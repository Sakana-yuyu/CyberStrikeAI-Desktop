package handler

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// terminalResize is sent by the frontend when the xterm.js terminal is resized.
type terminalResize struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// ptySession is the interactive shell behind one terminal WebSocket.
type ptySession interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Resize(cols, rows uint16) error
	Close() error
}

// wsUpgrader 仅用于系统设置中的终端 WebSocket，会复用已有的登录保护（JWT 中间件在上层路由组）。
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// 认证在 Gin 路由层完成，同一站点的 HTTPS/WSS 直接放行。
		return true
	},
}

func (h *TerminalHandler) acceptTerminalWS(c *gin.Context, start func(cols, rows uint16) (ptySession, error)) {
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Debug("终端 WebSocket 升级失败", zap.Error(err))
		return
	}
	session, err := start(80, 24)
	if err != nil {
		h.logger.Warn("终端会话启动失败", zap.Error(err))
		msg := "\r\n\x1b[31m[终端启动失败] " + err.Error() + "\x1b[0m\r\n"
		if werr := conn.WriteMessage(websocket.TextMessage, []byte(msg)); werr != nil {
			h.logger.Debug("终端错误写回失败", zap.Error(werr))
		}
		if cerr := conn.Close(); cerr != nil {
			h.logger.Debug("终端连接关闭失败", zap.Error(cerr))
		}
		return
	}
	if err := servePTYSession(conn, session); err != nil {
		h.logger.Debug("终端会话结束", zap.Error(err))
	}
}

func servePTYSession(conn *websocket.Conn, session ptySession) error {
	defer func() {
		_ = session.Close()
		_ = conn.Close()
	}()

	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := session.Read(buf)
			if n > 0 {
				payload := make([]byte, n)
				copy(payload, buf[:n])
				if werr := conn.WriteMessage(websocket.BinaryMessage, payload); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	conn.SetReadLimit(64 * 1024)
	if err := conn.SetReadDeadline(time.Now().Add(terminalTimeout)); err != nil {
		return err
	}
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(terminalTimeout))
	})

	var sessionErr error
	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			if !isTerminalSocketClosed(err) {
				sessionErr = err
			}
			break
		}
		if msgType != websocket.TextMessage && msgType != websocket.BinaryMessage {
			continue
		}
		if len(data) == 0 {
			continue
		}
		if msgType == websocket.TextMessage && data[0] == '{' {
			var resize terminalResize
			if json.Unmarshal(data, &resize) == nil && resize.Type == "resize" && resize.Cols > 0 && resize.Rows > 0 {
				if err := session.Resize(resize.Cols, resize.Rows); err != nil {
					sessionErr = err
					break
				}
				continue
			}
		}
		if _, err := session.Write(data); err != nil {
			sessionErr = err
			break
		}
	}
	<-done
	return sessionErr
}

func isTerminalSocketClosed(err error) bool {
	return websocket.IsCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseAbnormalClosure,
	) || errors.Is(err, net.ErrClosed)
}
