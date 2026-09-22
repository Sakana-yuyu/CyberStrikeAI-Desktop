package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func newProjectLinkTestEnv(t *testing.T) (*database.DB, *gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := database.NewDB(filepath.Join(dir, "link.db"), zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	localDir := filepath.Join(dir, "LocalProject")
	if err := os.MkdirAll(filepath.Join(localDir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "README.md"), []byte("# demo"), 0644); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(security.ContextSessionKey, security.Session{UserID: "linker", Scope: database.RBACScopeAll})
		c.Next()
	})
	h := NewProjectHandler(db, zap.NewNop())
	router.POST("/api/projects/link-folder", h.LinkProjectFolder)
	return db, router, localDir
}

func postLinkFolder(t *testing.T, router *gin.Engine, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/projects/link-folder", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func TestLinkFolderCreatesProjectAndFact(t *testing.T) {
	db, router, localDir := newProjectLinkTestEnv(t)

	resp := postLinkFolder(t, router, `{"path":"`+filepath.ToSlash(localDir)+`"}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", resp.Code, resp.Body.String())
	}
	var payload struct {
		ProjectID  string `json:"projectId"`
		Project    string `json:"projectName"`
		LinkedPath string `json:"linkedPath"`
		Created    bool   `json:"created"`
	}
	if err := decodeJSON(resp, &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Created || payload.LinkedPath != localDir {
		t.Fatalf("unexpected payload: %+v (want path %s, created)", payload, localDir)
	}
	if p, err := db.GetProject(payload.ProjectID); err != nil || p.Name != "LocalProject" {
		t.Fatalf("project not created from folder name: %v %v", p, err)
	}
	fact, err := db.GetProjectFactByKey(payload.ProjectID, linkFolderFactKey)
	if err != nil {
		t.Fatalf("fact missing: %v", err)
	}
	if fact.Category != "infra" || !fact.Pinned || fact.Confidence != "confirmed" {
		t.Fatalf("unexpected fact flags: cat=%s pinned=%v conf=%s", fact.Category, fact.Pinned, fact.Confidence)
	}
	if !contains(fact.Summary, localDir) || !contains(fact.Body, "read_file") {
		t.Fatalf("fact content missing path/tool guidance: summary=%q body=%q", fact.Summary, fact.Body)
	}
}

func TestLinkFolderRejectsInvalidPaths(t *testing.T) {
	_, router, _ := newProjectLinkTestEnv(t)

	cases := []string{
		`{"path":"relative/path"}`, // 相对路径
		`{"path":"` + filepath.ToSlash(filepath.Join("C:\\", "no", "such", "dir")) + `"}`, // 不存在
		`{}`, // 缺 path
	}
	for _, body := range cases {
		resp := postLinkFolder(t, router, body)
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s, got %d: %s", body, resp.Code, resp.Body.String())
		}
	}
}

func TestLinkFolderToExistingProjectRespectsAccess(t *testing.T) {
	db, router, localDir := newProjectLinkTestEnv(t)
	project, err := db.CreateProject(&database.Project{Name: "Existing", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	_ = db.SetResourceOwner("project", project.ID, "owner-1")

	// 归属者可用（会话仍是 RBACScopeAll，直接换成 assigned 验证拒绝分支）
	resp := postLinkFolder(t, router, `{"projectId":"`+project.ID+`","path":"`+filepath.ToSlash(localDir)+`"}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("link to existing should work, got %d: %s", resp.Code, resp.Body.String())
	}

	stranger := gin.New()
	stranger.Use(func(c *gin.Context) {
		c.Set(security.ContextSessionKey, security.Session{UserID: "stranger", Scope: database.RBACScopeAssigned})
		c.Next()
	})
	stranger.POST("/api/projects/link-folder", NewProjectHandler(db, zap.NewNop()).LinkProjectFolder)
	resp = postLinkFolder(t, stranger, `{"projectId":"`+project.ID+`","path":"`+filepath.ToSlash(localDir)+`"}`)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("stranger link should be forbidden, got %d: %s", resp.Code, resp.Body.String())
	}
}

func contains(s, sub string) bool {
	return strings.Contains(s, sub)
}
