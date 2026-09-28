package main

import "testing"

func TestScaleByDPI(t *testing.T) {
	cases := []struct {
		name             string
		width, height    uint
		dpi              uint
		screenW, screenH uint
		wantW, wantH     uint
	}{
		{name: "96dpi unchanged", width: 1440, height: 900, dpi: 96, screenW: 1920, screenH: 1080, wantW: 1440, wantH: 900},
		{name: "150 percent", width: 1440, height: 900, dpi: 144, screenW: 2560, screenH: 1440, wantW: 2160, wantH: 1350},
		{name: "clamped to screen", width: 1440, height: 900, dpi: 192, screenW: 1920, screenH: 1080, wantW: 1872, wantH: 1032},
		{name: "unknown dpi", width: 1440, height: 900, dpi: 0, screenW: 1920, screenH: 1080, wantW: 1440, wantH: 900},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotW, gotH := scaleByDPI(tc.width, tc.height, tc.dpi, tc.screenW, tc.screenH)
			if gotW != tc.wantW || gotH != tc.wantH {
				t.Fatalf("scaleByDPI() = %d x %d, want %d x %d", gotW, gotH, tc.wantW, tc.wantH)
			}
		})
	}
}
