# Agent Instructions

1. Keep `INDEX.md` updated whenever files are created or reorganized
2. Keep docs current — update rather than create new files when possible
3. Be skeptical, honest, and concise. No hype.

## Available API Keys & Credits

| Provider | Key Location | Status |
|----------|-------------|--------|
| **Venice** | `VENICE_API_KEY` in `.env` | Active, has credits |
| **OpenRouter** | `OPENROUTER_API_KEY` in `.env` | Weekly limit may be exhausted |
| **Phala (dstack)** | Authed CLI | Active, has credits |

### Inference Priority

1. **Venice** (`https://api.venice.ai/api/v1`) — primary for demos. Has credits. OpenAI-compatible.
2. **OpenRouter** (`https://openrouter.ai/api/v1`) — backup. May hit weekly limits.
3. **Redpill** (`https://api.redpill.ai/v1`) — production (GPU-TEE). For real deployment only.

### Venice Models

- `deepseek-r1-671b` — reasoning model, good for vulnerability analysis
- `deepseek-v3.2` — chat model (was deepseek-chat-v3-0324, renamed by Venice)
- `llama-3.3-70b` — alternative
- E2EE models: `e2ee-qwen3-30b-a3b-p` (note `-p` suffix, tests may reference old name)

### Caching

Venice supports prompt caching on OpenAI-compatible endpoint. Ensure system prompts are identical across calls for cache hits. Check `usage.prompt_tokens_details.cached_tokens` in responses.

## Package: @mnemo/venice

The `@mnemo/venice` package wraps Venice with E2E encryption support for `@effect/ai`. For simple inference without E2E encryption, use the standard OpenAI-compatible endpoint via `@mnemo/core` Provider with Venice base URL.

## Local Environment

- **TEE**: `docker compose -f infra/dstack/docker-compose.yml up -d dstack-simulator`
- **Anvil**: `anvil` (Foundry devnet)
- **IPFS**: mock layer in `@mnemo/chain` or real `ipfs daemon`
