package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/security"
	"github.com/gin-gonic/gin"
)

func TestChannelChecksPermissionAndValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &ConfigHandler{config: &config.Config{AI: config.AIConfig{Channels: map[string]config.AIChannelConfig{
		"custom": {BaseURL: "https://example.com/v1", APIKey: "stored-secret"},
	}}}}
	for _, tc := range []struct {
		name, path, body string
		allowed          bool
		status           int
		contains         string
	}{
		{"balance denied", "/balance", `{}`, false, 403, "permission"},
		{"probe denied", "/probe", `{}`, false, 403, "permission"},
		{"malformed", "/balance", `{`, true, 400, "invalid"},
		{"missing key", "/balance", `{}`, true, 400, "required"},
		{"missing channel", "/balance", `{"channel_id":"missing"}`, true, 404, "not found"},
		{"saved unsupported", "/balance", `{"channel_id":"custom","base_url":"https://api.deepseek.com","api_key":"draft-secret"}`, true, 200, "unavailable"},
		{"private probe", "/probe", `{"base_url":"https://127.0.0.1","api_key":"secret","model":"model"}`, true, 200, "non-public"},
		{"missing model", "/probe", `{"api_key":"secret"}`, true, 400, "required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(security.ContextSessionKey, security.Session{UserID: "test", Permissions: map[string]bool{"config:write": tc.allowed}})
			})
			router.POST("/balance", h.ChannelBalance)
			router.POST("/probe", h.TestOpenAI)
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, req)
			body := recorder.Body.String()
			if recorder.Code != tc.status || !strings.Contains(body, tc.contains) {
				t.Fatalf("%d: %s", recorder.Code, body)
			}
			if strings.Contains(body, "secret") {
				t.Fatal("response exposed a key")
			}
		})
	}
}
