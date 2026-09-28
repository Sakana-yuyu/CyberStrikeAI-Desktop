package security

import (
	"path/filepath"
	"runtime"
	"strings"
)

func defaultAgentShell() string {
	if runtime.GOOS == "windows" {
		return "powershell.exe"
	}
	return "/bin/sh"
}

func agentShellArgs(shell, command string) []string {
	if runtime.GOOS == "windows" {
		name := strings.ToLower(filepath.Base(shell))
		if name == "powershell.exe" || name == "pwsh.exe" {
			return []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command}
		}
	}
	return []string{"-c", command}
}
