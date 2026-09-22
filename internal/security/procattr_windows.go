//go:build windows

package security

import (
	"context"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

func prepareShellCmdSession(cmd *exec.Cmd) error {
	if cmd == nil {
		return nil
	}
	// 独立进程组，便于 taskkill /T 终止整棵子进程树。
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags = syscall.CREATE_NEW_PROCESS_GROUP
	// 桌面端为 windowsgui 子系统进程，不给控制台子进程再弹出黑色控制台窗口
	HideConsoleWindow(cmd)
	return nil
}

// HideConsoleWindow 禁止子进程弹出控制台窗口（GUI 桌面进程派生 cmd/powershell/
// taskkill/python 等控制台子进程时 Windows 会为其创建可见控制台）。
// CREATE_NO_WINDOW 让子进程完全没有控制台；HideWindow 为已有控制台的场景兜底。
func HideConsoleWindow(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= 0x08000000 // CREATE_NO_WINDOW
	cmd.SysProcAttr.HideWindow = true
}

// terminateProcessGroup 使用 taskkill /F /T 终止进程及其子进程；rootPID 为 0 时回退到 cmd.Process.Pid。
func terminateProcessGroup(rootPID int, cmd *exec.Cmd) {
	pid := rootPID
	if pid <= 0 && cmd != nil && cmd.Process != nil {
		pid = cmd.Process.Pid
	}
	if pid <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	tk := exec.CommandContext(ctx, "taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	HideConsoleWindow(tk)
	if err := tk.Run(); err != nil {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}
}

// terminateCmdTree 使用 taskkill /F /T 终止进程及其子进程（Windows 上 Process.Kill 无法保证杀掉 python 等孙进程）。
func terminateCmdTree(cmd *exec.Cmd) {
	terminateProcessGroup(0, cmd)
}

func stopProcessGroup(pid int, cmd *exec.Cmd) {
	// Windows has no portable SIGTERM equivalent for arbitrary console jobs.
	terminateProcessGroup(pid, cmd)
}

// Windows taskkill /T is best effort; unlike a Unix PGID it has no persistent
// group handle to query after the root exits. Job Objects are needed for that.
func processGroupExists(pid int) bool { return false }
