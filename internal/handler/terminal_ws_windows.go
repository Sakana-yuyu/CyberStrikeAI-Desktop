//go:build windows

package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"time"
	"unsafe"

	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"golang.org/x/sys/windows"
)

// RunCommandWS 在 Windows 上用 ConPTY 提供交互式 Shell。
func (h *TerminalHandler) RunCommandWS(c *gin.Context) {
	h.acceptTerminalWS(c, startWindowsPTY)
}

func startWindowsPTY(cols, rows uint16) (ptySession, error) {
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}

	var inputRead, inputWrite, outputRead, outputWrite windows.Handle
	if err := windows.CreatePipe(&inputRead, &inputWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("create terminal input pipe: %w", err)
	}
	if err := windows.CreatePipe(&outputRead, &outputWrite, nil, 0); err != nil {
		_ = windows.CloseHandle(inputRead)
		_ = windows.CloseHandle(inputWrite)
		return nil, fmt.Errorf("create terminal output pipe: %w", err)
	}

	var console windows.Handle
	err := windows.CreatePseudoConsole(
		windows.Coord{X: int16(cols), Y: int16(rows)},
		inputRead,
		outputWrite,
		0,
		&console,
	)
	if err != nil {
		closeWindowsPipeHandles(inputRead, inputWrite, outputRead, outputWrite)
		return nil, fmt.Errorf("create pseudo console: %w", err)
	}

	shell := os.Getenv("COMSPEC")
	if shell == "" {
		shell = `C:\Windows\System32\cmd.exe`
	}
	// xterm.js decodes UTF-8. Switch the console code page before the prompt.
	command := `"` + shell + `" /K chcp 65001>nul`
	cmdLine, err := windows.UTF16FromString(command)
	if err != nil {
		closeWindowsPipeHandles(inputRead, inputWrite, outputRead, outputWrite)
		windows.ClosePseudoConsole(console)
		return nil, fmt.Errorf("prepare shell command: %w", err)
	}

	attrList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		closeWindowsPipeHandles(inputRead, inputWrite, outputRead, outputWrite)
		windows.ClosePseudoConsole(console)
		return nil, fmt.Errorf("prepare process attributes: %w", err)
	}
	defer attrList.Delete()
	// CreatePseudoConsole returns a pointer to an internal object. The kernel
	// reads that object's first handle, so the attribute value is the pointer
	// itself. STARTF_USESTDHANDLES with empty standard handles stops cmd.exe
	// from attaching to this process's console instead of the pseudoconsole.
	if err := attrList.Update(
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		unsafe.Pointer(uintptr(console)),
		unsafe.Sizeof(console),
	); err != nil {
		closeWindowsPipeHandles(inputRead, inputWrite, outputRead, outputWrite)
		windows.ClosePseudoConsole(console)
		return nil, fmt.Errorf("attach pseudo console: %w", err)
	}

	si := &windows.StartupInfoEx{
		StartupInfo: windows.StartupInfo{
			Cb:    uint32(unsafe.Sizeof(windows.StartupInfoEx{})),
			Flags: windows.STARTF_USESTDHANDLES,
		},
		ProcThreadAttributeList: attrList.List(),
	}
	var pi windows.ProcessInformation
	err = windows.CreateProcess(
		nil,
		&cmdLine[0],
		nil,
		nil,
		true,
		windows.EXTENDED_STARTUPINFO_PRESENT,
		nil,
		nil,
		&si.StartupInfo,
		&pi,
	)
	if err != nil {
		closeWindowsPipeHandles(inputRead, inputWrite, outputRead, outputWrite)
		windows.ClosePseudoConsole(console)
		return nil, fmt.Errorf("start shell: %w", err)
	}
	if err := windows.CloseHandle(pi.Thread); err != nil {
		_ = windows.TerminateProcess(pi.Process, 1)
		_ = windows.CloseHandle(pi.Process)
		closeWindowsPipeHandles(inputRead, inputWrite, outputRead, outputWrite)
		windows.ClosePseudoConsole(console)
		return nil, fmt.Errorf("close shell thread: %w", err)
	}

	return &windowsPTY{
		inputWrite:  inputWrite,
		outputRead:  outputRead,
		inputRead:   inputRead,
		outputWrite: outputWrite,
		console:     console,
		process:     pi.Process,
		pid:         pi.ProcessId,
	}, nil
}

func closeWindowsPipeHandles(handles ...windows.Handle) {
	for _, handle := range handles {
		if handle != 0 {
			_ = windows.CloseHandle(handle)
		}
	}
}

type windowsPTY struct {
	inputWrite  windows.Handle
	outputRead  windows.Handle
	inputRead   windows.Handle
	outputWrite windows.Handle
	console     windows.Handle
	process     windows.Handle
	pid         uint32
}

func (p *windowsPTY) Read(b []byte) (int, error) {
	if p.outputRead == 0 {
		return 0, os.ErrClosed
	}
	var n uint32
	err := windows.ReadFile(p.outputRead, b, &n, nil)
	if errors.Is(err, windows.ERROR_BROKEN_PIPE) {
		return int(n), io.EOF
	}
	return int(n), err
}

func (p *windowsPTY) Write(b []byte) (int, error) {
	if p.inputWrite == 0 {
		return 0, os.ErrClosed
	}
	var n uint32
	err := windows.WriteFile(p.inputWrite, b, &n, nil)
	if errors.Is(err, windows.ERROR_BROKEN_PIPE) {
		return int(n), io.EOF
	}
	return int(n), err
}

func (p *windowsPTY) Resize(cols, rows uint16) error {
	if p.console == 0 || cols == 0 || rows == 0 || cols > 500 || rows > 500 {
		return nil
	}
	if err := windows.ResizePseudoConsole(p.console, windows.Coord{X: int16(cols), Y: int16(rows)}); err != nil {
		return fmt.Errorf("resize terminal: %w", err)
	}
	return nil
}

func (p *windowsPTY) Close() error {
	var errs []error
	if p.inputWrite != 0 {
		if err := windows.CloseHandle(p.inputWrite); err != nil {
			errs = append(errs, err)
		}
		p.inputWrite = 0
	}
	if p.pid != 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		tk := exec.CommandContext(ctx, "taskkill", "/F", "/T", "/PID", strconv.FormatUint(uint64(p.pid), 10))
		security.HideConsoleWindow(tk)
		if err := tk.Run(); err != nil && p.process != 0 {
			if termErr := windows.TerminateProcess(p.process, 1); termErr != nil {
				errs = append(errs, fmt.Errorf("stop shell: %w", termErr))
			}
		}
		cancel()
		p.pid = 0
	}
	if p.process != 0 {
		if err := windows.CloseHandle(p.process); err != nil {
			errs = append(errs, err)
		}
		p.process = 0
	}
	if p.console != 0 {
		windows.ClosePseudoConsole(p.console)
		p.console = 0
	}
	closeWindowsPipeHandles(p.inputRead, p.outputWrite, p.outputRead)
	p.inputRead = 0
	p.outputWrite = 0
	p.outputRead = 0
	return errors.Join(errs...)
}
