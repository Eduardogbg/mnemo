# Phala dstack & TEE Infrastructure — Deep Dive for Mnemo

> Research compiled 2026-03-12 for The Synthesis hackathon.
> Sources: Phala docs, dstack GitHub repos, blog posts, npm packages.

---

## 1. dstack Architecture

dstack is Phala's open-source framework for deploying containerized applications into Confidential VMs (CVMs) running on Intel TDX hardware. It provides end-to-end encryption for network traffic and disk storage with zero application code changes.

### Core Components

| Component | Where it runs | Role |
|---|---|---|
| **dstack-vmm** (VMM) | Bare-metal host | Hypervisor that parses Docker Compose files, boots CVMs from reproducible OS images, allocates CPU/memory/GPU resources. |
| **dstack-guest-agent** (tappd) | Inside each CVM | Serves containers' key derivation and attestation requests via `/var/run/dstack.sock`. Provisions per-app keys from KMS, encrypts local storage. |
| **dstack-kms** (KMS) | Its own TEE instance | Verifies TDX quotes before releasing keys. Enforces authorization policies via on-chain smart contracts. Derives deterministic keys bound to each application's attested identity. |
| **dstack-gateway** | Edge / reverse proxy | Manages TLS termination with automatic ACME certificate provisioning. Routes traffic to CVMs. Uses RA-TLS for mutual attestation on internal comms. |
| **dstack-os** (meta-dstack) | CVM guest OS | Minimized OS image (Yocto-based). Read-only root filesystem with dm-verity. Hardware abstraction layer that normalizes across TEE implementations. |

### Interaction Flow

```
 Client (HTTPS)
      |
  dstack-gateway  (TLS termination, RA-TLS internally)
      |
  dstack-vmm      (boots CVM, passes docker-compose.yaml)
      |
  ┌─ CVM ─────────────────────────────────┐
  │  dstack-os (dm-verity, LUKS)           │
  │  dstack-guest-agent (tappd)            │
  │    └─ /var/run/dstack.sock             │
  │  ┌─────────┐  ┌─────────┐             │
  │  │ Agent A  │  │ Agent B  │  (Docker)  │
  │  └─────────┘  └─────────┘             │
  └────────────────────────────────────────┘
      |
  dstack-kms  (separate TEE, on-chain policy)
```

### Secure Boot Chain

1. Hypervisor/OVMF measures and configures VM specs
2. Linux kernel loaded with measurement recorded in RTMR0-2
3. Read-only root filesystem verified via dm-verity
4. Application data partition encrypted via LUKS (keys from KMS)
5. Docker containers launched, measured into RTMR3

---

## 2. Deployment to Phala Cloud

### CLI Installation

```bash
npm install -g phala
# or use directly:
npx phala <command>
```

### Authentication

```bash
phala auth login          # interactive login, stores creds in ~/.phala-cloud/credentials.json
# or via env var:
export PHALA_CLOUD_API_KEY=<your-key>
```

### Deployment Workflow

```bash
# 1. Build Docker image
phala docker build --image mnemo-negotiation --tag v0.1.0

# 2. Push to Docker Hub
phala docker login
phala docker push --image mnemo-negotiation --tag v0.1.0

# 3. Deploy CVM with Docker Compose
phala cvms create \
  --name mnemo \
  --compose ./docker-compose.yml \
  --env-file ./.env \
  --vcpu 4 \
  --memory 8192 \
  --diskSize 60 \
  --teepod-id 3

# 4. Manage
phala cvms list
phala cvms logs --name mnemo
phala cvms restart --name mnemo
phala cvms stop --name mnemo
phala cvms delete --name mnemo
```

### Project Configuration (`phala.toml`)

```toml
[cvm]
name = "mnemo"
compose = "./docker-compose.yml"
env_file = "./.env"

[auth]
profile = "default"
```

### Local Development (TEE Simulator)

```bash
phala simulator start     # starts local TEE simulator
# Guest agent available at http://localhost:8090 instead of /var/run/dstack.sock
```

---

## 3. Multi-Container Networking

**This is critical for Mnemo: Agent A and Agent B as separate processes with shared state.**

### How it works

All containers defined in a single `docker-compose.yaml` run **inside the same CVM**. Standard Docker Compose networking applies:

- Compose creates a default network for all services
- Containers discover each other by **service name** (DNS resolution)
- No ports are exposed outside the CVM unless explicitly configured

### Example `docker-compose.yaml` for Mnemo

```yaml
version: "3.8"
services:
  agent-a:
    image: mnemo/agent:latest
    environment:
      - ROLE=agent-a
      - SHARED_STATE_URL=http://state-manager:8080
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock   # TEE key/attestation access

  agent-b:
    image: mnemo/agent:latest
    environment:
      - ROLE=agent-b
      - SHARED_STATE_URL=http://state-manager:8080
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock

  state-manager:
    image: mnemo/state-manager:latest
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
      - negotiation-data:/data
    ports:
      - "8080:8080"   # internal only within CVM

  redis:
    image: redis:7-alpine
    # accessible as redis:6379 from other containers

volumes:
  negotiation-data:
```

### Key points for Mnemo

- `agent-a` can reach `agent-b` via `http://agent-b:<port>` and vice versa
- All inter-container traffic stays **inside the CVM** — encrypted memory, never leaves the TEE boundary
- A shared `state-manager` service can hold the negotiation state tree (forks, branches, commits)
- Both agents can independently call the guest agent via `/var/run/dstack.sock` for key derivation and attestation
- Redis or SQLite on an encrypted volume can serve as the shared state backend

---

## 4. Key Management & Derivation

### Architecture

The KMS runs in its own TEE and is governed by on-chain smart contracts. It replaces hardware-bound key sealing with a portable, policy-controlled system.

### Key Derivation via Guest Agent

Apps communicate with the guest agent over a Unix socket:

```
/var/run/dstack.sock
```

### SDK Usage (TypeScript)

```typescript
import { TappdClient } from '@phala/dstack-sdk';

// In production CVM — connects to /var/run/dstack.sock automatically
const client = new TappdClient();

// In local dev with simulator:
// const client = new TappdClient('http://localhost:8090');

// Derive a deterministic key
const key = await client.getKey('/mnemo/agent-a/signing-key');
// Returns: secp256k1 key material

// Same path + same app = same key, every time
// Different app (different Docker image hash) = different key, same path
```

### SDK Usage (Python)

```python
from dstack_sdk import TappdClient

client = TappdClient()  # auto-connects to /var/run/dstack.sock
key = client.get_key("/mnemo/agent-a/signing-key")
```

### SDK Usage (Go)

```go
import dstack "github.com/Dstack-TEE/dstack/sdk/go"

client, _ := dstack.NewTappdClient()
// or with simulator: dstack.NewTappdClient(dstack.WithEndpoint("http://localhost:8090"))

key, _ := client.GetKey("/mnemo/agent-a/signing-key")
```

### Properties

| Property | Detail |
|---|---|
| **Deterministic** | Same path always produces the same key for the same app identity |
| **Persistent across restarts** | Keys are derived from KMS root key + app identity, not stored locally |
| **App-isolated** | Different Docker image hash = different keys, even with same path |
| **Portable** | App can migrate to different TEE hardware and get the same keys |
| **Key rotation** | KMS supports root key share rotation and complete root key rotation with controlled handover periods |

### Key Types Derived

- Application CA keys (TLS certificates)
- Disk encryption keys (LUKS)
- Environment variable encryption keys
- ECDSA signing keys (secp256k1 — for wallets/transactions)
- Ed25519 signing keys

### Mnemo Implications

- Each agent can derive its own signing key: `/mnemo/agent-a/signing` and `/mnemo/agent-b/signing`
- The state manager can derive an encryption key for the negotiation log: `/mnemo/state/encryption`
- Keys survive CVM restarts — negotiation state is recoverable
- Keys are bound to the exact Docker image hash — if someone deploys a modified image, they get different keys and cannot access previous state

---

## 5. Remote Attestation

### How It Works

1. **Guest agent** generates a TDX attestation quote (cryptographically signed by Intel TDX hardware)
2. The quote includes measurements of the entire boot chain + application code
3. External verifiers can validate the quote against Intel's root of trust

### Generating Attestation (SDK)

```typescript
import { TappdClient } from '@phala/dstack-sdk';

const client = new TappdClient();

// reportData: up to 64 bytes of custom data to bind into the quote
// Use a nonce, challenge hash, or commitment hash
const quote = await client.getQuote(reportData);
// Returns: { quote: Uint8Array, eventLog: [...] }

// For empty report data:
const quote = await client.getQuote('');
```

**reportData constraints:**
- Exactly 64 bytes max
- If > 64 bytes, SHA-256 hash it first (produces 32 bytes)
- Pad shorter data with zeros

### Verification Endpoints

Every CVM exposes two endpoints for external verification:

| Endpoint | Returns | Purpose |
|---|---|---|
| `/attestation` | Quote + event log + `vm_config` | **Hardware verification** — prove genuine TEE |
| `/info` | Application configuration | **Code verification** — prove expected code is running |

### What's in the Attestation Report

| Field | What it measures |
|---|---|
| `MRTD` | Initial Trust Domain memory (VM image) |
| `RTMR0` | Hardware/firmware components |
| `RTMR1` | Kernel measurements |
| `RTMR2` | Command line / boot config |
| `RTMR3` | **Application-specific**: Docker image hash, compose-hash, app-id |
| `report_data` | 64-byte custom field (your nonce/challenge) |
| `tee_tcb_svn` | Security patch level |

### 6-Step Verification Process

1. Validate the attestation report's cryptographic signature
2. Verify the certificate chain to Intel's trusted root CA
3. Check hardware values (MRSEAM, TCB) against known-good baseline
4. Confirm system measurements (MRTD, RTMR0-2) match security policy
5. Validate application measurements in RTMR3 (compose-hash, app-id)
6. Verify `report_data` matches expected challenge-response values

### Phala Attestation Bundle

Every dstack job produces a JSON attestation bundle containing: code hash, image ID, node signature, timestamps. Can be verified programmatically or attached to output artifacts.

### Mnemo Implications

- Before entering a negotiation room, each agent can demand the other's attestation report
- A client can verify that the Mnemo negotiation harness is running the expected code (not a modified version that leaks private state)
- The `report_data` field can contain a commitment hash (e.g., hash of the agent's initial private state)
- Attestation can be posted on-chain as proof that a negotiation occurred in a valid TEE

---

## 6. GPU TEE

### Available Hardware

| GPU | Memory | Bandwidth | On-Demand $/hr | Reserved $/hr | Status |
|---|---|---|---|---|---|
| **NVIDIA H100** | 80 GB HBM3 | 3 TB/s | $3.08 | $2.38 (6mo+) | Available |
| **NVIDIA H200** | 141 GB HBM3e | 4.8 TB/s | $3.50 | $2.56 (6mo+) | Available |
| **NVIDIA B200** | 192 GB HBM3e | 8 TB/s | $7.99 | $5.63 (6mo+) | Available |

- Scale from 1 to 8 GPUs per instance
- All GPUs include Intel TDX + NVIDIA Confidential Computing
- Minimum billing: 24 hours on-demand
- Performance overhead: < 5% for most workloads
- 10-15% price premium over non-TEE GPU instances

### Running Local LLMs Inside the Enclave

Yes, this is fully supported. Use cases:
- Deploy a model via CVM+GPU with SSH access
- Use pre-configured Confidential AI Models with OpenAI-compatible APIs
- Run vLLM, Ollama, or any inference server as a Docker container inside the CVM

### Mnemo Implications

For a hackathon, GPU TEE is likely **overkill and expensive** ($74+/day minimum). Better approach:
- Run Mnemo's negotiation harness on a **CPU-only CVM** (much cheaper)
- Have agents call **Venice API** (official hackathon partner) for inference via outbound HTTPS
- If you need to demonstrate fully private inference, an H100 CVM running a small model (e.g., Llama 3.1 8B via vLLM) would work but costs ~$74/day minimum

---

## 7. Outbound Networking

### Can the TEE make outbound HTTPS calls?

**Yes.** Phala enclaves include secure outbound call gateways. Applications inside the CVM have standard network access — they can:

- Call external REST APIs (Venice API for inference)
- Connect to blockchain RPC endpoints (Base RPC for settlement)
- Fetch data from any HTTPS endpoint
- All outbound traffic is encrypted at the network level

### RA-HTTPS

dstack provides automatic RA-HTTPS wrapping with content-addressing domains on `*.dstack.host`. This means:
- External clients connecting to your CVM get TLS + remote attestation in one step
- The TLS certificate is bound to the TEE attestation report

### Mnemo Implications

- Agents can call Venice API for private inference from inside the TEE
- The state manager can call Base RPC to submit settlement transactions
- Lit Protocol SDK calls for conditional decryption will work
- No special configuration needed — standard `fetch()` / `requests.get()` / `http.Get()` work

---

## 8. Storage

### Encrypted Volumes

- All data volumes are encrypted with **LUKS** (Linux Unified Key Setup)
- Decryption keys are only unsealed inside the TEE after successful remote attestation
- The KMS derives disk encryption keys deterministically — same app identity gets same keys

### Crash Recovery

- dstack checkpoints encrypted state periodically
- If a node fails, a new CVM can resume from the last checkpoint
- Keys are re-derived from KMS (not stored locally), so a fresh CVM on different hardware can decrypt the previous state
- The LUKS-encrypted volume persists across CVM restarts

### Security Note

There was a documented [security advisory](https://github.com/Dstack-TEE/dstack/security/advisories/GHSA-jxq2-hpw3-m5wf) regarding LUKS2 persistent storage — an attacker with host access could modify the volume encryption cipher to `cipher_null-ecb` (plaintext). This has been patched.

### Mnemo Implications

- Negotiation state (conversation tree, forks, private reveals) can be persisted to an encrypted volume
- If the CVM crashes mid-negotiation, the state is recoverable on restart
- Docker volumes (e.g., `negotiation-data:/data` in the compose file) are automatically LUKS-encrypted

---

## 9. ERC-8004 Reference Implementation

### Phala Has One

Phala maintains an official [ERC-8004 TEE Agent](https://github.com/Phala-Network/erc-8004-tee-agent) reference implementation that combines on-chain identity registration with TEE attestation.

### What ERC-8004 Provides

Three on-chain registries:

| Registry | Address (Sepolia) | Purpose |
|---|---|---|
| **Identity** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | ERC-721 NFT-based agent identity. Resolves to agent's registration file. |
| **Reputation** | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | On-chain feedback and trust scores. |
| **Validation** | TBD | Validator contracts (zkML, TEE oracles, stake-secured re-execution). |

### TEE Registry Extension

Phala's implementation adds a **TEE Registry** that binds agent identities to verified TEE attestation reports. This means:
- An agent's on-chain identity is cryptographically linked to the TEE it runs in
- Verifiers can confirm the agent is running expected code in a genuine enclave
- Prevents key-copying or environment-spoofing attacks

### Registration Flow

1. Fund the TEE-derived wallet address
2. Mint an identity NFT on the Identity Registry
3. Initialize reputation on the Reputation Registry
4. Post TDX attestation to the TEE Registry
5. Agent is now discoverable and verifiable on-chain

### ERC-8004 Went Live on Mainnet

As of January 29, 2026, ERC-8004 is live on Ethereum mainnet.

### Mnemo Implications

- Each Mnemo agent can register as an ERC-8004 identity before entering a negotiation room
- The room can verify both agents' TEE attestations via the TEE Registry
- Reputation scores from past negotiations could feed into the Reputation Registry
- This provides the "on-chain identity verification on entry" that the Mnemo architecture calls for

---

## 10. VibeVM

### What It Is

VibeVM is a **development environment** running inside a real CVM on Phala Cloud. When deployed, it spins up a VSCode Server with a repository already cloned, giving you a full IDE inside a TEE.

### Features

- VSCode server running inside a Confidential VM
- GitHub integration for cloning repos
- Full Docker support within the CVM
- TEE attestation available during development
- Deploy to production CVM when ready

### How to Use

1. Go to [cloud.phala.com/templates/VibeVM](https://cloud.phala.com/templates/VibeVM)
2. Deploy a VibeVM instance
3. Configure with GitHub credentials
4. Develop inside the TEE

### Relevance to Mnemo

**Moderate.** VibeVM is primarily a development tool, not a production runtime. It could be useful for:
- Rapid prototyping of the negotiation harness inside a real TEE
- Testing attestation flows without deploying a full CVM
- Demoing at the hackathon (show code running inside a verified TEE in real-time)

For production, you would deploy via `docker-compose.yml` + `phala cvms create`.

---

## Summary: Mnemo on Phala — Feasibility Assessment

| Requirement | Supported? | Notes |
|---|---|---|
| Two agents as separate processes | Yes | Docker Compose multi-container in same CVM |
| Shared state between agents | Yes | Inter-container networking via service names |
| Private state per agent | Yes | Derived keys are app-path-specific |
| Conversation forking/rewinding | Yes | Implement in state-manager, persist to encrypted volume |
| Key persistence across restarts | Yes | KMS derives deterministic keys from app identity |
| Remote attestation | Yes | TDX quotes via guest agent, verifiable by clients |
| Outbound HTTPS (Venice, Base RPC) | Yes | Standard networking, no restrictions |
| ERC-8004 identity on entry | Yes | Phala has reference implementation |
| Encrypted storage | Yes | LUKS volumes, automatic |
| GPU for local inference | Yes but expensive | $74+/day minimum, probably use Venice API instead |
| Lit Protocol integration | Yes | Outbound HTTPS to Lit nodes works from TEE |

### Recommended Hackathon Stack

```
┌─ Phala Cloud CVM (CPU-only, ~$X/day) ──────────────────┐
│                                                          │
│  agent-a (Node.js/Python)                                │
│    ├─ Private state (memory)                             │
│    ├─ TEE-derived signing key (/mnemo/a/sign)            │
│    └─ Venice API calls for inference                     │
│                                                          │
│  agent-b (Node.js/Python)                                │
│    ├─ Private state (memory)                             │
│    ├─ TEE-derived signing key (/mnemo/b/sign)            │
│    └─ Venice API calls for inference                     │
│                                                          │
│  state-manager (Node.js/Python)                          │
│    ├─ Negotiation state tree (git-like DAG)              │
│    ├─ Fork/branch/rewind operations                      │
│    ├─ Encrypted persistence (LUKS volume)                │
│    └─ Attestation: proves state integrity                │
│                                                          │
│  redis (shared state backend)                            │
│                                                          │
│  /var/run/dstack.sock (guest agent)                      │
│    ├─ Key derivation for each service                    │
│    └─ Attestation quotes for external verification       │
│                                                          │
└──────────────────────────────────────────────────────────┘
         │                    │
    Venice API           Base RPC
   (inference)         (settlement)
```

---

## Key SDK Reference

### TypeScript: `@phala/dstack-sdk`

```bash
npm install @phala/dstack-sdk
```

```typescript
import { TappdClient } from '@phala/dstack-sdk';

const client = new TappdClient();                           // production
// const client = new TappdClient('http://localhost:8090');  // simulator

// Key derivation
const key = await client.getKey('/path/to/key');

// Attestation
const quote = await client.getQuote(reportData);  // reportData: up to 64 bytes

// TLS certificates
const tlsKey = await client.getTlsKey();

// Signing
const sig = await client.sign(message, 'secp256k1');
```

### Python: `dstack-sdk`

```bash
pip install dstack-sdk
```

```python
from dstack_sdk import TappdClient

client = TappdClient()                                      # production
# client = TappdClient("http://localhost:8090")             # simulator

key = client.get_key("/path/to/key")
quote = client.get_quote(report_data)
```

### Go: `github.com/Dstack-TEE/dstack/sdk/go`

```bash
go get github.com/Dstack-TEE/dstack/sdk/go
```

### Raw HTTP (curl)

```bash
# Key derivation
curl --unix-socket /var/run/dstack.sock http://localhost/prpc/Tappd.GetKey \
  -d '{"path": "/mnemo/agent-a/signing"}'

# Attestation quote
curl --unix-socket /var/run/dstack.sock http://localhost/prpc/Tappd.GetQuote \
  -d '{"report_data": "<base64>"}'
```

---

## Sources

- [dstack overview (Phala docs)](https://docs.phala.com/dstack/overview)
- [dstack GitHub (Phala fork)](https://github.com/Phala-Network/dstack)
- [dstack GitHub (upstream Dstack-TEE)](https://github.com/Dstack-TEE/dstack)
- [dstack zero trust framework blog post](https://phala.com/posts/dstack-a-zero-trust-framework-for-confidential-containers)
- [Phala Cloud CLI overview](https://docs.phala.com/phala-cloud/phala-cloud-cli/overview)
- [GPU TEE pricing](https://phala.com/gpu-tee)
- [H100 GPU TEE](https://phala.com/gpu-tee/h100)
- [H200 GPU TEE](https://phala.com/gpu-tee/h200)
- [TDX attestation reports guide](https://phala.com/posts/understanding-tdx-attestation-reports-a-developers-guide)
- [Get attestation (docs)](https://docs.phala.com/phala-cloud/attestation/get-attestation)
- [ERC-8004 TEE Agent (GitHub)](https://github.com/Phala-Network/erc-8004-tee-agent)
- [ERC-8004 EIP](https://eips.ethereum.org/EIPS/eip-8004)
- [Deploy ERC-8004 agent with VibeVM](https://phala.com/posts/deploy-erc-8004-tee-agent-phala-vibevm)
- [VibeVM template](https://cloud.phala.com/templates/VibeVM)
- [VibeVM GitHub](https://github.com/Phala-Network/VibeVM)
- [dstack SDK (npm)](https://www.npmjs.com/package/@phala/dstack-sdk)
- [dstack SDK (Go README)](https://github.com/Dstack-TEE/dstack/blob/master/sdk/go/README.md)
- [dstack security audit](https://phala.com/posts/dstack-completes-security-audit-a-milestone-for-confidential-cloud)
- [LUKS2 security advisory](https://github.com/Dstack-TEE/dstack/security/advisories/GHSA-jxq2-hpw3-m5wf)
- [Docker Compose CVM deployment](https://docs.phala.network/phala-cloud/phala-cloud-user-guides/create-cvm/create-with-docker-compose)
- [dstack FAQs](https://docs.phala.com/dstack/faqs)
