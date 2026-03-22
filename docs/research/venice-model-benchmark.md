# Venice Model Benchmark — Smart Contract Audit

**Date:** 2026-03-22
**Endpoint:** `https://api.venice.ai/api/v1`
**Prompt:** Blind audit of SideEntranceLenderPool (known reentrancy via flash loan)
**Max tokens:** 4096
**Timeout:** 60s per model

## Results

| Model | TTFT | Total | Tokens | Found Bug? |
|-------|------|-------|--------|------------|
| `deepseek-v3.2` | TIMEOUT | - | - | - |
| `qwen3-235b-a22b-instruct-2507` | TIMEOUT | - | - | - |
| `zai-org-glm-5` | 54.7s | 81.8s | ~787 | No |
| `openai-gpt-oss-120b` | 14.3s | 46.1s | ~1291 | Yes |
| **`qwen3-coder-480b-a35b-instruct`** | **0.4s** | **7.3s** | **~559** | **Yes** |

## Analysis

**`qwen3-coder-480b-a35b-instruct` is the clear winner.** 0.4s time-to-first-token and 7.3s total — 6x faster than the runner-up. It correctly identifies the reentrancy vulnerability and produces a concise report (~559 tokens). For a live demo where the audience watches the audit stream in real-time, this speed is critical.

**`openai-gpt-oss-120b`** is the backup. It produces a more detailed report (~1291 tokens) and finds the bug, but 14.3s TTFT is noticeable during a demo. Acceptable if qwen3-coder goes down.

**`zai-org-glm-5`** failed to identify the reentrancy. Slow and inaccurate — not suitable.

### Venice infrastructure note

Three models timed out at 60s: `deepseek-v3.2`, `qwen3-235b-a22b-instruct-2507`, and in earlier runs even `zai-org-glm-5` timed out at 5 minutes. `deepseek-v3.2` worked reliably in our vuln-discovery experiments earlier (March 20), so this is likely a transient Venice infrastructure issue — possibly heavy load on those model backends or routing problems. **This is not a model quality issue; it's a Venice availability issue.** We should not depend on these models for demo reliability.

## Decision

Default model switched to `qwen3-coder-480b-a35b-instruct` across all packages:
- `packages/web/src/server.ts`
- `packages/web/src/RoomManager.ts`
- `packages/researcher/src/experiments/e2e-discovery.ts`
- `packages/researcher/src/experiments/vuln-discovery.ts`

## Reproduce

```bash
bun run packages/researcher/src/experiments/benchmark-models.ts
```
