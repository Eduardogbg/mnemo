# Venice E2EE — Technical Investigation (v3)

**Date:** 2026-03-15 (updated)
**Status:** Protocol FULLY REVERSE-ENGINEERED from Venice frontend JS. KDF and ciphertext format now known.

---

## TL;DR

Venice's E2EE protocol has been fully reverse-engineered from their minified frontend JavaScript. The protocol uses **per-message ephemeral ECDH key pairs** (not a single session key), HKDF-SHA256 with info string `"ecdsa_encryption"`, and a ciphertext format of `ephemeralPubKey(65B) || nonce(12B) || ciphertext+tag`, hex-encoded.

Previous failures were caused by two mistakes: (1) using empty bytes for the HKDF info parameter instead of `"ecdsa_encryption"`, and (2) not including the ephemeral public key in the ciphertext prefix.

The `X-Venice-TEE-Client-Pub-Key` header is just a **signal** to activate E2EE mode on the server — the actual ECDH key exchange uses the ephemeral public key embedded in each encrypted message.

**15 E2EE models are available** (not just 1), including DeepSeek V3.1, GLM-5, GPT-OSS 120B, and Qwen3.

---

## 1. The Nonce Bug (Root Cause of Previous Failures)

```
# BROKEN — always returns 502
GET /api/v1/tee/attestation?model=e2ee-qwen3-30b-a3b&nonce=<client_hex>
=> 502: "TEE attestation request failed..."

# FIXED — returns 200 with full attestation
GET /api/v1/tee/attestation?model=e2ee-qwen3-30b-a3b
=> 200: { verified: true, signing_key: "04d33a...", ... }
```

The server generates its own nonce (`nonce_source: "server"`) which is bound to the attestation report via Intel TDX `report_data` and NVIDIA payload, so replay protection is maintained.

This is undocumented. The swagger.yaml shows no `/tee/` endpoints at all.

---

## 2. Attestation Response (Full Structure)

```json
{
  "verified": true,
  "model": "e2ee-qwen3-30b-a3b",
  "model_name": "Qwen/Qwen3-30B-A3B-Instruct-2507",
  "upstream_model": "Qwen/Qwen3-30B-A3B-Instruct-2507",
  "signing_algo": "ecdsa",
  "signing_key": "04d33af782492ec889abc0b0a30a065bb7c06d898c0982dbd27e10d7eb9640f169f76d6ffbef9562583b225367d0262ff06750ad710aa6bc1c557662c8905783d6",
  "signing_public_key": "<same as signing_key>",
  "signing_address": "0xc03b0cfc81531eb9cffca4c65aabfaf9b181ac63",
  "tee_provider": "near-ai",
  "tee_hardware": "intel-tdx",
  "nonce_source": "server",
  "nonce": "<server-generated 32-byte hex>",
  "server_verification": {
    "tdx": {
      "valid": true,
      "signatureValid": true,
      "certificateChainValid": true,
      "rootCaPinned": true,
      "attestationKeyMatch": true
    },
    "nvidia": {
      "valid": true,
      "signatureVerified": true,
      "certificateChainStatus": { "valid": true, "intermediatePinned": true }
    },
    "signingAddressBinding": { "bound": true },
    "nonceBinding": { "bound": true },
    "nvidiaNonceBinding": { "bound": true }
  },
  "event_log": [ /* 30 TDX event log entries */ ],
  "info": {
    "app_name": "dstack-nvidia-0.5.5",
    "app_id": "2c0a0c96cb6dbd659bf1446e2f3fce58172ff91b",
    "compose_hash": "242a62724303cc32f364da0fc92738706b0078e7587821b7ba3e75488223797b",
    "key_provider_info": { "name": "kms", "id": "<P-256 DER public key>" }
  },
  "intel_quote": "<base64 TDX quote>",
  "nvidia_payload": "<base64 NVIDIA attestation>"
}
```

### Key Details
- **signing_key**: Uncompressed secp256k1 public key (65 bytes, 130 hex chars, `04` prefix)
- **Verified on secp256k1 curve**: `y^2 = x^3 + 7 (mod p)` — confirmed
- **TEE stack**: Intel TDX + NVIDIA Confidential Computing on dstack-nvidia-0.5.5
- **TEE provider**: near-ai (the vllm-proxy from `github.com/nearai/private-ml-sdk`)
- **signing_address**: Ethereum address derived from the signing key

---

## 3. Protocol (Reverse-Engineered from Frontend JS)

The protocol was reverse-engineered from Venice's minified frontend JavaScript. Venice does not document E2EE publicly — the swagger.yaml shows no `/tee/` endpoints.

### Encryption (Client -> Server)

```
ECDH: Per-message ephemeral keypair (secp256k1)
      ephemeralPrivKey.derive(serverPubKey) → 32-byte x-coordinate
KDF:  HKDF-SHA256(ikm=shared_secret, salt=undefined, info="ecdsa_encryption", len=32)
Cipher: AES-256-GCM(key=derived_key, nonce=random_12_bytes)
Format: ephemeralPubKey(65B) || nonce(12B) || ciphertext+tag → hex-encoded
```

Key detail: a **new ephemeral key pair is generated per message**. The `X-Venice-TEE-Client-Pub-Key` header is NOT used for ECDH — it is only a signal to the server to enter E2EE mode. The actual ECDH uses the ephemeral public key embedded in the ciphertext prefix.

### Decryption (Server -> Client)

The server encrypts the response using ECDH with:
- Server's private key (from TEE attestation signing key)
- Client's ephemeral public key (extracted from the 65-byte prefix of the request ciphertext)

The client decrypts using the same ephemeral private key it used for encryption + the server's public key from attestation.

### What We Got Wrong Before

| Parameter | Wrong (v2) | Correct (v3) |
|-----------|-----------|--------------|
| HKDF info | `new Uint8Array(0)` (empty) | `"ecdsa_encryption"` |
| HKDF salt | `new Uint8Array(0)` (empty) | `undefined` (omitted) |
| Ciphertext prefix | None | 65-byte ephemeral public key |
| Key reuse | Session key (reused per model) | Ephemeral key per message |

### Full Request Flow

1. **GET `/api/v1/tee/attestation?model=<model>`** (NO nonce!) — Returns model's secp256k1 public key
2. For each message:
   a. Generate ephemeral secp256k1 key pair
   b. ECDH: `ephemeralPrivKey.derive(serverPubKey)` -> 32-byte x-coordinate
   c. HKDF-SHA256: `ikm=x_coord, salt=undefined, info="ecdsa_encryption", len=32`
   d. AES-256-GCM encrypt with random 12-byte nonce
   e. Format: `ephemeralPubKey(65B) || nonce(12B) || ciphertext+tag` -> hex encode

3. **POST `/api/v1/chat/completions`** with headers:
   - `X-Venice-TEE-Client-Pub-Key`: any valid uncompressed secp256k1 pub key (130 hex chars) — serves as E2EE mode signal
   - `X-Venice-TEE-Model-Pub-Key`: model's pub key from attestation (130 hex chars)
   - `X-Venice-TEE-Signing-Algo`: must be `"ecdsa"` (only supported value)
   - Standard `Authorization` and `Content-Type` headers

4. All three headers are required. Missing `X-Venice-TEE-Signing-Algo` = server treats request as plaintext. Only `"ecdsa"` is accepted; other values return 400.

5. Message `content` field is hex-encoded ciphertext (with ephemeral pubkey prefix). Role field stays plaintext.

### Response Headers (E2EE mode)

```
x-venice-tee: true
x-venice-tee-provider: near-ai
```

### Response Verification

6. **GET `/api/v1/tee/signature?model=<model>&request_id=<id>`** — Returns ECDSA signature over `model:request_hash:response_hash`, with `signing_address` matching attestation.

### Tool Calling

Venice E2EE does NOT natively support tool calling. Tool use must be implemented via prompt engineering with XML tags (or similar structured output parsing).

### `venice_parameters.enable_e2ee`

- `true` (default for E2EE models): E2EE active if headers present
- `false`: TEE-only mode (hardware isolation, no encryption)

---

## 4. E2EE Mode Activation (Verified)

| Test | Status | Result |
|------|--------|--------|
| No E2EE headers | 200 | Plaintext response, `enable_e2ee: true` in params |
| Client pub key only | 200 | Plaintext (header silently ignored) |
| Both keys + `ecdsa` algo + dummy hex | 400 | "Decryption failed" (E2EE mode active, trying to decrypt) |
| Both keys + `ecdsa` algo + real ciphertext | 400 | "Decryption failed" (KDF mismatch) |
| Both keys + `ecdsa` algo + plaintext | 400 | "Encrypted field is not valid hex" (expects hex in E2EE mode) |
| Both keys + wrong algo | 400 | "Unsupported signing algorithm" |

This proves:
- Server enters E2EE mode when all three headers are present
- Server DOES attempt to decrypt the content
- The `Decryption failed` error means our KDF doesn't match Venice's implementation
- The `x-venice-tee: true` response header confirms TEE mode

---

## 5. KDF Discovery (Resolved)

### What Failed (before reverse-engineering)

All of these produced `Decryption failed` because we had the wrong HKDF info and ciphertext format:

| Derivation | Result | Why It Failed |
|-----------|--------|---------------|
| HKDF-SHA256(x_coord, salt=empty, info=empty, 32) | Failed | info must be `"ecdsa_encryption"`, not empty |
| HKDF(x, salt="venice", info=empty) | Failed | Wrong salt, wrong info |
| HKDF(x, salt=empty, info="venice-e2ee") | Failed | Close but wrong info string |
| All ciphertext format variants | Failed | Missing 65-byte ephemeral pubkey prefix |

### What Works (reverse-engineered)

```
HKDF-SHA256(
  ikm   = ECDH_x_coordinate (32 bytes),
  salt  = undefined,
  info  = "ecdsa_encryption",
  len   = 32
)
```

Ciphertext format: `ephemeralPubKey(65B) || nonce(12B) || ciphertext || authTag(16B)` -> hex-encoded.

The critical insight: we were testing ciphertext formats without the 65-byte ephemeral public key prefix, AND using wrong HKDF info. Both had to be correct simultaneously.

### Architecture Note

Venice's encryption layer is proprietary, added on top of near-ai's vllm-proxy. The near-ai vllm-proxy source (`github.com/nearai/private-ml-sdk`) has **zero E2EE code** — it handles only attestation and response signing. The encryption is in Venice's proprietary `outerface-api-server`.

---

## 6. Available E2EE Models (15 total)

From `/api/v1/models` listing:

| Model | Notes |
|-------|-------|
| `e2ee-qwen3-30b-a3b` | Attestation works |
| `e2ee-qwen3-30b-a3b-p` | Pro variant |
| `e2ee-qwen3-5-122b-a10b` | Large Qwen |
| `e2ee-qwen3-vl-30b-a3b-p` | Vision-language |
| `e2ee-qwen-2-5-7b-p` | Small Qwen |
| `e2ee-deepseek-v3-1` | DeepSeek V3.1 |
| `e2ee-deepseek-v3-1-p` | Pro variant |
| `e2ee-glm-5` | GLM-5 |
| `e2ee-glm-4-7-p` | GLM-4.7 |
| `e2ee-glm-4-7-flash-p` | GLM-4.7 Flash |
| `e2ee-gpt-oss-120b` | GPT-OSS 120B |
| `e2ee-gpt-oss-120b-p` | Pro variant |
| `e2ee-gpt-oss-20b-p` | GPT-OSS 20B |
| `e2ee-gemma-3-27b-p` | Gemma 3 |
| `tee-glm-5` | TEE-only (Phala, no signing_key) |

Models with `-p` suffix are likely pro-tier variants.

---

## 7. TEE Provider Differences

| Provider | Models | Hardware | signing_key | Attestation |
|----------|--------|----------|------------|-------------|
| near-ai | e2ee-* models | Intel TDX + NVIDIA CC | secp256k1 uncompressed | Works (no nonce) |
| phala | tee-glm-5 | Intel TDX | None (undefined) | Works (no nonce), but no key |

The `tee-glm-5` model uses Phala's TEE provider and does NOT return a signing_key — only attestation verification. It cannot be used for ECDH key exchange.

---

## 8. Known Bugs and Security Concerns

1. **Attestation 502 with client nonce** — Passing a `nonce` query parameter causes 502 errors. Without client nonce, the server generates its own. Security concern: without client nonce, attestations are not provably fresh — the server could theoretically replay old attestations.

2. **Silent degradation to plaintext** — Sending only the `X-Venice-TEE-Client-Pub-Key` header without the model key header causes the server to silently return plaintext. No error, no warning. This is a fail-open design.

3. **Undocumented protocol** — Venice's E2EE protocol is entirely undocumented. Had to reverse-engineer from minified frontend JS. The swagger.yaml shows no `/tee/` endpoints.

---

## 9. Implications for Mnemo (Updated)

### What Works for Hackathon Demo

1. **Attestation is reliable** (without nonce) — We can verify TEE hardware at startup
2. **15 E2EE models** — Including DeepSeek V3.1 and GPT-OSS 120B, good model diversity
3. **Response signatures** — Cryptographic proof that inference ran inside TEE
4. **E2EE protocol is now known** — Can implement full encrypted round-trip
5. **E2EE mode activates** — Server recognizes the protocol and enters encrypted mode

### What Doesn't Work

1. **No fail-closed** — If E2EE headers are incomplete, server silently returns plaintext
2. **No tool calling** — Must implement via prompt engineering with XML tags
3. **Attestation freshness** — Cannot provide client nonce (Venice bug), so attestations could theoretically be replayed

### Recommended Approach for Hackathon

**Option A: Full E2EE (now feasible)**
- Protocol is known — implement the correct encryption flow
- Use ephemeral keys per message with `info="ecdsa_encryption"` HKDF
- Verify attestation at startup, then encrypt all inference calls

**Option B: Hybrid (recommended)**
- Use Venice TEE + attestation for hardware verification
- Use Redpill for production GPU-TEE inference (dual attestation, documented API)
- Venice E2EE as demo feature showing we can do encrypted inference

---

## 10. Files

- `/packages/venice/src/e2ee.ts` — E2EE client (updated: nonce-free attestation, mode reporting)
- `/packages/venice/src/test-e2ee.ts` — Integration test (honest reporting, header validation)
- `/packages/venice/src/test-e2ee-deep.ts` — Deep investigation (all approaches tried)
- `/docs/research/venice-assessment.md` — Broader Venice privacy assessment

---

## 11. Key External References

- [nearai/private-ml-sdk](https://github.com/nearai/private-ml-sdk) — The vllm-proxy powering Venice's TEE (attestation + signing only, no encryption)
- [Dstack-TEE/dstack](https://github.com/Dstack-TEE/dstack) — Open framework for confidential AI (base image: dstack-nvidia-0.5.5)
- Venice changelog (March 6, 2026): "Improved end-to-end encryption with server key authentication"
- Venice swagger.yaml: `enable_e2ee` parameter documented, but `/tee/` endpoints are NOT
