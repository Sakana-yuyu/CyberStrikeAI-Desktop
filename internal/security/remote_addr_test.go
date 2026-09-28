package security

import "testing"

func TestIsLoopbackRemoteAddr(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		want       bool
	}{
		{name: "ipv4 loopback", remoteAddr: "127.0.0.1:54321", want: true},
		{name: "ipv6 loopback", remoteAddr: "[::1]:54321", want: true},
		{name: "bare ipv4 loopback", remoteAddr: "127.0.0.1", want: true},
		{name: "external address", remoteAddr: "192.0.2.7:54321", want: false},
		{name: "hostname", remoteAddr: "localhost:54321", want: false},
		{name: "invalid address", remoteAddr: "not-an-ip", want: false},
		{name: "empty address", remoteAddr: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsLoopbackRemoteAddr(tt.remoteAddr); got != tt.want {
				t.Fatalf("IsLoopbackRemoteAddr(%q) = %v, want %v", tt.remoteAddr, got, tt.want)
			}
		})
	}
}
