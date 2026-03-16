# Mnemo Side Bounty Opportunities -- Ranked by Effort-to-Reward

## TIER 1: Near-Zero Extra Effort (Do These)

### 1. Protocol Labs -- "Agents With Receipts -- ERC-8004" -- $8,004

- **What we'd do:** We already use ERC-8004 for agent identity on entry to negotiation rooms. We need to add: (a) an `agent.json` manifest file, (b) an `agent_log.json` structured execution log, and (c) make sure the ERC-8004 registration tx is prominently included (we already have one on Base). The entire Mnemo architecture -- two agents negotiating with identity verification -- is exactly "trusted agent systems using ERC-8004."
- **Effort:** 2-3 hours (write manifest files, format logs, ensure DevSpot compatibility)
- **Target:** 3rd place ($1,004) realistic, 2nd place ($3,000) plausible
- **Expected value:** ~$1,500 (50% chance at 3rd, 20% at 2nd)
- **Verdict:** MUST DO. This is our core project repackaged.

### 2. Protocol Labs -- "Let the Agent Cook" -- $8,000

- **What we'd do:** Same submission as above, different framing. Our negotiation agents already do: discover (find counterparty), plan (negotiation strategy), execute (scoped reveals, fork/rewind), verify (commitment checks), submit (settle on Base). Add the same `agent.json` + `agent_log.json`. Multi-agent swarm with specialized roles is literally what we build.
- **Effort:** 1-2 hours incremental beyond the ERC-8004 track (slightly different framing in the submission)
- **Target:** 3rd place ($1,500) realistic
- **Expected value:** ~$750 (50% chance at 3rd)
- **Verdict:** MUST DO. Same project, second Protocol Labs submission.

### 3. Synthesis Community -- "Open Track" -- $14,558.96

- **What we'd do:** Submit Mnemo as-is. This is the general track; every project is eligible.
- **Effort:** 0 hours (just submit)
- **Target:** Hard to estimate -- depends on total competition. Novel primitive + formal spec is strong.
- **Expected value:** ~$1,456 (10% chance -- big pool, lots of competitors)
- **Verdict:** FREE. Submit automatically.

---

## TIER 2: Low Effort, Good Ratio (Strong Candidates)

### 4. OpenServ -- "Best OpenServ Build Story" -- $500

- **What we'd do:** Write an X thread or blog post about the build process. We have a genuinely interesting story: formal spec in Quint, TEE negotiation rooms, scope model, getting gpt-5.2 to critique our protocol. Eduardo posts as @hackerdocc.
- **Effort:** 1-2 hours to write a compelling thread
- **Target:** 1st place ($250) or 2nd ($250)
- **Catch:** Says "while building with OpenServ." We are NOT building with OpenServ. This requires at least a token OpenServ integration to qualify, which changes the calculus.
- **Expected value:** $0 unless we add OpenServ integration. SKIP unless we also pursue the main OpenServ track.

### 5. Status Network -- "Go Gasless" -- $50 guaranteed

- **What we'd do:** Deploy a trivial contract (could be a simplified commitment log) on Status Network Sepolia testnet. Execute one gasless tx. Write a brief README. Point to our agent as the "AI agent component."
- **Effort:** 1-2 hours (deploy contract, do tx, screenshot, README)
- **Target:** $50 guaranteed per qualifying team (split $2,000 across up to 40 teams)
- **Expected value:** $50 (near certain if we qualify)
- **Verdict:** DO IT. $50 for 1-2 hours is not amazing, but it is guaranteed money and trivial work. Do it in a dead hour.

### 6. ENS -- "ENS Communication" -- $600

- **What we'd do:** In our negotiation rooms, agents currently use wallet addresses. Replace raw addresses with ENS name resolution in the UI/logs. Agent-to-agent communication routed by ENS names instead of hex addresses. This is exactly their ask: "agent-to-agent communication, UX flows that eliminate raw addresses."
- **Effort:** 3-4 hours (integrate ENS resolution into the harness, update logs/UI)
- **Target:** 1st ($400) or 2nd ($200)
- **Expected value:** ~$250 (40% at 1st, 30% at 2nd) -- small track, likely few competitors
- **Verdict:** GOOD CANDIDATE. Small effort, low competition niche.

### 7. ENS -- "ENS Identity" -- $600

- **What we'd do:** Same ENS integration as above, submitted to a second ENS track. Agents use ENS names as their identity in the negotiation room. Hex addresses replaced by names.
- **Effort:** 0 incremental hours if we already did ENS Communication
- **Target:** 2nd ($200)
- **Expected value:** ~$120 (60% chance at 2nd)
- **Verdict:** FREE if we do ENS Communication. Submit to both.

### 8. ENS -- "ENS Open Integration" -- $300

- **What we'd do:** Same integration, third ENS track.
- **Effort:** 0 incremental
- **Expected value:** ~$90 (30% chance)
- **Verdict:** FREE if we do the above. Submit to all three ENS tracks.

### 9. Arkhai -- "Escrow Ecosystem Extensions" -- $450

- **What we'd do:** Our scoped reveals with consent-freeze and commitment logs are literally a novel escrow pattern. The Alkahest protocol is about escrow with arbiters. We could frame our scope model as a new "arbiter type" (TEE-verified, consent-gated) and "obligation pattern" (scoped information reveal with rollback). This requires wrapping our existing protocol logic to extend Alkahest.
- **Effort:** 4-6 hours (understand Alkahest API, write an adapter/extension, demo)
- **Target:** Winner-takes-all $450
- **Expected value:** ~$135 (30% chance -- niche track, our work is genuinely novel)
- **Verdict:** MAYBE. Depends on how much Alkahest integration work is needed. Research their API first.

### 10. MetaMask -- "Best Use of Delegations" -- $5,000

- **What we'd do:** Our scope model has "owner alternation" (nested scope owner must differ from parent). This maps naturally to MetaMask's delegation/sub-delegation model. An agent delegates scoped reveal authority to the counterparty, who can sub-delegate within their scope. ERC-7715 extension with our scope model.
- **Effort:** 6-10 hours (learn Delegation Framework, integrate gator-cli or Smart Accounts Kit, implement scope-as-delegation)
- **Target:** 3rd place ($500) realistic, 2nd ($1,500) stretch
- **Expected value:** ~$400 (30% at 3rd, 15% at 2nd)
- **Verdict:** GOOD if we have time. The conceptual fit is strong (scoped permissions = delegations), but the integration work is real.

---

## TIER 3: Moderate Effort, Worth Considering

### 11. Venice -- "Private Agents, Trusted Actions" -- $11,500

- **What we'd do:** Mnemo IS private agents performing trusted actions. However, there is a problem: we deliberately chose Redpill over Venice because "Venice is NOT private (GPU operators see plaintext)." We would need to route some inference through Venice's API to qualify.
- **Effort:** 2-3 hours to add Venice as an alternative inference provider
- **Catch:** Prizes are in VVV tokens, not USD. The "$5,750" is a "platform accounting reference only." Actual value depends on VVV market price and liquidity.
- **Target:** Our project is literally "private deal negotiation agents" which they list as an example direction. 2nd or 3rd place plausible.
- **Expected value:** Hard to say -- VVV token value is uncertain. Maybe $500-1,500 in real liquidatable value.
- **Verdict:** CONSIDER. The irony is thick (using Venice for "privacy" when we know it's not private), but the prize pool is large and the fit is strong. Integrate Venice as a "non-sensitive reasoning" provider and use Redpill for the actually private parts. Frame it honestly.

### 12. Self -- "Best Self Agent ID Integration" -- $1,000

- **What we'd do:** Add Self Agent ID as an additional identity layer alongside ERC-8004. ZK-powered identity for agents entering negotiation rooms fits our "verify identity on entry" requirement.
- **Effort:** 4-6 hours (integrate Self SDK, add registration flow)
- **Expected value:** ~$300 (30% chance, winner-takes-all)
- **Verdict:** DECENT. ZK identity + negotiation rooms is a strong narrative.

---

## EXPLICITLY INCOMPATIBLE

- **Celo -- "Best Agent on Celo"** ($5,000): Requires building ON Celo. We're on Base. Would need to port settlement. Not worth it.
- **bond.credit -- "Agents that pay"** ($1,500): Requires LIVE TRADING on GMX perps on Arbitrum during the hackathon window. Completely different project.
- **Lido -- all three tracks** ($9,500): Requires deep Lido/stETH integration. Nothing to do with negotiation rooms.
- **Uniswap** ($5,000): Requires Uniswap API integration with real swaps. Orthogonal to our project.
- **Bankr** ($5,000): Requires Bankr LLM Gateway as the inference layer. We use Redpill.
- **Locus** ($3,000): Requires Locus wallets on Base with USDC. Could theoretically fit but the integration is not trivial and must be "core to the product."
- **SuperRare** ($2,500): Requires autonomous NFT minting/trading art. Completely different domain.
- **Olas -- all tracks** ($3,000): Requires Olas framework integration (Pearl, Mech Marketplace). Heavy framework lock-in.
- **Slice -- all tracks** ($2,200): Requires Slice commerce integration. Irrelevant.
- **Markee** ($800): Requires GitHub repo views/monetization metrics. Gaming territory.
- **ampersend** ($500): Requires ampersend-sdk as core dependency. Irrelevant.
- **Octant -- all tracks** ($3,000): Public goods evaluation. Different problem domain entirely.

---

## RECOMMENDED PLAN (sorted by priority)

| Priority | Bounty | Prize | Effort | EV |
|---|---|---|---|---|
| 1 | Protocol Labs: ERC-8004 | $8,004 | 2-3h | ~$1,500 |
| 2 | Protocol Labs: Agent Cook | $8,000 | 1-2h incremental | ~$750 |
| 3 | Synthesis Open Track | $14,559 | 0h | ~$1,456 |
| 4 | Status Network: Gasless | $50 | 1-2h | $50 |
| 5 | ENS: Communication + Identity + Open (3 tracks) | $1,500 | 3-4h total | ~$460 |
| 6 | MetaMask: Delegations | $5,000 | 6-10h | ~$400 |
| 7 | Venice: Private Agents | $11,500 (VVV) | 2-3h | ~$500-1,500 |

**Total estimated effort for priorities 1-5:** ~8-11 hours
**Total expected value for priorities 1-5:** ~$4,216

The Protocol Labs tracks are by far the best opportunity because our project already satisfies nearly all their requirements. The main work is packaging: writing the `agent.json` manifest and `agent_log.json` execution logs in their expected format. ENS is the next best bang-for-buck because the integration is small and maps directly to our architecture (agents communicating by name, not address). Status Network is a guaranteed $50 for trivial work.
