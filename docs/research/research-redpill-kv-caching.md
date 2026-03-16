# Redpill KV / Prefix Caching — Deep Research

> Research date: 2026-03-12
> Builds on: `docs/research-redpill-architecture.md`
> Confidence legend: **CONFIRMED** = documented/source-verified | **INFERRED** = logical deduction from partial docs | **UNKNOWN** = no source found

---

## Executive Summary

Prefix caching is critical for Mnemo's rewind/fork pattern. vLLM's automatic prefix caching (APC) is architecturally a perfect fit: when a scope closes and context rewinds from [1..10] to [1..5]+new, APC reuses KV blocks for the stable prefix. The problem: **we cannot confirm whether Redpill has APC enabled**. Phala's vLLM fork is pinned to v0.5.4 where APC is opt-in (not default). The shared Redpill service also load-balances across replicas, breaking cache locality. We describe an empirical test to detect APC, and recommend deploying a dedicated GPU-TEE instance with `--enable-prefix-caching` as the reliable path.

---

## 1. vLLM Automatic Prefix Caching — Mechanics

### How it works

vLLM divides the KV cache into fixed-size **blocks** (default: 16 tokens per block). Each block is identified by a hash of:

1. **Parent block hash** — the hash of the preceding block (creates a chain)
2. **Block tokens** — the exact token IDs in this block (tuple)
3. **Extra hashes** — LoRA adapter IDs, multimodal input hashes, or cache salts (multi-tenant)

This means the hash key for block N encodes the *entire prefix* up to and including block N. Two requests sharing the same first 80 tokens (5 blocks of 16) will hash identically for those 5 blocks and share physical GPU memory.

### Block size implications for Mnemo

- **Block size = 16 tokens** (default, configurable).
- Only **full blocks** are cached. If your prefix is 83 tokens, 5 full blocks (80 tokens) are cached; the remaining 3 tokens must be recomputed.
- **Implication**: Structuring your system prompt to align at 16-token boundaries offers marginal benefit, but in practice the last partial block is a negligible cost.

### Exact token match requirement

- **CONFIRMED**: Cache hits require **byte-for-byte identical token sequences**. The hash includes every token ID in the prefix.
- A single token difference (even whitespace) at any position invalidates the cache from that point onward.
- **Implication for Mnemo**: When reconstructing context for a rewound scope, the message serialization (chat template, role tags, etc.) must produce *identical tokens* for the stable prefix. This means:
  - Same model (same tokenizer)
  - Same chat template
  - Same message content (byte-identical)
  - Same message ordering
  - Same system prompt (place it first, never modify it)

### Eviction policy

- **LRU (Least Recently Used)** — when GPU memory is full and a block has reference count 0, the oldest-accessed block is evicted first.
- **No TTL** — blocks live in cache until memory pressure forces eviction. There is no time-based expiration in vLLM.
- **Tie-breaking**: Among blocks with the same last-access time, blocks at the end of the *longest* prefix are evicted first (i.e., suffix blocks before prefix blocks). This is favorable for Mnemo: your stable prefix [1..5] is more likely to survive than the discarded suffix [6..10].
- **No pinning API** — you cannot tell vLLM to keep a specific prefix. The only way to keep it warm is to keep issuing requests that use it.
- **Newer RFC (2025)**: A frequency-and-cost-aware eviction policy has been proposed (GitHub issue #23641) but is not yet in mainline vLLM.

### Reference counting and concurrent requests

- **CONFIRMED**: Each KV block has a `ref_cnt` tracking how many active requests use it.
- When two concurrent requests share a prefix, they share the same physical blocks. `ref_cnt` increments for each.
- Blocks with `ref_cnt > 0` are never evicted (they are in active use).
- **Implication for fork pattern**: If Agent A forks its thinking into two parallel requests sharing prefix [1..5], both requests will share KV blocks for that prefix on the *same vLLM instance*. This is the ideal case — zero redundant computation.

### Cross-request persistence

- **CONFIRMED**: Cache survives across independent API calls. If request 1 computes [1..10] and completes, then request 2 sends [1..5]+new, request 2 will hit the cache for [1..5] — as long as those blocks haven't been evicted by memory pressure between the two calls.
- This is not session-based; it's purely based on token sequence hash matching against whatever is in GPU memory.

### Version history

| Version | APC Status |
|---------|-----------|
| v0.4.0  | Added as experimental, opt-in via `--enable-prefix-caching` |
| v0.5.4  | Still opt-in, still marked experimental |
| v0.8.x  | Default enabled (V0 engine) |
| v1.0 (V1 engine) | Default enabled, use `--no-enable-prefix-caching` to disable |

**Phala's fork is pinned to `phala-v0.5.4`** — APC is opt-in and likely off unless explicitly configured.

---

## 2. Is Prefix Caching Enabled on Redpill?

### What we know

- **Phala's vLLM fork**: Branch `phala-v0.5.4` on GitHub (github.com/Phala-Network/vllm). Based on upstream v0.5.4 where APC is opt-in.
- **Redpill docs**: No mention of prefix caching, APC, or `--enable-prefix-caching` in any documentation page.
- **Phala FAQs**: No mention of caching configuration.
- **Architecture**: vllm-proxy sits in front of vllm container; it forwards requests and attaches attestation signatures. The vllm container's launch arguments are not publicly documented.
- **vLLM launch**: Phala's dstack documentation says the default entrypoint is `vllm serve --omni`. Custom arguments can be appended, but we don't know what Phala's managed Redpill instances use.

### Assessment

**UNKNOWN, leaning negative.** Given that:
1. The fork is v0.5.4 (APC off by default)
2. APC was marked "experimental" at that version
3. APC in v0.5.4 had known bugs (GitHub issues #3846, #3918, #6833)
4. No documentation mentions it

...it is more likely than not that APC is **disabled** on Redpill's managed instances. However, Phala *could* have added `--enable-prefix-caching` to their launch args without documenting it.

### The only way to know: empirical test

See Section 3 below.

---

## 3. Empirical Test: Detecting Prefix Caching on Redpill

### Test design

The principle: if APC is on, sending the same long prompt twice should produce a dramatically lower TTFT on the second call (the prefill phase is skipped for cached blocks).

**Expected results**:
- APC OFF: TTFT1 ~ TTFT2 (both compute full prefill)
- APC ON: TTFT2 << TTFT1 (e.g., 0.6s vs 4.3s for ~10K tokens, per vLLM benchmarks)

**Confounders**:
- Load balancing across replicas: second request might hit a different instance (no cache)
- Other users' requests evicting cache between calls
- Network jitter masking the difference

**Mitigation**: Run the test multiple times (10+) and look at the distribution, not a single pair.

### Test script

```python
#!/usr/bin/env python3
"""
Empirical test: Is prefix caching enabled on Redpill?

Sends a long prompt, then sends it again with a small suffix.
Compares Time-To-First-Token (TTFT) between the two calls.

If APC is enabled: second TTFT should be significantly lower.
If APC is disabled: TTFTs should be roughly equal.

Usage:
    pip install openai
    export REDPILL_API_KEY=your_key_here
    python test_prefix_caching.py
"""

import os
import time
import statistics
from openai import OpenAI

# --- Config ---
API_KEY = os.environ.get("REDPILL_API_KEY")
BASE_URL = "https://api.redpill.ai/v1"
MODEL = "phala/deepseek-v3-0324"  # largest Phala-hosted model, most obvious TTFT delta
NUM_TRIALS = 5  # number of cold/warm pairs

# Generate a long, deterministic prefix (~3000 tokens).
# We use a repetitive but unique structure so the tokenizer produces many tokens.
LONG_PREFIX = """You are a senior negotiation analyst. Below is the complete transcript
of a multi-party negotiation between Agent Alpha and Agent Beta regarding the acquisition
of DataCorp by TechGiant Inc. Your task is to analyze the negotiation dynamics.

""" + "\n".join([
    f"[Turn {i}] Agent {'Alpha' if i % 2 == 0 else 'Beta'}: "
    f"Regarding clause {i} of the agreement, I propose that the valuation "
    f"multiplier be set to {2.5 + i * 0.1:.1f}x EBITDA, with a contingency "
    f"of ${100 + i * 50}M held in escrow for {6 + i} months. The earn-out "
    f"threshold should be tied to revenue growth of {5 + i}% year-over-year, "
    f"measured quarterly. Additionally, the IP transfer clause in section "
    f"{'A' if i % 3 == 0 else 'B' if i % 3 == 1 else 'C'}.{i} should "
    f"reference the amended patent portfolio dated 2025-{(i % 12) + 1:02d}-15."
    for i in range(1, 61)  # 60 turns -> ~3000+ tokens
])

SUFFIX_A = "\n\nQuestion: What is Agent Alpha's opening position on the valuation multiplier?"
SUFFIX_B = "\n\nQuestion: What is Agent Beta's final counter-offer on the escrow amount?"


def measure_ttft(client, messages, max_tokens=50):
    """Send a streaming request and measure time to first token."""
    start = time.perf_counter()
    first_token_time = None

    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=max_tokens,
        stream=True,
        temperature=0.0,  # deterministic
    )

    full_response = ""
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            if first_token_time is None:
                first_token_time = time.perf_counter()
            full_response += chunk.choices[0].delta.content

    end = time.perf_counter()
    ttft = (first_token_time - start) if first_token_time else (end - start)
    return ttft, full_response


def main():
    if not API_KEY:
        print("ERROR: Set REDPILL_API_KEY environment variable")
        return

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    print(f"Model: {MODEL}")
    print(f"Prefix length: ~{len(LONG_PREFIX.split())} words")
    print(f"Trials: {NUM_TRIALS}")
    print("=" * 60)

    # --- Test 1: Same prefix, same suffix (pure cache test) ---
    print("\n## Test 1: Identical prompt sent twice")
    print("If APC is on, second TTFT should be much lower.\n")

    ttft_cold_list = []
    ttft_warm_list = []

    messages = [{"role": "user", "content": LONG_PREFIX + SUFFIX_A}]

    for trial in range(NUM_TRIALS):
        # Cold call (or at least, first call in pair)
        ttft_cold, _ = measure_ttft(client, messages)
        ttft_cold_list.append(ttft_cold)

        # Warm call (same prompt, should hit cache if APC is on)
        ttft_warm, _ = measure_ttft(client, messages)
        ttft_warm_list.append(ttft_warm)

        ratio = ttft_cold / ttft_warm if ttft_warm > 0 else float('inf')
        print(f"  Trial {trial+1}: cold={ttft_cold:.3f}s  warm={ttft_warm:.3f}s  ratio={ratio:.2f}x")

        # Brief pause to avoid rate limits, but not so long cache gets evicted
        time.sleep(1)

    print(f"\n  Cold TTFT: mean={statistics.mean(ttft_cold_list):.3f}s "
          f"median={statistics.median(ttft_cold_list):.3f}s")
    print(f"  Warm TTFT: mean={statistics.mean(ttft_warm_list):.3f}s "
          f"median={statistics.median(ttft_warm_list):.3f}s")

    speedup = statistics.mean(ttft_cold_list) / statistics.mean(ttft_warm_list)
    print(f"  Average speedup: {speedup:.2f}x")

    # --- Test 2: Same prefix, different suffix (prefix reuse test) ---
    print("\n## Test 2: Same prefix, different suffix")
    print("Tests if prefix KV blocks are reused across different completions.\n")

    ttft_first_list = []
    ttft_divergent_list = []

    messages_a = [{"role": "user", "content": LONG_PREFIX + SUFFIX_A}]
    messages_b = [{"role": "user", "content": LONG_PREFIX + SUFFIX_B}]

    for trial in range(NUM_TRIALS):
        # First call with suffix A
        ttft_a, _ = measure_ttft(client, messages_a)
        ttft_first_list.append(ttft_a)

        # Second call with suffix B (shares prefix, different suffix)
        ttft_b, _ = measure_ttft(client, messages_b)
        ttft_divergent_list.append(ttft_b)

        ratio = ttft_a / ttft_b if ttft_b > 0 else float('inf')
        print(f"  Trial {trial+1}: first(A)={ttft_a:.3f}s  divergent(B)={ttft_b:.3f}s  ratio={ratio:.2f}x")
        time.sleep(1)

    print(f"\n  First TTFT:     mean={statistics.mean(ttft_first_list):.3f}s")
    print(f"  Divergent TTFT: mean={statistics.mean(ttft_divergent_list):.3f}s")

    speedup2 = statistics.mean(ttft_first_list) / statistics.mean(ttft_divergent_list)
    print(f"  Average speedup: {speedup2:.2f}x")

    # --- Test 3: Parallel fork (concurrent requests sharing prefix) ---
    print("\n## Test 3: Concurrent fork requests")
    print("Sends two requests with same prefix simultaneously.\n")

    import concurrent.futures

    for trial in range(3):
        # Prime the cache
        measure_ttft(client, messages_a, max_tokens=10)
        time.sleep(0.5)

        # Send both forks concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(measure_ttft, client, messages_a, 30)
            future_b = executor.submit(measure_ttft, client, messages_b, 30)

            ttft_a, _ = future_a.result()
            ttft_b, _ = future_b.result()

        print(f"  Trial {trial+1}: fork_A={ttft_a:.3f}s  fork_B={ttft_b:.3f}s")

    # --- Interpretation ---
    print("\n" + "=" * 60)
    print("## Interpretation")
    print()
    if speedup > 2.0:
        print("STRONG EVIDENCE: Prefix caching IS enabled.")
        print(f"  Warm calls are {speedup:.1f}x faster than cold calls.")
        print("  Mnemo's rewind pattern will benefit from KV reuse.")
    elif speedup > 1.3:
        print("WEAK EVIDENCE: Possible prefix caching, but confounded by")
        print("  load balancing or variable server load.")
        print("  Consider running more trials or testing at low-traffic times.")
    else:
        print("NO EVIDENCE: Prefix caching appears DISABLED or")
        print("  load balancing prevents cache hits.")
        print("  Recommend: deploy dedicated GPU-TEE with --enable-prefix-caching.")


if __name__ == "__main__":
    main()
```

### Additional diagnostic: check for `usage.prompt_tokens_details`

vLLM v0.8+ with `--enable-prompt-tokens-details` returns a `cached_tokens` field in the response. Older versions (v0.5.4) do not support this. We can probe for it:

```python
#!/usr/bin/env python3
"""
Probe whether Redpill returns cached_tokens in usage details.
This would indicate a newer vLLM version with APC awareness.
"""
import os
import json
import requests

API_KEY = os.environ.get("REDPILL_API_KEY")
BASE_URL = "https://api.redpill.ai/v1"

# Non-streaming request to get full usage object
resp = requests.post(
    f"{BASE_URL}/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "model": "phala/deepseek-v3-0324",
        "messages": [{"role": "user", "content": "Say hello."}],
        "max_tokens": 5,
        "stream": False,
    }
)

data = resp.json()
usage = data.get("usage", {})
print("Full usage object:")
print(json.dumps(usage, indent=2))

# Check for cached_tokens
ptd = usage.get("prompt_tokens_details", {})
if ptd:
    print(f"\nprompt_tokens_details found: {ptd}")
    cached = ptd.get("cached_tokens", 0)
    print(f"cached_tokens: {cached}")
else:
    print("\nNo prompt_tokens_details field — likely vLLM v0.5.x (no APC reporting)")
```

---

## 4. Can We Influence Caching via the API?

### Parameters available in vLLM's OpenAI-compatible API

| Parameter | Available in v0.5.4? | Available in v0.8+? | Purpose |
|-----------|---------------------|---------------------|---------|
| `cache_salt` via `extra_body` | No | Yes (v0.9+, PR #17045) | Isolates cache per tenant. Passed as `extra_body={"cache_salt": "..."}` |
| `seed` | Yes (server-level) | Yes (server + per-request) | Random seed; does NOT affect routing |
| `--prefix-caching-hash-algo` | No | Yes (server flag) | Hash algorithm: `sha256` (default), `sha256_cbor`, `xxhash` |
| Sticky routing headers | No | No (vLLM doesn't support this natively) | Would need external load balancer config |
| `--enable-prefix-caching` | Yes (server flag) | Default on | Enables APC |
| `--enable-prompt-tokens-details` | No | Yes | Returns `cached_tokens` in usage |

### What we can try on Redpill

1. **`extra_body={"cache_salt": salt}`** — Pass via OpenAI SDK. If Redpill runs v0.5.4, this will be silently ignored (unknown field). If they've upgraded, it would isolate our cache from other users (beneficial, but reduces cache hit probability if we use different salts across calls).

2. **`seed` parameter** — This controls sampling randomness, NOT routing. It will not help with cache affinity.

3. **Custom headers** — Redpill's API is behind a gateway (vllm-proxy). We have no evidence that it supports sticky session headers (like `X-Session-ID` or cookies). Standard load balancers (NGINX, Traefik) can do sticky sessions, but Phala hasn't documented this.

### Bottom line

**We have no API-level control over prefix caching or routing on Redpill.** The caching behavior is entirely determined by:
- Server-side flag (`--enable-prefix-caching`)
- Which replica our request lands on (load balancer decision)
- Memory pressure on that replica (other users' requests)

---

## 5. OpenAI's Prefix Caching vs. vLLM's

### OpenAI proprietary prefix caching

- Automatically enabled on OpenAI's API for prompts > 1024 tokens
- Caches in 128-token increments after the first 1024 tokens
- Returns `usage.prompt_tokens_details.cached_tokens` in every response
- Cache TTL: 5-10 minutes of inactivity, max 1 hour (24 hours with enterprise retention)
- 50% discount on cached input tokens
- **This is an OpenAI infrastructure feature, NOT part of the API spec**

### Does it work on Redpill?

**No.** OpenAI's prefix caching is implemented in their serving infrastructure, not in the API protocol. When Redpill says "OpenAI-compatible," it means the *request/response format* is compatible (messages array, streaming SSE, usage fields). The caching happens in whatever inference engine backs the endpoint — in Redpill's case, vLLM.

If vLLM's APC is enabled on Redpill, you get vLLM's caching behavior (hash-based, LRU, no TTL, no pricing discount). If it's disabled, you get no caching. OpenAI's `cached_tokens` reporting field may or may not appear depending on vLLM version.

---

## 6. Multi-Replica Routing Problem

### The problem

Redpill auto-scales across 2-10 replicas (documented in previous research). If request 1 (computing [1..10]) hits replica A, and request 2 (rewound to [1..5]+new) hits replica B, there is zero cache benefit — replica B never computed [1..5].

### vLLM Router (upstream, 2025)

vLLM released a Rust-based load balancer in December 2025 that supports:
- **Consistent hashing** — routes requests with the same routing key to the same replica
- **Prefix-aware routing** — queries each replica's KV cache index for cache affinity scores
- **CHWBL (Consistent Hashing with Bounded Loads)** — prevents overloading while maximizing cache hits

### Ray Serve prefix-aware routing

Ray 2.54 includes a `PrefixCacheAffinityRouter` that routes requests with similar prefixes to the same replica.

### Does Redpill use any of these?

**UNKNOWN, likely no.** Redpill's architecture predates the vLLM Router (Dec 2025) and is based on the older v0.5.4 fork. Their vllm-proxy is a simple forwarder that adds attestation signatures; there's no evidence of prefix-aware routing.

### Implication for Mnemo

On shared Redpill, we have approximately a `1/N` chance of hitting the same replica (where N = number of replicas). For rapid sequential requests (rewind within seconds), we might get lucky. For parallel forks, even less likely.

---

## 7. Phala Community / GitHub Findings

### GitHub: Phala-Network/vllm

- Repository exists at github.com/Phala-Network/vllm
- Default branch viewed: `phala-v0.5.4`
- Shows 2,214 commits, created Oct 2024
- **No issues or discussions** about prefix caching on this fork
- README lists "(Experimental) Prefix caching support" as a feature but provides no configuration guidance

### GitHub: Dstack-TEE/dstack

- Open framework for confidential AI (github.com/Dstack-TEE/dstack)
- **No issues** mentioning prefix caching or KV cache configuration
- Focus is on attestation, deployment, and TEE orchestration — not inference optimization

### Phala Discord

- **Exists** — referenced in docs for support ("reach out to the Phala Team on Discord")
- **No public search results** mentioning prefix caching discussions
- **Action item**: Ask directly in Phala Discord whether `--enable-prefix-caching` is set on managed Redpill instances. This is a one-line flag change on their side.

### Phala docs

- docs.phala.com/llm-in-gpu-tee/inference-api — lists models and pricing, no engine configuration
- docs.phala.com/phala-cloud/confidential-ai/faqs — clarifies dstack/vllm-proxy relationship, no caching details
- docs.phala.com/phala-cloud/confidential-ai/confidential-gpu/deploy-and-verify — deployment guide, no engine args

---

## 8. Practical Recommendations

### Strategy matrix

| Scenario | Action | Effort | Confidence |
|----------|--------|--------|------------|
| **A. APC is already on** | Structure prompts with stable prefix first; run empirical test to confirm | Low | Test will tell us |
| **B. APC is off, Phala enables it** | Ask in Discord/email; it's a single flag (`--enable-prefix-caching`) | Low (for us) | Depends on Phala responsiveness |
| **C. APC is off, Phala won't enable it** | Deploy dedicated GPU-TEE instance on Phala Cloud with custom vLLM args | Medium | High — we control the config |
| **D. APC is on but routing breaks cache** | Deploy dedicated instance (single replica = no routing problem) | Medium | High |

### Recommended path (for hackathon)

**Step 1 (today):** Run the empirical TTFT test (Section 3). This takes 5 minutes and gives us a definitive answer for the shared Redpill service.

**Step 2 (if test shows no caching):** Ask in Phala Discord:
> "Is `--enable-prefix-caching` enabled on the managed Redpill inference nodes? We're building a conversation system with rewind/fork patterns and prefix caching would significantly reduce latency for our use case."

**Step 3 (if no response or can't enable):** Deploy a dedicated GPU-TEE instance on Phala Cloud.

#### Deploying a dedicated instance

Phala Cloud supports deploying vLLM with custom Docker Compose configurations. Based on the docs:

```yaml
# serve.dstack.yml or docker-compose.yml on Phala Cloud
services:
  vllm:
    image: phala/vllm:0.5.4  # or whatever their image tag is
    command: >
      vllm serve phala/deepseek-v3-0324
      --enable-prefix-caching
      --gpu-memory-utilization 0.95
      --max-model-len 32768
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]
```

Key flags:
- `--enable-prefix-caching` — the critical one
- `--gpu-memory-utilization 0.95` — leave more memory for KV cache (default is 0.9)
- Single replica — no routing problem, all requests hit the same instance

**Cost estimate**: Phala Cloud shows pricing per-hour for GPU instances. An H100 or A100 instance for a hackathon demo (a few hours) would be in the $5-20 range.

### Prompt structure for maximum cache benefit

Regardless of whether APC is on shared Redpill or a dedicated instance, structure every API call like this:

```
[SYSTEM PROMPT — identical across all calls]
[Message 1 — oldest, most stable]
[Message 2]
...
[Message N — most recent, most likely to change on rewind]
[NEW: Suffix / question / instruction after rewind]
```

The key principle: **everything that changes goes at the END**. The stable prefix (system prompt + surviving messages after rewind) must produce identical token sequences every time.

#### DAG reconstruction rules for cache-friendliness

1. **System prompt**: Always the same string. Never interpolate timestamps, turn counts, or other variable data into it.
2. **Message ordering**: Chronological within the DAG path. Never reorder surviving messages.
3. **Message formatting**: Use the same chat template / role tags every time. Do NOT add "context" metadata (like "[scope: X]") that might vary.
4. **After rewind**: Append the new message at the end. The token sequence for messages [1..5] must be byte-identical to what it was when [1..10] was sent.

### Fork pattern optimization

When Agent A forks (sends two parallel requests with shared prefix [1..5]):

```python
import concurrent.futures

prefix_messages = reconstruct_dag_path(scope_root)  # messages [1..5]

fork_a_messages = prefix_messages + [{"role": "user", "content": "Option A analysis..."}]
fork_b_messages = prefix_messages + [{"role": "user", "content": "Option B analysis..."}]

# Send concurrently — if they hit the same replica, prefix is shared
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    future_a = executor.submit(call_llm, fork_a_messages)
    future_b = executor.submit(call_llm, fork_b_messages)

    result_a = future_a.result()
    result_b = future_b.result()
```

On a dedicated instance (single replica), both forks hit the same vLLM instance. The prefix [1..5] is computed once and shared via reference counting. The two divergent suffixes compute independently. This is the optimal case.

---

## 9. Open Questions for Phala

Priority questions to ask in Discord/email:

1. **Is `--enable-prefix-caching` set on managed Redpill inference nodes?**
2. **What vLLM version is actually running in production?** (Fork shows v0.5.4, but production may have been updated.)
3. **How many replicas serve a given model, and is there any request affinity?** (Cookie-based sticky sessions, consistent hashing, etc.)
4. **Can we deploy a dedicated vLLM instance with custom engine args?** (Via Phala Cloud's custom configuration template.)
5. **What GPU type backs the Phala-hosted models?** (H100 CC mode confirmed for some, but does it vary?)

---

## Sources

- [vLLM Automatic Prefix Caching — Design Doc](https://docs.vllm.ai/en/stable/design/prefix_caching/)
- [vLLM APC v0.8.5 — V1 Design](https://docs.vllm.ai/en/v0.8.5/design/v1/prefix_caching.html)
- [vLLM APC v0.5.4 — Feature Page](https://docs.vllm.ai/en/v0.5.4/automatic_prefix_caching/apc.html)
- [vLLM APC v0.6.0 — Implementation Details](https://docs.vllm.ai/en/v0.6.0/automatic_prefix_caching/details.html)
- [vLLM APC v0.8.3 — Feature Page](https://docs.vllm.ai/en/v0.8.3/features/automatic_prefix_caching.html)
- [vLLM OpenAI-Compatible Server v0.8.3](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html)
- [vLLM Cache Salt RFC — Issue #16016](https://github.com/vllm-project/vllm/issues/16016)
- [vLLM Prefix Cache Lifecycle — Issue #12077](https://github.com/vllm-project/vllm/issues/12077)
- [vLLM Prefix-Cache-Aware Load Balancing — Issue #11477](https://github.com/vllm-project/vllm/issues/11477)
- [vLLM Frequency-Aware Eviction RFC — Issue #23641](https://github.com/vllm-project/vllm/issues/23641)
- [vLLM Router Blog Post (Dec 2025)](https://blog.vllm.ai/2025/12/13/vllm-router-release.html)
- [vLLM Engine Args v0.8.3](https://docs.vllm.ai/en/v0.8.3/serving/engine_args.html)
- [Ray Serve Prefix-Aware Routing](https://docs.ray.io/en/latest/serve/llm/user-guides/prefix-aware-routing.html)
- [KV-Cache Wins — llm-d Blog](https://llm-d.ai/blog/kvcache-wins-you-can-see)
- [Phala-Network/vllm Fork — GitHub](https://github.com/Phala-Network/vllm)
- [Dstack-TEE/dstack — GitHub](https://github.com/Dstack-TEE/dstack)
- [Phala GPU TEE Deploy & Verify](https://docs.phala.com/phala-cloud/confidential-ai/confidential-gpu/deploy-and-verify)
- [Phala Inference API — Models & Pricing](https://docs.phala.com/llm-in-gpu-tee/inference-api)
- [Phala GPU TEE Deep Dive](https://phala.com/posts/Phala-GPU-TEE-Deep-Dive)
- [OpenAI Prompt Caching Guide](https://platform.openai.com/docs/guides/prompt-caching)
- [OpenAI Prompt Caching Announcement](https://openai.com/index/api-prompt-caching/)
- [Redpill Docs — How To Use](https://docs.redpill.ai/get-started/how-to-use)
- [Redpill on Phala Cloud](https://cloud.phala.com/cases/redpill)
