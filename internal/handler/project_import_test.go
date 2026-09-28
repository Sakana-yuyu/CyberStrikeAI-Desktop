package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
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

func newProjectImportTestEnv(t *testing.T) (*database.DB, *gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	db, err := database.NewDB(filepath.Join(root, "import.db"), zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetEinoConversationDirs(
		filepath.Join(root, "plantask"),
		filepath.Join(root, "checkpoint"),
		filepath.Join(root, "reduction"),
		filepath.Join(root, "workspace"),
	)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(security.ContextSessionKey, security.Session{
			UserID: "importer",
			Scope:  database.RBACScopeAll,
		})
		c.Next()
	})
	router.POST("/api/projects/import-folder", NewProjectHandler(db, zap.NewNop()).ImportProjectFolder)
	return db, router, filepath.Join(root, "workspace")
}

func buildImportMultipart(t *testing.T, fields map[string]string, files map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	for rel, content := range files {
		if err := mw.WriteField("paths", rel); err != nil {
			t.Fatal(err)
		}
		part, err := mw.CreateFormFile("files", filepath.Base(rel))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	return &body, mw.FormDataContentType()
}

func postImportFolder(t *testing.T, router *gin.Engine, fields map[string]string, files map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body, contentType := buildImportMultipart(t, fields, files)
	req := httptest.NewRequest(http.MethodPost, "/api/projects/import-folder", body)
	req.Header.Set("Content-Type", contentType)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func TestImportProjectFolderCreatesProjectAndFiles(t *testing.T) {
	db, router, workspaceRoot := newProjectImportTestEnv(t)

	resp := postImportFolder(t, router,
		map[string]string{"projectName": "本地导入项目", "description": "来自桌面端导入"},
		map[string]string{
			"MyFolder/report.md":           "# 报告",
			"MyFolder/nmap/all.txt":        "PORT STATE",
			"MyFolder/.git/config":         "git",
			"MyFolder/node_modules/x/y.js": "module",
			"MyFolder/.DS_Store":           "junk",
		})
	if resp.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"imported":2`) ||
		!strings.Contains(resp.Body.String(), `"skipped":3`) ||
		!strings.Contains(resp.Body.String(), `"created":true`) {
		t.Fatalf("unexpected response: %s", resp.Body.String())
	}

	var payload struct {
		ProjectID string `json:"projectId"`
	}
	if err := decodeJSON(resp, &payload); err != nil {
		t.Fatal(err)
	}
	if p, err := db.GetProject(payload.ProjectID); err != nil || p.Name != "本地导入项目" {
		t.Fatalf("project not created properly: %v %v", p, err)
	}
	for _, rel := range []string{"MyFolder/report.md", "MyFolder/nmap/all.txt"} {
		if _, err := os.Stat(filepath.Join(workspaceRoot, "projects", payload.ProjectID, rel)); err != nil {
			t.Fatalf("imported file missing: %v", err)
		}
	}
	for _, rel := range []string{"MyFolder/.git/config", "MyFolder/node_modules/x/y.js", "MyFolder/.DS_Store"} {
		if _, err := os.Stat(filepath.Join(workspaceRoot, "projects", payload.ProjectID, rel)); err == nil {
			t.Fatalf("junk file should be skipped: %s", rel)
		}
	}
}

func TestImportProjectFolderOverwritesSameRelPath(t *testing.T) {
	_, router, workspaceRoot := newProjectImportTestEnv(t)

	first := postImportFolder(t, router, map[string]string{"projectName": "P"}, map[string]string{"F/a.txt": "old"})
	var p1 struct {
		ProjectID string `json:"projectId"`
	}
	if err := decodeJSON(first, &p1); err != nil {
		t.Fatal(err)
	}
	second := postImportFolder(t, router, map[string]string{"projectId": p1.ProjectID}, map[string]string{"F/a.txt": "new content"})
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"created":false`) {
		t.Fatalf("re-import failed: %d %s", second.Code, second.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(workspaceRoot, "projects", p1.ProjectID, "F", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new content" {
		t.Fatalf("expected overwrite, got %q", data)
	}
}

func TestSaveImportedFileDoesNotConsumeSiblingImportPath(t *testing.T) {
	dstDir := t.TempDir()
	protectedPath := filepath.Join(dstDir, "report.txt.importing")
	targetPath := filepath.Join(dstDir, "report.txt")

	if err := saveImportedFile(importFileHeader(t, "report.txt.importing", "keep this file"), protectedPath); err != nil {
		t.Fatalf("save sibling path: %v", err)
	}
	if err := saveImportedFile(importFileHeader(t, "report.txt", "new target"), targetPath); err != nil {
		t.Fatalf("save target path: %v", err)
	}
	if got, err := os.ReadFile(protectedPath); err != nil || string(got) != "keep this file" {
		t.Fatalf("sibling import path was changed: content=%q err=%v", got, err)
	}
	if got, err := os.ReadFile(targetPath); err != nil || string(got) != "new target" {
		t.Fatalf("target contents incorrect: content=%q err=%v", got, err)
	}
}

func TestValidateImportFolderFileSizes(t *testing.T) {
	tests := []struct {
		name  string
		files []*multipart.FileHeader
		want  bool
	}{
		{name: "one file at limit", files: []*multipart.FileHeader{{Filename: "one", Size: importFolderMaxFileByte}}, want: false},
		{name: "aggregate at limit", files: []*multipart.FileHeader{{Filename: "one", Size: importFolderMaxFileByte}, {Filename: "two", Size: importFolderMaxFileByte}}, want: false},
		{name: "single file over limit", files: []*multipart.FileHeader{{Filename: "large", Size: importFolderMaxFileByte + 1}}, want: true},
		{name: "aggregate over limit", files: []*multipart.FileHeader{{Filename: "one", Size: importFolderMaxFileByte}, {Filename: "two", Size: importFolderMaxFileByte}, {Filename: "three", Size: 1}}, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateImportFolderFileSizes(tt.files)
			if (err != nil) != tt.want {
				t.Fatalf("validateImportFolderFileSizes() error=%v, wantError=%v", err, tt.want)
			}
		})
	}
}

func importFileHeader(t *testing.T, filename, content string) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("files", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = req.MultipartForm.RemoveAll() })
	return req.MultipartForm.File["files"][0]
}

func TestImportProjectFolderRejectsTraversalAndMismatch(t *testing.T) {
	_, router, _ := newProjectImportTestEnv(t)

	resp := postImportFolder(t, router, map[string]string{"projectName": "P"}, map[string]string{"../evil.txt": "x"})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("traversal should be rejected, got %d: %s", resp.Code, resp.Body.String())
	}
	resp = postImportFolder(t, router, map[string]string{"projectName": "P"}, map[string]string{`C:\abs\evil.txt`: "x"})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("absolute path should be rejected, got %d: %s", resp.Code, resp.Body.String())
	}

	// paths 与 files 数量不一致
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("projectName", "P")
	_ = mw.WriteField("paths", "only-one-path")
	part, _ := mw.CreateFormFile("files", "a.txt")
	_, _ = part.Write([]byte("x"))
	part2, _ := mw.CreateFormFile("files", "b.txt")
	_, _ = part2.Write([]byte("y"))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/projects/import-folder", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched paths/files should be rejected, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestImportProjectFolderRespectsProjectAccess(t *testing.T) {
	db, _, workspaceRoot := newProjectImportTestEnv(t)
	project, err := db.CreateProject(&database.Project{Name: "Existing", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	_ = db.SetResourceOwner("project", project.ID, "owner-1")

	// 换成 assigned 范围的陌生用户，单独起一台路由
	strangerRouter := gin.New()
	strangerRouter.Use(func(c *gin.Context) {
		c.Set(security.ContextSessionKey, security.Session{UserID: "stranger", Scope: database.RBACScopeAssigned})
		c.Next()
	})
	strangerRouter.POST("/api/projects/import-folder", NewProjectHandler(db, zap.NewNop()).ImportProjectFolder)
	resp := postImportFolder(t, strangerRouter, map[string]string{"projectId": project.ID}, map[string]string{"F/a.txt": "x"})
	if resp.Code != http.StatusForbidden {
		t.Fatalf("stranger import should be forbidden, got %d: %s", resp.Code, resp.Body.String())
	}
	if _, err := os.Stat(filepath.Join(workspaceRoot, "projects", project.ID, "F", "a.txt")); err == nil {
		t.Fatal("no file should be written for forbidden import")
	}
}

func decodeJSON(resp *httptest.ResponseRecorder, v interface{}) error {
	return json.Unmarshal(resp.Body.Bytes(), v)
}
