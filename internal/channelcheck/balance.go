package channelcheck

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
)

type Amount struct {
	Currency  string `json:"currency"`
	Remaining string `json:"remaining"`
}

type Balance struct {
	Status   string   `json:"status"`
	Provider string   `json:"provider,omitempty"`
	Scope    string   `json:"scope,omitempty"`
	Amounts  []Amount `json:"amounts"`
	Message  string   `json:"message,omitempty"`
}

// BalanceEndpoint selects only documented official origins; it never guesses a gateway's billing API.
func BalanceEndpoint(raw string) (string, string) {
	u, err := baseURL(raw)
	if err != nil {
		return "", ""
	}
	host := strings.ToLower(u.Hostname())
	path := strings.TrimSuffix(u.Path, "/")
	switch host {
	case "api.deepseek.com":
		if path == "" || path == "/v1" {
			return "deepseek", "https://api.deepseek.com/user/balance"
		}
	case "api.siliconflow.cn":
		if path == "" || path == "/v1" {
			return "siliconflow", "https://" + host + "/v1/user/info"
		}
	case "api.moonshot.cn":
		if path == "" || path == "/v1" {
			return "moonshot", "https://" + host + "/v1/users/me/balance"
		}
	case "openrouter.ai":
		if path == "" || path == "/api/v1" {
			return "openrouter", "https://openrouter.ai/api/v1/credits"
		}
	}
	return "", ""
}

func QueryBalance(ctx context.Context, client *http.Client, rawURL, key string) (Balance, error) {
	provider, endpoint := BalanceEndpoint(rawURL)
	result := Balance{Status: "unavailable", Provider: provider, Amounts: []Amount{}}
	if endpoint == "" {
		result.Message = "Balance unavailable: no documented adapter for this origin (including OpenAI, Anthropic and custom gateways)."
		return result, nil
	}
	data, err := Request(ctx, client, http.MethodGet, endpoint, key, nil, false)
	if err != nil {
		return result, err
	}
	amounts, err := parseBalance(provider, data)
	if err != nil {
		return result, err
	}
	result.Status = "available"
	result.Scope = "account"
	result.Amounts = amounts
	return result, nil
}

func validAmount(value string) bool {
	n, err := strconv.ParseFloat(value, 64)
	return err == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
}

func parseBalance(provider string, data []byte) ([]Amount, error) {
	invalid := errors.New("balance unavailable: missing or invalid provider fields")
	amounts := []Amount{}
	switch provider {
	case "deepseek":
		var v struct {
			Available *bool `json:"is_available"`
			Infos     []struct {
				Currency string `json:"currency"`
				Total    string `json:"total_balance"`
			} `json:"balance_infos"`
		}
		if json.Unmarshal(data, &v) != nil || v.Available == nil {
			return nil, invalid
		}
		for _, item := range v.Infos {
			if (item.Currency != "CNY" && item.Currency != "USD") || !validAmount(item.Total) {
				return nil, invalid
			}
			amounts = append(amounts, Amount{Currency: item.Currency, Remaining: item.Total})
		}
	case "siliconflow":
		var v struct {
			Code int `json:"code"`
			Data struct {
				Total string `json:"totalBalance"`
			} `json:"data"`
		}
		if json.Unmarshal(data, &v) != nil || v.Code != 20000 || !validAmount(v.Data.Total) {
			return nil, invalid
		}
		// The API does not return a currency: do not invent one for regional accounts.
		amounts = append(amounts, Amount{Currency: "provider credits", Remaining: v.Data.Total})
	case "moonshot":
		var v struct {
			Code   *int `json:"code"`
			Status bool `json:"status"`
			Data   struct {
				Available *float64 `json:"available_balance"`
			} `json:"data"`
		}
		if json.Unmarshal(data, &v) != nil || v.Code == nil || *v.Code != 0 || !v.Status || v.Data.Available == nil {
			return nil, invalid
		}
		amounts = append(amounts, Amount{Currency: "provider credits", Remaining: strconv.FormatFloat(*v.Data.Available, 'f', -1, 64)})
	case "openrouter":
		var v struct {
			Data struct {
				Credits *float64 `json:"total_credits"`
				Usage   *float64 `json:"total_usage"`
			} `json:"data"`
		}
		if json.Unmarshal(data, &v) != nil || v.Data.Credits == nil || v.Data.Usage == nil {
			return nil, invalid
		}
		remaining := *v.Data.Credits - *v.Data.Usage
		if math.IsInf(remaining, 0) || math.IsNaN(remaining) {
			return nil, invalid
		}
		amounts = append(amounts, Amount{Currency: "USD", Remaining: strconv.FormatFloat(remaining, 'f', -1, 64)})
	}
	if len(amounts) == 0 {
		return nil, invalid
	}
	return amounts, nil
}
