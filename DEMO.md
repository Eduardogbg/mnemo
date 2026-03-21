# Mnemo — CLI Demo Guide

## Prerequisites

- Docker + Docker Compose
- Bun (v1.3+)
- Foundry (`forge`, `anvil`, `cast`)
- API keys in `.env` (VENICE_API_KEY required, OPENROUTER_API_KEY optional)

## Quick Start (3 Terminals)

### Terminal 1: Infrastructure

```bash
# Start TEE simulator
cd infra/dstack
docker compose --env-file ../../.env up -d dstack-simulator

# Start local Ethereum devnet
anvil --block-time 1 &

# Optional: start IPFS
docker compose --env-file ../../.env up -d ipfs

# Check everything is up
docker compose ps
curl -s -X POST http://localhost:8090/prpc/Tappd.TdxQuote \
  -H 'Content-Type: application/json' \
  -d '{"report_data":"'$(openssl rand -hex 32)'"}' | head -c 100
echo "...OK"

cast chain-id --rpc-url http://localhost:8545
```

### Terminal 2: TEE Attestation Demo

```bash
bun run scripts/demo-attestation.ts
```

Shows:
1. **Valid TDX quote** — 4/4 structural checks pass (TDX type, signature, event log, RTMR[3])
2. **Nonce freshness** — different nonces → different REPORTDATA (replay protection)
3. **Tampered RTMR[3]** — modified code identity → **REJECTED**
4. **Sandbox explanation** — compose hash enforces read-only RPC + air-gapped analysis

### Terminal 3: Full E2E Discovery-to-Settlement

```bash
# Source .env and run from researcher package
set -a && source .env && set +a
cd packages/researcher
bun run src/experiments/e2e-discovery.ts
```

This runs the complete Mnemo flow:
1. **Register** a protocol on the local MnemoRegistry
2. **Discover** — agent polls registry, finds new protocol
3. **Analyze** — agent sends contract source to DeepSeek (via Venice) for blind audit
4. **Detect** — keyword scoring on LLM response (finds reentrancy, critical severity)
5. **Disclose** — DisclosureIntent via TEE gateway (no details leaked)
6. **Negotiate** — prover vs verifier agents in Room (up to 6 turns)
7. **Settle** — if accepted: escrow created, funded by protocol, auto-released after verification

### Optional: RPC Sandbox Demo

```bash
# Start read-only RPC proxy
cd infra/dstack
docker compose --env-file ../../.env up -d rpc-proxy

# READ works through proxy
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://localhost:8546

# WRITE is blocked
cast send 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --value 1ether \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://localhost:8546
# → ERROR: Method eth_sendRawTransaction is blocked by TEE sandbox policy
```

### Optional: Contract Deployment (Base Sepolia)

```bash
# Deploy MnemoRegistry + MnemoEscrow + MnemoReputation
forge script contracts/script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_KEY \
  --broadcast --verify
```

## Demo Flow

```
Protocol registers on MnemoRegistry (on-chain)
         │
         ▼
Agent polls registry every 3 min (nextProtocolId)
         │
         ▼
New protocol found → fetch metadata → LLM audits source
         │
         ▼
Vulnerability found → DisclosureIntent via TEE gateway
  (researcherAgentId + protocolId + timestamp ONLY — no details)
         │
         ▼
Protocol notified → funds escrow (GATE — no payment = no details)
         │
         ▼
TEE room opens → researcher submits exploit code
         │
         ▼
TEE runs forge verification at PINNED BLOCK
         │
    ┌────┴────┐
    ▼         ▼
  PASS      FAIL
    │         │
    ▼         ▼
AUTO-RELEASE  AUTO-REFUND
(researcher)  (protocol)
```

## Key Talking Points

1. **TEE + Forge = Automated Arbiter** — No dispute resolution. Exploit works at pinned block → auto-pay.

2. **Escrow is Access Control** — Protocol pays to learn the vulnerability. No payment = no details.

3. **Attestation = Code Identity** — RTMR[3] binds to exact Docker Compose hash. Modified code → different keys → attestation fails. Agent cannot exfiltrate or sign.

4. **Read-Only Sandbox** — RPC proxy allows `eth_call`, blocks `eth_sendRawTransaction`. Network-level enforcement inside TEE.

5. **Agent Identity (ERC-8004)** — On-chain registration on Base Sepolia. Reputation posted after each bounty.

6. **Pinned Block** — Block number pinned at DisclosureIntent time. Protocol can't patch-then-dispute.

## Cleanup

```bash
cd infra/dstack
docker compose down -v
# Kill background anvil
kill %1 2>/dev/null
```
