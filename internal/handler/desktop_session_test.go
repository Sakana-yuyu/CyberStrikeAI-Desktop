package handler

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func newDesktopSessionTestEnv(t *testing.T, desktopMode bool, token string) (*security.AuthManager, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := database.NewDB(filepath.Join(t.TempDir(), "desktop-session.db"), zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	manager := security.NewAuthManager(12)
	if _, err := manager.AttachRBACStore(db); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		Auth: config.AuthConfig{SessionDurationHours: 12},
	}
	cfg.DesktopMode = desktopMode
	cfg.DesktopBootstrapToken = token
	router := gin.New()
	router.POST("/api/auth/desktop-session", NewAuthHandler(manager, cfg, "config.yaml", zap.NewNop()).DesktopSession)
	return manager, router
}

func postDesktopSession(router *gin.Engine, token string, remoteAddr string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/desktop-session", strings.NewReader(`{"desktop_token":"`+token+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = remoteAddr
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func TestDesktopSessionExchangesBootstrapToken(t *testing.T) {
	manager, router := newDesktopSessionTestEnv(t, true, "bootstrap-secret-token")

	resp := postDesktopSession(router, "bootstrap-secret-token", "127.0.0.1:54321")
	if resp.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"token"`) ||
		!strings.Contains(resp.Body.String(), `"permissions"`) {
		t.Fatalf("unexpected response: %s", resp.Body.String())
	}
	// 返回的 token 必须是可用的 admin 会话
	var payload struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(resp, &payload); err != nil {
		t.Fatal(err)
	}
	session, ok := manager.ValidateToken(payload.Token)
	if !ok || session.Username != "admin" {
		t.Fatalf("minted session invalid: ok=%v user=%v", ok, session.Username)
	}
	if !session.Permissions["project:write"] {
		t.Fatalf("expected admin permissions in desktop session")
	}
}

func TestDesktopSessionRejectsWrongTokenAndNonLoopback(t *testing.T) {
	_, router := newDesktopSessionTestEnv(t, true, "bootstrap-secret-token")

	if resp := postDesktopSession(router, "wrong-token", "127.0.0.1:54321"); resp.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token should be 401, got %d: %s", resp.Code, resp.Body.String())
	}
	if resp := postDesktopSession(router, "bootstrap-secret-token", "192.0.2.7:54321"); resp.Code != http.StatusForbidden {
		t.Fatalf("non-loopback client should be 403, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestDesktopSessionRejectsForwardedLoopbackFromRemotePeer(t *testing.T) {
	_, router := newDesktopSessionTestEnv(t, true, "bootstrap-secret-token")
	req := httptest.NewRequest(http.MethodPost, "/api/auth/desktop-session", strings.NewReader(`{"desktop_token":"bootstrap-secret-token"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", "127.0.0.1")
	req.RemoteAddr = "192.0.2.7:54321"
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("forwarded loopback must not override remote peer, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestDesktopSessionDisabledOutsideDesktopMode(t *testing.T) {
	_, router := newDesktopSessionTestEnv(t, false, "bootstrap-secret-token")
	resp := postDesktopSession(router, "bootstrap-secret-token", "127.0.0.1:54321")
	if resp.Code != http.StatusNotFound {
		t.Fatalf("non-desktop mode should be 404, got %d: %s", resp.Code, resp.Body.String())
	}
}
