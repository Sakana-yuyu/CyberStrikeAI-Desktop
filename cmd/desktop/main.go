// CyberStrikeAI 桌面端入口：进程内启动主服务（默认仅绑定 127.0.0.1），
// 并用系统 WebView（Windows 为 WebView2）打开原生窗口。
// Web 端零改动：窗口加载的就是本机 HTTP 服务，WebSocket/SSE/上传下载全部按浏览器语义工作。
//
// 桌面模式与 cmd/server 的差异：
//   - 强制纯 HTTP（自签证书在嵌入式 WebView 中会被直接拒绝），监听 127.0.0.1（--listen 可覆盖）
//   - 端口被占用时自动换可用端口（需在 app.New 之前确定，C2 等模块注册时读取该端口）
//   - 无控制台时（-H=windowsgui 构建）stdout/stderr 日志与首次启动的初始管理员密码横幅
//     会落到 logs/ 并以弹窗展示
//   - 单实例保护：两个进程同时写同一个 SQLite 会互相锁死，重复启动时直接打开已有实例
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"

	"cyberstrike-ai/internal/app"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/logger"
	"cyberstrike-ai/internal/termout"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// ansiRe 去除终端彩色转义序列，弹窗/日志文件里只保留纯文本
var ansiRe = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")

const (
	desktopWindowWidth  = 1440
	desktopWindowHeight = 900
	desktopAppTitle     = "CyberStrikeAI"
)

func main() {
	var configPath = flag.String("config", "config.yaml", "Path to the configuration file")
	var listenHost = flag.String("listen", "", "Override the web listen host (desktop default: 127.0.0.1; use 0.0.0.0 to expose on LAN)")
	var portFlag = flag.Int("port", 0, "Override the web port (default: config server.port; a free port is picked automatically when occupied)")
	var noWindow = flag.Bool("no-window", false, "Run without opening a desktop window (server-only mode, Ctrl+C to stop)")
	flag.Parse()

	// 桌面端常由资源管理器双击启动，工作目录未必在程序所在目录；
	// config.yaml、data/、web/ 等均为相对路径，这里先把配置路径转为绝对路径再对齐工作目录。
	cp := strings.TrimSpace(*configPath)
	if cp == "" {
		cp = "config.yaml"
	}
	if abs, absErr := filepath.Abs(cp); absErr == nil {
		cp = abs
	}
	ensureWorkingDir()

	localConfig, err := config.EnsureLocalConfig(cp)
	if err != nil {
		desktopFail("加载配置失败: " + err.Error())
	}
	cfg, err := config.Load(cp)
	if err != nil {
		desktopFail("加载配置失败: " + err.Error())
	}
	// 桌面窗口经本机回环地址加载页面，强制纯 HTTP
	config.ApplyPlainHTTPBootstrap(cfg)

	// 桌面模式：生成一次性引导令牌。窗口 URL 以 #dt=<token> 携带（fragment 不进
	// 服务器访问日志），前端用它调 /api/auth/desktop-session 换取会话，免去登录页。
	cfg.DesktopMode = true
	desktopToken, tokenErr := generateDesktopToken()
	if tokenErr != nil {
		desktopFail("生成桌面端引导令牌失败: " + tokenErr.Error())
	}
	cfg.DesktopBootstrapToken = desktopToken

	host := strings.TrimSpace(*listenHost)
	if host == "" {
		host = "127.0.0.1"
	}
	port := *portFlag
	if port <= 0 {
		port = cfg.Server.Port
	}
	if port <= 0 {
		port = 8080
	}
	if free, busy := pickFreePortIfBusy(host, port); busy {
		fmt.Fprintf(os.Stderr, "[desktop] port %d is busy, using %d instead\n", port, free)
		port = free
	}
	cfg.Server.Host = host
	cfg.Server.Port = port

	// 与服务端入口一致：MCP 启用且未配置鉴权时自动生成并回写
	if err := config.EnsureMCPAuth(cp, cfg); err != nil {
		desktopFail("配置 MCP 鉴权失败: " + err.Error())
	}

	// GUI 模式没有控制台，stdout/stderr 无处可看；落到文件便于排查
	logOutput := strings.TrimSpace(cfg.Log.Output)
	if !*noWindow && (logOutput == "" || logOutput == "stdout" || logOutput == "stderr") {
		logOutput = desktopLogPath("server.log")
		_ = os.MkdirAll(filepath.Dir(logOutput), 0755)
	}

	log := logger.New(cfg.Log.Level, logOutput, logger.DiagnosticOptions{
		Dir:           cfg.Log.DiagnosticDir,
		Disabled:      cfg.Log.DiagnosticDisabled,
		RetentionDays: cfg.Log.DiagnosticRetentionDays,
	})
	defer log.Sync()

	// 单实例：两个进程同时写同一个 SQLite 会互相加锁失败
	if !*noWindow && alreadyRunning() {
		if focusExistingWindow() {
			return
		}
		desktopAlert(desktopAppTitle, "CyberStrikeAI 桌面端已在运行。请切换到已打开的窗口。")
		return
	}
	defer releaseSingleInstance()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 捕获启动期 stdout：首次启动的配置创建提示与初始管理员密码只在 stdout 打印一次，
	// GUI 模式必须转存并弹窗展示，否则用户拿不到初始密码。
	// 注意 gin.DefaultWriter 在包初始化时已绑定原 stdout，管道拦不到 gin 日志，
	// 因此 GUI 模式下另外把 gin 的访问/错误日志改写到桌面日志文件。
	pr, pw, pipeErr := os.Pipe()
	origStdout := os.Stdout
	if pipeErr == nil {
		os.Stdout = pw
	}

	var desktopLog *os.File
	if !*noWindow {
		desktopLog = openDesktopLogFile()
		if desktopLog != nil {
			gin.DefaultWriter = desktopLog
			gin.DefaultErrorWriter = desktopLog
		}
	}

	if localConfig.Created {
		termout.PrintConfigCreated()
	}
	if cfg.MCP.Enabled {
		config.PrintMCPConfigJSON(cfg.MCP)
	}
	application, err := app.New(cfg, log, cp)

	var capture *stdoutCapture
	if pipeErr == nil {
		_ = pw.Close()
		os.Stdout = origStdout
		capture = startStdoutCapture(pr, desktopLog)
	}

	if err != nil {
		desktopFail("应用初始化失败: " + err.Error())
	}

	serverErr := make(chan error, 1)
	go func() { serverErr <- application.RunWithContext(ctx) }()

	baseURL := fmt.Sprintf("http://%s:%d/", host, port)
	if err := waitForHTTPReady(baseURL, serverErr, 30*time.Second); err != nil {
		application.Shutdown()
		desktopFail("服务启动失败: " + err.Error())
	}
	writeInstanceURL(baseURL)

	fmt.Println("CyberStrikeAI 桌面端已启动: " + baseURL)

	// 首次启动横幅（初始管理员密码等）在 GUI 模式下没有控制台可看，弹窗展示一次
	time.Sleep(150 * time.Millisecond)
	if banner := capture.snapshot(); banner != "" {
		if *noWindow {
			fmt.Println(banner)
		} else {
			desktopAlert(desktopAppTitle+" 首次启动", banner)
		}
	}

	if *noWindow {
		waitForSignal()
	} else if err := openDesktopWindow(baseURL + "#dt=" + desktopToken); err != nil {
		// WebView 不可用（如未安装 WebView2 运行时）时退化为默认浏览器
		fmt.Fprintf(os.Stderr, "[desktop] desktop window unavailable: %v\n", err)
		desktopAlert(desktopAppTitle, "无法创建桌面窗口（"+err.Error()+"），将在默认浏览器中打开。")
		if err := openInBrowser(baseURL); err != nil {
			desktopFail("打开页面失败: " + err.Error())
		}
		waitForSignal()
	}

	fmt.Println("正在关闭…")
	application.Shutdown()
	cancel()
}

func waitForSignal() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
}

// generateDesktopToken 生成每次启动随机的一次性引导令牌（hex，URL fragment 安全）
func generateDesktopToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// ensureWorkingDir 在 web/templates 等资源不在当前目录时，切换到 exe 所在目录
func ensureWorkingDir() {
	if _, err := os.Stat(filepath.Join("web", "templates")); err == nil {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	exeDir := filepath.Dir(exe)
	if _, err := os.Stat(filepath.Join(exeDir, "web", "templates")); err == nil {
		_ = os.Chdir(exeDir)
	}
}

// pickFreePortIfBusy 返回 (可用端口, 是否发生了替换)
func pickFreePortIfBusy(host string, port int) (int, bool) {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err == nil {
		_ = ln.Close()
		return port, false
	}
	ln, err = net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		desktopFail(fmt.Sprintf("无法在 %s 上监听: %v", host, err))
	}
	free := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return free, true
}

func waitForHTTPReady(baseURL string, serverErr <-chan error, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for {
		if resp, err := client.Get(baseURL); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode < 500 {
				return nil
			}
		}
		select {
		case err := <-serverErr:
			if err != nil {
				return err
			}
			return fmt.Errorf("服务器已意外退出")
		default:
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("等待 %s 就绪超时", baseURL)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// stdoutCapture 持续读取被接管的 stdout 管道，保留启动期横幅供弹窗展示
type stdoutCapture struct {
	mu     sync.Mutex
	lines  []string
	buffer int
}

// startStdoutCapture 持续读取被接管的 stdout 管道，保留启动期横幅供弹窗展示，
// 并把内容镜像到 sink（可为 nil）。termout 在打印时才读取 os.Stdout，
// 因此管道里只有交换窗口期内动态读取 os.Stdout 的输出。
func startStdoutCapture(pr *os.File, sink io.Writer) *stdoutCapture {
	c := &stdoutCapture{}
	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			c.mu.Lock()
			if c.buffer < 4096 {
				c.lines = append(c.lines, line)
				c.buffer += len(line)
			}
			c.mu.Unlock()
			if sink != nil {
				_, _ = io.WriteString(sink, line+"\n")
			}
		}
	}()
	return c
}

func (c *stdoutCapture) snapshot() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.TrimSpace(ansiRe.ReplaceAllString(strings.Join(c.lines, "\n"), ""))
}

func desktopLogPath(name string) string {
	return filepath.Join("logs", name)
}

// openDesktopLogFile 打开 GUI 模式下的桌面日志文件（gin 访问日志、启动横幅镜像）
func openDesktopLogFile() *os.File {
	path := desktopLogPath("startup.log")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil
	}
	return f
}

func appendDesktopLog(line string) {
	f := openDesktopLogFile()
	if f == nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(time.Now().Format(time.RFC3339) + " " + line + "\n")
}
