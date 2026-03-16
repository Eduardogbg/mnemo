# Synthesis Hackathon — Sponsors & Strategy

## Timeline
- March 9: Partner bounties went live
- **March 13: Building starts (TOMORROW)**
- March 18: Agentic judging feedback
- March 22: Building closes
- March 25: Winners announced

## Official Partners (25+)

### Directly Relevant to Our Project
- **Venice** (venice.ai) — Privacy-focused AI inference, 26 fully private models, OpenAI-compatible API. Official partner. Use for private inference inside TEE rooms.
- **Lit Protocol** — Programmable key management, threshold cryptography. Official partner. Use for room access control and conditional decryption.
- **Self** (self.xyz) — Identity verification without exposing personal data. Mentioned in "Agents that keep secrets" theme.
- **MetaMask** — Delegation toolkit, ERC-7710/7715. Official partner.
- **Base** — Settlement layer. Official partner.
- **Olas** — Autonomous agent framework. Could be used for agent orchestration.
- **Virtuals Protocol** — Agent commerce (ACP). Our project addresses their gap (public negotiations).

### Other Partners
- Uniswap, Celo, Lido DAO, ENS, Filecoin/Protocol Labs
- Superrare, Locus, Merit Systems, Talent Protocol, Status Network, Slice, Frutero
- Ampersend, Bankr
- Devfolio (platform), Bonfires, Ethereum Foundation

### Not Official But Ecosystem-Critical
- **Phala Network** — TEE infrastructure, ERC-8004 TEE agent reference impl. Not listed as official sponsor but has deployment templates and docs specifically for this hackathon.

## Prize Structure
- **Synthesis Open Track** — shared prize across the event, aligned to 4 themes
- **Partner Tracks** — per-partner prizes for using their tools
- Specific amounts not yet publicly indexed (went live March 9)

## Judging Criteria
1. Ship something that works (demos, prototypes, deployed contracts)
2. Agent must show meaningful contribution
3. On-chain artifacts = stronger submission
4. Open source required
5. Document human-agent collaboration via conversationLog

## Our Track Alignment

| Theme | How We Hit It | Strength |
|---|---|---|
| Agents that keep secrets | TEE rooms, nothing leaks on failed negotiation | Primary |
| Agents that trust | ERC-8004 identity proofs, credible commitments | Primary |
| Agents that cooperate | Negotiation protocol, escrow, forking | Strong |
| Agents that pay | Conditional payment on information exchange | Secondary |

## Partner Bounty Strategy

Maximize by integrating:
1. **Venice** — private inference inside negotiation rooms
2. **Lit Protocol** — room access keys, conditional decryption of deal terms
3. **Base** — escrow contract deployment, ERC-8004 identity
4. **Self** — identity verification for human-backed agents
5. **ERC-8004** — built into registration, use reputation registry for post-deal ratings

## On-Chain Artifacts We'll Produce
- ERC-8004 agent registration (done via hackathon registration)
- Escrow smart contract on Base
- Commitment log contract (records agreed deals)
- Reputation updates post-negotiation
- TEE attestation proofs
