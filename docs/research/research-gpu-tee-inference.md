# GPU-TEE Inference for Mnemo — Research

> Research compiled 2026-03-12 for The Synthesis hackathon.
> **Key distinction:** Venice offers two privacy tiers: standard inference (policy-based privacy — anonymized, no logging) and alpha E2EE/TEE inference (cryptographic privacy via hardware attestation + encryption).
> For Mnemo's requirements, we need cryptographically verifiable inference — either via Venice E2EE or Phala GPU-TEE (Redpill).

---

## 1. How to Deploy LLM Inference on Phala GPU-TEE

### Deployment Options (Three Tiers)

Phala offers three ways to get confidential inference, from simplest to most custom:

#### Option A: On-Demand API (Redpill) — RECOMMENDED FOR HACKATHON

The simplest path. Phala runs pre-deployed models inside their own GPU-TEEs and exposes an OpenAI-compatible API at `https://api.redpill.ai/v1`.

```python
from openai import OpenAI

client = OpenAI(
    api_key="<PHALA_API_KEY>",
    base_url="https://api.redpill.ai/v1"
)

response = client.chat.completions.create(
    model="phala/deepseek-chat-v3-0324",
    messages=[{"role": "user", "content": "Propose terms for the deal..."}]
)
```

- **Zero infrastructure** — just an API key
- Every response includes attestation proof (CPU + GPU TEE)
- Pay per token, no minimum
- $5 minimum account balance required

#### Option B: Dedicated GPU-TEE Instance (Self-hosted vLLM)

Rent a GPU-TEE node and run your own model via vLLM.

**Workflow:**
1. Sign into [cloud.phala.com](https://cloud.phala.com)
2. Navigate to GPU TEE → "Start Building"
3. Select GPU hardware (H100/H200/B200)
4. Select GPU count (1-8)
5. Choose deployment template: **vLLM** (pre-configured) or **Custom** (your own docker-compose)
6. Select pricing plan (on-demand or reserved)
7. Deploy → wait for provisioning (Preparing → Starting → Running)
8. Access via JupyterLab URL or SSH

**vLLM template** is pre-configured with:
- NVIDIA Driver 570.133.20 + CUDA 12.8
- vLLM server with OpenAI-compatible API on port 8000
- You specify the model (HuggingFace model ID) at deploy time

**Architecture inside the CVM:**
```
┌─ GPU-TEE CVM (Intel TDX + NVIDIA CC) ──────┐
│                                               │
│  vllm-proxy  ←── forwards requests ──→  vllm │
│    │                                    │     │
│    │ attaches attestation               │     │
│    │ quotes to responses                GPU(s)│
│    │                                          │
│  dstack-guest-agent (tappd)                   │
│    └─ /var/run/dstack.sock                    │
└───────────────────────────────────────────────┘
```

The `vllm-proxy` is a Phala component that sits in front of vLLM, forwarding requests and attaching GPU+CPU attestation quotes to every response. vLLM itself runs unmodified.

#### Option C: Custom Docker Compose

For full control, provide your own `docker-compose.yml`:

```yaml
version: "3.8"
services:
  inference:
    image: vllm/vllm-openai:latest
    command: >
      --model meta-llama/Llama-3.1-8B-Instruct
      --max-model-len 8192
      --gpu-memory-utilization 0.90
      --tensor-parallel-size 1
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

volumes:
  model-cache:
```

### What Models Fit on H100 80GB?

| Model | Precision | VRAM Required | Fits on 1x H100 80GB? | Notes |
|-------|-----------|---------------|------------------------|-------|
| Llama 3.1 8B | FP16 | ~16 GB | YES | Plenty of room for KV cache |
| Llama 3.1 8B | FP8 | ~8 GB | YES | Native FP8 on Hopper |
| Qwen2.5 7B | FP16 | ~14 GB | YES | |
| DeepSeek V3 (685B MoE) | FP16 | ~1.3 TB | NO | Needs 8+ GPUs |
| DeepSeek V3 | FP8 | ~650 GB | NO | Needs 8x H100 |
| Llama 3.1 70B | FP16 | ~140 GB | NO | Needs 2x H100 |
| Llama 3.1 70B | FP8 | ~70 GB | YES (tight) | Minimal KV cache headroom |
| Llama 3.1 70B | INT4 (AWQ/GPTQ) | ~35 GB | YES | Good KV cache room |
| Qwen2.5 72B | FP16 | ~144 GB | NO | Needs 2x H100 |
| Qwen2.5 72B | INT4 | ~36 GB | YES | Good fit |
| Gemma 3 27B | FP16 | ~54 GB | YES | ~26 GB for KV cache |

**Best single-H100 options for negotiation:**
- Llama 3.1 8B (FP16) — fast, cheap, good for prototyping
- Llama 3.1 70B (INT4/AWQ) — strong reasoning, fits with quantization
- Qwen2.5 72B (INT4) — strong multilingual, fits with quantization
- Gemma 3 27B (FP16) — good middle ground, no quantization needed

### Can We Share an Inference Endpoint Between Rooms?

**Yes.** vLLM supports continuous batching — multiple concurrent requests are batched efficiently. A single GPU-TEE instance running vLLM can serve multiple negotiation rooms simultaneously. The rooms just hit the same `http://inference:8000/v1/chat/completions` endpoint.

For the Redpill API (Option A), this is handled automatically — it's a shared multi-tenant service.

---

## 2. Cost Analysis for Hackathon (10 Days, March 13-22)

### Option A: Redpill API (Pay-per-token) — CHEAPEST

Models running natively in Phala's GPU-TEE (provider=phala):

| Model | Input $/M tokens | Output $/M tokens | Context |
|-------|-------------------|---------------------|---------|
| DeepSeek V3 0324 | $0.28 | $1.14 | 163K |
| Qwen2.5 VL 72B | $0.59 | $0.59 | 65K |
| Gemma 3 27B | $0.11 | $0.40 | 53K |
| GPT-OSS 120B | $0.10 | $0.49 | 131K |
| GPT-OSS 20B | $0.04 | $0.15 | 131K |
| Qwen2.5 7B | $0.04 | $0.10 | 32K |

**External providers (also TEE-attested):**

| Provider | Model | Input $/M | Output $/M |
|----------|-------|-----------|------------|
| NearAI | DeepSeek V3.1 | varies | varies |
| NearAI | Qwen3 30B A3B | varies | varies |
| Tinfoil | DeepSeek R1 0528 | $2.00 | $2.00 |
| Tinfoil | Meta Llama 3.3 70B | $2.00 | $2.00 |

**Estimated hackathon cost (Redpill API):**

Assume: 500 negotiation rounds, ~2K tokens input + ~1K tokens output per round.
- Input: 500 * 2,000 = 1M tokens
- Output: 500 * 1,000 = 0.5M tokens

Using DeepSeek V3 0324 (phala-native):
- Input: 1M * $0.28/M = $0.28
- Output: 0.5M * $1.14/M = $0.57
- **Total: ~$0.85**

Even at 10x that volume (5,000 rounds): **~$8.50**

Using Qwen2.5 7B (cheapest phala-native):
- Input: 1M * $0.04/M = $0.04
- Output: 0.5M * $0.10/M = $0.05
- **Total: ~$0.09** (essentially free)

### Option B: Self-Hosted GPU-TEE Instance

| GPU | On-Demand $/hr | 10 Days Cost | Reserved $/hr | 10 Days (reserved) |
|-----|----------------|--------------|---------------|---------------------|
| 1x H100 | $3.08 | $739.20 | $2.38 | $571.20 |
| 1x H200 | $3.50 | $840.00 | $2.56 | $614.40 |
| 2x H100 | $6.16 | $1,478.40 | $4.76 | $1,142.40 |
| 1x B200 | $7.99 | $1,917.60 | $5.63 | $1,351.20 |

**24-hour minimum billing on on-demand.** Reserved requires 1-month or 6-month commitment — not suitable for a 10-day hackathon.

### Verdict

**Use the Redpill API (Option A).** For a hackathon with moderate usage, total inference cost will be **under $10**. Self-hosting a GPU-TEE for $740+ makes zero sense unless we need a custom model or extreme throughput.

The Redpill API models that run natively on Phala's GPU-TEE infrastructure provide the same privacy guarantees as self-hosting — the operator cannot see plaintext prompts because they run inside NVIDIA Confidential Computing enclaves.

---

## 3. How to Rent/Provision a GPU-TEE Node

### Step-by-Step (if we decide to self-host)

1. **Sign up** at [cloud.phala.com](https://cloud.phala.com)
2. **Fund account** — minimum $5 for API, more for GPU-TEE instances
3. **Navigate** to GPU TEE section
4. **Select hardware:**
   - H200 (US): 24 vCPU, 141 GB VRAM, 256 GB RAM — $2.56/hr reserved
   - H200 (India): 15 vCPU, 141 GB VRAM, 384 GB RAM — $2.30/hr reserved
   - B200 (US): 12 vCPU, 180 GB VRAM, 192 GB RAM — $3.80/hr reserved
   - H100: 80 GB VRAM — $3.08/hr on-demand
5. **Choose GPU count** (1-8, resources scale proportionally)
6. **Select template:** vLLM, Jupyter Notebook (PyTorch), or Custom Docker Compose
7. **Pick pricing plan:** On-demand (24hr minimum) or reserved (1-month / 6-month)
8. **Deploy** — provisioning takes a few minutes
9. **Verify TEE** once running:
   ```bash
   nvidia-smi                         # confirm GPU detection
   nvidia-smi conf-compute -q         # confirm CC State: ON
   pip install nv-local-gpu-verifier nv_attestation_sdk
   python -m verifier.cc_admin        # cryptographic attestation proof
   ```

### Free Tier / Credits

- **$20 free credits** on signup + 1 free CVM instance (CPU-only)
- **No dedicated hackathon credit program** found
- The $20 free credits would cover massive usage on the Redpill API (enough for ~200K+ output tokens on DeepSeek V3)
- For GPU-TEE instances, $20 covers ~6.5 hours on H100 — not enough for sustained use
- **Recommendation:** Contact Phala team directly (Discord/email) about hackathon credits. They are a Synthesis sponsor-adjacent project (crypto-native, likely friendly to hackathon participants)

### For Redpill API Only (Simplest Path)

1. Sign up at [cloud.phala.com](https://cloud.phala.com)
2. Go to Dashboard → Confidential AI API → Enable
3. Create API key
4. Fund account ($5 minimum)
5. Use `https://api.redpill.ai/v1` as base URL with OpenAI SDK

---

## 4. Local Testing Without GPU-TEE

### Strategy: Develop Locally, Deploy API Calls to Redpill

Since we're recommending the Redpill API (not self-hosted GPU-TEE), the local/production workflow is almost identical:

**Local development:**
```python
# Option 1: Local Ollama for fast iteration (no privacy, just dev speed)
from openai import OpenAI
client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
response = client.chat.completions.create(
    model="llama3.1:8b",
    messages=[...]
)

# Option 2: Redpill API directly (private, but costs pennies)
client = OpenAI(base_url="https://api.redpill.ai/v1", api_key=PHALA_KEY)
response = client.chat.completions.create(
    model="phala/deepseek-chat-v3-0324",
    messages=[...]
)
```

**Production (inside CPU CVM on Phala Cloud):**
```python
# Identical code — just the Redpill API call
client = OpenAI(base_url="https://api.redpill.ai/v1", api_key=PHALA_KEY)
```

The only code change between local and production is the `base_url` and `model` parameters.

### TEE Simulator for CPU-Side Logic

For testing dstack SDK features (key derivation, attestation) without TEE hardware:

```bash
# Build simulator
git clone https://github.com/Dstack-TEE/dstack.git
cd dstack/sdk/simulator
./build.sh
./dstack-simulator
# Creates dstack.sock + tappd.sock

# Set env
export DSTACK_SIMULATOR_ENDPOINT=/path/to/dstack.sock
```

Then use SDKs with simulator endpoint:
```typescript
const client = new TappdClient('http://localhost:8090');  // simulator
const key = await client.getKey('/mnemo/agent-a/signing-key');
const quote = await client.getQuote(reportData);
```

### Minimal Workflow Change Summary

| Component | Local Dev | Production (Phala Cloud) |
|-----------|-----------|--------------------------|
| Inference | Ollama (localhost:11434) | Redpill API (api.redpill.ai) |
| TEE keys | dstack simulator (localhost:8090) | dstack guest agent (/var/run/dstack.sock) |
| Attestation | Simulated quotes | Real TDX quotes |
| State storage | Local filesystem | LUKS-encrypted volume |
| Code changes | **base_url config only** | **base_url config only** |

---

## 5. Pre-Built Confidential AI Models (Redpill)

### What Are These?

Phala runs a managed inference service called **Redpill** (`api.redpill.ai`). It's essentially "OpenAI API but every call runs inside a GPU-TEE."

### Models Running Natively in Phala's GPU-TEE (provider=phala)

These are the models where Phala controls the full TEE stack — highest privacy guarantee:

| Model | ID | Context | Input $/M | Output $/M |
|-------|----|---------|-----------|------------|
| DeepSeek V3 0324 | `phala/deepseek-chat-v3-0324` | 163K | $0.28 | $1.14 |
| Qwen2.5 VL 72B | `qwen/qwen2.5-vl-72b-instruct` | 65K | $0.59 | $0.59 |
| Gemma 3 27B | `google/gemma-3-27b-it` | 53K | $0.11 | $0.40 |
| GPT-OSS 120B | `openai/gpt-oss-120b` | 131K | $0.10 | $0.49 |
| GPT-OSS 20B | `openai/gpt-oss-20b` | 131K | $0.04 | $0.15 |
| Qwen2.5 7B | `qwen/qwen-2.5-7b-instruct` | 32K | $0.04 | $0.10 |

### External TEE Providers (via Redpill gateway)

These route through NearAI or Tinfoil — they claim TEE execution but Phala doesn't directly control the hardware:

| Provider | Models | Pricing |
|----------|--------|---------|
| NearAI | DeepSeek V3.1, Qwen3 30B, GLM-4.6 | Varies |
| Tinfoil | DeepSeek R1 0528, Qwen3 Coder 480B, Llama 3.3 70B | $2.00/$2.00 per M |

### Non-TEE Models (Also on Redpill)

Redpill also proxies to 200+ models (GPT-5, Claude, Gemini, etc.) but these route to OpenAI/Anthropic/Google servers — **NOT private**. The Redpill gateway itself runs in TEE (so your API key is protected), but the inference happens on the model provider's infrastructure.

### Can We Just Use These?

**YES. This is the recommended approach.** Specifically:

- **For negotiation reasoning:** `phala/deepseek-chat-v3-0324` (strong reasoning, 163K context, runs in Phala's GPU-TEE)
- **For cost-sensitive testing:** `qwen/qwen-2.5-7b-instruct` ($0.04/$0.10 per M — nearly free)
- **For vision tasks (if needed):** `qwen/qwen2.5-vl-72b-instruct`

The privacy guarantee: prompts and completions are encrypted end-to-end, processed inside NVIDIA Confidential Computing enclaves, and never visible to Phala operators or GPU providers.

---

## 6. Attestation for Inference

### How GPU-TEE Attestation Works

Phala's GPU-TEE provides **dual attestation** — cryptographic proof from both the CPU and GPU:

```
┌─ Intel TDX (CPU) ──────────────────────────────────┐
│  - Boots Confidential VM                             │
│  - Measures OS, drivers, application code            │
│  - Generates TDX attestation quote                   │
│  - Fields: MRTD, RTMR0-3, report_data               │
│                                                      │
│  ┌─ NVIDIA CC (GPU) ──────────────────────────────┐ │
│  │  - Runs model inference in GPU enclave          │ │
│  │  - Encrypted bounce buffers (AES-GCM) for       │ │
│  │    CPU↔GPU data transfer                        │ │
│  │  - SPDM key exchange between CPU and GPU        │ │
│  │  - Generates GPU attestation report             │ │
│  │  - Verifiable via NVIDIA NRAS                   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Trust Chain

1. **GPU authenticates to CPU:** GPU generates attestation report signed with hardware identity key, detailing firmware state
2. **CPU verifies GPU:** CVM verifies the GPU's report (locally or via NVIDIA Remote Attestation Service / NRAS)
3. **Encrypted channel:** CPU and GPU exchange keys via SPDM protocol, establishing AES-GCM encrypted data path
4. **Data flows:** Prompts encrypted in CPU TEE → encrypted transfer to GPU enclave → inference → encrypted result back to CPU TEE → returned to client

### Can Our Negotiation CVM Verify the Inference CVM?

**With Redpill API:** Every response from `api.redpill.ai` includes attestation metadata. The Redpill gateway signs responses with a key generated inside the TEE, bundled with CPU + GPU attestation reports and on-chain model hash. Our CPU CVM can verify this using:
- Public verification tools (Redpill verification API)
- NVIDIA NRAS for GPU attestation validation
- Intel Trust Authority for TDX quote validation

**With self-hosted GPU-TEE:** The GPU-TEE CVM exposes `/attestation` and `/info` endpoints. Our CPU CVM can:
1. Fetch the GPU-TEE's attestation report
2. Verify the TDX quote against Intel's root of trust
3. Verify the GPU attestation via NVIDIA NRAS
4. Check RTMR3 to confirm the expected vLLM + model Docker image is running
5. Verify `report_data` field for challenge-response freshness

### What Gets Attested?

| Layer | What's Measured | Who Verifies |
|-------|----------------|--------------|
| CPU TEE (TDX) | OS image, kernel, drivers, Docker containers | Intel Trust Authority |
| GPU TEE (NVIDIA CC) | GPU firmware, confidential compute mode, driver version | NVIDIA NRAS |
| Application | Docker image hash, compose-hash, app-id (in RTMR3) | Phala verification tools |
| Response | Model output signed with TEE-derived key | Client-side verification |

### Practical Verification Code

```python
import requests

# After getting inference response from Redpill
response = client.chat.completions.create(
    model="phala/deepseek-chat-v3-0324",
    messages=[...]
)

# Verify attestation (conceptual — exact API TBD)
# Redpill attaches verification URLs to responses
# verification_url = response.headers.get("X-Attestation-URL")
# attestation = requests.get(verification_url).json()
# assert attestation["gpu_tee"]["cc_state"] == "ON"
# assert attestation["cpu_tee"]["tdx_verified"] == True
```

### Mnemo Architecture Implication

The strongest architecture for Mnemo is:

```
┌─ CPU CVM (Phala Cloud, cheap) ──────────┐
│  Negotiation harness                     │
│  Agent A + Agent B + State Manager       │
│  TEE-derived keys, attestation           │
│                                          │
│  Calls Redpill API for inference ────────┼──→ GPU-TEE (Phala/Redpill)
│  Verifies attestation on every response  │    (NVIDIA CC + Intel TDX)
│                                          │    Runs DeepSeek V3 / Qwen
└──────────────────────────────────────────┘
```

Both the CPU CVM (running the negotiation logic) and the GPU-TEE (running inference) are independently attested. Neither Phala operators, GPU providers, nor any third party can see:
- The negotiation prompts (encrypted in transit, processed in GPU enclave)
- The model outputs (encrypted from GPU enclave back to CPU CVM)
- The negotiation state (encrypted in CPU CVM memory + LUKS storage)

---

## 7. Updated Architecture Recommendation

### Option 1: Venice Standard Inference (Policy-Based Privacy)

```
CPU CVM ──→ Venice API standard inference (anonymized, no logging — policy-based)
```

### Option 2: Venice E2EE Inference (Cryptographic Privacy, Alpha)

```
CPU CVM ──→ Venice E2EE API (end-to-end encrypted, TEE-attested — alpha)
```

### Option 3: Redpill (Cryptographic Privacy, Production)

```
CPU CVM ──→ Redpill API (prompts encrypted, inference in GPU-TEE)
         ↑ attestation proof on every response
```

### Code Change Required

Minimal — swap the base URL and model:

```python
# Venice standard inference (policy-based privacy)
client = OpenAI(base_url="https://api.venice.ai/api/v1", api_key=VENICE_KEY)
response = client.chat.completions.create(model="deepseek-r1", ...)

# Redpill/Phala (cryptographic privacy, GPU-TEE)
client = OpenAI(base_url="https://api.redpill.ai/v1", api_key=PHALA_KEY)
response = client.chat.completions.create(model="phala/deepseek-chat-v3-0324", ...)
```

### Cost Comparison

| Provider | Privacy | Cost (1M input + 0.5M output) | Attestation |
|----------|---------|-------------------------------|-------------|
| Venice (standard) | Policy-based privacy (anonymized, no logging) | ~$0.50 | None (alpha E2EE/TEE mode available) |
| Redpill (DeepSeek V3) | GPU-TEE encrypted | ~$0.85 | CPU+GPU dual attestation |
| Redpill (Qwen2.5 7B) | GPU-TEE encrypted | ~$0.09 | CPU+GPU dual attestation |
| Self-hosted H100 | GPU-TEE encrypted | $739/10 days | Full control |

---

## 8. Open Questions / Risks

1. **Redpill API availability:** Is it production-stable? What's the uptime? Rate limits are not documented.
2. **Latency:** GPU-TEE adds <5% compute overhead, but the Redpill API may have queue delays. Need to benchmark.
3. **Phala-native model selection:** Only 7 models run natively on Phala's TEE. DeepSeek V3 0324 is the best reasoning model in the list, but it's not the latest (V3.1 is on NearAI, V3.2 may not be available yet).
4. **External TEE providers (Tinfoil/NearAI):** These claim TEE execution but we can't verify Phala controls the hardware. For hackathon demo, Phala-native models are the honest choice.
5. **Free credits:** $20 signup credit is enough for API usage but need to confirm it's still available.
6. **Attestation verification SDK:** The exact client-side verification API/SDK is not well-documented. May need to check Redpill docs or GitHub.

---

## Sources

- [Phala Confidential AI Overview](https://docs.phala.com/phala-cloud/confidential-ai/overview)
- [Deploy and Verify GPU TEE](https://docs.phala.com/phala-cloud/confidential-ai/confidential-gpu/deploy-and-verify)
- [On-demand Confidential AI API (Redpill)](https://docs.phala.com/phala-cloud/confidential-ai/confidential-model/confidential-ai-api)
- [GPU TEE Deep Dive](https://phala.com/posts/Phala-GPU-TEE-Deep-Dive)
- [GPU TEE Launch Announcement](https://phala.com/posts/gpu-tee-is-launched-on-phala-cloud-for-confidential-ai)
- [GPU TEE Pricing](https://phala.com/confidential-ai)
- [H100 GPU TEE](https://phala.com/gpu-tee/h100)
- [How TEE Verification Works](https://phala.com/learn/How-TEE-Verification-Works)
- [Private AI Inference](https://phala.com/solutions/private-ai-inference)
- [dstack Local Development Guide](https://docs.phala.com/dstack/local-development)
- [dstack GitHub](https://github.com/Dstack-TEE/dstack)
- [Redpill AI Models](https://www.redpill.ai/models)
- [Redpill Documentation](https://docs.redpill.ai/confidential-ai-inference/get-started)
- [LLM in GPU TEE FAQs](https://docs.phala.com/llm-in-gpu-tee/faqs)
- [Phala Cloud Pricing](https://phala.com/posts/introducing-phala-cloud-pricing-affordable-secure-scalable)
- [GPU Memory Requirements for LLMs](https://www.spheron.network/blog/gpu-memory-requirements-llm/)
- [vLLM Docker Deployment Guide](https://inference.net/content/vllm-docker-deployment)
