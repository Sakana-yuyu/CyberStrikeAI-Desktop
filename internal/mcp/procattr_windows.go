//go:build windows

package mcp

import (
	"os/exec"
	"syscall"
)

// hideConsoleWindow 禁止 MCP stdio 子进程弹出控制台窗口（GUI 桌面进程派生
// python/node 等控制台子进程时 Windows 会为其创建可见控制台）。
// 与 security.HideConsoleWindow 等价；mcp 不能引用 security（import cycle），故本包自带。
func hideConsoleWindow(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= 0x08000000 // CREATE_NO_WINDOW
	cmd.SysProcAttr.HideWindow = true
}
