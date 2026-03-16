# Venice AI -- Honest Technical Assessment

**Date:** 2026-03-12
**Context:** Sponsor of The Synthesis hackathon. Evaluating for use in Mnemo (private negotiation rooms with conversation forking).

---

## TL;DR Verdict

Venice is a **convenience wrapper** around open-weight models with a privacy story built on **policy promises, not cryptographic guarantees** for standard inference. Standard Venice inference exposes plaintext prompts to GPU operators. Venice does offer a TEE inference mode, but it is currently an alpha feature -- not production-ready. The standard privacy architecture amounts to: "we don't log, we don't tie identity to prompts, and GPUs purge after processing." This is significantly weaker than what we need for Mnemo, but Venice is still useful as an inference provider called *from within* our Phala TEE enclave.

---

## 1. Does Venice Run on TEE?

**Yes, for E2EE models.** Venice offers 15 E2EE-capable models running on Intel TDX + NVIDIA Confidential Computing hardware, with verifiable attestation. The TEE provider is near-ai, running on dstack-nvidia-0.5.5. Standard (non-E2EE) Venice inference does not use TEEs.

The E2EE protocol has been reverse-engineered from Venice's frontend JS (it is undocumented). It uses per-message ephemeral ECDH key pairs (secp256k1), HKDF-SHA256 with info `"ecdsa_encryption"`, and AES-256-GCM. Hardware attestation (Intel TDX + NVIDIA CC) is verifiable via the `/api/v1/tee/attestation` endpoint. See `docs/research/research-venice-e2ee-effect.md` for full protocol details.

**Caveats:**
- The E2EE protocol is entirely undocumented by Venice -- had to reverse-engineer from minified JS
- Attestation does not support client nonces (502 bug), so freshness is not provable
- Silent degradation to plaintext if E2EE headers are incomplete (fail-open)
- No native tool calling support in E2EE mode

They also acknowledge that homomorphic encryption (the other potential path to private inference) is "not feasible in any manner that would please a user" -- too slow and too expensive.

**Bottom line:** For standard inference, Venice's privacy is policy-based. For E2EE models, Venice provides real hardware attestation and end-to-end encryption, though the protocol is undocumented and has some rough edges (nonce bug, silent plaintext degradation).

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

### Critical gaps:
- **No attestation or proof** that prompts are actually purged from GPUs
- **No cryptographic enforcement** -- a malicious GPU operator could log everything
- **The proxy is Venice-controlled** -- you are trusting Venice not to log at the proxy layer
- **No remote attestation** -- no way to verify any of these claims
- Telemetry is **enabled by default** (can be disabled in settings)

### Honest assessment:
For standard inference, this is roughly equivalent to the privacy of using any API service that pinky-promises not to log. It is better than OpenAI (which explicitly trains on your data by default) but it is **not private in any cryptographic or verifiable sense**. A subpoena, a rogue employee, or a compromised GPU operator breaks the model entirely. Venice's alpha TEE mode aims to address this, but is not yet production-ready.

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
| "Private AI" | Standard inference is policy-based. E2EE mode (15 models) provides real TEE + encryption, but protocol is undocumented and has bugs. |
| "Conversations never stored on servers" | Prompts pass through Venice's proxy. Claimed not to be stored, but no proof. |
| "Decentralized GPU network" | GPUs see plaintext. "Decentralized" means multiple GPU operators, not trustless computation. |
| "Encrypted conversations" | SSL in transit + encrypted local browser storage. Prompts are **decrypted at the GPU**. |
| "No data tied to identity" | Identity stripping happens at Venice's proxy. You trust Venice to do this correctly. |
| "Prompts purged after processing" | Policy claim. No attestation, no enforcement mechanism. |

**The core contradiction (standard inference):** Venice markets "privacy" but with standard inference the GPU literally sees your plaintext. Their defense is that the GPU doesn't know *who you are*. This is anonymity-by-policy, not privacy-by-design. The E2EE mode (15 models on Intel TDX + NVIDIA CC) addresses this with real hardware attestation and end-to-end encryption, though the protocol is undocumented and has known bugs (see `research-venice-e2ee-effect.md`).

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

### Honest risk assessment:
With standard inference, Venice is the **weakest link** in the privacy chain. A compromised Venice GPU operator could log prompts. Mitigation: design prompts so that even a full log of Venice API calls reveals nothing meaningful about the negotiation. The enclave is the brain; Venice is just the language muscle.

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
- "Privacy" marketing that aligns with Mnemo's narrative (even if the real privacy comes from Phala)

**What Venice does NOT give us:**
- Documented E2EE protocol (had to reverse-engineer from minified JS)
- Client-nonce attestation freshness (502 bug)
- Fail-closed E2EE (silent degradation to plaintext on incomplete headers)
- Native tool calling in E2EE mode
- Any guarantee that standard (non-E2EE) inference prompts aren't logged
- Custom code execution
- Fine-tuned models

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
