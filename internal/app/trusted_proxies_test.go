package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestConfigureTrustedProxiesDefaultsToNoForwardedHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := configureTrustedProxies(router, nil); err != nil {
		t.Fatal(err)
	}
	router.GET("/ip", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = "192.0.2.7:54321"
	req.Header.Set("X-Forwarded-For", "127.0.0.1")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK || resp.Body.String() != "192.0.2.7" {
		t.Fatalf("untrusted forwarded IP changed client IP: status=%d body=%q", resp.Code, resp.Body.String())
	}
}

func TestConfigureTrustedProxiesAllowsConfiguredProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := configureTrustedProxies(router, []string{"127.0.0.1"}); err != nil {
		t.Fatal(err)
	}
	router.GET("/ip", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })

	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set("X-Forwarded-For", "198.51.100.8")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK || resp.Body.String() != "198.51.100.8" {
		t.Fatalf("configured proxy forwarded IP not honored: status=%d body=%q", resp.Code, resp.Body.String())
	}
}
