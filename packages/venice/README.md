# @mnemo/venice

Venice AI integration package — TEE/E2EE inference exploration scripts.

## Setup

From the repo root:

```bash
bun install
```

Make sure your `.env` in the repo root contains:

```
VENICE_API_KEY=your-key-here
```

## Test Scripts

Run from the repo root or from `packages/venice/`:

```bash
# Verify API key works with a basic chat completion
bun run --cwd packages/venice src/test-basic.ts

# Test TEE model: attestation, inference, and signature retrieval
bun run --cwd packages/venice src/test-tee.ts

# List all models and identify TEE/E2EE ones
bun run --cwd packages/venice src/test-models.ts
```

Or using workspace scripts:

```bash
cd packages/venice
bun run test:basic
bun run test:tee
bun run test:models
bun run test:all    # run all three
```

## Venice TEE/E2EE Notes

- **TEE models** (`tee-*`): Run inside hardware-secured enclaves (Intel TDX). Venice cannot see the computation. API usage is identical to regular models — just use a `tee-` prefixed model name.
- **E2EE models** (`e2ee-*`): Add client-side ECDH encryption on top of TEE. Requires streaming, special headers, and an encryption handshake. Not yet implemented in these scripts.
- **Attestation**: `GET /tee/attestation?model=...&nonce=...` returns Intel TDX quotes proving the enclave is genuine.
- **Signature**: `GET /tee/signature?model=...&request_id=...` returns a signature over the response for tamper-proof verification.

Currently available TEE model: `tee-glm-5`. E2EE models include `e2ee-qwen3-30b-a3b`, `e2ee-deepseek-v3-1`, `e2ee-glm-5`, and others (run `test:models` for the full list).

Base URL: `https://api.venice.ai/api/v1`
