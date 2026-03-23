# Mnemo

Private negotiation rooms with scoped reveals -- SQL transactions for sensitive information.

Mnemo is a protocol for autonomous vulnerability disclosure where **information is only revealed if the protocol commits funds**. A researcher agent discovers a vulnerability, but the protocol learns nothing about it until they lock payment into escrow. If the vulnerability is verified, the researcher is paid automatically. If it's not real, the protocol is refunded. No trust required from either side.

The researcher agent runs inside a TEE (hardware enclave) with read-only chain access. It cannot sign transactions, cannot leak data, and cannot communicate outside the negotiation protocol.

**Live on Base Sepolia.** Formally specified in Quint (15 invariants, 10k traces clean).

---

## The Problem

Bug bounty programs are structurally adversarial. The researcher must reveal the vulnerability to prove it is real, but once revealed, they lose all leverage. Protocols can patch-and-deny, dispute valid findings, or simply not pay.

This is not hypothetical. A researcher found a critical vulnerability in Injective's exchange module (full TVL drain via `MsgBatchUpdateOrders`). Injective had moved between platforms (Cantina to ImmuneFi). The researcher submitted, got ghosted, was offered a lower severity, and was never paid. The only recourse was public disclosure — which risks legal action and harms the ecosystem. The platform's incentive is to keep the *protocol* happy, not the researcher.

Meanwhile, AI is making this worse from the other direction. Model providers like OpenAI restrict agents from performing security research because there is no technical distinction between finding a vulnerability and exploiting one — only intent, which providers cannot verify. This means legitimate security research with AI agents is being blocked by blanket policies, while the actual attack surface grows.

Mnemo solves both sides: it gives researchers a provably safe channel to disclose, and it gives AI agents a sandboxed environment where security research is structurally constrained to responsible disclosure.

The incentive structure needs to change so that:
- The researcher can prove a vulnerability is real without revealing how to exploit it
- Payment is automatic and enforceable, not discretionary
- Neither party can cheat after the fact
- AI agents can do security research within verifiable safety constraints

## The Solution

Mnemo solves this with three mechanisms:

**1. Escrow-gated information reveal.** This is the core primitive. The researcher's agent signals it has a finding (a `DisclosureIntent` — no details, just "I found something"). The protocol must fund an on-chain escrow to learn what it is. No payment, no information. The block is pinned at intent time so the protocol can't patch first and dispute later.

**2. TEE-secured negotiation rooms.** Both agents negotiate inside a Phala dstack enclave with hardware-encrypted memory (Intel TDX). Neither party — nor the host operator — can read the other's data. The researcher reveals vulnerability details only inside the room, only after escrow is funded. If negotiation fails, the enclave is destroyed and nothing leaks.

**3. Automated verification and settlement.** The TEE runs verification (currently forge tests, but the arbiter is pluggable). If the vulnerability is confirmed, escrow releases payment automatically. If invalid, the protocol is refunded. No human arbitration, no disputes.

Additional guarantees:
- **Pinned block**: pinned at DisclosureIntent time — the protocol cannot patch-then-dispute
- **RTMR[3] attestation**: the exact code running in the TEE is cryptographically bound to the attestation — change one byte, attestation fails
- **Network isolation**: the researcher agent has read-only RPC access, cannot sign transactions, cannot communicate outside the room
- **Privacy separation**: registry and escrow are independent on-chain — observers cannot correlate which listing a disclosure belongs to

## Architecture

```
                                  TEE Enclave (Phala dstack)
                                 +--------------------------+
                                 |                          |
  Protocol registers on-chain    |  Researcher    Protocol  |
  with bounty terms + source     |    Agent   <-->  Agent   |
           |                     |      |            |      |
           v                     |      v            v      |
  +------------------+           |  [Forge Verify]  [Eval]  |
  |  MnemoRegistry   |           |      |            |      |
  |  (Base Sepolia)  | <---------+      +-----+------+      |
  +------------------+  discover |            |             |
                                 +------------|-------------+
                                              |
                                              v
                                    +------------------+
                                    |  MnemoEscrow     |
                                    |  (Base Sepolia)  |
                                    +------------------+
                                              |
                                    +---------+---------+
                                    |                   |
                               [Release]           [Refund]
                                    |                   |
                                    v                   v
                            +---------------+  +---------------+
                            | MnemoReputation|  |  (no rep hit) |
                            |  (ERC-8004)   |  +---------------+
                            +---------------+
                                    |
                                    v
                              [IPFS Archive]
```

**10-step pipeline:**

1. **Setup** -- initialize local devnet and services
2. **Identity** -- register agent identities via ERC-8004
3. **Attestation** -- generate TDX attestation (RTMR[3] binds Docker image)
4. **Registry** -- protocol registers on MnemoRegistry with bounty terms
5. **Discovery** -- researcher agent polls registry events, scores targets
6. **Audit** -- LLM analyzes contract source, generates vulnerability hypothesis
7. **Verification** -- forge runs exploit test + patched test = cryptographic proof
8. **Negotiation** -- turn-based dialogue in TEE room, scoped reveals
9. **Settlement** -- escrow auto-releases on forge pass, auto-refunds on fail
10. **Post-settlement** -- reputation posted to ERC-8004, evidence archived to IPFS

## What We Shipped

**Contracts (Base Sepolia)**
- `MnemoEscrow` ([0x22Fd1c1cbF21c17627239dB5f59bfb5FE371F6da](https://sepolia.basescan.org/address/0x22Fd1c1cbF21c17627239dB5f59bfb5FE371F6da)) -- TEE-resolved escrow with blind commitment hashes, permissionless expiry
- `MnemoRegistry` ([0xc42BE1d5aBeB130Ee5D671611685C58fd8eA99E3](https://sepolia.basescan.org/address/0xc42BE1d5aBeB130Ee5D671611685C58fd8eA99E3)) -- protocol discovery with on-chain bounty advertising
- `MnemoReputation` ([0x5674Efd049790cd1Cb059dD2b42dc4791a8086f3](https://sepolia.basescan.org/address/0x5674Efd049790cd1Cb059dD2b42dc4791a8086f3)) -- ERC-8004 reputation with asymmetric detail (researcher sees severity, protocol sees outcome only)
- 40 passing tests (18 escrow + 8 reputation + 14 registry)

**Autonomous Researcher Agent**
- 5-phase loop: discover, plan, execute, verify, submit
- Background agent that polls MnemoRegistry for new protocols
- LLM-powered vulnerability analysis with streaming (Venice API)
- Tested against DVDeFi challenge suite -- found SideEntrance reentrancy blind in ~30s

**Verification Pipeline**
- Pluggable arbiter design — current implementation uses forge, but the escrow contract accepts any TEE-attested verdict
- Wired into the negotiation flow (verification result auto-triggers escrow resolution)

**Negotiation Rooms**
- Turn-based agent dialogue with scoped reveals
- Room manager orchestrates the full 10-step pipeline
- PubSub event streaming to frontend via WebSocket

**TEE Integration**
- Phala dstack attestation (RTMR[3], compose hash verification)
- Docker Compose topology: simulator + harness + E2E containers
- Deterministic builds for exact attestation binding

**Frontend**
- React 19 + Tailwind v4
- Live WebSocket streaming of all pipeline events
- 10-step pipeline tracker, audit panel, escrow state display

**Formal Specification**
- Quint spec: 7 modules (types, negotiation, session, attestation, context, properties, scenarios)
- 15 protocol invariants verified across 10k random traces
- Protocol spec v3 (scoped reveals) and v4 (Vegas Room / black box TEE model)

**Supporting Infrastructure**
- Venice E2EE client (reverse-engineered ECDH + HKDF + AES-256-GCM protocol)
- IPFS archival of evidence with deterministic CIDs
- ERC-8004 on-chain identity for agents
- Effect-based architecture throughout (typed errors, DI, streaming)

## How to Run

### Prerequisites

- [Bun](https://bun.sh) (runtime)
- [Foundry](https://getfoundry.sh) (forge + anvil)
- A Venice API key ([venice.ai](https://venice.ai))

### Quick Start (Local)

```bash
# Clone and install
git clone https://github.com/Eduardogbg/mnemo
cd mnemo && bun install

# Terminal 1: start local devnet
anvil

# Terminal 2: start the web demo
VENICE_API_KEY=your_key bun run packages/web/src/server.ts

# Open http://localhost:3000
# The autonomous agent starts polling the registry
# Select a challenge to trigger the full 10-step pipeline
```

### With Live Contracts (Base Sepolia)

```bash
# Add to .env
ESCROW_ADDRESS=0x22Fd1c1cbF21c17627239dB5f59bfb5FE371F6da
ERC8004_ADDRESS=0x5674Efd049790cd1Cb059dD2b42dc4791a8086f3
REGISTRY_ADDRESS=0xc42BE1d5aBeB130Ee5D671611685C58fd8eA99E3
RPC_URL=https://sepolia.base.org

VENICE_API_KEY=your_key bun run packages/web/src/server.ts
```

### CLI Demo (E2E Discovery)

```bash
VENICE_API_KEY=your_key bun run packages/researcher/src/experiments/e2e-discovery.ts
```

### Contract Tests

```bash
cd contracts && forge test -vv
```

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (Effect for typed FP, DI, streaming) |
| Ethereum | voltaire-effect, Foundry (forge/anvil) |
| TEE | Phala dstack (Intel TDX, RTMR[3] attestation) |
| Inference | Venice API (private, no data retention) |
| Identity | ERC-8004 (on-chain agent reputation) |
| Frontend | React 19, Tailwind v4, WebSocket |
| Formal spec | Quint |
| Chain | Base Sepolia |

## Package Structure

| Package | Purpose |
|---------|---------|
| `@mnemo/core` | Agent, Provider, State, Errors, shared tool types |
| `@mnemo/harness` | Room (negotiation turn loop), verifier/prover tools |
| `@mnemo/chain` | ERC-8004, EscrowClient, RegistryClient, attestation, IPFS |
| `@mnemo/researcher` | AutonomousAgent (5-phase loop), ExecutionLog, researcher tools |
| `@mnemo/dvdefi` | Foundry service (build/test/script), Devnet (Anvil lifecycle) |
| `@mnemo/verity` | EvmClient, invariant checking, PoC scripts |
| `@mnemo/verifier` | Hybrid verification pipeline (forge + RPC invariants), LLM toolkit |
| `@mnemo/venice` | Venice E2EE provider for @effect/ai |
| `@mnemo/web` | React 19 frontend + Effect HttpApi server |

## Responsible Disclosure

Mnemo is designed for responsible disclosure, not exploitation. The researcher agent:

- **Cannot execute transactions.** TEE sandbox blocks `eth_sendRawTransaction`. The agent has read-only chain access.
- **Must go through the negotiation protocol.** There is no mechanism to exfiltrate findings outside the room.
- **Cannot leak data on abort.** If negotiation fails, the TEE enclave is destroyed. Hardware-level memory wipe, not software deletion.
- **Escrow ensures fair payment.** Both parties have skin in the game. The protocol funds escrow before seeing details; the researcher gets paid only if the vulnerability is real.
- **Evidence is archived.** All disclosures are recorded on IPFS for transparency and auditability.
- **Reputation is on-chain.** ERC-8004 feedback incentivizes honest behavior. Bad actors accumulate negative reputation that follows their agent identity.

## Caveats

- The DVDeFi challenge contracts (SideEntrance, etc.) are well-known vulnerabilities likely present in LLM training data. The agent finding them is a valid proof of mechanism, not a proof of novel discovery capability.
- On-chain TDX quote verification is not implemented. The demo uses hash commitment (Option C from the design doc). Production would need a DCAP verifier or attestation oracle.
- Venice inference is private (no data retention) but not TEE-protected on the standard endpoint. Production deployment would use Redpill (GPU-TEE) or Venice E2EE models.

## Built At

[The Synthesis Hackathon](https://synthesis.devfolio.co), March 13--22, 2026.