//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// 非 Windows 平台暂无内置原生窗口（jchv/go-webview2 仅支持 Windows），
// 桌面模式退化为“无头服务 + 系统默认浏览器”，服务与桌面流程保持一致。
func openDesktopWindow(url string) error {
	return errors.New("此平台暂不支持原生桌面窗口")
}

func desktopAlert(title, message string) {
	fmt.Fprintf(os.Stderr, "[%s] %s\n", title, message)
}

func desktopFail(message string) {
	appendDesktopLog("FATAL: " + message)
	fmt.Fprintln(os.Stderr, "FATAL: "+message)
	os.Exit(1)
}

func openInBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

func alreadyRunning() bool { return false }

func focusExistingWindow() bool { return false }

func releaseSingleInstance() {}

func writeInstanceURL(url string) {}

func readInstanceURL() string { return "" }
