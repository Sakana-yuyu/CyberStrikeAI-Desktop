package handler

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// 导入本地项目文件夹：文件落入 tmp/workspace/projects/<projectID>/，
// 与智能体工作区同一棵树，文件管理页（workspace 根）按项目可见。
const (
	importFolderFilesField   = "files"
	importFolderPathsField   = "paths"
	importFolderMaxFiles     = 200
	importFolderMaxFileByte  = 512 << 20                            // 单文件 512MiB
	importFolderMaxTotalByte = 1 << 30                              // 单次累计文件数据 1GiB
	importFolderMaxBodyByte  = importFolderMaxTotalByte + (8 << 20) // multipart 头部与字段预留 8MiB
	importFolderMaxRelRunes  = 1024
)

// importFolderSkipDirs 选择文件夹时几乎必然携带、但对项目工作区无价值的目录；
// 跳过并在响应里计数，前端预检也用同一份名单。
var importFolderSkipDirs = map[string]bool{
	".git": true, ".svn": true, ".hg": true, ".idea": true, ".vs": true,
	".vscode": true, "node_modules": true, "__pycache__": true, ".gradle": true,
	"target": true, ".pytest_cache": true, ".mypy_cache": true,
}

// importFolderSkipFiles 系统生成的杂项文件。
var importFolderSkipFiles = map[string]bool{
	".DS_Store": true, "Thumbs.db": true, "desktop.ini": true,
}

func importFolderShouldSkip(relSlash string) bool {
	parts := strings.Split(relSlash, "/")
	for i, p := range parts {
		if p == "" {
			return true
		}
		if i == len(parts)-1 {
			return importFolderSkipFiles[p]
		}
		if importFolderSkipDirs[p] {
			return true
		}
	}
	return false
}

// sanitizeImportRelPath 校验单个相对路径并规范为 / 分隔：
// 拒绝越界（..）、绝对路径、盘符、Windows 保留字符/设备名、超长组件。
func sanitizeImportRelPath(raw string) (string, error) {
	rel := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if rel == "" {
		return "", fmt.Errorf("空路径")
	}
	if strings.HasPrefix(rel, "/") || filepath.IsAbs(filepath.FromSlash(rel)) || len(rel) >= 2 && rel[1] == ':' {
		return "", fmt.Errorf("不允许绝对路径: %q", raw)
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(rel)))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("不允许越界路径: %q", raw)
	}
	if len([]rune(clean)) > importFolderMaxRelRunes {
		return "", fmt.Errorf("路径过长（>%d 字符）", importFolderMaxRelRunes)
	}
	reserved := map[string]bool{}
	for _, base := range []string{"CON", "PRN", "AUX", "NUL"} {
		reserved[base] = true
	}
	for i := 1; i <= 9; i++ {
		reserved[fmt.Sprintf("COM%d", i)] = true
		reserved[fmt.Sprintf("LPT%d", i)] = true
	}
	for _, part := range strings.Split(clean, "/") {
		if len([]rune(part)) > 255 {
			return "", fmt.Errorf("路径组件超过 255 字符: %q", part)
		}
		base := strings.ToUpper(strings.TrimRight(part, ". "))
		if reserved[base] {
			return "", fmt.Errorf("Windows 保留设备名: %q", part)
		}
		if strings.ContainsAny(part, "<>:\"|?*") || strings.ContainsRune(part, 0) {
			return "", fmt.Errorf("包含非法字符: %q", part)
		}
		if part != strings.TrimRight(part, " .") {
			return "", fmt.Errorf("组件不能以空格或点结尾: %q", part)
		}
	}
	return clean, nil
}

type importFolderResponse struct {
	OK              bool     `json:"ok"`
	ProjectID       string   `json:"projectId"`
	ProjectName     string   `json:"projectName"`
	Created         bool     `json:"created"`
	Imported        int      `json:"imported"`
	Skipped         int      `json:"skipped"`
	Bytes           int64    `json:"bytes"`
	SkippedExamples []string `json:"skippedExamples,omitempty"`
	WorkspaceRoot   string   `json:"workspaceRoot"`
}

func firstFormValue(values map[string][]string, key string) string {
	if vs := values[key]; len(vs) > 0 {
		return vs[0]
	}
	return ""
}

func validateImportFolderFileSizes(fileHeaders []*multipart.FileHeader) error {
	var totalBytes int64
	for _, fh := range fileHeaders {
		if fh.Size > importFolderMaxFileByte {
			return fmt.Errorf("文件超过 %dMiB 上限: %s", importFolderMaxFileByte>>20, fh.Filename)
		}
		if fh.Size < 0 || fh.Size > importFolderMaxTotalByte-totalBytes {
			return fmt.Errorf("单次导入数据超过 %dMiB 上限", importFolderMaxTotalByte>>20)
		}
		totalBytes += fh.Size
	}
	return nil
}

// ImportProjectFolder POST /api/projects/import-folder
// multipart：paths（与 files 等长的相对路径数组）、files、projectId（省略时按 projectName 新建项目）。
// 权限：路由层映射 project:write；导入到已有项目时再校验资源归属。
func (h *ProjectHandler) ImportProjectFolder(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, importFolderMaxBodyByte)
	form, err := c.MultipartForm()
	if err != nil {
		status := http.StatusBadRequest
		message := "解析 multipart 表单失败: " + err.Error()
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			status = http.StatusRequestEntityTooLarge
			message = "单次导入请求超出大小限制"
		}
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
		c.JSON(status, gin.H{"error": message})
		return
	}
	defer form.RemoveAll()
	fileHeaders := form.File[importFolderFilesField]
	paths := form.Value[importFolderPathsField]
	if len(fileHeaders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未收到任何文件"})
		return
	}
	if len(paths) != len(fileHeaders) {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("paths(%d) 与 files(%d) 数量不一致", len(paths), len(fileHeaders))})
		return
	}
	if len(fileHeaders) > importFolderMaxFiles {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("单次最多 %d 个文件，请分批导入", importFolderMaxFiles)})
		return
	}
	if err := validateImportFolderFileSizes(fileHeaders); err != nil {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": err.Error()})
		return
	}

	session, sessionOK := security.CurrentSession(c)
	if !sessionOK {
		c.JSON(http.StatusForbidden, gin.H{"error": "未登录"})
		return
	}

	projectID := strings.TrimSpace(firstFormValue(form.Value, "projectId"))
	created := false
	if projectID == "" {
		projectName := strings.TrimSpace(firstFormValue(form.Value, "projectName"))
		if projectName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 projectId 或 projectName"})
			return
		}
		p, err := h.db.CreateProject(&database.Project{
			Name:        projectName,
			Description: clampProjectDescription(strings.TrimSpace(firstFormValue(form.Value, "description"))),
		})
		if err != nil {
			h.logger.Error("导入时创建项目失败", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		projectID = p.ID
		_ = h.db.SetResourceOwner("project", p.ID, session.UserID)
		_ = h.db.AssignResourceToUser(session.UserID, "project", p.ID)
		created = true
	} else if session.Scope != database.RBACScopeAll && !h.db.UserCanAccessResource(session.UserID, session.Scope, "project", projectID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该项目"})
		return
	}
	project, err := h.db.GetProject(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}

	// 工作区根（agent.workspace_root_dir 或默认 tmp/workspace）
	workspaceBase := h.db.EinoWorkspaceBaseDir()
	if !filepath.IsAbs(workspaceBase) {
		cwd, wdErr := os.Getwd()
		if wdErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": wdErr.Error()})
			return
		}
		workspaceBase = filepath.Join(cwd, workspaceBase)
	}
	projectRoot := filepath.Join(workspaceBase, "projects", projectID)

	imported := 0
	skipped := 0
	var skippedExamples []string
	var totalBytes int64
	for i, fh := range fileHeaders {
		rel, relErr := sanitizeImportRelPath(paths[i])
		if relErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("第 %d 个文件路径非法: %v", i+1, relErr)})
			return
		}
		if importFolderShouldSkip(rel) {
			skipped++
			if len(skippedExamples) < 5 {
				skippedExamples = append(skippedExamples, rel)
			}
			continue
		}
		dst := filepath.Join(projectRoot, filepath.FromSlash(rel))
		if !strings.HasPrefix(dst, projectRoot+string(filepath.Separator)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "路径越界"})
			return
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			h.logger.Error("导入建目录失败", zap.String("dir", filepath.Dir(dst)), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if openErr := saveImportedFile(fh, dst); openErr != nil {
			h.logger.Error("导入写文件失败", zap.String("path", dst), zap.Error(openErr))
			c.JSON(http.StatusInternalServerError, gin.H{"error": openErr.Error()})
			return
		}
		imported++
		totalBytes += fh.Size
	}

	if h.audit != nil {
		h.audit.RecordOK(c, "project", "import", "导入本地项目文件夹", "project", projectID, map[string]interface{}{
			"imported": imported,
			"skipped":  skipped,
			"bytes":    totalBytes,
		})
	}

	c.JSON(http.StatusOK, importFolderResponse{
		OK:              true,
		ProjectID:       projectID,
		ProjectName:     project.Name,
		Created:         created,
		Imported:        imported,
		Skipped:         skipped,
		Bytes:           totalBytes,
		SkippedExamples: skippedExamples,
		WorkspaceRoot:   "projects/" + projectID,
	})
}

// saveImportedFile 覆盖式写入（同名重复导入按最新内容为准），写失败时清掉残留
func saveImportedFile(fh *multipart.FileHeader, dst string) error {
	src, err := fh.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	f, err := os.CreateTemp(filepath.Dir(dst), ".cyberstrike-import-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = io.Copy(f, src); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, dst); err != nil {
		return err
	}
	return nil
}
