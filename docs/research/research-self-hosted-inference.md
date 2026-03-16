# Self-Hosted LLM Inference with KV Prefix Cache Control

> Research date: 2026-03-12
> Context: Mnemo hackathon project (The Synthesis, March 13-22 2026)
> Purpose: Evaluate self-hosted inference options for DAG-based context rewinding with prefix cache control

---

## Table of Contents

1. [Access Patterns and Requirements](#1-access-patterns-and-requirements)
2. [vLLM Prefix Caching Deep Dive](#2-vllm-prefix-caching-deep-dive)
3. [SGLang RadixAttention Deep Dive](#3-sglang-radixattention-deep-dive)
4. [vLLM vs SGLang for Mnemo](#4-vllm-vs-sglang-for-mnemo)
5. [Other Inference Engines](#5-other-inference-engines)
6. [Self-Hosted vLLM on Phala GPU-TEE](#6-self-hosted-vllm-on-phala-gpu-tee)
7. [SGLang on Phala GPU-TEE](#7-sglang-on-phala-gpu-tee)
8. [Model Selection for Single H100 80GB](#8-model-selection-for-single-h100-80gb)
9. [Two-CVM Architecture](#9-two-cvm-architecture)
10. [Architecture Options and Recommendation](#10-architecture-options-and-recommendation)

---

## 1. Access Patterns and Requirements

Mnemo has three distinct KV cache access patterns:

### Pattern 1 -- Scope Rewind

```
Turn N:   [system | msg1 | msg2 | msg3 | scope_open | msg4 | msg5]
Turn N+1: [system | msg1 | msg2 | msg3 | new_msg]
```

A scope closes, and messages 4-5 are deleted. The next request must get a cache hit on the prefix `[system | msg1 | msg2 | msg3]`. This is the *defining* pattern for Mnemo -- it cannot work efficiently without prefix caching.

**Requirements**: The inference engine must retain KV cache blocks for the shared prefix even after the original request completes, and match them when a new request arrives with that prefix plus different suffix tokens.

### Pattern 2 -- Agent Fork (Parallel Thinking)

```
Request A: [system | msg1 | msg2 | msg3 | "option A: ..."]
Request B: [system | msg1 | msg2 | msg3 | "option B: ..."]
```

Two concurrent requests share a prefix. The engine should compute the prefix KV once and reuse it for both.

**Requirements**: Concurrent requests with identical prefixes must share physical KV cache blocks (reference counting), not duplicate computation.

### Pattern 3 -- Normal Turn Progression

```
Turn N:   [system | msg1 | msg2 | msg3]
Turn N+1: [system | msg1 | msg2 | msg3 | msg4]
```

Standard append-only conversation. Every inference engine handles this well.

---

## 2. vLLM Prefix Caching Deep Dive

### How It Works

vLLM's Automatic Prefix Caching (APC) uses hash-based block matching:

1. **Block granularity**: KV cache is divided into fixed-size blocks of 16 tokens (default). Only block sizes up to 32 are supported on CUDA. The 16-token default is intentionally chosen -- larger blocks reduce prefix hit rates unless partial-matching is added.

2. **Hash computation**: Each block is hashed by combining:
   - The parent block's hash value (chaining)
   - The exact token IDs in the current block
   - Extra hashes (LoRA IDs, multimodal input hashes)

   This means the hash encodes the *entire prefix* up to that block, not just the local tokens.

3. **Hash algorithm options** (`--prefix-caching-hash-algo`):
   - `sha256` (default as of v0.11+) -- cryptographically secure, ~6ms overhead for 50K-token contexts
   - `sha256_cbor` -- reproducible cross-language hashing via CBOR serialization
   - `xxhash` -- faster non-cryptographic 128-bit hash (requires xxhash package), suitable for single-tenant
   - `builtin` -- Python's built-in hash (fastest, but collision-prone, NOT safe for multi-tenant)

4. **Global hash table**: All physical blocks are indexed by hash. When a new request arrives, its token blocks are hashed and looked up. Cache hits reuse existing physical blocks.

### Eviction Policy

- **LRU (Least Recently Used)**: When GPU memory is full, the least-recently-used block with refcount 0 is evicted.
- **No TTL**: There is no time-based expiry. Blocks live until evicted by memory pressure.
- **No pinning API**: You cannot pin specific prefixes. The only way to keep a prefix in cache is to keep issuing requests that reference it (preventing LRU eviction).
- **Eviction order**: Freed blocks are added to the LRU queue tail in reverse order -- later blocks (which hash more tokens) are evicted first. This is favorable for Mnemo: the system prompt prefix is evicted last.

### Concurrent Request Handling (Pattern 2)

**This works well.** vLLM's PagedAttention uses reference counting:
- Two concurrent requests sharing a prefix will share the same physical KV cache blocks.
- The common blocks have refcount = 2; divergent suffix blocks are allocated independently.
- This is the core design of PagedAttention -- sharing system prompts across many requests was the original motivation.

### Pre-warming the Cache

There is no explicit "pre-warm" API. However, you can prime the cache by sending a dummy request with the system prompt + common prefix and a minimal generation (`max_tokens=1`). This forces vLLM to compute and cache those blocks. Subsequent real requests will hit the cache.

**For Mnemo**: At negotiation start, send a dummy request with the full system prompt to prime the cache. Cost is one forward pass of the system prompt -- trivial.

### Cache Isolation (`cache_salt`)

vLLM supports per-request cache isolation via the `cache_salt` parameter:

```python
response = client.chat.completions.create(
    model="...",
    messages=[...],
    extra_body={"cache_salt": "room-123"}
)
```

The salt is mixed into the first block's hash, creating separate cache namespaces. Requests with different salts will never share cache blocks, even with identical token prefixes.

**For Mnemo**: If running multiple negotiation rooms on the same vLLM instance, use `cache_salt` per room to prevent cross-room cache interference. For a single-room demo, not needed.

An advanced `cache_salt_map` parameter allows assigning different salts to different message ranges within a single request.

### Monitoring and Metrics

vLLM exposes Prometheus metrics at `GET /metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `vllm:prefix_cache_queries` | Counter | Total prefix cache lookups |
| `vllm:prefix_cache_hits` | Counter | Total cache hits |
| `vllm:gpu_prefix_cache_hit_rate` | Gauge | GPU cache hit rate |
| `vllm:cpu_prefix_cache_hit_rate` | Gauge | CPU cache hit rate |
| `vllm:kv_cache_usage_perc` | Gauge | Total KV cache utilization |

There is no `/v1/cache/stats` REST endpoint -- monitoring is Prometheus-only. For the hackathon, scraping `/metrics` and computing `hits/queries` gives cache hit rate.

**Limitation**: `kv_cache_usage_perc` does not distinguish between active blocks (in-use by running requests) and cached blocks (available for reuse). A feature request (issue #33434) exists for this.

### Memory Overhead

The metadata overhead for prefix caching is negligible: **one 8-byte hash per block**, yielding a data-to-metadata ratio of ~1,000,000:1. Managing a 365 GB cache pool requires ~339 KB of index memory.

### Performance Impact

- **With shared prefixes (our case)**: Large speedups. Cached blocks skip prefill computation entirely. Time-to-first-token (TTFT) can improve 2-5x for long shared prefixes.
- **Without shared prefixes**: In v0.x, there was ~36.7% throughput reduction due to hash computation overhead. In v1 (current), prefix caching has **zero overhead** -- it is enabled by default and "requires no intervention from the user." The v1 engine uses pre-allocated block pools and embedded linked-list pointers to eliminate runtime allocation costs.

### vLLM Version Note

- **v0.5.4** (Phala's fork): Prefix caching is opt-in (`--enable-prefix-caching`), has measurable overhead.
- **v0.8+**: Prefix caching default-on, overhead reduced.
- **v1 / v0.11+**: Zero-overhead prefix caching, SHA256 default hash, `cache_salt` support.

**If self-hosting: use upstream vLLM v0.11+ or latest, NOT Phala's v0.5.4 fork.**

---

## 3. SGLang RadixAttention Deep Dive

### How It Works

SGLang (from the Berkeley LMSYS team) takes a fundamentally different approach: a radix tree (trie) over token sequences.

1. **Token-level granularity**: Unlike vLLM's fixed 16-token blocks, SGLang's radix tree operates at token-level granularity. Each node in the tree corresponds to a token, and the tree captures the full prefix structure of all cached sequences.

2. **Radix tree structure**: The tree is maintained as an LRU cache of KV states for all requests. When a new request arrives, the engine traverses the tree to find the longest matching prefix, then computes only the new suffix.

3. **Automatic detection**: No configuration needed. RadixAttention is always on (disable with `--disable-radix-cache`). Prefix sharing is automatic and fine-grained.

### Why Radix Tree > Block Hashing for Mnemo

The key advantage for our use case:

- **vLLM (block-level)**: With 16-token blocks, a rewind that doesn't align to a 16-token boundary wastes partial blocks. If your scope boundary falls mid-block, the entire block is a cache miss.
- **SGLang (token-level)**: The radix tree matches at exact token boundaries. A rewind to any token position gets a precise cache hit with zero waste.

For Pattern 1 (scope rewind), this means SGLang will always match the exact prefix, while vLLM might miss the last partial block.

### Eviction Policies

SGLang supports two eviction policies via `--radix-eviction-policy`:
- `lru` (default) -- Least Recently Used
- `lfu` -- Least Frequently Used

**LFU is interesting for Mnemo**: The system prompt prefix is accessed on every request and would accumulate a high frequency count, making it resistant to eviction even under memory pressure. This is effectively "soft pinning."

### Cache Control APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/flush_cache` | POST | Clears the entire radix cache. Will not execute if requests are running. |
| `/get_server_info` | GET | Returns server config including memory pool size and token limits |
| `/get_model_info` | GET | Model metadata |

**No per-request cache control** -- cache management is server-level only. No equivalent of vLLM's `cache_salt` for multi-tenant isolation.

### HiCache -- Hierarchical KV Caching

SGLang recently (September 2025) introduced HiCache, a hierarchical caching system:

```
L1: GPU memory (fastest, smallest)
L2: Host/CPU memory (medium)
L3: Distributed storage -- Mooncake, 3FS, NIXL, AIBrix (slowest, largest)
```

The HiRadixTree tracks where each KV cache span resides across tiers. When a cache hit is detected at a lower tier, data is prefetched upward. Cache loading for layer N+1 happens concurrently with computation of layer N, hiding transfer latency.

**Relevance for Mnemo**: HiCache with CPU memory as L2 means evicted prefixes can be recovered from CPU RAM instead of recomputed. For our scope-rewind pattern, this provides a safety net -- even if GPU memory pressure evicts our prefix blocks, they may still be in CPU memory.

Enable with:
```
--enable-hierarchical-cache --hicache-ratio 2.0
```

This allocates CPU memory = 2x GPU memory for KV caching.

**Performance**: Benchmarks show 84% TTFT reduction on cache hits, 56% average TTFT reduction in production, and 2x throughput improvement.

### SGLang Performance Numbers

From Runpod benchmarks (DeepSeek-R1-Distill-Llama-70B on 2x H100):

| Scenario | SGLang (tok/s) | vLLM (tok/s) |
|----------|----------------|--------------|
| Fresh context | 29.5 | 28.6 |
| Cached prefix (1st hit) | 35.0 | 32.8 |
| Cached prefix (2nd hit) | 34.9 | 33.3 |
| High concurrency (sustained) | 30-31 (stable) | 22 -> 16 (degrades) |

SGLang achieves ~10-20% throughput improvement with cached prefixes and maintains stability under concurrency.

---

## 4. vLLM vs SGLang for Mnemo

### Head-to-Head Comparison

| Feature | vLLM (v1 / v0.11+) | SGLang |
|---------|---------------------|--------|
| **Cache granularity** | 16-token blocks | Token-level (radix tree) |
| **Prefix match precision** | Block-aligned only | Exact token boundary |
| **Default caching** | On (zero overhead in v1) | On (always) |
| **Eviction policy** | LRU only | LRU or LFU |
| **Multi-tenant isolation** | `cache_salt` parameter | None |
| **Cache inspection** | Prometheus metrics | `/get_server_info` |
| **Cache flush** | Not exposed | `/flush_cache` endpoint |
| **Hierarchical cache** | Via LMCache plugin | Native HiCache (GPU/CPU/disk) |
| **Concurrent prefix sharing** | Yes (refcount) | Yes (radix tree nodes) |
| **Hash algorithm options** | sha256, xxhash, builtin | N/A (tree structure) |
| **OpenAI-compatible API** | Yes (`/v1/chat/completions`) | Yes (`/v1/chat/completions`) |
| **Docker image** | `vllm/vllm-openai:latest` | `lmsysorg/sglang:latest-runtime` |
| **Phala template** | Yes (built-in) | No (custom Docker Compose) |
| **Community/ecosystem** | Larger, more enterprise adoption | Smaller, Berkeley-backed |

### Verdict for Mnemo

**SGLang is the better fit for our specific access patterns.** Reasons:

1. **Token-level matching** eliminates the block-alignment problem. Scope rewinds will always hit cache precisely.
2. **LFU eviction** can soft-pin our system prompt without any workaround.
3. **HiCache** provides CPU-memory fallback for evicted prefixes -- important for the rewind pattern where we might evict blocks during a scope and want them back later.
4. **Stable concurrency** -- SGLang maintains throughput under concurrent fork requests (Pattern 2).
5. **Simpler mental model** -- the radix tree is a direct analog of our conversation DAG.

**vLLM advantages we'd lose**:
- Built-in Phala template (we'd need custom Docker Compose for SGLang -- trivial)
- `cache_salt` for multi-tenant isolation (not needed for single-room demo)
- Larger community / more docs

**Pragmatic choice**: SGLang for production/dedicated instance, vLLM if we want to stay closer to Phala's supported stack.

---

## 5. Other Inference Engines

### TensorRT-LLM (NVIDIA)

**Unique feature: Priority-based KV cache eviction with TTL.**

TensorRT-LLM is the only engine that gives explicit control over cache retention:

```python
# Pin system prompt blocks at highest priority for 1 hour
request.set_kv_cache_retention(
    token_range=(0, 500),  # system prompt tokens
    priority=100,          # max priority
    duration=3600          # seconds until deprioritized
)
```

This is exactly the "pin prefixes with TTL" feature we asked about. No other engine has it.

**Other features**:
- Default block size: 128 tokens (larger than vLLM's 16)
- Host memory offloading for evicted reusable blocks (`--kv_host_cache_bytes`)
- Cache state only becomes reusable after the originating request completes (limitation for concurrent sharing)
- Early reuse feature: allows sharing system prompts during computation (5x TTFT improvement)
- Priority eviction improves cache hit rate by ~20% in benchmarks

**Downsides for Mnemo**:
- More complex setup (engine build step with `trtllm-build`)
- Less OpenAI-API-compatible out of the box
- Larger Docker images
- **Cache reuse only after request completion** -- this means Pattern 2 (concurrent fork) won't share KV cache during prefill, only after one request finishes. This is a significant limitation for our fork pattern.
- No Phala template

**Verdict**: Interesting for the priority/TTL feature, but the "reuse only after completion" limitation kills Pattern 2. Not recommended.

### llama.cpp Server

llama.cpp server has basic KV cache reuse:

- `--cache-reuse N` flag: reuse KV cache when at least N% of the prompt matches a previous request's cached state
- `cache_prompt: true` in request body: enables per-request KV reuse
- `--slot-save-path`: enables saving slot KV cache to disk (manual save/restore)
- `id_slot` parameter: explicitly assign a request to a specific cache slot

**Slot-based architecture**: llama.cpp server uses a fixed number of "slots" (configurable via `--parallel N`). Each slot holds one conversation's KV cache. The default similarity threshold of 0.5 means 50% prefix overlap triggers reuse.

**Advantages**:
- Slot persistence to disk (save/restore KV cache across restarts)
- Explicit slot assignment
- Runs on CPU (no GPU required, useful for testing)
- Tiny Docker image

**Downsides**:
- No concurrent prefix sharing (one slot = one request at a time)
- Fixed slot count limits parallelism
- Performance much lower than vLLM/SGLang on GPU
- Recent bug reports (2025) with `--cache-reuse` not working correctly
- No Phala GPU-TEE template

**Verdict**: Good for local development/testing without GPU. Not suitable for production or the fork pattern.

### LMCache (External KV Cache Layer)

LMCache sits between the client and vLLM/SGLang, providing:
- Cross-instance KV cache sharing (multiple vLLM replicas share one cache)
- KV cache offloading to CPU/SSD/remote storage
- 3-10x TTFT improvement in multi-round QA

**Relevance**: If Redpill uses multiple vLLM replicas (they mention 2-10 with auto-scaling), LMCache could ensure our prefix cache survives load balancing across replicas. However, this requires server-side deployment -- not something we control on Redpill.

---

## 6. Self-Hosted vLLM on Phala GPU-TEE

### Deployment via Phala's vLLM Template

Phala offers a pre-configured vLLM template for GPU-TEE deployment:

1. Go to cloud.phala.com > GPU TEE > Start Building
2. Select 1x H100 ($3.08/hr on-demand)
3. Choose "vLLM" template
4. Specify HuggingFace model ID
5. Deploy

The template includes:
- NVIDIA Driver 570.133.20 + CUDA 12.8
- vLLM server on port 8000
- `vllm-proxy` for attestation (sits in front of vLLM, attaches TDX+GPU attestation to responses)

**Critical issue**: Phala's vLLM fork is at `phala-v0.5.4`. This is outdated:
- Prefix caching is opt-in (not default)
- No zero-overhead v1 engine
- No `cache_salt` support
- SHA256 hashing not default (collision risk)
- Higher overhead when prefix caching is enabled (~36% throughput reduction on cache misses)

### Custom Docker Compose (Recommended)

Instead of Phala's template, use Custom Docker Compose with upstream vLLM:

```yaml
version: "3.8"
services:
  vllm:
    image: vllm/vllm-openai:latest
    command: >
      --model meta-llama/Llama-3.1-70B-Instruct-AWQ
      --quantization awq
      --max-model-len 32768
      --gpu-memory-utilization 0.92
      --tensor-parallel-size 1
      --block-size 16
      --prefix-caching-hash-algo sha256
      --enable-prefix-caching
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ports:
      - "8000:8000"
    volumes:
      - model-cache:/root/.cache/huggingface
      - /var/run/dstack.sock:/var/run/dstack.sock
    shm_size: "16g"

volumes:
  model-cache:
```

### Key vLLM Flags for Mnemo

| Flag | Value | Rationale |
|------|-------|-----------|
| `--enable-prefix-caching` | (default in latest) | Required for all three patterns |
| `--prefix-caching-hash-algo` | `sha256` | Secure, collision-resistant (single-tenant so xxhash would also be fine) |
| `--block-size` | `16` (default) | Smaller blocks = better prefix hit granularity |
| `--max-model-len` | `32768` | Negotiation context unlikely to exceed 32K; saves VRAM for KV cache |
| `--gpu-memory-utilization` | `0.90-0.92` | Leave ~6-8GB headroom for CUDA overhead |
| `--tensor-parallel-size` | `1` | Single H100 |
| `--quantization` | `awq` or `gptq` | For 70B models; not needed for smaller models |

### Cost

| Config | $/hr | $/day | /10 days |
|--------|------|-------|----------|
| 1x H100 on-demand | $3.08 | $73.92 | $739.20 |
| 1x H200 on-demand | $3.50 | $84.00 | $840.00 |
| 1x H100 reserved (1-month) | $2.38 | $57.12 | $571.20 |

**24-hour minimum billing on on-demand.** For the hackathon, we could deploy only when needed (e.g., demo days) to save cost.

---

## 7. SGLang on Phala GPU-TEE

### Docker Compose for Phala

There is no Phala template for SGLang, but it is just a Docker container. Custom Docker Compose:

```yaml
version: "3.8"
services:
  sglang:
    image: lmsysorg/sglang:latest-runtime
    command: >
      python3 -m sglang.launch_server
      --model-path meta-llama/Llama-3.1-70B-Instruct-AWQ
      --quantization awq
      --host 0.0.0.0
      --port 8000
      --mem-fraction-static 0.90
      --radix-eviction-policy lfu
      --enable-hierarchical-cache
      --hicache-ratio 2.0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ports:
      - "8000:8000"
    volumes:
      - model-cache:/root/.cache/huggingface
      - /var/run/dstack.sock:/var/run/dstack.sock
    ipc: host
    shm_size: "32g"

volumes:
  model-cache:
```

### Key SGLang Flags for Mnemo

| Flag | Value | Rationale |
|------|-------|-----------|
| `--radix-eviction-policy` | `lfu` | Soft-pins frequently-used system prompt |
| `--enable-hierarchical-cache` | (flag) | CPU memory as L2 cache for evicted prefixes |
| `--hicache-ratio` | `2.0` | CPU cache = 2x GPU cache size |
| `--mem-fraction-static` | `0.90` | Similar to vLLM's gpu-memory-utilization |
| `--page-size` | `1` (default) | Token-level granularity (the whole point) |

### Missing: Attestation Proxy

Phala's vLLM template includes `vllm-proxy` which attaches attestation quotes to responses. With SGLang, we'd need to either:

1. Run our own attestation wrapper (read from `/var/run/dstack.sock`, attach to responses)
2. Skip per-response attestation and verify at the CVM level (the GPU-TEE CVM itself is attested)
3. Fork Phala's vllm-proxy to work with SGLang (it is a simple HTTP proxy)

For the hackathon, option 2 is sufficient -- the entire GPU-TEE CVM is attested, so anything running inside it is covered.

---

## 8. Model Selection for Single H100 80GB

### DeepSeek V3 -- Does NOT Fit

DeepSeek V3 is 671B total parameters (MoE). Even with FP8 quantization, it requires ~650 GB VRAM -- **8x H100 minimum**. At $3.08/hr per GPU, that is $24.64/hr or $591/day. Not viable for a hackathon self-hosted instance.

Use DeepSeek V3 via Redpill API instead ($0.28/M input, $1.14/M output).

### Models That Fit on 1x H100 80GB

| Model | Architecture | Total / Active Params | Precision | VRAM Est. | KV Cache Room | Notes |
|-------|-------------|----------------------|-----------|-----------|---------------|-------|
| **GPT-OSS 120B** | MoE | 117B / 5.1B active | FP16 | ~30 GB | ~50 GB | Near o4-mini reasoning. **Best bang for buck.** |
| **Llama 4 Scout** | MoE | 109B / 17B active | INT4 | ~30 GB | ~50 GB | 10M context window. Good reasoning. |
| **Qwen3 30B-A3B** | MoE | 30B / 3B active | FP16 | ~8 GB | ~72 GB | Excellent MoE efficiency. 262K context. |
| **Llama 3.1 70B** | Dense | 70B | AWQ INT4 | ~35 GB | ~45 GB | Strong reasoning, proven for negotiation-like tasks |
| **Qwen2.5 72B** | Dense | 72B | AWQ INT4 | ~36 GB | ~44 GB | Strong multilingual |
| **Gemma 3 27B** | Dense | 27B | FP16 | ~54 GB | ~26 GB | Good middle ground, no quantization needed |
| **Llama 3.1 8B** | Dense | 8B | FP16 | ~16 GB | ~64 GB | Fast prototyping, plenty of cache room |
| **DeepSeek-R1-Distill-Qwen3-8B** | Dense (distilled) | 8B | FP16 | ~16 GB | ~64 GB | Strong reasoning distilled from R1 |

### Recommendation for Mnemo

**For hackathon demo**: GPT-OSS 120B (MoE, 5.1B active, fits easily, near-frontier reasoning) or Qwen3 30B-A3B (MoE, 3B active, massive context, very fast).

**For best reasoning quality on 1x H100**: Llama 3.1 70B (AWQ) or Llama 4 Scout (INT4). Both offer strong multi-step reasoning needed for negotiation scenarios.

**For development/iteration**: Llama 3.1 8B or DeepSeek-R1-Distill-Qwen3-8B. Fast inference, plenty of VRAM for large KV caches.

**KV cache room matters**: For Mnemo's prefix caching patterns, more free VRAM = more cached prefixes retained. MoE models are ideal -- small active parameters mean most VRAM is available for KV cache.

---

## 9. Two-CVM Architecture

### The Architecture

If we self-host inference, we need two CVMs:

```
┌── CVM 1 (CPU TEE, ~$0.10-0.20/hr) ────────┐
│                                               │
│  state-manager (conversation DAG)             │
│  harness-a (Agent A logic)                    │
│  harness-b (Agent B logic)                    │
│                                               │
│  Calls CVM 2 via HTTPS ──────────────────────┼──┐
│                                               │  │
│  dstack-guest-agent                           │  │
│  /var/run/dstack.sock                         │  │
└───────────────────────────────────────────────┘  │
                                                   │
┌── CVM 2 (GPU TEE, $3.08/hr H100) ───────────┐  │
│                                               │◄─┘
│  vLLM or SGLang (inference engine)            │
│  GPU: 1x H100 80GB                           │
│  Model: Llama 3.1 70B AWQ / GPT-OSS 120B    │
│                                               │
│  OpenAI-compatible API on port 8000           │
│  dstack-guest-agent for attestation           │
└───────────────────────────────────────────────┘
```

### How Two CVMs Communicate on Phala

**Within a single CVM**: All containers in one `docker-compose.yml` run inside the same CVM. They communicate via Docker networking (localhost or service names). This is how the vLLM template works -- `vllm-proxy` and `vllm` are in the same CVM.

**Between two separate CVMs**: Each CVM gets a public URL via dstack-gateway:
- CVM 1: `https://<app-id-1>-3000.dstack-prod5.phala.network/`
- CVM 2: `https://<app-id-2>-8000.dstack-prod5.phala.network/`

Communication goes through the gateway over HTTPS. This means:
- CVM 1 calls CVM 2's vLLM API at `https://<app-id-2>-8000.dstack-prod5.phala.network/v1/chat/completions`
- Traffic is TLS-encrypted
- Both CVMs independently attested (Intel TDX + optionally NVIDIA CC on CVM 2)

**Mutual attestation**: CVM 1 can verify CVM 2's TDX quote before sending prompts:
1. Fetch `https://<app-id-2>/attestation` to get TDX report
2. Verify against Intel Trust Authority
3. Check RTMR3 to confirm expected Docker image hash
4. Proceed with inference calls

### Limitation: No Private Networking

Phala does not appear to support private inter-CVM networking (no VPC equivalent). All CVM-to-CVM traffic goes through the public gateway. This means:
- Extra latency from gateway hops (likely small -- same datacenter)
- The gateway can see encrypted traffic metadata (but not content, since TLS)
- The inference endpoint is technically publicly accessible (must be auth-protected)

**Mitigation**: Add a simple API key or mTLS to the inference endpoint. In the custom Docker Compose for CVM 2, add an nginx reverse proxy or use vLLM's `--api-key` flag.

### Alternative: Single CVM with GPU

If we put everything in one `docker-compose.yml` on a GPU-TEE CVM:

```yaml
version: "3.8"
services:
  inference:
    image: lmsysorg/sglang:latest-runtime
    command: [...]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ports:
      - "8000:8000"

  state-manager:
    image: mnemo/state-manager:latest
    depends_on:
      - inference
    environment:
      - INFERENCE_URL=http://inference:8000/v1
    ports:
      - "3000:3000"
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
```

**Advantages**:
- No inter-CVM networking needed
- Lower latency (localhost communication)
- Single deployment unit
- Both inference and logic in same TEE boundary

**Disadvantages**:
- GPU-TEE CVM costs $3.08/hr even when inference is idle
- Cannot scale inference independently
- 24-hour minimum billing

**For a hackathon, single CVM is simpler and recommended.**

---

## 10. Architecture Options and Recommendation

### Option A: Shared Redpill API (No Cache Control)

```
CPU CVM ($0.10/hr) ──HTTPS──> Redpill API (api.redpill.ai)
```

- **Cost**: ~$0.85/hackathon for inference + ~$24-48 for CVM
- **Prefix caching**: Unknown if enabled. Phala's vLLM fork is v0.5.4 (opt-in). Even if enabled, shared multi-tenant cache means your prefixes may be evicted by other users' requests.
- **Cache control**: None. No `cache_salt`, no eviction policy control, no monitoring.
- **Latency**: Dominated by inference time, not network.
- **Attestation**: Built-in (Redpill signs responses with TEE-derived keys).
- **Best for**: Hackathon development, demos with low volume, cost-sensitive operation.

### Option B: Dedicated vLLM on GPU-TEE

```
GPU-TEE CVM ($3.08/hr) running:
  - vLLM (latest upstream) with --enable-prefix-caching
  - State manager + harness containers
```

- **Cost**: ~$74/day
- **Prefix caching**: Full control. SHA256 hashing, cache_salt, Prometheus monitoring.
- **Cache control**: Medium. LRU eviction only, no pinning, no TTL.
- **Best for**: When Redpill's caching behavior is confirmed insufficient.

### Option C: SGLang on GPU-TEE (Best Cache Semantics)

```
GPU-TEE CVM ($3.08/hr) running:
  - SGLang with RadixAttention + HiCache
  - State manager + harness containers
```

- **Cost**: ~$74/day
- **Prefix caching**: Best-in-class. Token-level radix tree, LFU eviction, hierarchical CPU/GPU cache.
- **Cache control**: `/flush_cache` endpoint. LFU soft-pins frequent prefixes. HiCache prevents eviction loss.
- **Best for**: Production-grade prefix caching for the DAG-based context model.

### Option D: Hybrid (Recommended for Hackathon)

```
Development + Demo:  CPU CVM ──> Redpill API (cheapest)
Production / Scale:  GPU-TEE CVM with SGLang (best cache semantics)
```

Code stays identical -- both expose OpenAI-compatible `/v1/chat/completions`. The only change is `base_url`:

```python
# Development / Demo
INFERENCE_URL = "https://api.redpill.ai/v1"

# Self-hosted (when cache control matters)
INFERENCE_URL = "http://inference:8000/v1"  # or https://<cvm-url>/v1
```

### Final Recommendation

**Start with Option A (Redpill API) for the hackathon.** The cost difference is massive ($0.85 vs $740) and prefix caching *may* work on Redpill if they use a recent vLLM version with APC enabled.

**Prepare Option C (SGLang on GPU-TEE) as a fallback.** Write the Docker Compose now. If during the hackathon we find that Redpill's cache behavior causes visible latency on scope rewinds (reprocessing the full prefix each time), we can spin up a dedicated SGLang instance in ~10 minutes.

**Key action items**:
1. Ask Phala team: "Is `--enable-prefix-caching` set on Redpill's managed vLLM? What vLLM version?" (Discord or email)
2. Benchmark scope-rewind latency on Redpill during early hackathon days
3. Have the SGLang Docker Compose ready to deploy if needed
4. For model: use DeepSeek V3 on Redpill (best reasoning, 163K context). If self-hosting, use GPT-OSS 120B or Llama 3.1 70B AWQ on 1x H100.

---

## Sources

### vLLM
- [Automatic Prefix Caching Design](https://docs.vllm.ai/en/stable/design/prefix_caching/)
- [vLLM v1 Prefix Caching](https://docs.vllm.ai/en/v0.8.5/design/v1/prefix_caching.html)
- [Automatic Prefix Caching Feature Guide](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/)
- [vLLM Metrics](https://docs.vllm.ai/en/latest/design/metrics/)
- [Engine Args (v0.8.3)](https://docs.vllm.ai/en/v0.8.3/serving/engine_args.html)
- [Cache Salting RFC (Issue #16016)](https://github.com/vllm-project/vllm/issues/16016)
- [Prefix Cache State Metrics Request (Issue #33434)](https://github.com/vllm-project/vllm/issues/33434)
- [KV-Cache Wins: From Prefix Caching to Distributed Scheduling](https://llm-d.ai/blog/kvcache-wins-you-can-see)
- [vLLM v0.8.1 V1 Engine Performance](https://developers.redhat.com/articles/2025/04/28/performance-boosts-vllm-081-switching-v1-engine)

### SGLang
- [RadixAttention and SGLang (LMSYS Blog)](https://lmsys.org/blog/2024-01-17-sglang/)
- [SGLang v0.4 Release Notes](https://lmsys.org/blog/2024-12-04-sglang-v0-4/)
- [SGLang HiCache (LMSYS Blog)](https://lmsys.org/blog/2025-09-10-sglang-hicache/)
- [SGLang Server Arguments](https://docs.sglang.io/advanced_features/server_arguments.html)
- [SGLang Native APIs](https://docs.sglang.io/basic_usage/native_api.html)
- [SGLang GitHub](https://github.com/sgl-project/sglang)
- [SGLang vs vLLM: KV Cache Reuse (Runpod)](https://www.runpod.io/blog/sglang-vs-vllm-kv-cache)
- [SGLang vs vLLM: Token-Level Radix Tree vs Block-Level Hashing](https://medium.com/byte-sized-ai/prefix-caching-sglang-vs-vllm-token-level-radix-tree-vs-block-level-hashing-b99ece9977a1)

### TensorRT-LLM
- [KV Cache Reuse (TRT-LLM)](https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html)
- [New KV Cache Reuse Optimizations (NVIDIA Blog)](https://developer.nvidia.com/blog/introducing-new-kv-cache-reuse-optimizations-in-nvidia-tensorrt-llm/)
- [5x Faster TTFT with KV Cache Early Reuse (NVIDIA Blog)](https://developer.nvidia.com/blog/5x-faster-time-to-first-token-with-nvidia-tensorrt-llm-kv-cache-early-reuse/)

### llama.cpp
- [KV Cache Reuse Tutorial](https://github.com/ggml-org/llama.cpp/discussions/13606)
- [llama-server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

### LMCache
- [LMCache GitHub](https://github.com/LMCache/LMCache)
- [LMCache Paper (arXiv)](https://arxiv.org/abs/2510.09665)
- [KV Caching with vLLM, LMCache, and Ceph](https://ceph.io/en/news/blog/2025/vllm-kv-caching/)

### Phala / dstack
- [Phala GPU TEE Deep Dive](https://phala.com/posts/Phala-GPU-TEE-Deep-Dive)
- [Phala Cloud FAQ](https://docs.phala.com/phala-cloud/faqs)
- [Deploy CVM with Docker Compose](https://docs.phala.network/phala-cloud/phala-cloud-user-guides/create-cvm/create-with-docker-compose)
- [Phala vLLM Fork (v0.5.4)](https://github.com/Phala-Network/vllm)

### Model Selection
- [Top 10 Open-Source Reasoning Models 2026 (Clarifai)](https://www.clarifai.com/blog/top-10-open-source-reasoning-models-in-2026)
- [Best Open Source LLMs 2026 (BentoML)](https://www.bentoml.com/blog/navigating-the-world-of-open-source-large-language-models)
- [DeepSeek V3/R1 671B Deployment Guide](https://www.theriseunion.com/en/blog/DeepSeek-V3-R1-671B-GPU-Requirements.html)
- [Qwen3-30B-A3B (HuggingFace)](https://huggingface.co/Qwen/Qwen3-30B-A3B)
