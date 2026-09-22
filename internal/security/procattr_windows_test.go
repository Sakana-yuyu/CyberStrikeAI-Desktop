//go:build windows

package security

import (
	"os/exec"
	"syscall"
	"testing"
)

// 桌面端（windowsgui）派生控制台子进程时不得弹窗：所有工具执行路径都要隐藏窗口
func TestPrepareShellCmdSessionHidesConsoleWindow(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "echo", "ok")
	if err := prepareShellCmdSession(cmd); err != nil {
		t.Fatal(err)
	}
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr missing")
	}
	if cmd.SysProcAttr.CreationFlags&0x08000000 == 0 {
		t.Fatal("CREATE_NO_WINDOW not set")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow not set")
	}
	if cmd.SysProcAttr.CreationFlags&syscall.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatal("CREATE_NEW_PROCESS_GROUP lost")
	}
}

func TestHideConsoleWindowIdempotentAndNilSafe(t *testing.T) {
	HideConsoleWindow(nil)
	cmd := exec.Command("python", "-c", "print(1)")
	HideConsoleWindow(cmd)
	HideConsoleWindow(cmd)
	if cmd.SysProcAttr.CreationFlags&0x08000000 == 0 || !cmd.SysProcAttr.HideWindow {
		t.Fatal("flags missing after repeated application")
	}
}
