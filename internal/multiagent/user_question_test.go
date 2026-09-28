package multiagent

import (
	"context"
	"strings"
	"testing"
)

func TestUserQuestionToolReturnsChosenAnswer(t *testing.T) {
	tool := userQuestionTool{}
	info, err := tool.Info(context.Background())
	if err != nil || info.Name != "ask_user" {
		t.Fatalf("tool info = %#v, %v", info, err)
	}
	ctx := WithUserQuestionAsk(context.Background(), func(_ context.Context, question string, options []string) (string, error) {
		if question != "继续扫描吗？" || len(options) != 2 || options[1] != "停止" {
			t.Fatalf("question = %q, options = %#v", question, options)
		}
		return "只扫描测试环境", nil
	})
	got, err := tool.InvokableRun(ctx, `{"question":"继续扫描吗？","options":["继续","停止"]}`)
	if err != nil || !strings.Contains(got, "只扫描测试环境") {
		t.Fatalf("answer = %q, %v", got, err)
	}
	if _, err := tool.InvokableRun(ctx, `{"question":""}`); err == nil {
		t.Fatal("empty question must be rejected")
	}
}
