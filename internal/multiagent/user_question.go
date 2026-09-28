package multiagent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"github.com/eino-contrib/jsonschema"
)

type userQuestionKey struct{}

// UserQuestionAsk 在当前任务中等待用户选择或填写答案。
type UserQuestionAsk func(context.Context, string, []string) (string, error)

func WithUserQuestionAsk(ctx context.Context, ask UserQuestionAsk) context.Context {
	if ctx == nil || ask == nil {
		return ctx
	}
	return context.WithValue(ctx, userQuestionKey{}, ask)
}

func userQuestionAskFromContext(ctx context.Context) UserQuestionAsk {
	if ctx == nil {
		return nil
	}
	ask, _ := ctx.Value(userQuestionKey{}).(UserQuestionAsk)
	return ask
}

type userQuestionTool struct{}

func (userQuestionTool) Info(context.Context) (*schema.ToolInfo, error) {
	var params jsonschema.Schema
	err := json.Unmarshal([]byte(`{"type":"object","properties":{"question":{"type":"string","description":"需要用户决定的具体问题"},"options":{"type":"array","items":{"type":"string"},"description":"2 到 4 个简短且互斥的建议选项"}},"required":["question"]}`), &params)
	if err != nil {
		return nil, err
	}
	return &schema.ToolInfo{
		Name:        "ask_user",
		Desc:        "当任务执行中遇到确实需要用户决定的方向、参数或取舍时，向用户提问并等待回答。给出 2 到 4 个选项，用户也可自行输入。不要用它代替工具审批。",
		ParamsOneOf: schema.NewParamsOneOfByJSONSchema(&params),
	}, nil
}

func (userQuestionTool) InvokableRun(ctx context.Context, arguments string, _ ...tool.Option) (string, error) {
	var input struct {
		Question string   `json:"question"`
		Options  []string `json:"options"`
	}
	if err := json.Unmarshal([]byte(arguments), &input); err != nil {
		return "", err
	}
	input.Question = strings.TrimSpace(input.Question)
	if input.Question == "" || len([]rune(input.Question)) > 500 {
		return "", errors.New("问题不能为空且不能超过 500 字")
	}
	if len(input.Options) > 4 {
		return "", errors.New("选项不能超过 4 个")
	}
	options := make([]string, 0, len(input.Options))
	for _, option := range input.Options {
		option = strings.TrimSpace(option)
		if option != "" && len([]rune(option)) <= 120 {
			options = append(options, option)
		}
	}
	ask := userQuestionAskFromContext(ctx)
	if ask == nil {
		return "", errors.New("当前任务不支持交互提问")
	}
	answer, err := ask(ctx, input.Question, options)
	if err != nil {
		return "", err
	}
	return "用户回答：" + answer, nil
}

func appendUserQuestionTool(tools []tool.BaseTool) []tool.BaseTool {
	return append(tools, userQuestionTool{})
}
