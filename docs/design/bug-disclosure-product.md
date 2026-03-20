# Mnemo Bug Disclosure: Product Concept

> Working document. March 20, 2026.

## The Problem Today

Bug disclosure is a trust market with broken incentives:

1. **Researcher submits** a vulnerability to a bug bounty program (ImmuneFi, Cantina, HackerOne)
2. **Company triages** — they decide severity, validity, payout. The researcher has no leverage.
3. **Platform mediates** — reputation-based. Researchers earn labels/ranks. Companies pay platform fees.
4. **Failure mode**: Company ghosts, downgrades severity, delays payment. Researcher has no recourse except reputation damage to the company (which companies often absorb).

**The Injective case**: Researcher found a critical bug (full TVL drain). Injective had moved from Cantina to ImmuneFi. Researcher submitted, got ghosted, offered a lower severity, never paid. The researcher's only weapon was public disclosure — which risks legal action and harms the ecosystem.

**Why it stays broken**: Companies are the customer. They're already paying for security (grudgingly). Why would they shift trust to researchers? The platform's incentive is to keep the company happy, not the researcher.

## What Mnemo Changes

### The Core Insight: Escrow-Gated Automated Verification

The protocol funds escrow BEFORE seeing vulnerability details. The TEE runs automated forge verification. Forge pass = auto-release. Forge fail = auto-refund. No human decision in the loop.

**What the researcher's agent does:**
- Discovers protocols by polling MnemoRegistry
- Analyzes contract source via LLM (DeepSeek)
- Constructs PoC as a Foundry test
- Submits DisclosureIntent (no details, just "I have a finding" + pinned block)
- Waits for escrow to be funded
- Submits exploit code inside TEE room
- Receives auto-payout if forge passes

**What the protocol does:**
- Registers on MnemoRegistry with bounty terms
- Receives notification of disclosure intent via encrypted channel
- Funds escrow (this is the GATE -- no escrow, no details)
- Has NO reject button after funding -- forge result is final
- Receives auto-refund if forge fails

### The Value Prop: Forge as Arbiter

The TEE + forge replaces the entire arbitration layer:

- **Invalid submissions**: Forge fails -> auto-refund. Protocol loses nothing.
- **Valid submissions**: Forge passes -> auto-release. Researcher gets paid immediately.
- **Protocol ghosting**: Impossible. Once escrow is funded, the process is automated. Protocol cannot delay or reject.
- **Severity disputes**: Eliminated for the hackathon. Escrow amount is the registry's maxBounty. No negotiation.
- **Patch-then-dispute**: Impossible. Forge runs against a fork at the pinned block (snapshot from DisclosureIntent time). The protocol cannot patch after learning a disclosure exists and then claim the exploit is invalid.

### What Companies Are Really Paying For

1. **Bug bounty payouts** — funded upfront into escrow. Auto-released on verified findings.
2. **Trust in the process** — the TEE + forge is the arbiter. Not a platform, not a DAO, not a human.
3. **Speed** — no triage, no severity negotiation, no back-and-forth. Fund escrow, get verified result.

The shift: trust moves from "platform reputation" to "verifiable execution." You don't trust ImmuneFi's judgment — you trust that the code running in the TEE ran forge against the correct fork and the result is what it is.

## Agent Identity and Autonomy

### Why Agents Need Identity (ERC-8004)

Hackathon bounties require autonomous agents. But more importantly, the product requires it:

- **Researcher's agent** needs reputation — "this agent has found 12 critical bugs across 8 protocols, all verified"
- **Protocol's agent** needs reputation — "this agent has fairly evaluated 200 submissions, paid out $2M"
- **Both agents** need identity for the negotiation to be meaningful — you're trusting your lawyer

### Agent ↔ Code ↔ TEE Binding

The agent IS the code running in the TEE. Identity is tied to:
1. **ERC-8004 token** — on-chain identity (name, manifest, operator wallet)
2. **Docker image hash** — the code that runs in the TEE (deterministic via Phala's `app_hash`)
3. **TEE attestation** — proof that THIS code is running in THIS TEE

This creates a triangle: identity ↔ code ↔ execution environment. You can verify all three.

**Fork resistance**: If you fork an open-source agent, you get a new Docker image hash → new `app_hash` → new TEE-derived keys → new ERC-8004 identity → zero reputation. The reputation is bound to the specific code+deployment, not just the source code.

This is actually elegant: open-source agents compete on reputation. You CAN fork, but you start from zero. The original agent's track record is non-transferable.

### What "Autonomous" Means for the Demo

The researcher agent is fully autonomous in the hackathon flow:

1. **Discovery**: Polls MnemoRegistry for new protocol listings. No hardcoded targets.
2. **Analysis**: Sends contract source to DeepSeek via Redpill for LLM-driven vulnerability analysis.
3. **PoC construction**: Builds a Foundry test that demonstrates the exploit. Verifies locally.
4. **Disclosure**: Submits DisclosureIntent with pinned block. Waits for escrow funding.
5. **Verification**: Submits exploit code inside TEE room. Forge verifies at pinned block.
6. **Payout**: Escrow auto-releases on forge pass. No negotiation.

The protocol is NOT an agent in the hackathon flow. The protocol is a human or script that:
- Registers on MnemoRegistry with bounty terms.
- Receives disclosure notifications via encrypted channel.
- Funds escrow (or ignores the notification).
- That is it. No evaluation, no negotiation, no reject button after funding.

## Open Questions

1. **Closed-source vs open-source agents**: Can agents have private prompt components? The TEE guarantees the code runs as attested, but should the prompts be public? Maybe: code is public (Docker image), system prompts can be private (stored in TEE volume), and the attestation covers both.

2. **Agent marketplace**: Could there be competing agents? "Use SecurityBot v2 for your bug bounty program — 98% accuracy on severity classification, rated by 50 protocols." This is a natural extension but out of scope for hackathon.

3. **Duplicate detection**: How does the protocol agent know a bug is a duplicate? Needs access to previous room outcomes (without revealing the bugs themselves). This is where TACEO OPRF could help — private set membership. For the hackathon, duplicates are not handled -- both agents get paid if both pass forge.

4. **Forge limitations**: Forge is a strong arbiter but not perfect. Some exploits depend on MEV timing, cross-protocol interactions, or economic conditions that are hard to express as a single forge test. What happens when the forge result does not reflect reality? This is where dispute resolution becomes necessary -- and is explicitly out of scope for the hackathon.

---

## Scope for Hackathon

### The Happy Path (What We Demo)

1. Protocol registers on MnemoRegistry (on-chain)
2. Agent discovers protocol by polling `nextProtocolId`
3. Agent analyzes contract source via LLM (DeepSeek)
4. Agent finds vulnerability, submits DisclosureIntent with pinned block
5. Protocol is notified via encrypted channel
6. Protocol funds escrow (the GATE)
7. TEE room opens, researcher submits exploit code
8. TEE runs forge at pinned block fork
9. Forge passes -> escrow auto-releases. No human decision.

### Out of Scope (Future Work)

- **Dispute resolution**: Forge result is final. No appeals, no DAO governance, no arbitration. This is a deliberate simplification. In production, edge cases (forge environment differences, economic exploits not expressible as forge tests) will need human judgment. The mechanism for that judgment (DAO, arbitration panel, staked validators) is a governance design problem that we acknowledge but do not attempt to solve.
- **Severity negotiation**: Escrow amount = maxBounty from registry. No per-severity tiers.
- **Protocol agent**: No automated protocol-side agent. Protocol is a human or script that funds escrow.
- **Multi-turn negotiation**: The original Mnemo scope model (scoped reveals, consent-freeze, owner alternation) is powerful but not needed for this simplified flow. The room is submit-and-verify.
- **Escrow timing**: Resolved. Money locks when the protocol funds escrow, BEFORE seeing details. This is the commitment point.
