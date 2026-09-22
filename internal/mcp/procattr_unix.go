//go:build !windows

package mcp

import "os/exec"

// hideConsoleWindow Unix 下无控制台窗口概念，空实现。
func hideConsoleWindow(cmd *exec.Cmd) {}
