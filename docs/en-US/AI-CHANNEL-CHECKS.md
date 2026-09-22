# AI channel keys, liveness and balances

Use **Settings → AI channels**. Each existing channel holds its own provider protocol, Base URL, API key and model. There is no separate credential store. Vendor presets fill official URLs and clear the previous key/model to avoid sending a vendor's key to another vendor. Keys remain password-masked; switching presets does not save until you save the channel.

**Test connection** and **Bulk probe** perform a minimal generation only when clicked and may incur charges. They support OpenAI-compatible chat completions and Anthropic Messages. Passing confirms that the chosen key/model produced an assistant response at that moment; it does not guarantee future availability. Very small output budgets can fail on reasoning-only models. Existing batch concurrency remains two.

**Balance** queries the current editor's credentials without saving, only when clicked. Changes to the editor or selected channel invalidate the displayed result. Results are account-level snapshots, not necessarily this key's spending limit. A zero or negative returned amount is real; missing fields are never converted into a zero balance.

## Supported balance contracts

| Official Base URL | Request | Interpretation |
| --- | --- | --- |
| `https://api.deepseek.com[/v1]` | `GET /user/balance` | All returned CNY/USD `balance_infos[].total_balance` values; zero balances remain valid even when `is_available` is false. |
| `https://api.siliconflow.cn[/v1]` | `GET /v1/user/info` | Successful `code=20000`, `data.totalBalance`. Labelled provider credits because this response does not declare a currency. |
| `https://api.moonshot.cn[/v1]` | `GET /v1/users/me/balance` | Successful `code=0`, `status=true`, `data.available_balance`; labelled provider credits. |
| `https://openrouter.ai[/api/v1]` | `GET /api/v1/credits` | `data.total_credits - data.total_usage`, USD. This endpoint requires a management key; ordinary inference keys may receive HTTP 403. No separate management credential is collected. |

All balance requests use Bearer authentication. OpenAI, Anthropic, other regional domains, custom gateways (including One API/New API deployments), and unrecognized paths return **unavailable** without making a request. We deliberately do not use deprecated OpenAI dashboard billing endpoints or infer credit from a successful generation. A provider HTTP error reports only its status, never its body. OpenRouter users should prefer their dashboard rather than replace an inference key solely to obtain balance data.

## API and security

- `POST /api/config/channel-balance`: JSON `{ "channel_id": "saved-channel-id" }`, or draft `{ "base_url": "https://api.deepseek.com/v1", "api_key": "..." }`. A saved ID takes precedence; unknown IDs return 404.
- Response: `status` is `available`, `unavailable`, or `error`; `amounts` is an array of `{currency, remaining}` strings; optional `provider`, `scope`, `message`. Unsupported balances are not HTTP transport errors.
- `POST /api/config/test-openai`: existing draft `provider`, `base_url`, `api_key`, `model` contract; returns `success`, optional `latency_ms` or sanitized `error`.
- Both operations require authentication and `config:write`, enforced at the route and handler. Requests are limited to 64 KiB. Responses use `Cache-Control: no-store`.
- 30-second context/client deadlines, 10-second dial/TLS deadlines, 256-KiB response ceiling, no redirects, no environment proxy, HTTPS/443 only. Every DNS result is checked and the validated public IP is dialed directly to prevent DNS rebinding. Private, loopback, link-local, metadata, shared-address and reserved ranges are rejected. No automatic probes, retries, polling, key logging, or raw upstream error output.
- Local/private/HTTP model servers can still be configured for existing inference, but these manual checks intentionally refuse them. Existing model-list and vision checks are outside this change and do not inherit these new transport restrictions.
- Keys remain part of the existing configuration persistence and privileged settings response; password masking is not encryption at rest. Protect configuration files and settings access. No new browser local-storage credential copy is created.

## Research and licensing

Independent implementation of HTTP contracts; no upstream adapter code was copied and no new dependency was added. Research inspected 2026-09-12:

- One API adapter reference (MIT): https://github.com/songquanpeng/one-api/blob/main/controller/channel-billing.go
- One API license: https://github.com/songquanpeng/one-api/blob/main/LICENSE
- New API adapter reference (AGPL-3.0): https://github.com/QuantumNous/new-api/blob/main/controller/channel-billing.go
- New API license: https://github.com/QuantumNous/new-api/blob/main/LICENSE
- DeepSeek official contract: https://api-docs.deepseek.com/api/get-user-balance
- OpenRouter official contract and management-key requirement: https://openrouter.ai/docs/api/api-reference/credits/get-credits

The open-source adapters informed endpoint/schema research only. Their generic dashboard balance assumptions were deliberately not adopted. Endpoints and permissions may change; failures remain explicit, not fabricated amounts.

## Verification

Offline fixture tests cover all four balances, missing/null/invalid/zero values, unsupported origins without network access, protocol/auth headers, malformed generation responses, response ceilings, sanitized errors, destination restrictions, permission checks and saved-channel precedence. No real keys or paid provider calls are needed.

Run `go test ./internal/channelcheck`, `go test ./internal/handler -run TestChannelChecks`, and `node --check web/static/js/settings.js`. Windows CGO builds require the project's configured WinLibs GCC on PATH and `CGO_ENABLED=1`.
