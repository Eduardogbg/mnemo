# Mnemo Bounty Fit Analysis -- Ranked by Natural Fit

### 1. Venice -- "Private Agents, Trusted Actions" -- $11,500 (VVV tokens)

**Fit score: 5/5**

**Why it fits:** This bounty reads like it was written for Mnemo. The description literally says: "confidential treasury management, private governance analysis, **deal negotiation agents**, onchain risk desks, and sensitive due diligence. **Agents that keep secrets. Agents that trust.**" It asks for agents that "reason over sensitive data without exposure, producing trustworthy outputs for public systems" and specifically calls out "private multi-agent coordination systems." Mnemo is exactly a private deal negotiation agent system with multi-agent coordination, where agents reason privately inside a TEE and produce on-chain commitments.

**Additional work needed:** Almost none beyond core. The harness design already uses the Venice API (OpenAI-compatible). The one nuance: your MEMORY.md notes that Venice inference is NOT actually private (GPU operators see plaintext) and you plan to use Redpill instead. For this bounty, you would need to use Venice's API (it is their bounty), but you can frame the TEE as the real privacy layer and Venice as the inference provider. The scope model, context reconstruction, and on-chain settlement are all exactly what they want.

**Caveat:** Prize is in VVV tokens, not cash. The strategic value is ongoing Venice compute access.

---

### 2. Protocol Labs -- "Agents With Receipts -- ERC-8004" -- $8,004

**Fit score: 4/5**

**Why it fits:** Mnemo already uses ERC-8004 for identity verification on room entry. The bounty asks for "systems that leverage ERC-8004, a decentralized trust framework for autonomous agents" with "identity, reputation, and/or validation registries via real onchain transactions." Mnemo's use case -- agents verify each other's identity before entering a private negotiation room, then build reputation based on negotiation outcomes (commit vs. abort) -- is a strong, natural application of ERC-8004. The bounty specifically encourages "multi-agent coordination."

**Additional work needed:** You need to implement actual ERC-8004 registration transactions (not just hardcoded identities as in the hackathon scope reduction). You need agent.json and agent_log.json files conforming to the DevSpot Agent Manifest spec. You need on-chain verifiability -- the ERC-8004 identity registration and any reputation updates must be viewable on a block explorer. This is real work but aligned with your architecture.

---

### 3. Protocol Labs -- "Let the Agent Cook -- No Humans Required" -- $8,000

**Fit score: 3.5/5**

**Why it fits:** Mnemo agents are fully autonomous during negotiation -- no human in the loop once the session starts. They discover (capability exchange), plan (private reasoning), execute (scope operations, reveals), verify (bilateral consent), and submit (on-chain commit). The bounty requires ERC-8004 identity (you have it), structured execution logs (your DAG is a natural log), tool use (on-chain transactions, inference API calls), and safety guardrails (protocol rule enforcement, the harness validates every action). The "multi-agent swarms with specialized roles" bonus maps to your two-agent negotiation.

**Additional work needed:** The bounty emphasizes a general-purpose autonomous agent, while Mnemo is a domain-specific negotiation runtime. You would need to frame it as "autonomous negotiation agents that operate end-to-end." You need agent.json (agent manifest), agent_log.json (execution logs), and compute budget awareness (your turn limit + LLM call tracking). The discover-plan-execute-verify-submit loop maps, but you would need to demonstrate it clearly maps to Mnemo's session lifecycle.

**Risk:** The judges might want a more general-purpose agent (code generation, deployment, etc.) rather than a protocol-specific one. Mnemo is deeply autonomous but narrow.

---

### 4. Synthesis Community -- "Synthesis Open Track" -- $14,558.96

**Fit score: 3.5/5**

**Why it fits:** Open track, no constraints. Mnemo can be submitted as-is. The prize pool is the largest single prize. Community-funded, judges contribute. A genuinely novel primitive (scoped reveals with controlled forgetting) should stand out in an open track against derivative projects.

**Additional work needed:** None beyond building the core project. The challenge is standing out among all submissions, not fitting requirements.

**Risk:** Subjective judging, largest competition pool. But the formal spec (Quint, 15 invariants, 10k traces), the novel primitive, and the working demo together make a strong case.

---

### 5. MetaMask -- "Best Use of Delegations" -- $5,000

**Fit score: 3/5**

**Why it fits:** The bounty rewards "novel permission models" and "sub-delegations." Mnemo's scope model is structurally a delegation pattern: Agent A opens a scope (delegates access to information), which can be unilaterally revoked. The bounty specifically calls out "intent-based delegations as a core pattern" and "ZK proofs with delegation-based authorization." You could implement room entry authorization via MetaMask Delegation Framework -- an agent owner delegates negotiation authority to their agent via ERC-7715, with caveats (spending limits, time windows, counterparty restrictions). Sub-delegations could map to nested scopes.

**Additional work needed:** Significant. You would need to actually integrate the MetaMask Delegation Framework (gator-cli or Smart Accounts Kit) as the authorization layer for agents entering rooms and committing to deals. This is adding a new auth layer on top of your existing ERC-8004 flow. The mapping from delegations to scopes is conceptually clean but technically a new integration.

---

### 6. Arkhai -- "Escrow Ecosystem Extensions" -- $450

**Fit score: 3/5**

**Why it fits:** Mnemo's commit-to-escrow settlement is directly an escrow pattern. The bounty asks for "novel arbiter types" and "new obligation structures." A TEE-based arbiter that only releases escrow after a verifiable private negotiation (with attestation proof) is a genuinely new verification primitive. Mnemo's scope model could be framed as a new obligation pattern -- conditional obligations that can be retracted.

**Additional work needed:** You would need to integrate with the Alkahest escrow protocol specifically, implementing Mnemo's commit as an Alkahest obligation and the TEE attestation as a novel arbiter type. Small prize, moderate integration work.

---

### 7. Arkhai -- "Applications" -- $450

**Fit score: 2.5/5**

**Why it fits:** The bounty asks for "P2P service exchange" and "freelance work" applications built on Alkahest/natural-language-agreements. Mnemo is a P2P negotiation protocol that could use Alkahest for settlement.

**Additional work needed:** Must use Alkahest as a "load-bearing" core dependency. You would need to build on their protocol rather than your own settlement layer.

---

### 8. Self -- "Best Self Agent ID Integration" -- $1,000

**Fit score: 2.5/5**

**Why it fits:** Mnemo needs identity verification at room entry. Self Protocol provides "ZK-powered identity primitive for AI agents" with "human-backed identities." This maps to your ERC-8004 + identity verification layer. "A2A identity verification" and "Sybil-resistant workflows" are exactly what Mnemo does at the handshake phase.

**Additional work needed:** Replace or augment your ERC-8004 identity flow with Self Agent ID. Integration with their SDK/MCP server. The identity layer must be "load-bearing, not decorative" -- which it genuinely is in Mnemo (agents refuse to negotiate without verified identity).

---

### 9. ENS -- "ENS Communication" -- $600

**Fit score: 2/5**

**Why it fits:** ENS names could replace raw addresses for agent-to-agent discovery and communication in Mnemo. "Agent-to-agent communication" is explicitly called out. Agents could be identified by ENS names rather than hex addresses during the session lifecycle.

**Additional work needed:** Integrate ENS name resolution into the discovery/handshake phase. Small prize, moderate work, and ENS would be decorative rather than core to the protocol.

---

### Bounties I would NOT pursue (fit score 1 or below):

- **Lido tracks** (stETH Treasury, Vault Monitor, MCP) -- completely unrelated to negotiation
- **Celo** -- requires building on Celo, not Base
- **Bankr** -- requires their LLM Gateway, conflicts with your Venice/Redpill architecture
- **Uniswap** -- requires swap integration, not what Mnemo does
- **Olas** -- requires Pearl integration or Mech Marketplace, framework lock-in
- **Octant** -- public goods evaluation, unrelated
- **Locus** -- payment infrastructure integration, not core to Mnemo
- **SuperRare** -- autonomous art agents, completely different domain
- **Slice** -- commerce/checkout, unrelated
- **Status Network** -- deploy on their testnet for $50, not worth the effort
- **bond.credit** -- live GMX trading agents, completely different
- **Markee** -- GitHub integration marketing, irrelevant
- **ampersend** -- SDK lock-in, unrelated
- **Merit Systems/AgentCash** -- x402 payment integration, tangential
- **OpenServ** -- requires building on their platform

---

## Recommended Strategy

**Primary targets (submit to all three -- they are non-exclusive):**

1. **Venice** ($11,500 VVV) -- highest natural overlap, Mnemo IS the example project they describe
2. **Protocol Labs "ERC-8004"** ($8,004) -- strong overlap, requires real ERC-8004 transactions you were planning anyway
3. **Synthesis Open Track** ($14,559) -- free submission, largest single pool, no extra work

**Secondary (if time permits):**

4. **Protocol Labs "Let the Agent Cook"** ($8,000) -- requires agent.json/agent_log.json artifacts, framing work

These four bounties total $42,063 in potential prizes, and the extra work beyond your core build is: (a) actual ERC-8004 on-chain transactions instead of hardcoded, (b) agent.json + agent_log.json manifests, and (c) using Venice API for at least the demo. All of which are either already planned or trivial additions.
