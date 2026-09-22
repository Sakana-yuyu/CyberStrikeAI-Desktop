package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"cyberstrike-ai/internal/channelcheck"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
)

// ChannelBalance reuses a saved channel key; draft credentials are accepted without persistence.
// A saved channel ID takes precedence over all supplied draft fields.
func (h *ConfigHandler) ChannelBalance(c *gin.Context) {
	if !security.SessionHasPermission(c, "config:write") {
		c.JSON(http.StatusForbidden, gin.H{"error": "config:write permission required"})
		return
	}
	var req struct {
		ChannelID string `json:"channel_id"`
		BaseURL   string `json:"base_url"`
		APIKey    string `json:"api_key"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if req.ChannelID != "" {
		h.mu.RLock()
		ch, ok := h.config.AI.Channels[req.ChannelID]
		h.mu.RUnlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
			return
		}
		req.BaseURL, req.APIKey = ch.BaseURL, ch.APIKey
	}
	if strings.TrimSpace(req.APIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API Key is required"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	result, err := channelcheck.QueryBalance(ctx, channelcheck.Client(), req.BaseURL, strings.TrimSpace(req.APIKey))
	if err != nil {
		result.Status = "error"
		result.Message = err.Error()
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}
