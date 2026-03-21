# Mnemo — Demo Guide

## Prerequisites

- Docker + Docker Compose
- Bun (v1.3+)
- Foundry (`forge`, `anvil`)
- [damn-vulnerable-defi](https://github.com/tinchoabbate/damn-vulnerable-defi) cloned to `repos/damn-vulnerable-defi`
- API keys in `.env` (VENICE_API_KEY required, OPENROUTER_API_KEY optional)

## Quick Start

### 1. Start infrastructure

```bash
# Start IPFS + TEE simulator
docker compose -f infra/dstack/docker-compose.yml --env-file .env up -d ipfs dstack-simulator

# Start local Ethereum devnet (background)
anvil --block-time 1 &
```

### 2. Run the E2E demo

```bash
set -a && source .env && set +a
cd packages/researcher
bun run demo
```

The script runs preflight checks and will tell you exactly what's missing if anything isn't set up.

## What the demo does

```
 1. Setup          — wire local layers (Registry, Escrow, ERC-8004, ExecutionLog)
 2. Identity       — register protocol + researcher agents (ERC-8004)
 3. Attestation    — compute composeHash, generate TDX quote, bind RTMR[3]
 4. Registry       — register a protocol (SideEntrance challenge) on MnemoRegistry
 5. Discovery      — agent polls registry, finds new active protocol
 6. LLM Audit      — blind audit via Venice (llama-3.3-70b), no hints given
 7. Forge Verify   — exploit test PASSES + patched test PASSES → VALID_BUG
 8. Negotiation    — prover vs verifier agents in Room (up to 6 turns)
 9. Settlement     — escrow: create → fund → TEE auto-release (forge already proved it)
10. Post-settle    — reputation feedback, IPFS archival, execution log flush
```

### TEE Attestation Demo (optional)

```bash
bun run scripts/demo-attestation.ts
```

Shows: valid TDX quote (4/4 checks), nonce freshness (replay protection), tampered RTMR[3] (rejected).

### RPC Sandbox Demo (optional)

```bash
# Start read-only RPC proxy
docker compose -f infra/dstack/docker-compose.yml --env-file .env up -d rpc-proxy

# READ works through proxy
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://localhost:8546

# WRITE is blocked
cast send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --value 1ether \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://localhost:8546
# → ERROR: Method eth_sendRawTransaction is blocked by TEE sandbox policy
```

## Demo Flow

```
Protocol registers on MnemoRegistry (on-chain)
         │
         ▼
Agent polls registry every 3 min (nextProtocolId)
         │
         ▼
New protocol found → fetch metadata → LLM audits source (hypothesis)
         │
         ▼
LLM finds vuln → forge runs exploit + patched tests (proof)
         │
         ▼
VALID_BUG → DisclosureIntent via TEE gateway
  (researcherAgentId + protocolId + timestamp ONLY — no details)
         │
         ▼
Protocol notified → funds escrow (GATE — no payment = no details)
         │
         ▼
TEE room opens → prover presents forge evidence → verifier evaluates
         │
    ┌────┴────┐
    ▼         ▼
ACCEPTED    REJECTED
    │         │
    ▼         ▼
AUTO-RELEASE  AUTO-REFUND
(researcher)  (protocol)
    │
    ▼
Reputation + IPFS archive
```

## Key Talking Points

1. **TEE + Forge = Automated Arbiter** — No dispute resolution. Exploit works at pinned block → auto-pay.

2. **Escrow is Access Control** — Protocol pays to learn the vulnerability. No payment = no details.

3. **Attestation = Code Identity** — RTMR[3] binds to exact Docker Compose hash. Modified code → different keys → attestation fails.

4. **Read-Only Sandbox** — RPC proxy allows `eth_call`, blocks `eth_sendRawTransaction`. Network-level enforcement inside TEE.

5. **Agent Identity (ERC-8004)** — On-chain registration. Reputation posted after each bounty.

6. **Pinned Block** — Block number pinned at DisclosureIntent time. Protocol can't patch-then-dispute.

## Output Files

- `agent_log.json` — structured execution log (24 entries across all phases)
- `agent.json` — agent manifest

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VENICE_API_KEY` | Yes* | Venice API key for LLM inference |
| `OPENROUTER_API_KEY` | No | Fallback LLM provider (may hit weekly limits) |
| `IPFS_API` | No | IPFS API endpoint (default: `http://localhost:5001`) |
| `IPFS_GATEWAY` | No | IPFS gateway URL (default: `http://localhost:8080`) |

\* Either VENICE_API_KEY or OPENROUTER_API_KEY must be set.

## Cleanup

```bash
docker compose -f infra/dstack/docker-compose.yml down -v
kill %1 2>/dev/null  # background anvil
```
