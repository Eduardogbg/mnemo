# ERC Critique & Partner-Bounty Alignment

> Honest assessment: which ERCs to integrate, which to name-drop, which to skip.

---

## The Honest Classification

### INTEGRATE FOR REAL

| ERC | Why | Partners Behind It |
|---|---|---|
| **ERC-8004** (Trustless Agents) | Genuine identity/reputation gap. Live on mainnet since Jan 29 2026. Authors: Marco De Rossi (MetaMask/Consensys), Davide Crapis (EF dAI lead), Erik Reppel (Coinbase). Three registries are lightweight, composable, not overengineered. The problem is real — no standardized agent discovery/identity across platforms. | MetaMask, EF, Coinbase, ENS |
| **EIP-7702** (EOA Account Code) | Live mainnet infra (Pectra, May 2025). Vitalik co-authored. Lets agent EOAs gain smart account features without deploying contract wallets. Use it if it simplifies escrow settlement — it's a protocol feature, not something you "integrate." | Base, MetaMask (broadly) |

### NAME-DROP FOR BOUNTY ALIGNMENT

| ERC | Why | Partners |
|---|---|---|
| **ERC-8183** (Agentic Commerce) | Use for final deal settlement, but don't force the negotiation into its state machine. Only 3 weeks old (Feb 25 2026). Clean design (Client/Provider/Evaluator + hooks), but it's literally Virtuals' internal ACP wrapped in an ERC number. Nobody outside Virtuals uses it yet. | **Virtuals Protocol** (authors are Virtuals team), EF (Davide Crapis co-authored) |
| **ERC-7710** (Delegation) | Mention delegation patterns for agent permissions. Experimental, Sepolia-only. Dan Finlay (MetaMask co-founder) co-authored. "Conforming to the standard" = "using MetaMask's toolkit" — they're basically the same thing. | **MetaMask** |
| **ERC-7715** (Grant Permissions) | Companion to 7710. `wallet_grantPermissions` RPC. Designed for browser-wallet-to-dApp flows, not TEE agent authorization. Square peg, round hole. Mention as "future work." | **MetaMask** |

### LOW-EFFORT BOUNTY GRABS

| Standard | Why | Partners |
|---|---|---|
| **x402** (HTTP Payments) | Not an ERC but a Coinbase/Cloudflare open protocol. Mature (100M+ payments, live since May 2025). The Merit Systems bounty ($1,750) wants x402 as load-bearing, OpenServ ($5,000) lists "x402-native services." If Mnemo exposes any HTTP endpoint, slapping x402 on it is straightforward and hits two bounties. | **Merit Systems** (AgentCash), **OpenServ** |
| **ERC-8128** (Ethereum Web Auth) | Per-request HTTP auth using Ethereum signatures. Pairs with ERC-8004 for auth+authz. Slice bounty is small ($500) but the integration is genuinely useful for agent-to-TEE authentication -- better than sessions for server-side agents. Low effort, real value. | **Slice** |

### SKIP

| ERC | Why |
|---|---|
| **ERC-4337** (Account Abstraction) | Overkill for server-side TEE agents. Up to 5.5x gas overhead for validation. Your agents are not user-facing wallets needing gas sponsorship. Use EIP-7702 if you need smart account features. |
| **ERC-7579** (Modular Smart Accounts) | For smart account module builders (Biconomy, ZeroDev, Safe). Not for application-layer projects. No relevant Synthesis partner behind it. |

---

## Per-ERC Deep Critique

### ERC-8004 — Verdict: Real

The problem is real. AI agents have no standardized way to discover each other, verify identity, or build reputation across platforms. Every platform (Virtuals, Olas, etc.) has its own siloed identity. ERC-8004 fills the gap.

Design is reasonable: three registries are lightweight and composable. Identity is just an ERC-721 pointing to a JSON agent card — not overengineered. Reputation is simple (address submits rating + tags). Validation is the most ambitious piece (TEE attestation, zkML) but optional.

**Weaknesses:** Reputation has no built-in Sybil resistance (anyone can rate). Validation registry is underspecified. "Pluggable trust models" = "we haven't decided what works."

**But:** Authors are credible (MetaMask, EF, Coinbase, Google). Live on mainnet. Phala has a reference implementation binding it to TEE attestation. This is the most legitimate standard on the list.

### ERC-8183 — Verdict: Premature but Useful

Clean state machine (Open → Funded → Submitted → Terminal). Hook system is well-designed. Evaluator role adds genuine value over two-party escrow.

**But:** 3 weeks old. Nobody outside Virtuals uses it. The evaluator is a single trusted party — just moves the trust problem. The standard says "use reputation for high-value roles" which is circular (need reputation to trust evaluator, evaluator generates reputation).

**The real concern:** This is Virtuals converting their internal ACP to an ERC for legitimacy. Not inherently bad — many good standards started this way. But it reflects Virtuals' architecture, not necessarily the best abstraction.

**For Mnemo:** Your negotiation rooms are more sophisticated than job-escrow. Use ERC-8183 for the settlement format of completed deals. Don't contort your architecture to fit it.

### ERC-4337 — Verdict: Skip for Us

Solves a genuine problem (EOAs are terrible for programmatic use). 40M+ smart accounts deployed. Not bullshit.

But for server-side agents in TEEs: the overhead isn't justified. You don't need bundler infrastructure, gas sponsorship, or UserOperations. Your agents can sign transactions directly from TEE-derived keys.

### EIP-7702 — Verdict: Background Infra

Genuinely useful, not ceremony. Lets EOAs execute smart contract code within a single transaction. Use it if your escrow settlement benefits from batching. Not something to highlight for bounties — no partner gives bounties specifically for 7702.

### ERC-7579 — Verdict: Irrelevant

Real standard with real adoption (Safe, Biconomy, ZeroDev). But it's for smart account infrastructure builders. You're building negotiation rooms, not wallet modules.

### ERC-7710 — Verdict: Interesting Concept, Not Ready

The concept is right: scoped delegation of capabilities with revocation. Maps to "agent negotiates with scoped permissions." But it's experimental (Sepolia-only), and it's really "MetaMask's API with an ERC number."

Write your own scoped-permission logic. Structure it so you could adopt 7710 later if it matures.

### x402 — Verdict: Easy Win, Real Protocol

Not an ERC. An open HTTP-level payment protocol from Coinbase + Cloudflare. Uses the HTTP 402 status code that was reserved for "Payment Required" since 1997 but never standardized until now.

The protocol is mature: 100M+ payments processed, V2 launched, integrated into Google's Agent Payments Protocol (AP2), neutral governance foundation established. Supports ERC-20 on Base, Polygon, and Solana. Micropayments down to $0.001.

**For Mnemo:** Two concrete integration paths:
1. **Consume** -- Agent inside TEE uses AgentCash MCP server to call x402 APIs (data enrichment, external lookups during negotiation). This hits the Merit Systems bounty.
2. **Produce** -- Mnemo room endpoints (e.g., "get public offer summary," "request attestation") are themselves x402-payable. Counterparty agent pays per request. This hits the OpenServ bounty.

Path 2 is more novel and more aligned with Mnemo's "controlled reveal" model -- information has a price, literally.

**Risk:** The AgentCash MCP server is the expected integration for Merit Systems. If we don't use AgentCash specifically, we may not qualify for that bounty despite using x402 generally.

### ERC-8128 — Verdict: Small Bounty, Genuine Fit

Per-request HTTP authentication using Ethereum account signatures. The anti-SIWE: no sessions, every request is self-authenticating. Includes timestamps, TTLs, and nonces.

**For Mnemo:** This is actually the right auth model for agents talking to TEE endpoints. An agent signs each request with its Ethereum key. The TEE verifies the signature, checks the address against the ERC-8004 Identity Registry, and admits or rejects. No session management, no API keys, no cookies. Each request proves provenance.

**Weakness:** Very new, from the Slice team. The bounty is small ($500 in Slice product credits, not cash). But the implementation cost is low (HTTP middleware that verifies signatures), and the architecture alignment is genuine.

**Recommended:** Implement as the auth layer for Mnemo room HTTP endpoints. Small effort, clean design, pairs with ERC-8004 naturally.

### ERC-7715 — Verdict: Wrong Abstraction for Us

Designed for browser-wallet ↔ dApp permission flows. Our agents operate inside TEEs — the trust boundary is the enclave, not a browser wallet. Forcing this pattern is a waste of time. Mention it as "future UX work."

---

## Bounty Strategy

**Maximum coverage with minimum integration overhead (target 8-9 partner bounties):**

1. **ERC-8004** (real integration) — register agents, reputation post-negotiation, TEE validation → Protocol Labs tracks
2. **Venice API** (real integration) — private inference in rooms → Venice track
3. **Lit Protocol** (real integration) — conditional decryption for room access → Lit track
4. **Self** (real integration) — ZK identity verification on entry → Self track + "Agents that Keep Secrets"
5. **Base** (real integration) — deploy escrow/commitment contracts → Base track
6. **ERC-8183** (light integration) — settlement format for deals → Virtuals track
7. **ERC-7710/7715** (name-drop) — mention delegation patterns → MetaMask track ($5,000)
8. **x402** (light integration) — expose room endpoints as x402-payable, or use AgentCash for external API calls → Merit Systems ($1,750) + OpenServ ($5,000)
9. **ERC-8128** (light integration) — HTTP auth middleware for agent-to-TEE requests, pairs with ERC-8004 → Slice ($500 in credits)

---

## Partner Bounty Details (Best Available)

Specific bounty amounts are **not centrally published**. The hackathon has deliberately not released a consolidated bounty table. What's known:

| Partner | Estimated Range | What They Want | Mnemo Relevance |
|---|---|---|---|
| **Venice** | Has $27M ecosystem incentive fund | Use Venice API for inference, privacy-first AI | Critical |
| **Lit Protocol** | $5-10K typical (gave $10K at HackFS 2024) | Sign/decrypt within Lit Actions, conditional decryption | Critical |
| **Self (self.xyz)** | Unknown; $9M raised, active bounty program | ZK identity verification, Sybil resistance | High |
| **MetaMask** | Unknown; has Delegation Toolkit hacker guide | Use ERC-7710/7715, AI agent permissions | Medium |
| **Base** | $10-25K typical at major hackathons | Deploy on Base | High |
| **Olas** | $15K at ETH Lisbon 2025; typically 4 tracks | Build with Olas SDK, Mechs marketplace | Medium |
| **Virtuals** | Unknown; co-authored ERC-8183 | Agent commerce, use ACP | High |
| **Phala** | Not official sponsor but has hackathon guides | TEE deployment, confidential computing | Critical |
| **Merit Systems** | $1,750 (3 tiers: $1K/$500/$250) | Use AgentCash to consume x402 APIs; pay-per-request must be load-bearing | Medium |
| **Slice** | $2,200 across 3 tracks (ERC-8128: $500 credits) | Use ERC-8128 as auth primitive | Low-Medium |
| **ENS** | $1,500 across 3 tracks | Name resolution, agent discovery, communication | Low |
| **Uniswap, Celo, Lido** | Various | Various | Low to None |
| **Superrare, Locus, Talent Protocol, Status, Frutero, Ampersend, Bankr** | Various | Various | None |

---

## Sources

- [ERC-8004 EIP](https://eips.ethereum.org/EIPS/eip-8004), [Contracts](https://github.com/erc-8004/erc-8004-contracts), [Phala TEE Agent](https://github.com/Phala-Network/erc-8004-tee-agent)
- [ERC-8183 EIP](https://eips.ethereum.org/EIPS/eip-8183)
- [EIP-7702 EIP](https://eips.ethereum.org/EIPS/eip-7702)
- [ERC-7579 EIP](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-7710 EIP](https://eips.ethereum.org/EIPS/eip-7710)
- [ERC-7715 EIP](https://eips.ethereum.org/EIPS/eip-7715)
- [MetaMask Delegation Toolkit](https://docs.metamask.io/smart-accounts-kit/concepts/delegation/)
- [Venice $27M Incentive Fund](https://venice.ai/blog/venice-launches-27m-incentive-fund-to-advance-private-uncensored-ai-apps-agents-infrastructure)
- [Composable Security: ERC-8004 Explainer](https://composable-security.com/blog/erc-8004-a-practical-explainer-for-trustless-agents/)
- [x402 Official Site](https://www.x402.org/)
- [x402 GitHub (Coinbase)](https://github.com/coinbase/x402)
- [x402 Coinbase Developer Docs](https://docs.cdp.coinbase.com/x402/welcome)
- [ERC-8128 Specification](https://eip.tools/eip/8128)
- [ERC-8128 Discussion (Ethereum Magicians)](https://ethereum-magicians.org/t/erc-8128-signed-http-requests-with-ethereum/27515)
