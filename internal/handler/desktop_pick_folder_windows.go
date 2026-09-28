//go:build windows

package handler

import (
	"errors"
	"fmt"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// pickNativeFolder 弹出系统「选择文件夹」对话框（IFileOpenDialog + FOS_PICKFOLDERS），
// 返回 (绝对路径, 是否取消, 错误)。
// 浏览器/WebView 的 <input webkitdirectory> 拿不到本机绝对路径（安全设计），
// 桌面端只能由进程自己调 Win32 对话框取得路径。

const (
	coinitApartmentThreaded = 0x2
	clsctxInprocServer      = 0x1

	fosPickFolders     = 0x20
	fosForceFilesystem = 0x40
	fosPathMustExist   = 0x800

	sigdnFileSysPath = 0x80058000

	hresultCancelled = 0x800704C7 // ERROR_CANCELLED (1223)
)

var (
	clsidFileOpenDialog = windows.GUID{Data1: 0xDC1C5A9C, Data2: 0xE88A, Data3: 0x4DDE, Data4: [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidIFileOpenDialog  = windows.GUID{Data1: 0xD57C7288, Data2: 0xD4AD, Data3: 0x4768, Data4: [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}

	ole32          = windows.NewLazySystemDLL("ole32.dll")
	procCoInit     = ole32.NewProc("CoInitializeEx")
	procCoCreate   = ole32.NewProc("CoCreateInstance")
	procCoUninit   = ole32.NewProc("CoUninitialize")
	procCoTaskFree = ole32.NewProc("CoTaskMemFree")

	user32       = windows.NewLazySystemDLL("user32.dll")
	procForegWnd = user32.NewProc("GetForegroundWindow")

	shell32           = windows.NewLazySystemDLL("shell32.dll")
	procShCreateItem  = shell32.NewProc("SHCreateItemFromParsingName")
	iidIShellItemGUID = windows.GUID{Data1: 0x43826D1E, Data2: 0xE718, Data3: 0x42EE, Data4: [8]byte{0xBC, 0x55, 0xA1, 0xE2, 0x61, 0xC3, 0x7B, 0xFE}}
)

// COM vtable 偏移（据 Windows SDK ShObjIdl_core.h 逐行核对）：
// IUnknown 0-2；IModalWindow::Show=3；
// IFileDialog：SetOptions=9、GetOptions=10、SetFolder=12、GetFolder=13、
//
//	SetTitle=17、GetResult=20（注意 21 AddPlace/22 SetDefaultExtension 常被漏数）；
//
// IShellItem::GetDisplayName=5
func comVtbl(obj unsafe.Pointer, index int) uintptr {
	if obj == nil {
		return 0
	}
	vt := *(*unsafe.Pointer)(obj)
	return *(*uintptr)(unsafe.Add(vt, uintptr(index)*unsafe.Sizeof(uintptr(0))))
}

func comCall(obj unsafe.Pointer, index int, args ...uintptr) uintptr {
	fn := comVtbl(obj, index)
	r1, _, _ := syscall.SyscallN(fn, append([]uintptr{uintptr(obj)}, args...)...)
	return r1
}

func comRelease(obj unsafe.Pointer) {
	_ = comCall(obj, 2)
}

// shCreateItemFromParsingName 由绝对路径创建 IShellItem（SetFolder 用）
func shCreateItemFromParsingName(path string) (unsafe.Pointer, uint32) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, 0xFFFFFFFF
	}
	var item unsafe.Pointer
	hr, _, _ := procShCreateItem.Call(
		uintptr(unsafe.Pointer(ptr)),
		0,
		uintptr(unsafe.Pointer(&iidIShellItemGUID)),
		uintptr(unsafe.Pointer(&item)),
	)
	return item, uint32(hr)
}

func pickNativeFolder(title, startDir string) (string, bool, error) {
	// COM 单元初始化：HTTP handler 所在 goroutine 独立初始化即可
	hr, _, _ := procCoInit.Call(0, coinitApartmentThreaded)
	needUninit := hr == 0 || hr == 0x80010106 // S_FALSE：本线程已初始化
	if hr != 0 && hr != 0x80010106 {
		return "", false, fmt.Errorf("CoInitializeEx 失败: 0x%x", hr)
	}
	defer func() {
		if needUninit {
			_, _, _ = procCoUninit.Call()
		}
	}()

	var dlg unsafe.Pointer
	hr, _, _ = procCoCreate.Call(
		uintptr(unsafe.Pointer(&clsidFileOpenDialog)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIFileOpenDialog)),
		uintptr(unsafe.Pointer(&dlg)),
	)
	if hr != 0 || dlg == nil {
		return "", false, fmt.Errorf("创建对话框失败: 0x%x", hr)
	}
	defer comRelease(dlg)

	// SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)，保留原有位
	var curOpts uintptr
	comCall(dlg, 10, uintptr(unsafe.Pointer(&curOpts)))
	comCall(dlg, 9, curOpts|fosPickFolders|fosForceFilesystem|fosPathMustExist)

	if t := strings.TrimSpace(title); t != "" {
		if titlePtr, err := windows.UTF16PtrFromString(t); err == nil {
			comCall(dlg, 17, uintptr(unsafe.Pointer(titlePtr)))
		}
	}

	// SetFolder：指定初始目录（空则由系统记住上次位置）
	if d := strings.TrimSpace(startDir); d != "" {
		if item, hr := shCreateItemFromParsingName(d); hr == 0 && item != nil {
			comCall(dlg, 12, uintptr(item))
			comRelease(item)
		}
	}

	hwnd, _, _ := procForegWnd.Call()
	// Show 返回 HRESULT：用户取消 = 0x80070490，其他非零为真失败
	if showHR := comCall(dlg, 3, hwnd); showHR != 0 {
		if uint32(showHR) == hresultCancelled {
			return "", true, nil
		}
		return "", false, fmt.Errorf("对话框失败: 0x%x", uint32(showHR))
	}

	// IFileDialog::GetResult(20) 取选中项（IShellItem）。
	// 注：IFileDialog 方法顺序（SDK 头文件 ShObjIdl_core.h）：
	//   19 SetFileNameLabel, 20 GetResult, 21 AddPlace, 22 SetDefaultExtension,
	//   23 Close, 24 SetClientGuid, 25 ClearClientData, 26 SetFilter，
	//   27/28 才是 GetResults/GetSelectedItems。
	// 浏览进目录但未显式选中时（如程序化确认）GetResult 可能为空，
	// 回退 GetFolder(13) 取当前浏览目录——对文件夹选择语义一致。
	var item unsafe.Pointer
	hr = comCall(dlg, 20, uintptr(unsafe.Pointer(&item)))
	if hr != 0 || item == nil {
		item = nil
		folderHR := comCall(dlg, 13, uintptr(unsafe.Pointer(&item)))
		if folderHR != 0 || item == nil {
			return "", false, fmt.Errorf("未选择文件夹: 0x%x", uint32(folderHR))
		}
	}
	defer comRelease(item)

	var pathPtr *uint16
	if hr := comCall(item, 5, uintptr(sigdnFileSysPath), uintptr(unsafe.Pointer(&pathPtr))); hr != 0 || pathPtr == nil {
		return "", false, fmt.Errorf("获取路径失败: 0x%x", uint32(hr))
	}
	defer procCoTaskFree.Call(uintptr(unsafe.Pointer(pathPtr)))

	path := windows.UTF16PtrToString(pathPtr)
	if strings.TrimSpace(path) == "" {
		return "", false, errors.New("选择的路径为空")
	}
	return path, false, nil
}
