# Redpill Inference Architecture — Deep Technical Research

> Research date: 2026-03-12
> Confidence legend: **CONFIRMED** = documented/source-verified | **INFERRED** = logical deduction from partial docs | **UNKNOWN** = no source found

---

## 1. Prefix Caching Control

### What vLLM supports (upstream)

- **Flag**: `--enable-prefix-caching` — **enabled by default** as of vLLM v0.8.x (previously opt-in). Disable with `--no-enable-prefix-caching`.
- **Mechanism**: Hash-based block matching. vLLM hashes KV cache blocks and stores them in a hash table. When a new request shares a prefix with a previous one, blocks with matching hashes are reused.
- **Eviction**: LRU (Least Recently Used). When GPU memory is full and a block has reference count 0, the least recently used block is evicted first. There is **no configurable TTL** — blocks live until evicted by memory pressure.
- **Hash algorithm**: Configurable via `--prefix-caching-hash-algo` (`builtin` default, `sha256` for collision resistance).
- **No pinning API**: vLLM does not expose a way to "pin" specific prefixes in cache. The only control is indirect — keep issuing requests with that prefix to prevent LRU eviction.

### Your rewind scenario (messages 1-10 → rewind to 1-5 → new call with 1-5 + msg 11)

**INFERRED — favorable**: This pattern should get a cache hit on messages 1-5 in vLLM, because:
1. The KV blocks for tokens in messages 1-5 were computed during the 1-10 call.
2. After the call completes, those blocks enter the cache with refcount 0 (eligible for eviction but still present).
3. The next call (messages 1-5 + msg 11) will hash the same token sequence for blocks 1-5 and hit the cache.
4. The blocks for messages 6-10 will eventually be evicted via LRU since nothing references them.

**Key risk**: If Redpill serves many concurrent users on the same vLLM instance, cache pressure could evict your prefix blocks between turns. There is no way to guarantee persistence.

### Is prefix caching enabled on Redpill?

**UNKNOWN**. Redpill's docs do not mention prefix caching configuration. However:
- vLLM v0.8+ enables it by default, so unless Redpill explicitly disables it, it should be on.
- Phala's vLLM fork is at branch `phala-v0.5.4` — this is an older version where prefix caching was **opt-in**, not default. If Redpill runs this fork, prefix caching may be disabled unless they added `--enable-prefix-caching` to their launch args.
- **Action item**: Ask Phala directly whether `--enable-prefix-caching` is set on their managed Redpill inference nodes.

### Can we control TTL or pin prefixes?

**No** — neither upstream vLLM nor Redpill expose TTL or pinning controls. The only lever is memory pressure (fewer concurrent users = longer cache life).

---

## 2. Parallel Inference on Same Prefix (Forking)

### vLLM behavior (upstream)

**CONFIRMED — efficient**: vLLM's paged attention architecture handles this well:
- Two concurrent requests sharing a prefix will share the same physical KV cache blocks for the common portion (via reference counting).
- The divergent suffixes allocate new blocks independently.
- This is the core design of PagedAttention — it's how vLLM handles system prompts shared across many requests.

### On Redpill

**INFERRED — depends on routing**: If both fork requests hit the same vLLM instance, they'll share KV cache. If Redpill load-balances across multiple replicas (their docs mention 2-10 replicas with auto-scaling), the requests might land on different instances and each would compute the prefix independently.

**Workaround**: Send both requests in quick succession. If using streaming, start both streams concurrently. There's no API to force same-instance routing.

---

## 3. Message Deletion / Persistence (Statelessness)

### CONFIRMED — Stateless

Redpill is **stateless per-request**. Key evidence:

1. **Zero-logging architecture**: Phala docs state "usage receipts but no plaintext storage." Redpill docs: "Zero conversation storage."
2. **OpenAI-compatible API**: The `/v1/chat/completions` endpoint is request/response — no session ID, no conversation continuity. Each call is independent.
3. **No session state**: There is no concept of a "conversation ID" or persistent session in the API. You send the full message array each time.

**This is ideal for Mnemo**: Your state-manager maintains the DAG and reconstructs the relevant message history for each LLM call. Redpill sees each call as a fresh, independent request. When a scope closes and messages are deleted from your DAG, those messages simply never appear in subsequent API calls — Redpill never stored them.

**Privacy implication**: Prompts enter the TEE, are processed, and the response exits. No plaintext is persisted. Even Redpill operators cannot access prompts during inference (GPU memory encryption) or after (no storage).

---

## 4. Integration Architecture

### Base URL

**CONFIRMED**: `https://api.redpill.ai/v1`

Alternative (Phala direct, may be same backend): `https://inference-api.phala.network/v1`

### Authentication

**CONFIRMED**: Bearer token.
```
Authorization: Bearer $REDPILL_API_KEY
```
- Obtain key from Redpill dashboard (redpill.ai)
- Minimum account balance: $5 USD
- **TEE-derived key**: Not for auth. The TEE-derived signing key is for *response verification* (see Section 5), not for client authentication. Your CVM authenticates with a regular API key.

### Practical integration from Docker Compose

```python
# In harness-a or harness-b container
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["REDPILL_API_KEY"],
    base_url="https://api.redpill.ai/v1"
)

response = client.chat.completions.create(
    model="phala/deepseek-v3-0324",  # or other model ID
    messages=messages_from_dag,       # reconstructed each turn
    stream=True                       # streaming supported
)
```

Standard OpenAI SDK works as a drop-in. No special client needed.

### Latency from CVM to Redpill

**UNKNOWN — but likely not same-network**. Key observations:
- Your CVM runs on Phala Cloud (Intel TDX nodes).
- Redpill GPU TEE nodes are NVIDIA H100/H200 instances, also on Phala Cloud infrastructure.
- They may be in the same datacenter, in which case latency would be sub-millisecond for the network hop (inference compute dominates).
- However, they communicate over HTTPS (TLS), not a local socket — so there's TLS handshake overhead on each request (unless HTTP keep-alive / connection pooling is used, which the OpenAI SDK does by default).
- **Estimated total latency**: Dominated by inference time, not network. For DeepSeek V3 at 163K context, expect seconds per response, not milliseconds. Network hop is negligible relative to inference.

### Rate Limits

**UNKNOWN**. Redpill docs do not document explicit rate limits. Phala's inference API page says "pay-per-request" with no mention of caps. For a 2-agent negotiation (sequential turns), you're unlikely to hit any rate limit. If you fork (parallel inference), you might want to confirm there's no per-key concurrency limit.

---

## 5. Attestation Chain (CPU TEE → GPU TEE)

### Architecture

```
┌─────────────────┐     HTTPS/TLS      ┌──────────────────────────┐
│  Your CVM       │ ──────────────────► │  Redpill Gateway         │
│  (Intel TDX)    │                     │  (TEE-protected)         │
│                 │                     │         │                │
│  state-manager  │                     │         ▼                │
│  harness-a      │                     │  ┌────────────────────┐  │
│  harness-b      │                     │  │ GPU TEE (H100)     │  │
│                 │     signed response │  │ vLLM + model       │  │
│                 │ ◄────────────────── │  │ signing key in TEE │  │
└─────────────────┘                     │  └────────────────────┘  │
                                        └──────────────────────────┘
```

### How attestation works

**CONFIRMED — two separate mechanisms**:

#### A. Pre-deployment attestation (one-time verification)

Before sending any prompts, your CVM can verify the Redpill deployment:

```
GET https://api.redpill.ai/v1/attestation/report?model=phala/deepseek-v3-0324
```

Response contains:
- `signing_address` — the public key of a signing key generated *inside* the TEE
- `nvidia_payload` — NVIDIA GPU attestation report (proves H100 is in CC mode, firmware is genuine)
- `intel_quote` — Intel TDX attestation quote (proves CPU TEE integrity)
- `all_attestations` — array of attestations for all GPU nodes serving this model

You verify the `nvidia_payload` by POSTing it to:
```
POST https://nras.attestation.nvidia.com/v3/attest/gpu
```
NVIDIA's Remote Attestation Service validates the GPU is genuine and in Confidential Computing mode.

The `intel_quote` can be verified using Intel's DCAP (Data Center Attestation Primitives) or Intel Trust Authority.

#### B. Per-response signature verification

**CONFIRMED**: Each inference response is signed by the TEE's private key.
- The signing key is generated inside the TEE at startup. The private key never leaves the enclave.
- The public key (`signing_address`) is bound to the TEE attestation — the attestation report proves "this public key was generated inside this specific TEE."
- Inference responses include a signature. You verify the signature against the `signing_address` to confirm the response came from inside the TEE.
- You can verify signatures on-chain via Etherscan's signature verification tool, or programmatically with standard ECDSA verification.

#### C. Is this automatic?

**INFERRED — partially automatic**:
- Response signing appears to be automatic (vllm-proxy does this).
- Fetching and verifying the attestation report is something *your CVM must do explicitly* — call the `/v1/attestation/report` endpoint and validate the quotes.
- There is no evidence of automatic per-request TDX quote generation embedded in each response header. The attestation is a separate endpoint you query.

### Can your CVM verify on each response?

**INFERRED — yes, but not via TDX quote per response**:
1. At startup: Fetch attestation report, verify NVIDIA + Intel quotes, extract `signing_address`.
2. On each response: Verify the response signature against the `signing_address`.
3. Periodically: Re-fetch attestation report to ensure the TEE hasn't been restarted/tampered.

This gives you a chain: Hardware attestation → proves signing key integrity → each response signed by that key → response came from TEE.

---

## 6. Model Availability and Context Limits

### Phala-hosted models on Redpill (CONFIRMED)

| Model | Context | Input $/M tok | Output $/M tok |
|-------|---------|----------------|-----------------|
| DeepSeek V3 0324 | **163K** | $0.28 | $1.14 |
| Qwen2.5 VL 72B | 65K | $0.59 | $0.59 |
| Google Gemma 3 27B | 53K | $0.11 | $0.40 |
| OpenAI GPT OSS 120B | — | — | — |
| OpenAI GPT OSS 20B | — | — | — |
| Qwen2.5 7B | — | $0.04 | $0.10 |
| Sentence Transformers | — | $0.000005 | — |

Additional models from NearAI, Tinfoil, and Chutes providers (17+ total confidential models). Broader Redpill catalog has 250+ models (but most route through third-party providers without GPU TEE — only "identity anonymization" tier privacy).

### Streaming

**CONFIRMED**: Supported. Set `stream: true` in request.

### Tool calling / Function calling

**CONFIRMED**: Documented as supported ("Tool calling" listed in API features). Implementation follows OpenAI's tool calling format.

### Model-specific quirks

**DeepSeek V3 0324 notes**:
- 163K context window — large enough for extended multi-turn negotiations
- MoE architecture (Mixture of Experts) — may have more variable latency than dense models
- Pricing is asymmetric ($0.28 input vs $1.14 output) — your rewind pattern helps here since rewound input tokens may get prefix cache hits (cheaper effective cost)
- **The "0324" suffix suggests this is a March 2024 snapshot**. DeepSeek has released V3.1 and V3.2 since — Phala may be running an older version. NearAI lists DeepSeek V3.1 as available.

---

## 7. Implications for Mnemo Architecture

### What works well

1. **Stateless API** — perfect for DAG-based context reconstruction. No implicit state to fight against.
2. **Prefix caching** — your rewind pattern (long shared prefix + short new suffix) is the ideal access pattern for vLLM's automatic prefix caching. Messages 1-5 compute once, cached for reuse.
3. **Response signing** — you can cryptographically verify each agent's LLM response came from a TEE. This adds a trust layer to the negotiation (neither agent can claim the other fabricated an LLM response).
4. **OpenAI-compatible API** — minimal integration work. Standard Python SDK from each harness container.

### What needs attention

1. **Prefix caching may not be enabled** on Redpill (Phala's vLLM fork is v0.5.4 where it's opt-in). Need to confirm with Phala team.
2. **No prefix pinning** — under load, your prefix blocks could be evicted. For a 2-agent system with relatively low concurrency, this is probably fine. For a demo with dedicated GPU, definitely fine.
3. **Cross-replica routing** — if Redpill auto-scales to multiple replicas, fork requests might not share KV cache. For the hackathon, probably only 1 replica matters.
4. **Attestation verification adds startup complexity** — your CVM needs to fetch and verify the attestation report before starting the negotiation. This is a one-time cost but adds code.
5. **No per-request TDX quote** — you get a signed response, not a fresh hardware attestation per inference call. The signing key is attested once; responses are signed with that key. This is standard and sufficient.

### Open questions for Phala team

1. Is `--enable-prefix-caching` set on Redpill's managed vLLM instances?
2. Which vLLM version is running? (The fork is v0.5.4 but production may differ.)
3. Are there per-API-key rate limits or concurrency limits?
4. What's the network topology from a Phala Cloud CVM to the GPU TEE inference nodes? Same datacenter?
5. Is there a way to request a dedicated vLLM instance to guarantee cache isolation?
6. Does the response include the signature inline (e.g., in a header or extra field), or do we need to request it separately?

---

## Sources

- [Phala Confidential AI Overview](https://docs.phala.com/phala-cloud/confidential-ai/overview)
- [Phala GPU TEE Deploy & Verify](https://docs.phala.com/phala-cloud/confidential-ai/confidential-gpu/deploy-and-verify)
- [Phala GPU TEE Deep Dive](https://phala.com/posts/Phala-GPU-TEE-Deep-Dive)
- [Phala Private AI Cloud Architecture](https://phala.com/learn/Private-AI-Cloud-Architecture)
- [Phala Confidential LLMs](https://phala.com/learn/Confidential-LLMs)
- [Phala Private AI Inference](https://phala.com/solutions/private-ai-inference)
- [Phala dstack Security Update](https://phala.com/posts/dstack-security-update-attestation-pipeline-hardening)
- [dstack GitHub (Dstack-TEE)](https://github.com/Dstack-TEE/dstack)
- [Phala vLLM Fork](https://github.com/Phala-Network/vllm) (branch: phala-v0.5.4)
- [RedPill Docs — Developer Overview](https://docs.redpill.ai/developers/overview)
- [RedPill Docs — Confidential AI Overview](https://docs.redpill.ai/privacy/confidential-ai/overview)
- [Phala Inference API (models + pricing)](https://docs.phala.com/llm-in-gpu-tee/inference-api)
- [vLLM Prefix Caching Design](https://docs.vllm.ai/en/stable/design/prefix_caching/)
- [vLLM Engine Args v0.8.3](https://docs.vllm.ai/en/v0.8.3/serving/engine_args.html)
