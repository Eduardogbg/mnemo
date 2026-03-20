# TEE Submission Architecture — Mnemo Bug Disclosure

> Design document. March 20, 2026.
> Covers: TEE attestation model, code submission format, protocol registration, communication channels, Docker Compose topology, and end-to-end deployment flow.

---

## 1. TEE Attestation

### 1.1 What Does dstack Attestation Actually Prove?

A dstack TDX attestation quote proves two things simultaneously:

1. **Code integrity** -- the exact software stack running inside the Confidential VM, from firmware through OS through application containers, matches a set of cryptographic measurements.
2. **Data confidentiality** -- the VM's memory is hardware-encrypted by Intel TDX. No entity outside the CVM (including the host operator, Phala, or anyone with physical access to the machine) can read the VM's RAM.

The quote does NOT prove that the application behaves correctly in a logical sense. It proves that the code you can inspect (by rebuilding the Docker image and checking hashes) is the code that is actually running, and that its runtime memory is encrypted.

### 1.2 What Is in the Quote?

The TDX attestation quote is a binary structure (TDX Quote v4) containing a TD Report signed by Intel TDX hardware. The fields that matter for Mnemo:

| Field | Size | What It Measures |
|---|---|---|
| `MRTD` | 48 bytes | Initial measurement of the Trust Domain -- the CVM image itself (dstack-os Yocto image) |
| `RTMR[0]` | 48 bytes | Hardware and firmware components |
| `RTMR[1]` | 48 bytes | Kernel measurements |
| `RTMR[2]` | 48 bytes | Boot configuration, command line parameters |
| `RTMR[3]` | 48 bytes | **Application layer**: Docker image hashes, docker-compose.yaml hash, app-id. This is the register we care about most. |
| `REPORTDATA` | 64 bytes | Arbitrary data chosen by the application at quote-generation time. We put our nonce, agent address, or commitment hash here. |
| `TEE_TCB_SVN` | 16 bytes | Security patch level of the TDX firmware |

The signature chain leads back to Intel's root CA, which is the hardware root of trust.

### 1.3 Can We Attest for EXACTLY a Certain Docker Image?

**Yes, with caveats.** Here is how the trust chain works:

```
Intel TDX hardware (root of trust)
  -> MRTD: measures the CVM guest OS image (dstack-os, Yocto-based, dm-verity)
    -> RTMR[0-2]: firmware, kernel, boot config
      -> RTMR[3]: Docker Compose hash + individual image hashes
        -> REPORTDATA: application-chosen (nonce, address, etc.)
```

RTMR[3] is extended (hash-chained) with:
1. The SHA-256 hash of the `docker-compose.yaml` file
2. The image hashes of each container referenced in the compose file
3. Custom events emitted by the application via `client.emitEvent()`

So: if you know the expected `docker-compose.yaml` and the expected image digests, you can verify RTMR[3] against them. The attestation proves this exact compose file with these exact images is running. Changing a single byte in the compose file or using a different image tag changes RTMR[3].

**The caveat**: the dstack-os image (MRTD) and the boot chain (RTMR[0-2]) are controlled by Phala. You trust that Phala's published dstack-os image is what they say it is. In practice, dstack-os is open source (Yocto meta-dstack layer) and was audited by zkSecurity in 2025. For the hackathon, this trust assumption is entirely reasonable.

### 1.4 On-Chain Verification

On-chain verification of TDX quotes is possible but non-trivial:

**Option A: On-chain quote parsing (expensive, complex)**
- Deploy a Solidity contract that parses the TDX Quote v4 binary format, verifies the ECDSA signature against Intel's root CA, and checks RTMR[3] against a registered expected value.
- This is expensive in gas and requires maintaining Intel's CA certificate chain on-chain.
- Projects like Automata Network have done this (their DCAP attestation verifier on Ethereum), but it is not something we should build from scratch for the hackathon.

**Option B: Attestation oracle (pragmatic for hackathon)**
- An off-chain verifier checks the TDX quote against Intel's PCCS (Provisioning Certificate Caching Service).
- The verifier posts a summary on-chain: "Quote verified. RTMR[3] = X. Agent address = Y. Timestamp = Z."
- The on-chain contract trusts the verifier. This is the standard pattern for TEE attestation in DeFi today.

**Option C: Hash commitment (what we actually do for the demo)**
- The agent computes `sha256(docker-compose.prod.yml)` and posts that hash on-chain alongside its ERC-8004 identity.
- Anyone can download our public compose file, hash it, and compare.
- The TDX quote (available via the `/attestation` endpoint) binds RTMR[3] to this hash.
- Full on-chain quote verification is out of scope for March 22. We demonstrate the attestation flow and show that the binding exists. Production would add Option A or B.

### 1.5 The Mnemo Attestation Flow

```
1. Protocol or verifier sends a nonce (random 32 bytes) to the agent.
2. Agent calls client.getQuote(sha256(nonce + agentAddress)).
3. Quote contains:
   - RTMR[3]: proves this compose file and these images are running
   - REPORTDATA: proves this specific nonce was used (freshness)
4. Verifier checks:
   a. TDX signature chain -> Intel root CA (proves genuine TDX hardware)
   b. RTMR[3] matches expected compose hash (proves sandbox policy)
   c. REPORTDATA contains expected nonce hash (proves freshness)
   d. TEE_TCB_SVN is above minimum (proves patched firmware)
5. If all checks pass: this agent is running our code, in a real TEE, right now.
```

---

## 2. Code Submission Format

### 2.1 Submission Options and Tradeoffs

The ethical hacker agent needs to analyze protocol code. There are several ways a protocol can provide its code:

| Format | Pros | Cons | Complexity |
|---|---|---|---|
| **On-chain bytecode + verified source (Etherscan/Sourcify)** | No trust in protocol; code is public fact. Agent fetches independently. | Verified source may lag deployments. Flattened single-file loses project structure. | Low |
| **Git repo URL** | Full project structure, build scripts, tests. Best for deep analysis. | Protocol must grant access. Agent needs outbound git (network policy complication). Repo may not match deployed code. | Medium |
| **tar.gz archive** | Self-contained, can include full project. No network access needed to receive. | Must verify archive matches deployed bytecode. Large archives cost bandwidth inside TEE. | Medium |
| **Single .sol file** | Simplest possible submission. | Useless for real protocols -- everything has imports. | Low (but useless) |
| **Foundry project directory** | Ideal for the agent's tooling (forge, cast, anvil). Includes tests, scripts, dependencies. | Protocol must package correctly. Larger payload. | Medium-High |

### 2.2 Recommended Approach: Hybrid (Hackathon)

For the hackathon, we use a two-tier approach:

**Tier 1 (automated, default): On-chain bytecode + verified source**
- The agent reads deployed bytecode via `eth_getCode` through the read-only RPC proxy.
- The agent fetches verified source from Sourcify (fully open, no API key needed) or Etherscan API.
- This requires zero protocol cooperation. The agent can analyze any verified contract.
- Limitation: flattened source loses import structure. Some analysis tools need the full project.

**Tier 2 (protocol-initiated): Foundry project archive**
- When a protocol registers with Mnemo for a retainer or submits to a bounty, they upload a tar.gz of their Foundry project.
- The archive is loaded into the TEE's air-gapped analysis network (Anvil + Forge + Slither).
- The agent verifies the archive compiles to the same bytecode as the deployed contract.

### 2.3 Submission Schema

```typescript
interface CodeSubmission {
  // Required: identifies the target
  contracts: {
    address: string          // 0x... deployment address
    chain: string            // "base" | "ethereum" | "arbitrum" | ...
    label: string            // human-readable name ("LendingPool")
  }[]

  // Option A: just addresses (agent fetches code independently)
  // No additional fields needed. Agent uses eth_getCode + Sourcify.

  // Option B: source archive
  archive?: {
    url?: string             // IPFS CID or HTTPS URL to tar.gz
    sha256: string           // hash of the archive for integrity check
    format: "foundry"        // project type
  }

  // Required metadata for verification
  compiler: {
    version: string          // "0.8.24"
    optimizer?: {
      enabled: boolean
      runs: number           // 200
    }
    evmVersion?: string      // "cancun"
  }

  // Optional: constructor args for re-deployment verification
  constructorArgs?: {
    address: string
    args: string             // ABI-encoded constructor arguments
  }[]

  // Required: who submitted this
  submitter: {
    address: string          // EOA or multisig that signed this submission
    signature: string        // EIP-712 signature over the submission hash
  }
}
```

### 2.4 Dependency Handling

Dependencies (OpenZeppelin, Solmate, etc.) are handled differently per tier:

- **Tier 1 (verified source)**: Dependencies are already flattened into the verified source. No special handling needed.
- **Tier 2 (Foundry archive)**: The archive must include `lib/` or use `foundry.toml` remappings. The agent runs `forge build` inside the air-gapped analysis network. If the build fails due to missing dependencies, the submission is rejected. We do NOT allow the TEE to fetch dependencies from the internet -- that would break the air-gap and introduce supply chain risk. The archive must be self-contained.

### 2.5 What the Hackathon Demo Actually Does

For the demo, we skip the submission schema entirely. The agent analyzes a pre-configured Damn Vulnerable DeFi challenge (Side Entrance) that is already included in the Docker image. The submission schema is documented but not implemented as an API endpoint.

Post-hackathon, the submission schema becomes a real API on the `mnemo-harness` service, accepting POST requests with the above JSON format.

---

## 3. Protocol Registration

### 3.1 Identity Options

| Method | Trust Level | UX | Suitability |
|---|---|---|---|
| **On-chain address (EOA/multisig)** | High -- verifiable ownership | Requires wallet signature | Primary method |
| **ENS name** | High -- resolves to address, human-readable | Requires ENS setup | Nice-to-have, resolves to the above |
| **ERC-8004 identity** | Highest -- includes TEE attestation binding | Requires minting NFT | For protocols that also run agents |
| **Email + signature** | Low -- off-chain, not verifiable by third parties | Easy | Not recommended |

### 3.2 Recommended Registration Flow

**Step 1: On-chain registration (minimal)**

The protocol signs an EIP-712 message with their admin/multisig key:

```
ProtocolRegistration {
  name: "Aave v3"
  contracts: [0x..., 0x..., 0x...]
  bountyTerms: "ipfs://Qm..."  // link to bounty program terms
  contactEndpoint: "https://security.aave.com/mnemo"
  nonce: 12345
}
```

This signature is posted to the `MnemoRegistry` contract on Base. The contract stores the registration and emits an event.

**Step 2: Contract ownership verification**

How do we know the registrant actually controls the contracts they claim?

Relying solely on `owner()` is fragile. It does not work for protocols that burned their admin key, proxy contracts where `owner()` returns the proxy admin address rather than the protocol multisig, CREATE2 deployments where the deployer key was discarded, or multisigs where signers have rotated since deployment.

The registry accepts multiple proof types. The registrant provides an EIP-712 signature and declares which proof type applies:

- **owner() match**: `target.owner() == signer`. Covers simple Ownable contracts.
- **AccessControl admin role**: `target.hasRole(DEFAULT_ADMIN_ROLE, signer)`. Covers OpenZeppelin AccessControl patterns.
- **Safe signer**: `GnosisSafe(safeAddress).isOwner(signer)` where the Safe is the contract's owner or admin.
- **Deployer proof**: TEE verifies off-chain that the contract's creation transaction originated from `signer` and attests to this. Covers factory-deployed and CREATE2 contracts.

The proof type used is stored alongside the listing so agents can assess its strength.

**For the hackathon**: `owner()` match only. This covers DVDeFi challenge contracts. The multi-proof design is documented as the production target.

### 3.3 What Goes On-Chain vs Off-Chain

| Data | Location | Rationale |
|---|---|---|
| Protocol identity (address, name hash) | On-chain (MnemoRegistry) | Needs to be discoverable and verifiable |
| Contract addresses claimed | On-chain (MnemoRegistry) | Agent needs to look these up |
| Bounty terms (full document) | IPFS, hash on-chain | Too large for on-chain storage |
| Contact endpoint | On-chain (MnemoRegistry) | Agent needs to reach the protocol |
| Source code archive | IPFS, hash on-chain | Way too large for on-chain |
| Compiler settings | IPFS (part of bounty terms) | Paired with source archive |
| Disclosure history | On-chain (MnemoReputation) | Public reputation record |

### 3.4 Hackathon Scope

For March 22, we deploy MnemoRegistry on Base Sepolia. The agent discovers targets by polling `nextProtocolId`. Protocol registration uses `owner()` match proof type only. The full multi-proof design (AccessControl, Safe signer, deployer proof) is documented as the production target.

---

## 4. Communication Channel

### 4.1 Architecture: TEE as Intermediary

The agent and protocol do NOT communicate directly. All communication flows through the Mnemo room running inside the TEE. This is fundamental -- the TEE is the trusted third party that enforces the protocol rules.

```
Protocol's Agent                    Researcher's Agent
(runs anywhere)                     (runs in TEE)
     |                                    |
     |         ┌─────────────────┐        |
     |-------->| Mnemo Room      |<-------|
     |         | (inside TEE)    |        |
     |<--------| Enforces:       |------->|
     |         |  - scope rules  |        |
     |         |  - consent      |        |
     |         |  - attestation  |        |
     |         |  - data deletion|        |
     |         └─────────────────┘        |
     |                |                   |
     |                v                   |
     |         On-chain settlement        |
     |         (Base, escrow)             |
```

### 4.2 Transport Layer

**For the hackathon: WebSocket over TLS to the TEE's public endpoint.**

The Mnemo harness exposes a WebSocket server on port 3000. Phala's dstack-gateway provides TLS termination and gives the CVM a public URL: `https://<app-id>-3000.dstack-prod5.phala.network/`.

Both agents connect to this WebSocket endpoint. The room server inside the TEE manages turn-taking, scope operations, and state.

**Message format**: JSON over WebSocket. Each message is a protocol operation (message, open_scope, close_scope, promote, commit, abort) as defined in the protocol spec.

**Encryption**: TLS handles transport encryption. The TEE handles data-at-rest confidentiality. We do NOT need end-to-end encryption between agents because the TEE is the trusted intermediary -- both agents trust the room code (verified via attestation), and the room holds all state.

### 4.3 How the Researcher Agent Finds the Protocol

**Discovery flow:**

1. The ethical hacker agent polls `MnemoRegistry.nextProtocolId()` to discover new listings.
2. For each listing, it fetches the protocol metadata (contract address, bounty terms, source via metadataURI).
3. The agent analyzes the contract source via LLM (DeepSeek via Redpill).
4. If a vulnerability is found, the agent submits a DisclosureIntent to the TEE Gateway with a pinned block number.
5. The TEE Gateway creates an escrow on-chain and notifies the protocol via encrypted channel.
6. The protocol funds escrow. This triggers the TEE room to open.
7. The researcher submits exploit code inside the TEE. Forge verifies at the pinned block.
8. Forge passes -> auto-release. Forge fails -> auto-refund.

**For the hackathon**: This is the actual flow. No simplification needed -- the agent discovers via registry polling, not hardcoded targets.

### 4.4 How the Protocol Knows Findings Are Legitimate

Three verification layers:

1. **TEE attestation**: The protocol's agent can verify the researcher agent's TDX quote before entering the room. This proves the researcher is running the expected (audited, open-source) code in a real TEE with network isolation.

2. **In-room verification**: During negotiation, when the researcher reveals a PoC in a scope, the protocol's agent can independently verify it. The protocol agent runs the PoC against its own copy of the contract (on its own Anvil fork). The Mnemo protocol does not dictate how verification works -- it just provides the room for structured information exchange.

3. **On-chain reputation**: The researcher agent's ERC-8004 identity has a track record of previous disclosures. A researcher with 10 verified criticals is more credible than one with zero history.

### 4.5 Lit Protocol's Role

Lit Protocol is a hackathon partner. Its natural fit in Mnemo is **room access gating**:

- Before entering a Mnemo room, an agent must satisfy a Lit Access Control Condition.
- Example condition: "Agent must hold an ERC-8004 identity NFT with reputation score > 50 on Base."
- Lit's threshold network evaluates the condition without a single point of trust.
- If the condition is met, Lit releases a decryption key that unlocks the room's connection credentials.

**Concrete integration for the hackathon:**
- The room WebSocket endpoint is encrypted with a symmetric key.
- That key is encrypted to a Lit Access Control Condition.
- To connect, an agent must satisfy the Lit condition to decrypt the key.
- This replaces a simple API-key or signature check with a decentralized, programmable gate.

**If Lit integration proves too complex by March 22**, fall back to EIP-712 signature verification at the WebSocket handshake. The Lit integration is a "nice to have" that strengthens the sponsor story.

---

## 5. Docker Compose Architecture

### 5.1 Service Topology (Production TEE)

```
┌─────────────────────────────── Phala CVM (Intel TDX) ─────────────────────────────┐
│                                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐       │
│  │                    analysis network (internal, air-gapped)               │       │
│  │                                                                          │       │
│  │   ┌───────────┐     ┌───────────┐     ┌───────────────────────┐         │       │
│  │   │   Anvil   │     │ RPC Proxy │     │   mnemo-harness       │         │       │
│  │   │ (fork)    │     │ (r/o)     │     │                       │         │       │
│  │   │           │◄────│           │◄────│  - Researcher agent   │         │       │
│  │   │  :8545    │     │  :8545    │     │  - Room server        │         │       │
│  │   └───────────┘     └─────┬─────┘     │  - Attestation API    │         │       │
│  │                           │           │  - Forge/analysis     │         │       │
│  └───────────────────────────│───────────│───────────────────────│─────────┘       │
│                              │           │                       │                   │
│  ┌───────────────────────────│───────────│───────────────────────│─────────┐       │
│  │               egress-restricted network                       │         │       │
│  │                              │           │                    │         │       │
│  │                              │           │  outbound:         │         │       │
│  │                              │           │  - Redpill (LLM)   │         │       │
│  │                              └───────────│  - Base RPC (r/o)  │         │       │
│  │                      (upstream RPC)      │                    │         │       │
│  └──────────────────────────────────────────│────────────────────│─────────┘       │
│                                             │                    │                   │
│  ┌──────────────────────────────────────────│────────────────────│─────────┐       │
│  │               default network            │                    │         │       │
│  │                                          │                    │         │       │
│  │   ┌───────────────┐                      │                    │         │       │
│  │   │  mnemo-web    │◄─────────────────────┘                    │         │       │
│  │   │  (frontend)   │   (internal HTTP)                         │         │       │
│  │   │  :8080        │                                           │         │       │
│  │   └───────────────┘                                           │         │       │
│  └───────────────────────────────────────────────────────────────│─────────┘       │
│                                                                  │                   │
│  /var/run/tappd.sock  ◄─────────────────────────────────────────┘                   │
│  /var/run/dstack.sock   (TEE key derivation, attestation)                           │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
         │                        │
         │ :8080 (web UI)         │ :3000 (WebSocket, room API)
         ▼                        ▼
    dstack-gateway (TLS termination, public URL)
```

### 5.2 What Runs in the TEE?

| Service | In TEE? | Rationale |
|---|---|---|
| **mnemo-harness** (room + researcher agent + forge) | Yes | Core trusted component. Must be attested. |
| **Anvil** (local chain fork) | Yes | Analysis happens on air-gapped network. Data stays in TEE. |
| **RPC Proxy** (read-only allowlist) | Yes | Enforces sandbox policy. Part of attested compose. |
| **mnemo-web** (frontend + API) | Yes (same CVM) | Convenience. Could run outside TEE, but simpler to bundle. |
| **LLM inference** | No -- external (Redpill GPU-TEE) | Too expensive to run inside our CVM. Redpill provides its own TEE attestation for inference. |
| **IPFS** | No -- external | Not needed in TEE. Source archives can be pinned to public IPFS. Agent fetches via HTTPS. |
| **Slither/Echidna** | Aspirational | Would run in the analysis network if included in the Docker image. Not in hackathon scope due to image size. |

### 5.3 Minimal Trusted Base

The minimal set of services that MUST run in the TEE for the security properties to hold:

1. **mnemo-harness**: the room server, scope engine, and agent runtime.
2. **RPC proxy**: without this, the agent could call `eth_sendRawTransaction`.
3. **Anvil**: without air-gapped Anvil, the agent would need direct RPC access for simulation, weakening the sandbox.

The web frontend is NOT part of the trusted base. It could run outside the TEE and communicate with the harness over the internal network. We bundle it for simplicity.

### 5.4 Secrets Management

| Secret | How It Enters the TEE | Who Can See It |
|---|---|---|
| `REDPILL_API_KEY` | Phala sealed env vars (`phala envs set`) | Only the CVM. Encrypted at rest, decrypted by guest agent. |
| `OPENROUTER_API_KEY` | Phala sealed env vars | Only the CVM. Dev fallback for inference. |
| Agent signing key | Derived via `client.getKey('/mnemo/agent/signing')` | Only the CVM. Deterministic, hardware-bound. Never transmitted. |
| Room encryption key | Derived via `client.getKey('/mnemo/room/<id>/encryption')` | Only the CVM. Per-room, deterministic. |
| Escrow private key | **Does not exist in TEE.** Escrow is funded by the protocol externally. | N/A |

**Critical design choice**: the TEE contains NO mainnet private keys for value transfer. The agent's TEE-derived key is used only for signing attestations and protocol messages. Escrow funding and bounty payouts happen outside the TEE, initiated by the protocol's multisig based on the committed deal terms.

### 5.5 Service Communication Map

```
mnemo-harness
  -> Anvil (analysis network, internal): fork queries, simulation
  -> RPC Proxy (analysis network, internal): read-only chain state
  -> Redpill API (egress-restricted, outbound HTTPS): LLM inference
  -> Base RPC (via RPC Proxy, read-only): chain state for analysis
  -> /var/run/tappd.sock: key derivation, attestation quotes

RPC Proxy
  -> Upstream RPC (egress-restricted, outbound HTTPS): Base Sepolia archive node
  -> Rejects: eth_sendRawTransaction, eth_sendTransaction, eth_sign, personal_sign

Anvil
  -> (no outbound): air-gapped. Initial fork state loaded at boot from RPC Proxy.

mnemo-web
  -> mnemo-harness (default network, internal HTTP): API calls to room/agent
```

---

## 6. Deployment Flow

### 6.1 End-to-End Lifecycle

```
PHASE 1: SETUP (before any bugs are found)
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Build Docker images                                              │
│    - mnemo-harness (agent runtime, forge, room server)              │
│    - mnemo-rpc-proxy (read-only RPC allowlist)                      │
│    - mnemo-web (frontend, optional)                                 │
│    Push to ghcr.io                                                  │
│                                                                     │
│ 2. Deploy CVM to Phala Cloud                                       │
│    phala cvms create --compose docker-compose.prod.yml \            │
│      --vcpu 2 --memory 4096 --env-file .env.sealed                 │
│    Returns: app-id, public URL                                      │
│                                                                     │
│ 3. Verify attestation                                               │
│    bun run verify-sandbox.ts --compose docker-compose.prod.yml      │
│    -> Produces expected RTMR[3] hash                                │
│    Fetch /attestation from the CVM -> compare RTMR[3]              │
│                                                                     │
│ 4. Register agent identity (ERC-8004 on Base Sepolia)               │
│    Mint identity NFT with:                                          │
│      - Docker image hash                                            │
│      - TEE attestation hash                                         │
│      - Agent's TEE-derived address                                  │
│                                                                     │
│ 5. (Optional) Protocol registers on MnemoRegistry                   │
│    Protocol submits: contracts, bounty terms, contact endpoint      │
└─────────────────────────────────────────────────────────────────────┘

PHASE 2: ANALYSIS (continuous, inside TEE)
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Agent selects target                                             │
│    - Reads registry for registered protocols, OR                    │
│    - Scans new deployments on monitored chains via read-only RPC    │
│    WHERE: inside TEE (mnemo-harness)                                │
│                                                                     │
│ 7. Agent fetches code                                               │
│    - eth_getCode via RPC Proxy (read-only)                          │
│    - Verified source from Sourcify (HTTPS, egress-restricted net)   │
│    WHERE: inside TEE (mnemo-harness -> RPC Proxy)                   │
│                                                                     │
│ 8. Agent analyzes                                                   │
│    - Compile with forge build (air-gapped analysis network)         │
│    - Fork target chain on Anvil (air-gapped)                        │
│    - Run forge test, invariant tests                                │
│    - LLM-assisted reasoning via Redpill (egress-restricted)         │
│    WHERE: inside TEE (analysis network, air-gapped)                 │
│                                                                     │
│ 9. Agent constructs PoC (if vulnerability found)                    │
│    - Write Foundry test demonstrating the exploit                   │
│    - Verify PoC passes on local Anvil fork                          │
│    - Calculate impact (max extractable value)                       │
│    WHERE: inside TEE (analysis network, air-gapped)                 │
└─────────────────────────────────────────────────────────────────────┘

PHASE 3: DISCLOSURE INTENT (TEE -> on-chain -> protocol)
┌─────────────────────────────────────────────────────────────────────┐
│ 10. Agent submits DisclosureIntent to TEE Gateway                   │
│     - Contains: agentId, protocolId, targetAddress, attestation     │
│     - pinnedBlock = current block number (SNAPSHOT for verification)│
│     - No severity, no details, no PoC — just "I have a finding"    │
│     WHERE: inside TEE (mnemo-harness)                               │
│                                                                     │
│ 11. TEE Gateway creates MnemoEscrow on-chain                       │
│     - create(funder=protocol, payee=researcher, amount=maxBounty,   │
│       deadline=now+48h, commitHash=keccak256(intentId))             │
│     WHERE: on-chain (Base)                                          │
│                                                                     │
│ 12. Protocol notified via encrypted channel                         │
│     - "Agent X has a finding for your contract. Fund escrow."       │
│     - Protocol's ONLY action: fund escrow or ignore                 │
│     - There is NO accept/reject button                              │
│     WHERE: encrypted notification (Lit Protocol or fallback)        │
└─────────────────────────────────────────────────────────────────────┘

PHASE 4: ESCROW GATE (on-chain)
┌─────────────────────────────────────────────────────────────────────┐
│ 13. Protocol funds escrow                                           │
│     - fund(escrowId) with maxBounty                                 │
│     - EscrowFunded event emitted                                    │
│     - THIS IS THE GATE: no funding = no details = researcher moves  │
│       on to next target                                             │
│     WHERE: on-chain (Base), initiated by protocol                   │
└─────────────────────────────────────────────────────────────────────┘

PHASE 5: VERIFICATION AND AUTO-SETTLEMENT (inside TEE, automated)
┌─────────────────────────────────────────────────────────────────────┐
│ 14. EscrowFunded event detected -> TEE room opens                   │
│     WHERE: inside TEE (watches on-chain events via read-only RPC)   │
│                                                                     │
│ 15. Researcher submits exploit code inside TEE room                 │
│     - Foundry test contract (the PoC)                               │
│     - The code stays inside the TEE — never exposed to protocol     │
│       until after verification                                      │
│     WHERE: inside TEE (mnemo-harness)                               │
│                                                                     │
│ 16. TEE runs forge verification                                     │
│     - Forks chain at pinnedBlock (from DisclosureIntent, step 10)   │
│     - NOT the current block — prevents protocol from patching       │
│       after seeing the intent and then claiming the exploit is      │
│       invalid on the patched code                                   │
│     - Deploys and executes the researcher's Foundry test            │
│     - forge test must PASS for the exploit to be valid              │
│     WHERE: inside TEE (analysis network, air-gapped Anvil fork)     │
│                                                                     │
│ 17a. Forge PASSES -> escrow AUTO-RELEASES                           │
│      - TEE calls release(escrowId)                                  │
│      - Payout sent to researcher's payee address                    │
│      - No human decision. Forge result is final.                    │
│      WHERE: on-chain (Base), initiated by TEE                       │
│                                                                     │
│ 17b. Forge FAILS -> escrow AUTO-REFUNDS                             │
│      - TEE calls refund(escrowId)                                   │
│      - Protocol gets money back                                     │
│      - No human decision. Forge result is final.                    │
│      WHERE: on-chain (Base), initiated by TEE                       │
│                                                                     │
│ 18. Reputation updated                                              │
│     - Researcher's ERC-8004 record updated: verified=true/false     │
│     - Disclosure record posted: payout, timestamp                   │
│     WHERE: on-chain (Base), MnemoReputation contract                │
│                                                                     │
│ 19. Room state destroyed. Only on-chain artifacts remain:           │
│     - Escrow record (Created -> Funded -> Released/Refunded)        │
│     - Reputation entries                                            │
│     - Commitment hash (verifiable but opaque)                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Upgrade and Restart

**CVM restart**: dstack supports CVM restart with state recovery. The KMS re-derives the same keys (deterministic from app identity). LUKS-encrypted volumes persist across restarts. In-progress room state survives if persisted to the encrypted volume.

**Image upgrade**: Upgrading the Docker image changes the image hash, which changes RTMR[3], which changes the TEE-derived keys. This is by design -- a new version is a new identity. The upgrade process:

1. Build and push new image
2. `phala cvms upgrade <app-id> --compose docker-compose.prod.yml`
3. CVM restarts with new image
4. New RTMR[3], new derived keys
5. Old room state is inaccessible (old keys no longer derivable)
6. Agent must re-register its attestation on-chain (new image hash)

**Implication**: upgrades during an active negotiation destroy the room state. For the hackathon this is fine -- rooms are short-lived. For production, you would need a migration protocol (commit or abort all active rooms before upgrading).

### 6.3 What the Hackathon Demo Actually Runs

Given March 22 deadline, here is what is real vs mocked:

| Component | Real | Mocked/Simulated |
|---|---|---|
| Docker Compose with network isolation | Real (runs in Docker) | TEE is simulated (dstack simulator) |
| RPC Proxy (read-only allowlist) | Real (functional Bun server) | |
| Anvil local fork at pinned block | Real | |
| Forge verification (compile, test at pinnedBlock) | Real | |
| MnemoRegistry (protocol registration) | Real (Base Sepolia) | |
| MnemoEscrow (auto-release/auto-refund) | Real (Base Sepolia) | |
| ERC-8004 identity | Real (Base Sepolia) | |
| Registry polling (nextProtocolId) | Real | |
| LLM analysis (DeepSeek via Redpill) | Real | |
| Escrow-gated room access | Real (watches EscrowFunded event) | |
| Auto-release on forge pass | Real (TEE calls release) | |
| Auto-refund on forge fail | Real (TEE calls refund) | |
| TEE attestation | Simulated (dstack simulator quotes) | Real Intel TDX quotes require Phala Cloud deployment |
| On-chain attestation verification | Mocked (hash comparison) | Full DCAP verification not implemented |
| Lit Protocol encryption | Stretch goal | Falls back to signature check |
| Protocol agent | Not implemented | Protocol is a human/script funding escrow |
| Severity negotiation | Not implemented | Flat escrow = maxBounty |
| Dispute resolution | Not implemented | Forge result is final |

---

## 7. Security Analysis: What Can Go Wrong

### 7.1 Threats the Architecture Handles

| Threat | Mitigation |
|---|---|
| Agent exploits a vulnerability it finds | No mainnet signing keys in TEE. RPC proxy blocks write methods. Network policy blocks arbitrary HTTP. |
| Agent leaks vulnerability to third party | Only output channel is Mnemo protocol. If scope closes / room aborts, data is destroyed. |
| Host operator reads TEE memory | Intel TDX hardware encryption. Memory is encrypted at the cache line level. |
| Modified Docker image deployed | RTMR[3] changes. Attestation check fails. Protocol's agent rejects the room. |
| Protocol ghosts after seeing PoC | Escrow must be funded before TEE room opens. No escrow, no details. Auto-release means protocol cannot ghost after funding. |
| Protocol patches then disputes | Block pinned at DisclosureIntent time. Forge runs against the snapshot, not current state. Patch is irrelevant to verification. |
| Researcher submits invalid exploit | Forge fails -> escrow auto-refunds. Protocol loses nothing. |

### 7.2 Threats the Architecture Does NOT Handle (Honest Assessment)

| Threat | Status | Mitigation Path |
|---|---|---|
| Side-channel leakage (timing, resource usage) | Acknowledged, not mitigated | Add jitter, quantize outputs (post-hackathon) |
| Intel TDX hardware vulnerability (new CVE) | Trust assumption | Monitor Intel advisories, upgrade firmware |
| Phala dstack-os compromise | Trust assumption | dstack-os is audited and open source |
| LLM inference provider sees prompts | Partially mitigated | Redpill provides GPU-TEE attestation for inference. Full mitigation requires self-hosted inference inside the CVM. |
| Escrow griefing (protocol funds escrow but never releases) | Handled | Auto-release on forge pass. Protocol has no release/reject decision. |
| Forge false positive (test passes but exploit is not real) | Not handled | Requires more sophisticated verification or human review (post-hackathon) |
| Forge false negative (test fails due to environment, not invalidity) | Not handled | Requires dispute resolution (post-hackathon) |
| Agent prompt injection via malicious contract code | Not handled | The agent analyzes arbitrary Solidity. A contract could contain comments designed to manipulate the LLM. Standard prompt injection problem. |

---

## 8. Summary: What to Build by March 22

**Must have (demo-critical):**
1. Docker Compose with three networks (analysis/egress-restricted/default) -- already done.
2. RPC Proxy with read-only allowlist -- already done.
3. Anvil fork service with pinned block support -- already done.
4. MnemoRegistry deployed on Base Sepolia -- agent polls `nextProtocolId` for discovery.
5. MnemoEscrow with auto-release/auto-refund -- TEE calls `release()` on forge pass, `refund()` on forge fail.
6. ERC-8004 identity minted on Base Sepolia.
7. TEE attestation flow (simulated) with `verify-sandbox.ts` -- already done.
8. One end-to-end flow: protocol registers -> agent discovers -> agent analyzes via LLM -> agent submits intent with pinned block -> protocol funds escrow -> TEE verifies with forge -> auto-release.

**Nice to have (strengthens demo):**
9. Lit Protocol for encrypted artifact access (escrow-gated decryption).
10. Real Phala Cloud CVM deployment (instead of simulator).
11. Web UI showing the flow in real-time.
12. IPFS storage for PoC artifacts.

**Post-hackathon:**
13. Full submission API (accepts CodeSubmission JSON).
14. On-chain DCAP attestation verification.
15. Dispute resolution (DAO/governance -- deliberately out of scope for hackathon).
16. Severity-tiered escrow (negotiation on payout amount).
17. Protocol agent (automated evaluation of disclosure intents).
18. Slither/Echidna integration in Docker image.
19. Duplicate detection (OPRF-based private set membership).

---

## 9. Scope for Hackathon

### Key Design Decisions

1. **TEE + forge is the automated arbiter.** There is no human decision in the verification and settlement phases. Forge pass = auto-release. Forge fail = auto-refund. This replaces the entire arbitration/dispute layer.

2. **Escrow is the access control mechanism.** The protocol's payment commitment (funding escrow) unlocks the information. No funding = no details revealed.

3. **Block is pinned at DisclosureIntent time.** The forge verification forks at the block recorded in the intent, not the current block. This prevents the protocol from patching the vulnerability after learning a disclosure exists and then claiming the exploit is invalid.

4. **Protocol has no reject button after funding.** Once escrow is funded, the forge result is final. The protocol cannot reject a valid exploit.

### Out of Scope (Future Work)

- **Dispute resolution**: Deliberately excluded. Adding appeals, arbitration, or DAO governance is a rabbit hole that distracts from the core demo. Acknowledged as necessary for production -- some edge cases (environment-dependent exploits, forge false positives/negatives) need human judgment.
- **Severity negotiation**: Escrow amount is flat (maxBounty from registry). Tiered payouts reintroduce negotiation complexity.
- **Scoped reveals / multi-turn negotiation**: The original Mnemo scope model is powerful but not needed for this flow. The room is submit-and-verify, not a conversation.
- **Protocol agent**: The protocol is a human or script that funds escrow. No automated protocol-side agent.
- **Anti-spam**: One researcher, one protocol in the demo.
