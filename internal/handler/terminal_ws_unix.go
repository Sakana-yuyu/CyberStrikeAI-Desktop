//go:build !windows

package handler

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
)

// RunCommandWS 提供交互式 Shell：基于 WebSocket + PTY 的长会话。
func (h *TerminalHandler) RunCommandWS(c *gin.Context) {
	h.acceptTerminalWS(c, startUnixPTY)
}

func startUnixPTY(cols, rows uint16) (ptySession, error) {
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	shell := "bash"
	if _, err := exec.LookPath(shell); err != nil {
		shell = "sh"
	}
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(),
		"COLUMNS=80",
		"LINES=24",
		"TERM=xterm-256color",
	)
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return nil, fmt.Errorf("start pty: %w", err)
	}
	return &unixPTY{file: ptmx, cmd: cmd}, nil
}

type unixPTY struct {
	file *os.File
	cmd  *exec.Cmd
}

func (p *unixPTY) Read(b []byte) (int, error)  { return p.file.Read(b) }
func (p *unixPTY) Write(b []byte) (int, error) { return p.file.Write(b) }

func (p *unixPTY) Resize(cols, rows uint16) error {
	if cols == 0 || rows == 0 {
		return nil
	}
	if err := pty.Setsize(p.file, &pty.Winsize{Cols: cols, Rows: rows}); err != nil {
		return fmt.Errorf("resize pty: %w", err)
	}
	return nil
}

func (p *unixPTY) Close() error {
	var err error
	if p.cmd != nil && p.cmd.Process != nil {
		if killErr := p.cmd.Process.Kill(); killErr != nil && p.cmd.ProcessState == nil {
			err = fmt.Errorf("kill shell: %w", killErr)
		}
	}
	if p.file != nil {
		if closeErr := p.file.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
		p.file = nil
	}
	return err
}
