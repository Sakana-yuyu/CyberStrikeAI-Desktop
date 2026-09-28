package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type pendingUserQuestion struct {
	ID             string   `json:"questionId"`
	ConversationID string   `json:"conversationId"`
	Question       string   `json:"question"`
	Options        []string `json:"options"`
	answer         chan string
}

type userQuestionManager struct {
	mu      sync.Mutex
	pending map[string]*pendingUserQuestion
}

func newUserQuestionManager() *userQuestionManager {
	return &userQuestionManager{pending: make(map[string]*pendingUserQuestion)}
}

func (m *userQuestionManager) ask(ctx context.Context, conversationID, question string, options []string, emit func(string, string, interface{})) (string, error) {
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		return "", err
	}
	p := &pendingUserQuestion{
		ID: hex.EncodeToString(idBytes), ConversationID: conversationID,
		Question: question, Options: append([]string(nil), options...), answer: make(chan string, 1),
	}
	m.mu.Lock()
	if m.pending[conversationID] != nil {
		m.mu.Unlock()
		return "", errors.New("当前会话已有待回答问题")
	}
	m.pending[conversationID] = p
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		if m.pending[conversationID] == p {
			delete(m.pending, conversationID)
		}
		m.mu.Unlock()
	}()
	emit("user_question", question, p)
	select {
	case answer := <-p.answer:
		emit("user_question_answered", "用户回答："+answer, map[string]string{"conversationId": conversationID, "questionId": p.ID, "answer": answer})
		return answer, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (m *userQuestionManager) get(conversationID string) *pendingUserQuestion {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pending[conversationID]
}

func (m *userQuestionManager) answer(conversationID, questionID, answer string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.pending[conversationID]
	if p == nil || p.ID != questionID {
		return false
	}
	select {
	case p.answer <- answer:
		delete(m.pending, conversationID)
		return true
	default:
		return false
	}
}

func (h *AgentHandler) userQuestionAsker(conversationID string, emit func(string, string, interface{})) func(context.Context, string, []string) (string, error) {
	return func(ctx context.Context, question string, options []string) (string, error) {
		if h.userQuestions == nil {
			return "", errors.New("交互提问服务不可用")
		}
		return h.userQuestions.ask(ctx, conversationID, question, options, emit)
	}
}

func (h *AgentHandler) GetPendingUserQuestion(c *gin.Context) {
	conversationID := strings.TrimSpace(c.Query("conversationId"))
	if conversationID == "" || !h.agentConversationAllowed(c, conversationID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该资源"})
		return
	}
	if h.userQuestions == nil {
		c.JSON(http.StatusOK, gin.H{"question": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"question": h.userQuestions.get(conversationID)})
}

func (h *AgentHandler) AnswerUserQuestion(c *gin.Context) {
	var req struct {
		ConversationID string `json:"conversationId" binding:"required"`
		QuestionID     string `json:"questionId" binding:"required"`
		Answer         string `json:"answer" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Answer = strings.TrimSpace(req.Answer)
	if req.Answer == "" || len([]rune(req.Answer)) > 2000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "回答不能为空且不能超过 2000 字"})
		return
	}
	if !h.agentConversationAllowed(c, req.ConversationID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该资源"})
		return
	}
	if h.userQuestions == nil || !h.userQuestions.answer(req.ConversationID, req.QuestionID, req.Answer) {
		c.JSON(http.StatusConflict, gin.H{"error": "问题已结束或已经回答"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GuideAgentLoop 把补充方向排入当前 TurnLoop 的下一轮，不取消正在执行的步骤。
func (h *AgentHandler) GuideAgentLoop(c *gin.Context) {
	var req struct {
		ConversationID string `json:"conversationId" binding:"required"`
		Message        string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len([]rune(req.Message)) > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "引导内容不能为空且不能超过 10000 字"})
		return
	}
	if !h.agentConversationAllowed(c, req.ConversationID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权访问该资源"})
		return
	}
	if h.tasks == nil || !h.tasks.GuideTask(req.ConversationID, req.Message) {
		c.JSON(http.StatusConflict, gin.H{"error": "任务已结束或暂时无法接收引导，可作为新消息发送"})
		return
	}
	persisted := h.db != nil
	if persisted {
		if _, err := h.db.AddMessage(req.ConversationID, "user", req.Message, nil); err != nil {
			persisted = false
			if h.logger != nil {
				h.logger.Warn("保存用户引导到对话历史失败", zap.Error(err))
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "persisted": persisted})
}
