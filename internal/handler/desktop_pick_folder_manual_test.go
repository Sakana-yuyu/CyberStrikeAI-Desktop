//go:build manual

package handler

import "testing"

// TestPickNativeFolderManual 弹出真实系统对话框（需要人工或 UI 自动化点击确认）。
// 运行：go test -tags manual -run TestPickNativeFolderManual -v -timeout 60s ./internal/handler/
func TestPickNativeFolderManual(t *testing.T) {
	path, cancelled, err := pickNativeFolder("COM 对话框冒烟测试", `C:\Windows\Temp`)
	if err != nil {
		t.Fatalf("pickNativeFolder error: %v", err)
	}
	if cancelled {
		t.Fatalf("unexpected cancel")
	}
	if path == "" {
		t.Fatalf("empty path")
	}
	t.Logf("picked: %s", path)
}
