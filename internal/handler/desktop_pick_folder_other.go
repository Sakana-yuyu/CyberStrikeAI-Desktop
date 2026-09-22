//go:build !windows

package handler

import "errors"

// pickNativeFolder 非 Windows 平台暂不支持原生文件夹选择（浏览器里直接粘贴路径即可）
func pickNativeFolder(title, startDir string) (string, bool, error) {
	return "", false, errors.New("当前平台不支持原生文件夹选择，请直接输入路径")
}
