package channelcheck

import (
	"context"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fixtureClient(body string, status int) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
}

func TestBalanceContracts(t *testing.T) {
	for _, tc := range []struct{ name, provider, body, want string }{
		{"deepseek zero", "deepseek", `{"is_available":false,"balance_infos":[{"currency":"CNY","total_balance":"0.00"}]}`, "0.00"},
		{"siliconflow", "siliconflow", `{"code":20000,"data":{"totalBalance":"12.30"}}`, "12.30"},
		{"moonshot", "moonshot", `{"code":0,"status":true,"data":{"available_balance":-1}}`, "-1"},
		{"openrouter", "openrouter", `{"data":{"total_credits":20,"total_usage":5}}`, "15"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			amounts, err := parseBalance(tc.provider, []byte(tc.body))
			if err != nil || len(amounts) != 1 || amounts[0].Remaining != tc.want {
				t.Fatalf("amounts=%v err=%v", amounts, err)
			}
		})
	}
	for _, provider := range []string{"deepseek", "siliconflow", "moonshot", "openrouter"} {
		for _, body := range []string{`{}`, `{"data":{}}`, `null`, `<html>error</html>`} {
			if _, err := parseBalance(provider, []byte(body)); err == nil {
				t.Errorf("%s accepted %s", provider, body)
			}
		}
	}
	for _, value := range []string{"NaN", "Inf", "", "1e999"} {
		if validAmount(value) {
			t.Errorf("accepted %q", value)
		}
	}
}

func TestOfficialOriginsOnly(t *testing.T) {
	for _, raw := range []string{
		"https://api.deepseek.com.evil.example/v1", "https://api.deepseek.com@evil.example/v1",
		"http://api.deepseek.com/v1", "https://api.deepseek.com:444/v1", "https://api.deepseek.com/proxy/v1",
		"https://api.deepseek.com/v1?key=secret", "https://api.openai.com/v1", "https://api.anthropic.com",
	} {
		result, err := QueryBalance(context.Background(), &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			t.Fatal("unsupported origin made a network request")
			return nil, nil
		})}, raw, "secret")
		if err != nil || result.Status != "unavailable" || len(result.Amounts) != 0 {
			t.Fatalf("%s: %+v %v", raw, result, err)
		}
	}
	provider, endpoint := BalanceEndpoint("https://api.deepseek.com/v1/")
	if provider != "deepseek" || endpoint != "https://api.deepseek.com/user/balance" {
		t.Fatal(provider, endpoint)
	}
}

func TestProbeProtocols(t *testing.T) {
	for _, tc := range []struct{ provider, base, path, header, body string }{
		{"openai_compatible", "https://api.deepseek.com/v1", "/v1/chat/completions", "Authorization", `{"choices":[{"message":{"role":"assistant"}}]}`},
		{"claude", "https://api.anthropic.com", "/v1/messages", "x-api-key", `{"type":"message","role":"assistant","content":[{"type":"text","text":"Hi"}]}`},
	} {
		client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.Path != tc.path || !strings.Contains(r.Header.Get(tc.header), "secret") {
				t.Fatal("incorrect path or authentication")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})}
		if err := Probe(context.Background(), client, tc.provider, tc.base, "secret", "model"); err != nil {
			t.Fatal(err)
		}
	}
	if err := Probe(context.Background(), fixtureClient(`{}`, 200), "openai", "https://example.com/v1", "secret", "model"); err == nil {
		t.Fatal("accepted empty response")
	}
}

func TestErrorsNeverExposeBody(t *testing.T) {
	for _, status := range []int{401, 403, 429, 500} {
		_, err := Request(context.Background(), fixtureClient("secret echoed by vendor", status), "GET", "https://example.com", "secret", nil, false)
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("unsafe error: %v", err)
		}
	}
	_, err := Request(context.Background(), fixtureClient(strings.Repeat("x", maxResponseBytes+1), 200), "GET", "https://example.com", "secret", nil, false)
	if err == nil {
		t.Fatal("accepted oversized response")
	}
}

func TestDestinationPolicy(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "100.100.100.200", "198.18.0.1", "2002:7f00:1::"} {
		if publicIP(netip.MustParseAddr(ip)) {
			t.Errorf("accepted %s", ip)
		}
	}
	if !publicIP(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("rejected public IP")
	}
	for _, raw := range []string{"http://example.com", "https://localhost:8080", "https://127.0.0.1", "https://user:secret@example.com", "https://example.com?q=secret"} {
		if _, err := baseURL(raw); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	client := Client()
	if client.Timeout == 0 || client.CheckRedirect(&http.Request{}, nil) == nil {
		t.Fatal("missing HTTP safeguards")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := publicDial(ctx, "tcp", "127.0.0.1:443"); err == nil {
		t.Fatal("dial accepted canceled private target")
	}
}
