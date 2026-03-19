# Venice AI -- Technical Assessment

**Date:** 2026-03-12
**Context:** Sponsor of The Synthesis hackathon. Evaluating for use in Mnemo (private negotiation rooms with conversation forking).

---

## TL;DR Verdict

Venice offers two distinct privacy models: **policy-based privacy** for standard inference, and **cryptographic privacy** via their alpha E2EE/TEE feature. Standard inference anonymizes requests and relies on operational commitments (no logging, identity stripping, GPU purge after processing). This is meaningful privacy for many use cases, though not cryptographically verifiable. Venice also offers an alpha TEE inference mode with hardware attestation and end-to-end encryption -- genuinely novel work, still maturing. For Mnemo's requirements (cryptographic guarantees), we use Venice either via E2EE mode or as an inference provider called *from within* our Phala TEE enclave.

---

## 1. Does Venice Run on TEE?

**Yes, for E2EE models.** Venice offers 15 E2EE-capable models running on Intel TDX + NVIDIA Confidential Computing hardware, with verifiable attestation. The TEE provider is near-ai, running on dstack-nvidia-0.5.5. Standard (non-E2EE) Venice inference does not use TEEs.

The E2EE protocol has been reverse-engineered from Venice's frontend JS (it is undocumented). It uses per-message ephemeral ECDH key pairs (secp256k1), HKDF-SHA256 with info `"ecdsa_encryption"`, and AES-256-GCM. Hardware attestation (Intel TDX + NVIDIA CC) is verifiable via the `/api/v1/tee/attestation` endpoint. See `docs/research/research-venice-e2ee-effect.md` for full protocol details.

**Caveats:**
- The E2EE protocol is partially documented as of March 2026 (~60% coverage). Critical details still missing: HKDF info string `"ecdsa_encryption"`, IKM derivation (x-coordinate only), salt (undefined), GCM tag position. See `docs/venice-tee-feedback.md` for full gap analysis.
- ~~Attestation does not support client nonces (502 bug)~~ **FIXED as of March 19, 2026** — client nonces (32 bytes / 64 hex chars) now work. The nonce is bound into both the Intel TDX quote and NVIDIA payload, enabling attestation freshness verification.
- Silent degradation to plaintext if E2EE headers are incomplete (fail-open) — still undocumented
- No native tool calling support in E2EE mode
- E2EE model names have changed: now use `e2ee-` prefix (e.g., `e2ee-qwen-2-5-7b-p`, `e2ee-glm-5`). 11 E2EE models available as of March 19, 2026. No official SDK exists.

They also acknowledge that homomorphic encryption (the other potential path to private inference) is "not feasible in any manner that would please a user" -- too slow and too expensive.

**Bottom line:** For standard inference, Venice's privacy is policy-based. For E2EE models, Venice provides real hardware attestation and end-to-end encryption. Documentation has improved from zero to ~60% but critical crypto parameters (HKDF info, IKM derivation) remain undocumented. Our `packages/venice/` client remains the most complete programmatic E2EE implementation outside Venice's own frontend.

## 2. Actual Privacy Architecture

Here is what actually happens to your prompt with standard (non-TEE) Venice inference:

1. **Browser -> Venice Proxy**: SSL-encrypted transit. Venice proxy receives the request.
2. **Venice Proxy -> Decentralized GPU**: The proxy strips identity metadata (IP, user info) and forwards the prompt to a GPU operator.
3. **GPU processes prompt**: With standard inference, the GPU operator **sees the plaintext prompt**. This is confirmed explicitly by founder Erik Voorhees: *"[The GPU] does see the plain text of the specific prompt."*
4. **Response streams back** through the proxy to your browser.
5. **Prompt is purged** from GPU memory after processing (policy claim, not technically enforced).

### What GPU operators CAN see:
- The full plaintext of your prompt
- The full plaintext of the response they generate

### What GPU operators CANNOT see (per Venice's claims):
- Your identity
- Your IP address
- Your other conversations
- Any metadata linking you to the prompt

### What Venice (the company) claims it cannot see:
- The content of your prompts or responses (they pass through the proxy but are not stored)

### Limitations of the policy-based model:
- **No attestation or proof** that prompts are actually purged from GPUs
- **No cryptographic enforcement** for standard inference -- trust is placed in Venice and GPU operators
- **The proxy is Venice-controlled** -- you trust Venice to handle the proxy layer correctly
- **No remote attestation** for standard inference -- the E2EE/TEE alpha addresses this for supported models
- Telemetry is **enabled by default** (can be disabled in settings)

### Assessment:
For standard inference, Venice provides policy-based privacy: anonymized requests, no logging claims, and GPU purge after processing. This is stronger than providers like OpenAI (which explicitly trains on your data by default) but does not offer cryptographic or verifiable guarantees. The trust model relies on Venice and GPU operators following their stated policies. Venice's alpha E2EE/TEE mode aims to add cryptographic guarantees on top of this foundation, with hardware attestation and end-to-end encryption for 15 supported models.

## 3. API Compatibility and Models

### OpenAI-Compatible API
Yes. Drop-in compatible with OpenAI client libraries.

- **Base URL:** `https://api.venice.ai/api/v1`
- **Auth:** Bearer token (`Authorization: Bearer VENICE_API_KEY`)
- **Endpoints:** Chat completions, image generation, embeddings, TTS, STT
- Supports streaming, system prompts, prompt caching

### Available Models (~25 via model router)

**Text/Chat (notable):**
| Model | Notes |
|-------|-------|
| Dolphin Mistral 24B Venice Edition | Default "uncensored" model |
| Qwen QwQ 32B | Reasoning model with thinking blocks |
| Llama 3.2 3B | Fast/small |
| Mistral Small 3.1 24B | Vision-enabled, balanced |
| Qwen3-235B-A22B | Large, 256K context |
| DeepSeek V3.2 | Cheap ($0.40/$1.00 per 1M tokens) |
| GPT-4o, GPT-4o Mini | OpenAI models via Venice |
| Claude Sonnet 4.6, Claude Opus 4.5 | Anthropic models via Venice |
| GLM 5, GLM 4.7 Flash Heretic | Zhipu AI models |

**Other modalities:** Image generation (multiple models, $0.01-$0.29/image), TTS (Kokoro, $3.50/1M chars), STT ($0.0001/audio second), embeddings (BGE-M3).

**Venice-specific parameters:**
- `include_venice_system_prompt: false` -- disable Venice's default system prompt injection
- `enable_web_search` / `enable_web_scraping` -- optional web access
- `disable_thinking` / `strip_thinking_response` -- control reasoning model output
- `character_slug` -- use pre-built Venice characters

### Rate Limits
Rate limits exist at user, API key, and global levels. Tracked via response headers (`x-ratelimit-limit-requests`, `x-ratelimit-remaining-tokens`, etc.). Specific numbers are **not published** in their docs.

## 4. Custom Harnesses / Code Execution

**No.** Venice is inference-only. You cannot:
- Run custom code on Venice infrastructure
- Fine-tune models
- Deploy custom models
- Execute arbitrary workloads

Venice is a model router -- it takes your prompt, routes it to a GPU, returns the result. Nothing more.

This means for Mnemo, Venice is purely a **downstream inference provider**. Our negotiation harness, forking logic, and room management must run elsewhere (Phala TEE).

## 5. Privacy Guarantees vs. Marketing Claims

| Marketing Claim | Reality |
|----------------|---------|
| "Private AI" | Standard inference provides policy-based privacy (anonymized, no logging). E2EE mode (15 models) adds cryptographic privacy via TEE + encryption; protocol is undocumented and still in alpha. |
| "Conversations never stored on servers" | Prompts pass through Venice's proxy. Claimed not to be stored, but no proof. |
| "Decentralized GPU network" | GPUs see plaintext. "Decentralized" means multiple GPU operators, not trustless computation. |
| "Encrypted conversations" | SSL in transit + encrypted local browser storage. Prompts are **decrypted at the GPU**. |
| "No data tied to identity" | Identity stripping happens at Venice's proxy. You trust Venice to do this correctly. |
| "Prompts purged after processing" | Policy claim. No attestation, no enforcement mechanism. |

**Two tiers of privacy:** Venice's standard inference provides anonymity-by-policy -- the GPU processes plaintext but does not know who you are. This is a meaningful privacy model for many use cases, distinct from cryptographic privacy-by-design. The E2EE mode (15 models on Intel TDX + NVIDIA CC) bridges this gap with hardware attestation and end-to-end encryption, adding cryptographic guarantees. The E2EE protocol is undocumented and still in alpha (see `research-venice-e2ee-effect.md` for integration details).

## 6. Using Venice from Inside a Phala TEE Enclave

This is the architecture that actually makes sense for Mnemo:

```
[Agent A] <--TEE--> [Phala Enclave: Negotiation Harness]
                              |
                         HTTPS call to Venice API
                              |
                    [Venice GPU: inference only]
                              |
                    [Response back to enclave]
```

### How it works:
1. Our negotiation harness runs inside a **Phala TEE enclave** -- this is where the real privacy lives
2. The enclave makes outbound HTTPS calls to Venice's API for inference (Phala supports secure outbound calls with attestation)
3. With standard inference, Venice GPU sees the prompt plaintext, but:
   - It doesn't know which negotiation room it belongs to
   - It doesn't know the agents' identities
   - It sees only one inference call, not the full conversation history (unless we send it)
4. The response comes back into the enclave where our harness processes it

### Privacy implications:
- **What Venice GPU sees:** Individual inference prompts, stripped of negotiation context (if we design the prompts carefully)
- **What Venice GPU does NOT see:** Room state, agent identities, fork history, deal terms
- **What Phala TEE protects:** Everything else -- the harness logic, conversation state, forking/rewinding, identity verification

### Design considerations:
- **Minimize context sent to Venice:** Don't send full conversation history. Summarize or use structured prompts that leak minimal negotiation state.
- **Use Venice's `include_venice_system_prompt: false`** to prevent Venice from injecting its own system prompt
- **Consider using the cheapest model** (DeepSeek V3.2 at $0.40/1M input tokens) for routine inference, reserving larger models for complex reasoning
- **Prompt caching** may leak information about repeated patterns -- evaluate whether to disable it
- **Rate limits** are the main practical concern -- unknown exact thresholds

### Risk considerations:
With standard inference, Venice's policy-based privacy is the least cryptographically enforced part of the chain. Mitigation: design prompts so that even a full log of Venice API calls reveals minimal information about the negotiation. The enclave is the brain; Venice provides the language capability. Alternatively, use Venice's E2EE mode for cryptographic protection on the inference calls themselves.

## 7. Pricing, Rate Limits, and Hackathon Constraints

### Pricing (pay-as-you-go USD)
| Resource | Cost |
|----------|------|
| DeepSeek V3.2 | $0.40 input / $1.00 output per 1M tokens |
| GPT-4o Mini | $0.19 input / $0.75 output per 1M tokens |
| Qwen3-235B | More expensive (check current pricing) |
| Claude Opus 4.5 | $6.00 input / $30.00 output per 1M tokens |
| Web search | $10.00 per 1K calls |
| Image generation | $0.01 - $0.29 per image |

### Access methods:
1. **USD pay-as-you-go:** Standard API billing
2. **VVV staking -> Diem:** Stake VVV tokens on Base, get daily-refreshing Diem credits (1 Diem = $1/day of compute forever). Resets at midnight UTC.
3. **Pro subscription:** $180/year, includes $10 API credit on signup

### Hackathon relevance:
- Venice is a Synthesis sponsor. They may provide API credits -- **check with organizers**
- Their bounty track focuses on **agents that use image generation** through Venice's API. This is not directly aligned with Mnemo's text-based negotiation use case, but we could potentially add a visual element
- For a hackathon demo, DeepSeek V3.2 at $0.40/1M input tokens is cheap enough that costs should be negligible
- Rate limits are the unknown -- not published, could be a problem under load

---

## Strategic Recommendation for Mnemo

### Use Venice as: inference provider called from within Phala TEE, or directly via E2EE mode (15 models, protocol now known)
### Do NOT use Venice standard (non-E2EE) inference as: the privacy layer

**Architecture:**
- Phala TEE = trust boundary (negotiation state, identity, forking logic)
- Venice API = stateless inference calls from within the enclave
- Design prompts to be **context-minimal** -- the less Venice sees, the better
- Use `include_venice_system_prompt: false` always

**Sponsor alignment:**
- Venice's bounty track is about image generation for agents, which is tangential to Mnemo
- However, using Venice for inference (even text-only) demonstrates integration with a sponsor's product, which helps politically
- Consider adding a visual negotiation summary or deal visualization via Venice image generation to hit their bounty track

**What Venice actually gives us:**
- OpenAI-compatible API (easy integration)
- Uncensored models (useful for negotiation scenarios where agents need to discuss sensitive terms without refusal)
- Cheap inference (DeepSeek V3.2)
- Privacy narrative that aligns with Mnemo's goals (standard inference provides policy-based privacy; E2EE mode adds cryptographic privacy)

**Areas for improvement in Venice's E2EE alpha (shared as feedback):**
- E2EE protocol documentation (currently undocumented; we reverse-engineered from frontend JS)
- Client-nonce support for attestation freshness (currently returns 502)
- Fail-closed behavior when E2EE headers are incomplete (currently degrades silently to plaintext)
- Native tool calling in E2EE mode
- Standard (non-E2EE) inference relies on policy-based privacy, not cryptographic guarantees
- No custom code execution or fine-tuned model support (Venice is inference-only by design)

---

## Sources

- [Venice Privacy Architecture](https://venice.ai/privacy)
- [How Venice Handles Your Privacy (Blog)](https://venice.ai/blog/how-venice-handles-your-privacy)
- [Venice API Reference](https://docs.venice.ai/api-reference/api-spec)
- [Venice API Pricing](https://docs.venice.ai/overview/pricing)
- [Venice Model Paradigm (Blog)](https://venice.ai/blog/venice-new-model-paradigm)
- [Venice Models Overview](https://docs.venice.ai/models/overview)
- [Understanding Diem](https://venice.ai/blog/understanding-venice-compute-units-vcu)
- [Introducing Diem as Tokenized Intelligence](https://venice.ai/blog/introducing-diem-as-tokenized-intelligence-the-next-evolution-of-vvv)
- [Privacy Guides Community Discussion](https://discuss.privacyguides.net/t/venice-ai/22799)
- [Erik Voorhees on Venice (Decrypt)](https://decrypt.co/230281/venice-ai-shapeshift-founder-erik-voorhees-morpheus-open-source)
- [Phala Private AI Inference](https://phala.com/solutions/private-ai-inference)
- [The Synthesis Hackathon](https://synthesis.md/)
