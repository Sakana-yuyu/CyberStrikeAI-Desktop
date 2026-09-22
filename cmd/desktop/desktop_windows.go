//go:build windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// 弹窗与 ShellExecute 常量（x/sys/windows 未完整导出，这里按 Win32 取值）
const (
	mbOK                    = 0x00000000
	mbIconError             = 0x00000010
	mbIconInformation       = 0x00000040
	mbTopmost               = 0x00040000
	swShownormal      int32 = 1
)

const singleInstanceMutexName = `Local\CyberStrikeAI-Desktop-SingleInstance`

var singleInstanceHandle windows.Handle

// openDesktopWindow 用 WebView2 打开原生窗口，阻塞直至窗口关闭。
// WebView2 运行时随 Edge 分发，Windows 10/11 一般自带；缺失时返回错误，由调用方退化为默认浏览器。
func openDesktopWindow(url string) error {
	// Win32 窗口与消息循环必须固定在创建它的线程上
	runtime.LockOSThread()

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  webview2DataDir(),
		WindowOptions: webview2.WindowOptions{
			Title:  desktopAppTitle,
			Width:  desktopWindowWidth,
			Height: desktopWindowHeight,
			Center: true,
			// 资源 ID 1 = windows_resource.rc 中的应用图标（与 exe 文件图标同源）
			IconId: 1,
		},
	})
	if w == nil {
		return errors.New("WebView2 初始化失败，可能未安装 WebView2 运行时（可从 https://developer.microsoft.com/microsoft-edge/webview2/ 安装）")
	}
	defer w.Destroy()
	w.Navigate(url)
	w.Run()
	return nil
}

// webview2DataDir 将 WebView2 的用户数据（localStorage/会话 Cookie）固定到用户目录，
// 避免落在随工作目录漂移的位置
func webview2DataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	if base == "" {
		return ""
	}
	return filepath.Join(base, "CyberStrikeAI", "WebView2")
}

func desktopAlert(title, message string) {
	titlePtr, _ := windows.UTF16PtrFromString(title)
	msgPtr, _ := windows.UTF16PtrFromString(message)
	_, _ = windows.MessageBox(0, msgPtr, titlePtr, mbOK|mbIconInformation|mbTopmost)
}

// desktopFail 记录到桌面日志、弹窗提示并退出（GUI 模式下用户看不到控制台）
func desktopFail(message string) {
	appendDesktopLog("FATAL: " + message)
	desktopAlert(desktopAppTitle, message)
	os.Exit(1)
}

func openInBrowser(url string) error {
	urlPtr, err := windows.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	verbPtr, _ := windows.UTF16PtrFromString("open")
	return windows.ShellExecute(0, verbPtr, urlPtr, nil, nil, swShownormal)
}

// alreadyRunning 通过命名互斥体保证单实例；
// 互斥体存在时 CreateMutex 仍返回有效句柄且 GetLastError 为 ERROR_ALREADY_EXISTS
func alreadyRunning() bool {
	namePtr, err := windows.UTF16PtrFromString(singleInstanceMutexName)
	if err != nil {
		return false
	}
	h, err := windows.CreateMutex(nil, false, namePtr)
	if h != 0 && errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(h)
		return true
	}
	singleInstanceHandle = h
	return false
}

func releaseSingleInstance() {
	if singleInstanceHandle != 0 {
		_ = windows.ReleaseMutex(singleInstanceHandle)
		_ = windows.CloseHandle(singleInstanceHandle)
		singleInstanceHandle = 0
	}
}

// focusExistingWindow 把已打开的桌面窗口拉到前台。窗口标题始终带 CyberStrikeAI。
func focusExistingWindow() bool {
	var target windows.HWND
	cb := windows.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		handle := windows.HWND(hwnd)
		if !windows.IsWindowVisible(handle) {
			return 1
		}
		if strings.Contains(windowText(handle), desktopAppTitle) {
			target = handle
			return 0
		}
		return 1
	})
	_ = windows.EnumWindows(cb, nil)
	if target == 0 {
		return false
	}
	foreground := windows.GetForegroundWindow()
	var foregroundThread uint32
	if foreground != 0 {
		if tid, err := windows.GetWindowThreadProcessId(foreground, nil); err == nil {
			foregroundThread = tid
		}
	}
	currentThread := windows.GetCurrentThreadId()
	attached := false
	if foregroundThread != 0 && foregroundThread != currentThread {
		if r, _, _ := procAttachThreadInput.Call(uintptr(foregroundThread), uintptr(currentThread), 1); r != 0 {
			attached = true
		}
	}
	const swRestore = 9
	procShowWindow.Call(uintptr(target), swRestore)
	procSetForegroundWindow.Call(uintptr(target))
	if attached {
		procAttachThreadInput.Call(uintptr(foregroundThread), uintptr(currentThread), 0)
	}
	return true
}

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procGetWindowTextW      = user32.NewProc("GetWindowTextW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procAttachThreadInput   = user32.NewProc("AttachThreadInput")
)

func windowText(hwnd windows.HWND) string {
	buf := make([]uint16, 512)
	n, _, _ := procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return ""
	}
	return windows.UTF16ToString(buf)
}

func instanceStateDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	return filepath.Join(base, "CyberStrikeAI")
}

func writeInstanceURL(url string) {
	dir := instanceStateDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(dir, "instance.url"), []byte(url), 0600)
}

func readInstanceURL() string {
	data, err := os.ReadFile(filepath.Join(instanceStateDir(), "instance.url"))
	if err != nil {
		return ""
	}
	url := string(data)
	if len(url) > 256 || !strings.HasPrefix(url, "http://127.0.0.1:") {
		return ""
	}
	return url
}
