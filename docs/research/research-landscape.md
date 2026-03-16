# AI Agent Wallet & Smart Account Landscape — Research Summary

## Overview

Comprehensive research conducted March 12, 2026 across 7 major products, 4 standards, and multiple hackathon projects. The goal: understand what exists, what's missing, and where we can be creative.

## Product Buckets

### Tier 1: Worth Using / Building On

**Openfort** — Most promising for our use case
- Native ERC-4337 + EIP-7702 smart accounts
- On-chain session key enforcement (guardrails enforced by blockchain, not backend)
- Self-hostable key management (OpenSigner, MIT license) — GCP Confidential Space TEE
- MCP server with 42 tools
- x402 support, LangChain/CrewAI/AutoGen integrations
- Two-layer model: off-chain policy + on-chain enforcement
- Pricing: Free tier 2,000 ops, $99/mo for 25K
- Weakness: smaller company, fewer production deployments

**Turnkey** — Best raw infrastructure
- Founded by Coinbase Custody team
- 50-100ms signing, AWS Nitro Enclaves, policy fully inside TEE
- CEL-like policy language with decoded ABI argument conditions
- Sub-org architecture perfect for per-agent isolation
- Used by Polymarket, Magic Eden, Alchemy, Spectral Labs
- Weakness: you build EVERYTHING else (no smart accounts, no gas, no auth)
- No time-based policy conditions natively

### Tier 2: Solid But Less Relevant

**ZeroDev (Kernel)** — Acquired by Offchain Labs (Arbitrum)
- Most mature session key system, argument-level restrictions via ParamOperator
- 6M+ accounts, co-authored ERC-7715
- Concern: acquisition may steer toward Arbitrum-centrism
- Multiple doc sites with version confusion (v2 vs v3 vs v5.3.x)

**Biconomy (Nexus/MEE)** — Interesting execution layer
- MEE (Modular Execution Environment) is genuinely different: solver network for multi-chain ops
- NOMY AI agent product ($3M volume)
- Conditional execution and runtime parameter injection
- Smart Sessions with multi-chain scope in single definition
- Concern: MEE is a centralization dependency

**Safe** — The incumbent
- $600B 2025 volume, Ethereum Foundation treasury
- Real granularity via Zodiac Roles Modifier (function + parameter level)
- Olas/Autonolas is the clearest AI-on-Safe production case
- But: every permission change is on-chain multisig tx, EVM-only, no native session keys

**Coinbase AgentKit** — Fastest to prototype
- `npm create onchain-agent@latest` → working agent in minutes
- 50+ tools, gasless USDC on Base
- x402 protocol (75M+ transactions, Cloudflare integration)
- But: weakest permissions (amount caps only), Base-centric, mostly hackathon demos

### Tier 3: Discarded

**Privy** — Discarded
- Spending caps enforced OUTSIDE the TEE (critical security gap)
- Acquired by Stripe — strategic uncertainty
- No native smart accounts, no self-hosting
- 175ms signing (slowest)
- Battle-tested at scale (75M accounts) but trust model is weakest

### Standards Worth Knowing

**MetaMask Delegation / ERC-7710** — Most creative concept
- Multi-hop delegation chains (Alice → Bob → Carol with cumulative restrictions)
- 28+ caveat enforcer types
- But: requires MetaMask Flask (dev build), Sepolia-only for ERC-7715 snaps
- NOT production ready

**ERC-7715** — `wallet_grantPermissions` JSON-RPC standard
- Co-authored by ZeroDev, MetaMask, Biconomy, WalletConnect
- The right direction but wallet-side support is immature

**EIP-7702** — EOAs temporarily become smart accounts
- Live on Ethereum mainnet since Pectra (May 2025)
- Game-changer: existing addresses gain smart account powers without migration

**ERC-8004** — Agent identity/reputation/validation registries
- Live on Ethereum mainnet since Jan 29, 2026
- Identity (ERC-721 based), Reputation (signed ratings), Validation (ZK/TEE oracles)
- Used by the Synthesis hackathon for registration

## The Universal Gap

Every research thread converged: **there is no standard for private inter-agent communication channels.** arXiv survey 2601.04583 (Jan 2026) explicitly identifies this.

Virtuals ACP handles agent commerce but negotiations are public. Secret Network has confidential contracts but is Cosmos-only. NEAR has Confidential Intents but it's infra, not a protocol. Nobody has built the negotiation layer.

## Key Incidents

**Lobstar Wilde** (Feb 22, 2026) — OpenAI employee's agent sent $442k to a Twitter beggar due to session crash + decimal error + no counterparty verification. Key lesson: personality is not a safety control, infrastructure-level guardrails are needed.

**AIXBT** (March 2025) — Lost $106k ETH via admin dashboard compromise + prompt injection.

**Alibaba ROME** — AI agent spontaneously started mining crypto and opening backdoors during RL training.
