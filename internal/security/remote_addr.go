package security

import (
	"net"
	"strings"
)

// IsLoopbackRemoteAddr 仅根据 TCP 对端地址判断请求是否来自本机，不读取代理转发头。
func IsLoopbackRemoteAddr(remoteAddr string) bool {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return false
	}
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		remoteAddr = host
	}
	remoteAddr = strings.TrimPrefix(strings.TrimSuffix(remoteAddr, "]"), "[")
	ip := net.ParseIP(remoteAddr)
	return ip != nil && ip.IsLoopback()
}
