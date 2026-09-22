// Package channelcheck implements user-initiated credential checks without logging secrets.
package channelcheck

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 256 * 1024

// Client deliberately bypasses environment proxies and rejects redirects and non-public IPs.
// Dialing the validated IP (not the hostname again) prevents DNS rebinding.
func Client() *http.Client {
	transport := &http.Transport{
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		DisableKeepAlives:     true,
		DialContext:           publicDial,
	}
	return &http.Client{
		Transport:     transport,
		Timeout:       30 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("redirects are not allowed") },
	}
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// Shared, benchmarking, documentation, and translation ranges are not public API targets.
	for _, cidr := range []string{
		"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24",
		"203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2001::/23", "64:ff9b::/96", "64:ff9b:1::/48", "2002::/16",
	} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}

func publicDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.New("invalid destination")
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("destination lookup failed")
	}
	for _, ip := range ips {
		if !publicIP(ip) {
			return nil, errors.New("non-public destinations are not allowed")
		}
	}
	dialer := net.Dialer{Timeout: 10 * time.Second}
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
	}
	return nil, errors.New("connection failed")
}

func baseURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, errors.New("invalid Base URL")
	}
	invalid := u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != ""
	if invalid {
		return nil, errors.New("Base URL must be HTTPS without credentials, query or fragment")
	}
	if port := u.Port(); port != "" && port != "443" {
		return nil, errors.New("only HTTPS port 443 is allowed")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !publicIP(ip) {
		return nil, errors.New("non-public destinations are not allowed")
	}
	return u, nil
}

// Request returns only local diagnostic messages, never upstream bodies, keys, or URLs.
func Request(ctx context.Context, client *http.Client, method, endpoint, key string, payload any, claude bool) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, errors.New("invalid probe payload")
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, errors.New("invalid request")
	}
	if claude {
		req.Header.Set("x-api-key", key)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("request failed (timeout, TLS, DNS or destination policy)")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("provider returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return nil, errors.New("invalid or oversized provider response")
	}
	return data, nil
}

// Probe performs a minimal billable generation, not merely a models-list request.
func Probe(ctx context.Context, client *http.Client, provider, rawURL, key, model string) error {
	u, err := baseURL(rawURL)
	if err != nil {
		return err
	}
	claude := strings.EqualFold(provider, "claude") || strings.EqualFold(provider, "anthropic")
	payload := map[string]any{
		"model":    model,
		"messages": []map[string]string{{"role": "user", "content": "Hi"}},
	}
	if claude {
		u.Path = strings.TrimSuffix(u.Path, "/")
		if !strings.HasSuffix(u.Path, "/v1") {
			u.Path += "/v1"
		}
		u.Path += "/messages"
		payload["max_tokens"] = 8
	} else {
		u.Path = strings.TrimSuffix(u.Path, "/") + "/chat/completions"
		if u.Hostname() == "api.openai.com" {
			payload["max_completion_tokens"] = 8
		} else {
			payload["max_tokens"] = 8
		}
	}
	u.RawPath = ""
	data, err := Request(ctx, client, http.MethodPost, u.String(), key, payload, claude)
	if err != nil {
		return err
	}
	var result struct {
		Choices []struct {
			Message struct {
				Role string `json:"role"`
			} `json:"message"`
		} `json:"choices"`
		Type    string            `json:"type"`
		Role    string            `json:"role"`
		Content []json.RawMessage `json:"content"`
	}
	if json.Unmarshal(data, &result) != nil {
		return errors.New("invalid generation response")
	}
	if claude {
		if result.Type == "message" && result.Role == "assistant" && len(result.Content) > 0 {
			return nil
		}
	} else if len(result.Choices) > 0 && result.Choices[0].Message.Role == "assistant" {
		return nil
	}
	return errors.New("provider did not return an assistant generation")
}
