# Prompt: KV Cache Economics for DAG-Based Conversation Rewinding

Give this to an agent with LLM inference infrastructure expertise (e.g., Claude, GPT-4, or a systems engineer). It's self-contained.

---

## Context

I'm building a 2-agent negotiation system called Mnemo. Two AI agents take turns in a conversation, but the conversation isn't linear — it's a DAG (directed acyclic graph) with "scopes" that can be opened and closed.

When a scope closes, the conversation rewinds: messages inside the scope are deleted, and the next LLM call sees only the surviving prefix plus any new content. Think of it like git branches that get deleted — the conversation snaps back to an earlier checkpoint.

### Concrete access patterns:

**Pattern 1 — Scope rewind (the novel one):**
- Turn 5: LLM sees tokens for [system_prompt | msg1 | msg2 | msg3 | scope_open | msg4 | msg5] (~4,000 tokens)
- Turn 6: Scope closes. LLM sees [system_prompt | msg1 | msg2 | msg3 | new_msg] (~2,500 tokens)
- The prefix [system_prompt | msg1 | msg2 | msg3] (~2,000 tokens) is identical between turns 5 and 6

**Pattern 2 — Agent fork (parallel thinking):**
- Agent wants to explore two options before committing
- Request A: [system_prompt | msg1 | msg2 | msg3 | "Consider option A: ..."]
- Request B: [system_prompt | msg1 | msg2 | msg3 | "Consider option B: ..."]
- Both sent simultaneously. Common prefix is ~2,000 tokens.

**Pattern 3 — Normal turn (append-only):**
- Turn N: [system_prompt | msg1 | ... | msgN]
- Turn N+1: [system_prompt | msg1 | ... | msgN | msgN+1]
- Standard prefix caching. Every inference provider already optimizes this.

### Current infrastructure plan:
- Production: Phala's Redpill API (GPU-TEE, OpenAI-compatible, vLLM backend)
- Fallback: Self-hosted SGLang on Phala GPU-TEE (1x H100, $3.08/hr)
- Model: Something that fits on 1x H100 80GB (e.g., Qwen3 30B MoE, Llama 3.1 70B AWQ, or GPT-OSS 120B MoE)
- A typical negotiation: 20-40 turns, 2-5 scope open/close cycles, maybe 1-2 agent forks
- I don't care much about latency. I care about **total cost of compute** per negotiation.

---

## Questions

### 1. Storage economics
KV cache for a single token on a 70B model is roughly how many bytes? For a 4,000-token context, how large is the full KV cache? Is storing KV caches to disk (for later reload) a realistic strategy, or is the data too large / too ephemeral to be worth persisting? What about for MoE models where only some experts are active?

### 2. Memory throughput: reload cost
If I have a cached prefix on GPU HBM and a new request comes in that shares that prefix — what's actually saved? Is it:
- (a) Avoiding recomputing the attention for those tokens (compute-bound saving)?
- (b) Avoiding loading weights for those tokens (memory-bandwidth saving)?
- (c) Both?

How significant is this saving in practice? If my prefix is 2,000 tokens and the new suffix is 500 tokens, what fraction of total inference cost does the cache hit save me?

### 3. Cross-machine KV cache sharing
Does it make sense to transfer a KV cache from GPU A to GPU B to run forked inference in parallel? What's the bandwidth cost of moving, say, a 2,000-token KV cache over NVLink / PCIe / network? Is this ever done in practice, or is it cheaper to just recompute?

### 4. Batching economics vs. dedicated caching
Normal inference providers batch many users' requests together for GPU utilization. If I'm trying to pin KV caches for my specific conversation DAG, I'm consuming GPU memory that could serve other users' batches.

Is this fundamentally at odds with shared infrastructure economics? Is it only viable on a dedicated instance? What's the memory overhead of keeping, say, 5 conversation prefixes (each ~2,000 tokens) pinned in cache on an H100?

### 5. Are my "caching shenanigans" worth it?
Given a 30-turn negotiation with 3 scope rewinds and 1 fork:
- **Without prefix caching:** Every turn recomputes KV for the full context from scratch. ~30 turns × ~3,000 avg tokens = ~90,000 prompt tokens processed.
- **With prefix caching:** Prefix hits save recomputation. Estimate ~60% of prompt tokens are cache hits across the session. Net: ~36,000 fresh + 54,000 cached tokens.

What's the actual cost difference? Is the compute saving from prefix caching significant enough to matter at our scale (tens of negotiations per day, not thousands)?

Or is the real answer: "prefix caching is free when it works, don't overthink it, just structure your prompts so the stable prefix comes first and let vLLM/SGLang handle it"?

### 6. What are the actual bottlenecks?
For my specific use case (small-scale, 2 agents, 20-40 turns, occasional rewind/fork), what should I actually worry about?
- Token cost (input/output pricing)?
- GPU memory for KV cache?
- Inference latency per turn?
- Cache eviction under load?
- Something else entirely?

Rank the bottlenecks for a system doing ~10-50 negotiations per day with ~30 turns each.

### 7. Recommendations
Given all of the above, what's the pragmatic engineering choice?
- Just use a managed API (OpenRouter/Redpill) and accept no cache control?
- Self-host with SGLang and `--enable-prefix-caching` for the rewind pattern?
- Don't bother with caching and just eat the token costs?
- Something else?

Be concrete with numbers where possible. I want to understand the order-of-magnitude economics, not exact pricing.
