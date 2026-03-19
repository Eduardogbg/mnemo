# Venice E2EE/TEE Alpha -- Integration Feedback

**From:** Mnemo team (The Synthesis hackathon, March 2026)
**Context:** We integrated Venice's E2EE inference into a TEE-based private negotiation protocol. Venice granted us alpha access, and we're grateful for the opportunity to work with this feature early.

---

## What We Love

Venice is one of very few providers offering end-to-end encrypted inference with hardware attestation. This is genuinely novel work, and we want to see it succeed. Here's what works well:

- **Attestation endpoint is clean.** `/api/v1/tee/attestation?model=<model>` returns a well-structured response with Intel TDX and NVIDIA CC verification, signing keys, and full event logs. The verification fields (`tdx.valid`, `nvidia.signatureVerified`, `signingAddressBinding.bound`) are easy to consume programmatically.

- **E2EE round-trip works.** Once we understood the protocol, encrypted inference works reliably. The per-message ephemeral ECDH design (secp256k1) is solid cryptography.

- **Good model selection.** 15 E2EE-capable models including DeepSeek V3.1, GPT-OSS 120B, Qwen3, GLM-5, and Gemma 3. This gives integrators real choice.

- **Hardware stack is strong.** Intel TDX + NVIDIA Confidential Computing on dstack-nvidia-0.5.5, with dual attestation (CPU + GPU). This is the right foundation.

- **Response signatures via `/api/v1/tee/signature`** provide cryptographic proof that inference ran inside the TEE. Very useful for audit trails.

---

## Integration Findings

We reverse-engineered the E2EE protocol from Venice's frontend JavaScript in order to build a programmatic client. Below are the areas where documentation or behavior changes would help future integrators.

### 1. ~~Attestation: Nonce Support Returns 502~~ FIXED

**Originally observed:** `GET /api/v1/tee/attestation?model=<model>&nonce=<hex>` returned 502.

**Update (2026-03-19):** Client nonces now work. The nonce must be exactly 32 bytes (64 hex characters). The response includes `request_nonce` matching the client's nonce, and it is bound into both the Intel TDX quote and the NVIDIA CC payload. Example:

```
GET /api/v1/tee/attestation?model=e2ee-qwen-2-5-7b-p&nonce=<64-hex-chars>
→ { "request_nonce": "<same-64-hex-chars>", "intel_quote": "...", "nvidia_payload": "..." }
```

Without a client nonce, the server still generates its own (`request_nonce` is server-random). Note: model names have changed — use `e2ee-` prefixed names (e.g., `e2ee-qwen-2-5-7b-p`, `e2ee-glm-5`). 11 E2EE models available as of March 19, 2026.

### 2. E2EE Protocol: Partially Documented (was Undocumented)

**Originally observed:** The E2EE protocol was not documented at all.

**Update (2026-03-19):** Venice has published documentation at `docs.venice.ai/overview/guides/tee-e2ee-models`. It now covers the high-level flow (ECDH + HKDF-SHA256 + AES-256-GCM), required headers, attestation endpoint, and constraints. However, critical implementation details are still missing (see items 4-6 below). A developer cannot implement E2EE from the docs alone — our reverse-engineering remains necessary.

**What we found:**
- Per-message ephemeral ECDH key pairs (secp256k1)
- HKDF-SHA256 with `info="ecdsa_encryption"` (the info string is not documented anywhere)
- Ciphertext format: `ephemeralPubKey(65B) || nonce(12B) || ciphertext+tag`, hex-encoded
- Three required headers: `X-Venice-TEE-Client-Pub-Key`, `X-Venice-TEE-Model-Pub-Key`, `X-Venice-TEE-Signing-Algo`
- The client pub key header is a signal to activate E2EE mode, not used for ECDH

**Suggestion:** Publish E2EE protocol documentation, including the KDF parameters, ciphertext format, header requirements, and the per-chunk response encryption format. This would dramatically lower the barrier for programmatic integrations.

### 3. Silent Degradation to Plaintext

**Observed:** If E2EE headers are partially present (e.g., only `X-Venice-TEE-Client-Pub-Key` without the other two), the server silently returns a plaintext response. No error, no warning header.

**Impact:** An integrator with a bug in header construction might believe they have E2EE active when they do not. This is a fail-open design.

**Suggestion:** Return an error (4xx) when E2EE headers are partially present, or include a response header indicating whether E2EE was active for the request (e.g., `X-Venice-E2EE-Active: false`).

### 4. KDF Parameters Not Documented

**Observed:** The HKDF info string `"ecdsa_encryption"` is critical for correct key derivation but is not documented anywhere. We discovered it only by reading minified JavaScript. Using any other info string (empty, `"venice-e2ee"`, etc.) produces `Decryption failed`.

**Suggestion:** Document the full KDF parameterization: algorithm (HKDF-SHA256), IKM (ECDH x-coordinate), salt (undefined/omitted), info (`"ecdsa_encryption"`), output length (32 bytes).

### 5. Per-Chunk Response Encryption

**Observed:** Streaming responses are encrypted per-chunk. The chunking and encryption format for responses is not documented.

**Suggestion:** Document the response encryption format, including how streaming chunks are individually encrypted and how the client should reassemble them.

### 6. Header Key vs. Ephemeral Key Distinction

**Observed:** The `X-Venice-TEE-Client-Pub-Key` header contains a public key that serves only as a mode activation signal. The actual ECDH key exchange uses the ephemeral public key embedded in each message's ciphertext prefix (first 65 bytes). This distinction is non-obvious.

**Suggestion:** Document this clearly. Integrators will naturally assume the header key is used for ECDH, which leads to decryption failures.

---

## Summary

Venice's E2EE/TEE feature is impressive and fills a real gap in the market. The core cryptography and hardware attestation work well. The main barrier to adoption is documentation -- the protocol details are solid but undiscoverable without reading frontend source code. We'd be happy to share our TypeScript client implementation (`packages/venice/src/e2ee.ts`) as a reference for documentation or an official SDK.

Thank you for granting us early access. We're excited to see this feature mature.
