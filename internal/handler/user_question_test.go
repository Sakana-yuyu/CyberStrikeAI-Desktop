package handler

import (
	"context"
	"testing"
	"time"
)

func TestUserQuestionManagerAnswerAndCancel(t *testing.T) {
	m := newUserQuestionManager()
	result := make(chan string, 1)
	go func() {
		answer, err := m.ask(context.Background(), "conversation-a", "选择方向", []string{"甲", "乙"}, func(string, string, interface{}) {})
		if err == nil {
			result <- answer
		}
	}()
	var pending *pendingUserQuestion
	deadline := time.After(time.Second)
	for pending == nil {
		select {
		case <-deadline:
			t.Fatal("question was not published")
		default:
			pending = m.get("conversation-a")
		}
	}
	if m.answer("conversation-b", pending.ID, "甲") || m.answer("conversation-a", "wrong", "甲") {
		t.Fatal("cross-conversation or stale answer accepted")
	}
	if !m.answer("conversation-a", pending.ID, "乙") || m.answer("conversation-a", pending.ID, "甲") {
		t.Fatal("answer must be accepted exactly once")
	}
	select {
	case answer := <-result:
		if answer != "乙" {
			t.Fatalf("answer = %q", answer)
		}
	case <-time.After(time.Second):
		t.Fatal("ask did not resume")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.ask(ctx, "conversation-a", "再次提问", nil, func(string, string, interface{}) {}); err == nil {
		t.Fatal("canceled task must stop waiting")
	}
	if m.get("conversation-a") != nil {
		t.Fatal("canceled question leaked")
	}
}

func TestGuideTaskRejectsMissingAndAcceptsActiveHook(t *testing.T) {
	m := NewAgentTaskManager()
	if m.GuideTask("missing", "方向") {
		t.Fatal("missing task accepted guidance")
	}
	task, err := m.StartTask("conversation-a", "开始", func(error) {})
	if err != nil {
		t.Fatal(err)
	}
	var received string
	unregister := m.BindAgentTurnLoopGuide("conversation-a", func(note string) bool { received = note; return true })
	if !m.GuideTask("conversation-a", " 新方向 ") || received != "新方向" {
		t.Fatalf("guidance = %q", received)
	}
	unregister()
	if m.GuideTask("conversation-a", "再次引导") {
		t.Fatal("unregistered hook accepted guidance")
	}
	_ = m.FinishTaskRun("conversation-a", task.RunID, "completed")
}
