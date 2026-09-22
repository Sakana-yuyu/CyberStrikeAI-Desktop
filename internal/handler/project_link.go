package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// 关联本地文件夹：不复制任何文件，把本机目录路径写入项目事实黑板
// （fact_key: workspace/local_root）。绑定该项目的对话会把黑板索引注入
// system prompt，智能体即可用 read_file/glob/grep 直接原地读取该目录。

const (
	linkFolderMaxPathRunes = 4096
	linkFolderFactKey      = "workspace/local_root"
)

type linkFolderResponse struct {
	OK          bool   `json:"ok"`
	ProjectID   string `json:"projectId"`
	ProjectName string `json:"projectName"`
	Created     bool   `json:"created"`
	LinkedPath  string `json:"linkedPath"`
	FactKey     string `json:"factKey"`
}

// normalizeLinkedFolderPath 校验并规范化本地路径：必须绝对（盘符/UNC/POSIX 根），
// 必须是已存在的目录。仅做记录用途，读写权限由智能体工具层自身约束。
func normalizeLinkedFolderPath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		return "", fmt.Errorf("路径不能为空")
	}
	if len([]rune(p)) > linkFolderMaxPathRunes {
		return "", fmt.Errorf("路径过长（>%d 字符）", linkFolderMaxPathRunes)
	}
	p = strings.TrimRight(p, "/\\")
	if p == "" || p == "." || p == string(filepath.Separator) {
		return "", fmt.Errorf("路径非法")
	}
	if !filepath.IsAbs(filepath.FromSlash(p)) && !strings.HasPrefix(p, `\\`) {
		return "", fmt.Errorf("必须是绝对路径（如 D:\\Projects\\demo）")
	}
	clean := filepath.Clean(p)
	st, err := os.Stat(clean)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("目录不存在: %s", clean)
		}
		return "", fmt.Errorf("无法访问路径: %v", err)
	}
	if !st.IsDir() {
		return "", fmt.Errorf("该路径不是目录: %s", clean)
	}
	return clean, nil
}

// LinkProjectFolder POST /api/projects/link-folder
// body: {path 必填, projectId 与 projectName 二选一, description 可选}
// 路径写为项目事实后由智能体原地读取，不上传不复制。
func (h *ProjectHandler) LinkProjectFolder(c *gin.Context) {
	var req struct {
		Path        string `json:"path" binding:"required"`
		ProjectID   string `json:"projectId"`
		ProjectName string `json:"projectName"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 path"})
		return
	}
	linkedPath, err := normalizeLinkedFolderPath(req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	session, sessionOK := security.CurrentSession(c)
	if !sessionOK {
		c.JSON(http.StatusForbidden, gin.H{"error": "未登录"})
		return
	}

	projectID := strings.TrimSpace(req.ProjectID)
	created := false
	if projectID == "" {
		projectName := strings.TrimSpace(req.ProjectName)
		if projectName == "" {
			// 默认用文件夹名作为项目名
			base := filepath.Base(linkedPath)
			if base == "" || base == string(filepath.Separator) || base == "." {
				base = "本地项目"
			}
			projectName = base
		}
		p, err := h.db.CreateProject(&database.Project{
			Name:        projectName,
			Description: clampProjectDescription(strings.TrimSpace(req.Description)),
		})
		if err != nil {
			h.logger.Error("关联文件夹时创建项目失败", zap.Error(err))
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

	fact := &database.ProjectFact{
		ProjectID: projectID,
		FactKey:   linkFolderFactKey,
		Category:  "infra",
		Summary:   "本地项目文件夹：" + linkedPath,
		Body: fmt.Sprintf(
			"本地项目根目录：`%s`\n\n处理本项目任务时，直接使用 read_file / glob / grep（或 ls / list_dir）原地读取该目录下的文件，无需复制或上传。示例：glob(\"%s/**/*.go\")、read_file(\"%s\\README.md\")。修改文件可用 write_file / edit_file（注意备份）。",
			linkedPath, linkedPath, linkedPath),
		Confidence: "confirmed",
		Pinned:     true,
	}
	if _, err := h.db.UpsertProjectFact(fact); err != nil {
		h.logger.Error("写入本地文件夹事实失败", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if h.audit != nil {
		h.audit.RecordOK(c, "project", "link-folder", "关联本地项目文件夹", "project", projectID, map[string]interface{}{
			"path":    linkedPath,
			"created": created,
		})
	}

	c.JSON(http.StatusOK, linkFolderResponse{
		OK:          true,
		ProjectID:   projectID,
		ProjectName: project.Name,
		Created:     created,
		LinkedPath:  linkedPath,
		FactKey:     linkFolderFactKey,
	})
}

// PickFolder POST /api/desktop/pick-folder
// 桌面端专用：弹出系统原生「选择文件夹」对话框并返回绝对路径。
// 仅桌面模式注册（浏览器 Web 部署拿不到本机路径），并限制回环来源。
func (h *ProjectHandler) PickFolder(c *gin.Context) {
	if h.config == nil || !h.config.DesktopMode {
		c.JSON(http.StatusNotFound, gin.H{"error": "仅桌面端支持选择本地文件夹"})
		return
	}
	if !isLoopbackClientIP(c.ClientIP()) {
		c.JSON(http.StatusForbidden, gin.H{"error": "仅允许本机桌面窗口使用"})
		return
	}
	path, cancelled, err := pickNativeFolder("选择要关联的项目文件夹", "")
	if err != nil {
		h.logger.Warn("原生文件夹对话框失败", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "打开文件夹对话框失败: " + err.Error()})
		return
	}
	if cancelled {
		c.JSON(http.StatusOK, gin.H{"cancelled": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": path})
}

// SetConfig 注入运行时配置（桌面模式判定用）
func (h *ProjectHandler) SetConfig(cfg *config.Config) {
	h.config = cfg
}
