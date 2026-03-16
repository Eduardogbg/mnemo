# Phala dstack — TEE Runtime Research

> Research date: 2026-03-12
> Context: Mnemo hackathon project (The Synthesis, March 13-22 2026)
> Purpose: Evaluate dstack as TEE runtime for private negotiation rooms

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Local Development Environment](#2-local-development-environment)
3. [GPU-TEE Integration](#3-gpu-tee-integration)
4. [SDK and APIs](#4-sdk-and-apis)
5. [Deployment Workflow](#5-deployment-workflow)
6. [Venice Integration Analysis](#6-venice-integration-analysis)
7. [Pricing](#7-pricing)
8. [Mnemo-Specific Assessment](#8-mnemo-specific-assessment)
9. [Sources](#9-sources)

---

## 1. Architecture Overview

dstack is Phala's open-source confidential computing framework — a "trustless Kubernetes" for TEE workloads. It runs containerized applications inside Confidential VMs (CVMs) backed by Intel TDX hardware. The project is a Linux Foundation Confidential Computing Consortium member and has been audited by zkSecurity (May-June 2025).

### Core Components

| Component | Role |
|---|---|
| **dstack-vmm** | Manages Confidential VMs on bare TDX hosts |
| **dstack-gateway** | Reverse proxy forwarding TLS connections to CVMs |
| **dstack-kms** | Key management server; derives per-app root keys from code+config identity |
| **dstack-guest-agent** | In-CVM service handling key derivation, attestation, event logging |
| **dstack-os (meta-dstack)** | Minimal Yocto-based guest OS image; hardware abstraction layer |

### Key Properties

- **Docker-native**: You write a `docker-compose.yaml`, dstack runs it inside a CVM.
- **Attestation built-in**: Every CVM exposes TDX quotes via `/var/run/dstack.sock`.
- **Deterministic key derivation**: Same app code + config = same root key across restarts/machines.
- **Zero Trust HTTPS**: Automatic TLS termination with CAA DNS records restricting cert issuance.
- **Encrypted secrets**: Environment variables are encrypted client-side, decrypted only inside the CVM.

### How It Differs from Raw TDX

dstack is not just "run a VM in TDX." It adds:
- Reproducible guest OS images (Yocto-based, minimal attack surface)
- KMS that ties secrets to app identity (code hash), not just the machine
- Gateway with domain mapping (`<app-id>[-<port>].dstack-prod5.phala.network`)
- SDK for attestation/key derivation from application code

---

## 2. Local Development Environment

### Yes, you can develop locally without TEE hardware.

Phala provides a **TEE simulator** that emulates the dstack guest agent interface. Your application code talks to the same socket (`/var/run/dstack.sock`) whether running in a real CVM or against the simulator.

### Option A: Docker Simulator (Fastest)

```bash
docker pull phalanetwork/tappd-simulator:latest
docker run --rm -p 8090:8090 phalanetwork/tappd-simulator:latest
```

Then set the endpoint in your app:
```bash
export DSTACK_SIMULATOR_ENDPOINT="http://localhost:8090"
```

For Docker-in-Docker (your app also in a container):
```dockerfile
ENV DSTACK_SIMULATOR_ENDPOINT="http://host.docker.internal:8090"
```

### Option B: Phala CLI (Recommended for Full Workflow)

```bash
npm install -g phala

# Start local simulator
phala simulator start

# Run your app against it
cd my-app
docker compose run --rm \
  -v ~/.phala-cloud/simulator/0.5.3/dstack.sock:/var/run/dstack.sock \
  app
```

### Option C: Build Simulator from Source

```bash
git clone https://github.com/Dstack-TEE/dstack.git
cd dstack/sdk/simulator
./build.sh
./dstack-simulator
```

Creates socket files: `dstack.sock` (v0.5+), `tappd.sock` (legacy v0.3), `external.sock`, `guest.sock`.

### Simulator Limitations

The simulator generates **mock attestation quotes** — they won't verify against Intel's PCCS. But the SDK API surface is identical, so your application logic works the same. You only need real hardware for:
- Verifiable attestation quotes
- Production key derivation (simulator keys are deterministic but not hardware-bound)

### Development Docker Compose Pattern

```yaml
version: '3.8'
services:
  app:
    build: .
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock   # TEE socket
    ports:
      - "3000:3000"
    environment:
      - DSTACK_SIMULATOR_ENDPOINT=http://host.docker.internal:8090
    restart: always
```

---

## 3. GPU-TEE Integration

### How GPU-TEE Works

Phala supports NVIDIA Confidential Computing on **H100** (Hopper) and **H200** GPUs, with **B200** (Blackwell) support incoming. The GPU-TEE protection lifecycle:

1. **Hardware Root of Trust** — Unique cryptographic identity burned into GPU at manufacture
2. **Secure Boot** — GPU firmware verified against NVIDIA signatures
3. **CVM Launch** — Intel TDX confidential VM initialized
4. **Confidential Mode** — GPU enters CC-On mode, performance counters disabled
5. **Session Establishment** — SPDM key exchange between GPU and CPU TEE
6. **Attestation** — Local or remote signature validation (NVIDIA Remote Attestation Service)
7. **Encrypted Data Exchange** — AES-GCM bounce buffers in shared PCIe memory
8. **Secure Execution** — AI workloads run in attested enclave

### Performance Benchmarks

| Model | Overhead | Notes |
|---|---|---|
| Llama-3.1-8B | ~9% | Acceptable |
| Phi-3 14B | ~7% | Good |
| Llama-3.1-70B | ~0% | Near-zero overhead |
| General | <7% avg | Primary bottleneck is PCIe transfer, not GPU compute |

- Time-to-first-token increases ~20-25% due to attestation/encryption setup
- Throughput: ~130 tokens/sec for medium inputs
- TEE mode on H100/H200 runs at up to **99% efficiency** vs native

### Developer Workflow for GPU-TEE

Phala's GPU-TEE is accessed through **Phala Cloud** (managed service), not self-hosted. The workflow:

1. Containerize your model serving (e.g., vLLM, TGI, or custom)
2. Deploy to Phala Cloud with GPU tier
3. The platform handles TDX + NVIDIA CC mode activation
4. Your container gets an OpenAI-compatible endpoint
5. Attestation available via dashboard or SDK

**Pre-deployed models** (DeepSeek, Llama, Qwen) are also available with OpenAI-compatible APIs — no container needed.

**Redpill** (Phala's production gateway) provides:
- OpenAI-compatible `/chat/completions` endpoint
- Response signing with CPU + GPU attestation
- On-chain model hash verification

### Relevance for Mnemo

For Mnemo, we likely do NOT need GPU-TEE directly. Our TEE needs are:
- Running agent logic (CPU workload)
- Storing/managing conversation state
- Handling cryptographic operations (forking, commitment)

LLM inference can happen outside the TEE (via Venice) while only the negotiation protocol runs inside. This is cheaper and simpler. Venice standard inference provides policy-based privacy (anonymized, no logging). Venice also offers an alpha E2EE/TEE mode with cryptographic guarantees for 15 models. For production cryptographic privacy, Redpill (Phala GPU-TEE) is the more mature option. GPU-TEE would only matter if we needed the model weights/prompts to be confidential from the infrastructure provider.

---

## 4. SDK and APIs

### Available SDKs

| Language | Package | Install |
|---|---|---|
| JavaScript/TypeScript | `@phala/dstack-sdk` | `npm install @phala/dstack-sdk` |
| Python | `dstack-sdk` | `pip install dstack-sdk` |
| Go | `github.com/Dstack-TEE/dstack/sdk/go/tappd` | `go get ...` |
| Rust | `dstack-sdk` | `cargo add dstack-sdk` |

### JavaScript/TypeScript SDK (Primary for Mnemo)

#### Constructor

```typescript
import { DstackClient } from '@phala/dstack-sdk';

// Production (inside CVM) — auto-connects to /var/run/dstack.sock
const client = new DstackClient();

// Development (simulator)
const client = new DstackClient('http://localhost:8090');
// Or set DSTACK_SIMULATOR_ENDPOINT env var
```

#### Core Methods

**`info()`** — Get TEE instance metadata
```typescript
const info = await client.info();
// Returns: app_id, instance_id, app_name, device_id,
//          tcb_info (MRTD, RTMRs, event_logs, os_image_hash),
//          app_cert (PEM certificate)
```

**`getKey(path, purpose?)`** — Deterministic key derivation (secp256k1)
```typescript
const ethKey = await client.getKey('wallet/ethereum');
// Returns: { key: Uint8Array(32), signature_chain: [...] }
// Same path → same key across restarts
// Different apps → different keys even with same path

const btcKey = await client.getKey('wallet/bitcoin');
// Independent from ethKey
```

**`getQuote(reportData)`** — Generate TDX attestation quote
```typescript
import crypto from 'crypto';

// Short data (≤64 bytes): pass directly
const nonce = crypto.randomBytes(32);
const quote = await client.getQuote(nonce);
// Returns: { quote: hex, event_log: json, replayRtmrs() }

// Long data (>64 bytes): hash first
const data = JSON.stringify({ room: 'abc', timestamp: Date.now() });
const hash = crypto.createHash('sha256').update(data).digest();
const quote = await client.getQuote(hash);
```

**`getTlsKey(options)`** — Generate TLS certificates
```typescript
const tls = await client.getTlsKey({
  subject: 'mnemo-room.example.com',
  altNames: ['room-123.mnemo.network'],
  usageRaTls: true,       // Embed TDX quote in cert
  usageServerAuth: true,
  usageClientAuth: false,
});
// Returns: { key: PEM, certificate_chain: [PEM, ...] }
```

**`sign(algorithm, data)`** — Sign data with TEE-derived key
```typescript
const result = await client.sign('secp256k1', messageHash);
// Returns: { signature: hex, public_key: hex, signature_chain: [...] }

// Also supports: 'ed25519', 'secp256k1_prehashed'
```

**`verify(algorithm, data, signature, publicKey)`** — Verify signatures
```typescript
const { valid } = await client.verify('secp256k1', data, sig, pubkey);
```

**`emitEvent(event, payload)`** — Extend RTMR3 with custom measurements
```typescript
await client.emitEvent('room_created', JSON.stringify({ roomId: '123' }));
// Recorded in boot event log, verifiable via attestation
```

#### Blockchain Integration (Viem / Ethereum)

```typescript
import { toViemAccount } from '@phala/dstack-sdk/viem';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

const key = await client.getKey('wallet/ethereum');
const account = toViemAccount(key);

const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(),
});

// This wallet is deterministic — same app identity → same address
// Can sign transactions, interact with Base contracts
```

#### Solana Integration

```typescript
import { toKeypair } from '@phala/dstack-sdk/solana';

const key = await client.getKey('wallet/solana');
const keypair = toKeypair(key);
```

### Python SDK

```python
from dstack_sdk import DstackClient
import secrets

client = DstackClient()

# Key derivation
key = client.get_key('wallet/ethereum', 'mainnet')

# Attestation
nonce = secrets.token_bytes(32)
quote = client.get_quote(nonce)

# Quote contains: quote bytes, event_log, rtmrs
```

### External Verification Endpoints

Applications should expose two endpoints for external verifiers:

- **`/attestation`** — Returns TDX quote, event log, VM config (hardware verification)
- **`/info`** — Returns application configuration (code verification)

### Communication: Inside TEE ↔ Outside World

The CVM is a regular Linux environment with network access. Communication patterns:

1. **Inbound**: dstack-gateway forwards HTTPS traffic to your container ports
   - URL pattern: `https://<app-id>-<port>.dstack-prod5.phala.network/`
   - TLS terminated at gateway or passed through (suffix `s`)
   - gRPC supported (suffix `g`)

2. **Outbound**: Standard HTTP/HTTPS from inside the CVM
   - Your app can call Venice API, Base RPC, any external service
   - No special configuration needed

3. **Socket**: `/var/run/dstack.sock` for attestation/key operations
   - Must be mounted in docker-compose.yaml

---

## 5. Deployment Workflow

### Local Dev → Phala Cloud (Managed)

This is the recommended path for hackathons. No bare-metal TDX server needed.

#### Step 1: Local Development

```bash
# Install CLI
npm install -g phala

# Start simulator
phala simulator start

# Write your app with docker-compose.yaml
# Test locally against simulator
docker compose up
```

#### Step 2: Authenticate with Phala Cloud

```bash
# Create account at cloud.phala.com
phala auth login
# Paste API key when prompted

phala auth status  # Verify
```

#### Step 3: Build and Push Docker Image

```bash
phala docker login -u <docker-hub-username>
phala docker build -i mnemo-room -t v0.1.0 -f ./Dockerfile
phala docker push -i <username>/mnemo-room:v0.1.0
```

#### Step 4: Generate Compose Template

```bash
phala docker generate -i <username>/mnemo-room:v0.1.0
# Edit the generated docker-compose.yml
```

Example docker-compose.yml for deployment:
```yaml
version: '3.8'
services:
  room:
    image: <username>/mnemo-room:v0.1.0
    container_name: mnemo-room
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    ports:
      - "3000:3000"
    environment:
      - VENICE_API_KEY=${VENICE_API_KEY}
      - BASE_RPC_URL=${BASE_RPC_URL}
    restart: always
```

#### Step 5: Deploy CVM

```bash
phala cvms create \
  -n mnemo-room \
  -c ./docker-compose.yml \
  --vcpu 2 \
  --memory 4096 \
  --disk-size 20 \
  --env-file ./.env
```

Returns: CVM ID, App ID, public URL.

#### Step 6: Verify and Monitor

```bash
# Check status
phala cvms get <app-id>

# Verify attestation
phala cvms attestation <app-id>

# Access
curl https://<app-id>-3000.dstack-prod5.phala.network/
```

#### Step 7: Update

```bash
# Rebuild, push, then:
phala cvms upgrade <app-id> -c docker-compose.yml
```

#### Step 8: Lifecycle

```bash
phala cvms stop <app-id>     # Pause (stop billing)
phala cvms start <app-id>    # Resume
phala cvms delete <app-id>   # Remove
```

### Self-Hosted (Bare Metal) — Not Recommended for Hackathon

Requires: Bare metal TDX server, Ubuntu 24.04, 16GB+ RAM, 100GB+ disk, public IPv4. You'd run dstack-kms, dstack-gateway, and dstack-vmm yourself. Only relevant for production infrastructure operators.

### Testnet vs Mainnet

Phala Cloud is the production environment — there isn't a separate "testnet" in the traditional blockchain sense. The deployment target is always the managed cloud. For development:
- Use the local simulator (free, instant)
- Deploy to Phala Cloud when ready (free $20 credits for new accounts)

---

## 6. Venice Integration Analysis

### Venice Overview

Venice provides private LLM inference with an OpenAI-compatible API. Key properties:
- API base: `https://api.venice.ai/api/v1`
- Auth: `Authorization: Bearer <VENICE_API_KEY>`
- OpenAI SDK compatible (just swap base URL)
- No prompt logging, no server-side storage
- SSL encryption throughout

### Venice API Basics

```typescript
import OpenAI from 'openai';

const venice = new OpenAI({
  apiKey: process.env.VENICE_API_KEY,
  baseURL: 'https://api.venice.ai/api/v1',
});

const response = await venice.chat.completions.create({
  model: 'deepseek-r1-671b',  // or llama-3.3-70b, etc.
  messages: [{ role: 'user', content: 'Negotiate terms...' }],
});
```

Venice-specific parameters:
```typescript
const response = await venice.chat.completions.create({
  model: 'llama-3.3-70b',
  messages: [...],
  // @ts-ignore — Venice extension
  venice_parameters: {
    enable_web_search: 'off',
    disable_thinking: true,
    include_venice_system_prompt: false,
  },
});
```

### Integration Architecture for Mnemo

```
┌─────────────────────────────────────┐
│         Phala CVM (Intel TDX)       │
│                                     │
│  ┌──────────────────────────────┐   │
│  │      Mnemo Room Agent        │   │
│  │                              │   │
│  │  - Conversation state        │   │
│  │  - Fork/rewind logic         │   │
│  │  - Commitment protocol       │   │
│  │  - Attestation endpoints     │   │
│  └──────┬───────────┬───────────┘   │
│         │           │               │
│    dstack.sock   HTTPS out          │
│    (keys/attest)    │               │
└─────────────────────┼───────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
    Venice API    Base RPC    Lit Protocol
    (inference)  (settlement) (access ctrl)
```

**Why this works:**
- Agent logic runs inside the CVM — negotiation state is private
- Venice API calls go out over HTTPS — prompts are encrypted in transit
- Venice standard inference provides policy-based privacy (anonymized, no logging). Venice's alpha E2EE/TEE mode adds cryptographic guarantees for supported models.
- dstack provides attestation proving the room code is what it claims
- Base contracts handle on-chain commitments
- Lit Protocol gates room access via conditional decryption

**What Venice does NOT give us in this model:**
- Standard Venice inference provides policy-based privacy (trust Venice's no-logging claims). Venice's alpha E2EE/TEE mode adds cryptographic guarantees with hardware attestation for supported models.
- If we needed verifiable private inference (prove the model ran exactly as claimed), we'd need Phala GPU-TEE (Redpill) or similar
- For the hackathon, Venice's trust model is acceptable — the novel primitive is the room protocol, not the inference privacy

### Venice Hackathon Bounty

Venice's bounty track at The Synthesis focuses on **agents that use image generation** as a core feature. Their evaluation criteria:
- Must use Venice API for agent LLM inference
- Must use autonomous image generation via agent (no manual prompts)
- Judged on effectiveness of image vs use-case

**Assessment:** Mnemo is not an image generation project. We should use Venice for inference (good for sponsor engagement) but the Venice bounty track is not our primary target. We can use Venice as our inference provider without chasing the image bounty.

---

## 7. Pricing

### Phala Cloud (Managed dstack)

| Resource | Cost |
|---|---|
| Free credits (new account) | $20 |
| Free CVM | 1 instance included |
| CPU TEE | From ~$0.10/hour |
| H100 GPU | From $3.08/GPU/hour |
| H200 GPU | From $3.50/GPU/hour |
| B200 GPU | From $7.99/GPU/hour |
| Billing | Hourly, pay-as-you-go |

### Hackathon Budget Estimate

For Mnemo (CPU-only CVM, no GPU-TEE needed):
- 1 CVM, 2 vCPU, 4GB RAM: ~$0.10-0.20/hour
- 10 days of hackathon: ~$24-48
- Free $20 credit covers most of it
- Could run on the free CVM instance for demos

---

## 8. Mnemo-Specific Assessment

### What dstack gives us

1. **Private rooms as CVMs**: Each negotiation room is a Docker container running in a CVM. Conversation state never leaves the TEE.
2. **Deterministic keys per room**: `getKey('room/<room-id>')` gives each room a stable identity for signing commitments.
3. **Attestation for trust**: Agents entering a room can verify the room code via TDX attestation before revealing information.
4. **Fork/rewind safety**: Since state is inside the CVM, forking is just in-memory state management — no risk of state leaking to disk outside the TEE.
5. **Base integration**: `toViemAccount()` directly from dstack SDK — the room can sign Base transactions for escrow/settlement.

### What we need to build

1. **Room server**: Express/Fastify app that manages conversation state, handles fork/rewind
2. **Attestation endpoint**: `/attestation` route using `client.getQuote()` for room verification
3. **Agent SDK**: Client library for agents to enter rooms, verify attestation, negotiate
4. **Commitment protocol**: Logic for converting agreed terms into Base transactions
5. **Integration with Lit Protocol**: Room access gating via Lit conditions

### Open Questions

- **Room lifecycle**: One CVM per room? Or one CVM hosting multiple rooms? (Cost vs isolation tradeoff)
- **State persistence**: CVM restarts lose state. Do we need encrypted disk persistence via `getKey()`?
- **Multi-party**: dstack is single-container. How do multiple agents connect? (WebSocket from outside → room server inside CVM)
- **Attestation UX**: How do agents verify attestation in practice? Need a verification library.

### Recommended Stack

```
Runtime:        Phala dstack CVM (Intel TDX)
Language:       TypeScript (Bun or Node.js)
SDK:            @phala/dstack-sdk
Framework:      Fastify or Hono
Inference:      Venice API (OpenAI-compatible)
Chain:          Base (via viem + dstack wallet)
Access Control: Lit Protocol
Local Dev:      phala simulator + docker compose
Deployment:     phala CLI → Phala Cloud
```

---

## 9. Sources

- [dstack Overview — Phala Docs](https://docs.phala.com/dstack/overview)
- [dstack Local Development Guide](https://docs.phala.com/dstack/local-development)
- [dstack GitHub (Phala-Network)](https://github.com/Phala-Network/dstack)
- [dstack GitHub (Dstack-TEE org)](https://github.com/Dstack-TEE/dstack)
- [dstack Examples Repository](https://github.com/Dstack-TEE/dstack-examples)
- [dstack JS SDK (npm)](https://www.npmjs.com/package/@phala/dstack-sdk)
- [dstack JS SDK Source](https://github.com/Dstack-TEE/dstack/tree/master/sdk/js)
- [GPU TEE Deep Dive — Phala Blog](https://phala.com/posts/Phala-GPU-TEE-Deep-Dive)
- [LLM in GPU TEE — Phala Docs](https://docs.phala.com/phala-cloud/confidential-ai/gpu-tee/llm-in-tee)
- [Attestation Guide — Phala Docs](https://docs.phala.com/phala-cloud/attestation/get-attestation)
- [Phala Cloud CLI Guide](https://phala.com/posts/get-started-on-phala-cloud-with-cli)
- [Phala Cloud CLI (GitHub)](https://github.com/Phala-Network/phala-cloud)
- [Phala Cloud Pricing](https://phala.com/posts/introducing-phala-cloud-pricing-affordable-secure-scalable)
- [Private AI Inference — Phala](https://phala.com/solutions/private-ai-inference)
- [dstack Security Audit Announcement](https://phala.com/posts/dstack-completes-security-audit-a-milestone-for-confidential-cloud)
- [Venice API Reference](https://docs.venice.ai/api-reference/api-spec)
- [Venice Privacy Architecture](https://venice.ai/privacy)
- [The Synthesis Hackathon](https://synthesis.md/)
- [Phala Cloud Python Starter](https://github.com/Phala-Network/phala-cloud-python-starter)
- [Phala Cloud Bun Starter](https://github.com/Phala-Network/phala-cloud-bun-starter)
