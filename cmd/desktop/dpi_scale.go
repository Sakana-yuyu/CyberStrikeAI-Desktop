package main

// scaleByDPI 把按 96 DPI 设计的窗口尺寸换成物理像素，并限制在屏幕工作区内。
// 进程声明 Per-Monitor V2 之后，CreateWindow 的宽高是物理像素；不缩放的话高分屏窗口会变小。
func scaleByDPI(width, height, dpi, screenW, screenH uint) (uint, uint) {
	if dpi < 96 {
		dpi = 96
	}
	w := width * dpi / 96
	h := height * dpi / 96
	if screenW > 160 && w >= screenW {
		w = screenW - 48
	}
	if screenH > 120 && h >= screenH {
		h = screenH - 48
	}
	if w < 640 {
		w = 640
	}
	if h < 480 {
		h = 480
	}
	return w, h
}
