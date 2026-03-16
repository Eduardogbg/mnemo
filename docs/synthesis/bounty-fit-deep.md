# Deep Sponsor Relevance Analysis -- Every Sponsor Through Mnemo's Lens

## TIER 1: GENUINE FIT -- These sponsors' bounties are structurally aligned with what Mnemo does

### Protocol Labs -- "Agents With Receipts" ($8,004 track)

**Angle:** This is almost purpose-built for Mnemo. The bounty literally asks for agents that use ERC-8004 to verify identity, reputation, and capabilities -- and explicitly calls out multi-agent coordination. Mnemo IS a system where agents negotiate with verifiable identity, where scoped reveals create a trail of commitments that map directly onto reputation. "Agents that can be trusted" is our tagline.

**Feasibility:** HIGH. We are already planning ERC-8004 identity. The demo would be: two agents enter a Mnemo room, verify identity via ERC-8004, negotiate with scoped reveals, commit the deal, and the commitment is logged on-chain as reputation signal.

**Verdict:** Genuine fit. This should be a primary target. $8K track, and our project is literally a system for building trust between autonomous agents.

---

### Protocol Labs -- "Let the Agent Cook" ($8,000 track)

**Angle:** Requires autonomous multi-tool agents. Mnemo agents that autonomously discover negotiation opportunities, plan reveals, execute private negotiations, verify counterparty commitments, and settle on-chain would tick every box. The "multi-agent swarms with specialized roles" bonus is exactly what scoped reveals enable -- a planner agent can reveal strategic intent to an executor agent in a scope that gets destroyed if the plan changes.

**Feasibility:** MEDIUM-HIGH. Requires showing a full autonomous loop. The demo needs to be convincing end-to-end -- agent discovers an opportunity, enters a room, negotiates, and settles. More orchestration work than the ERC-8004 track.

**Verdict:** Genuine fit, but more competitive. Everyone at the hackathon is building agents.

---

### MetaMask -- "Best Use of Delegations" ($5,000)

**Angle:** This is deeper than it initially appears. The bounty explicitly calls out "intent-based delegations as a core pattern, sub-delegations, novel permission models, ZK proofs with delegation-based authorization." Mnemo's scoped reveals ARE a permission model. The idea: a MetaMask delegation grants an agent permission to negotiate on your behalf, but scoped -- the agent can reveal your price range (inner scope) within a broader deal scope. If the deal scope closes, the price-range delegation is automatically revoked. Sub-delegations map to nested scopes. Owner alternation maps to delegation chain constraints. This is not decoration -- Mnemo's scope model is a novel permission model for delegations.

**Feasibility:** MEDIUM. Requires integrating the MetaMask Delegation Framework (gator-cli or Smart Accounts Kit). The mapping between scoped reveals and scoped delegations needs to actually work at the contract level, not just conceptually. Could be tight on time.

**Verdict:** Genuine fit. The bounty explicitly asks for "novel permission models" and Mnemo IS one. $5K track and the conceptual alignment is strong enough to be compelling to judges.

---

### Venice -- "Private Agents, Trusted Actions" ($11,500)

**Angle:** The bounty description reads like it was written for Mnemo: "confidential treasury management, private governance analysis, *deal negotiation agents*, onchain risk desks." Private cognition leading to public consequences is exactly the scoped-reveal model -- agents reason privately in the TEE, reveal selectively within scopes, and only committed results become public/on-chain.

**Feasibility:** MEDIUM. The catch is you noted Venice GPU operators see plaintext -- so Venice inference is not truly private. But the bounty only requires USING Venice's API, not claiming Venice provides the privacy. Mnemo's TEE provides the negotiation privacy; Venice provides the inference. You could use Venice for the agents' reasoning while Phala TEE protects the room state. Alternatively, use Venice for the demo and note that production would use Redpill.

**Verdict:** Genuine fit, worth the prize size. $11.5K in VVV is the second-largest pool. The "deal negotiation agents" example direction is literally Mnemo. The question is whether judges care that privacy comes from the TEE rather than Venice itself.

---

### bond.credit -- "Agents that pay" ($1,500)

**Angle:** On the surface this is "build a GMX trading bot." But think harder: the bounty is really about *creditworthiness*. The winner gets an on-chain credit score on ERC-8004. Now -- how does a counterparty evaluate an agent's creditworthiness? Private negotiation. An agent could selectively reveal its trading history, risk parameters, or collateral within a Mnemo scope to demonstrate creditworthiness to a lender, without publicly exposing its strategy. Scope closes = counterparty forgets your book. Scope commits = credit assessment goes on-chain.

**Feasibility:** LOW-MEDIUM. The hard requirement is live trading on GMX perps on Arbitrum during the hackathon window. You would need to actually build a trading agent AND integrate Mnemo, which is two hard problems. The Mnemo angle would be a differentiator in creditworthiness evaluation, not the trading itself.

**Verdict:** Stretch. The live-trading requirement is the real bottleneck. But the credit-score-via-scoped-reveal idea is genuinely novel and could be mentioned in the broader narrative even if you don't target this bounty directly.

---

### Arkhai -- "Escrow Ecosystem Extensions" ($450)

**Angle:** This is a sleeper. Arkhai's Alkahest is an escrow protocol. The bounty asks for "novel arbiter types (ZK-based, multi-party, reputation-weighted, AI-evaluated), new obligation structures, and generalized escrow primitives." A Mnemo room IS an escrow primitive -- information escrow. You could build a "scoped-reveal arbiter" where the arbitration happens inside a Mnemo room: both parties reveal evidence within a scope, an AI arbiter evaluates it privately, and only the ruling is committed to chain. The losing party's sensitive evidence is destroyed.

**Feasibility:** MEDIUM. Requires Alkahest integration. The Arkhai docs would need to be checked for API surface. If Alkahest is a clean Solidity interface, writing a new arbiter contract that interfaces with Mnemo room commitments could be tractable.

**Verdict:** Genuine fit at the protocol level. Small prize ($450) but the conceptual alignment is tight and it could strengthen the overall submission narrative. "Information escrow" as a new Alkahest primitive is a compelling story.

---

### Arkhai -- "Applications" ($450)

**Angle:** Same Alkahest integration but application-level. A P2P service exchange where terms are negotiated in a Mnemo room, escrowed via Alkahest, and settled on delivery. Think: freelancer reveals their rate and availability in a scope, client reveals their budget, if terms match the scope commits into an Alkahest escrow.

**Feasibility:** MEDIUM. Same integration work as above.

**Verdict:** Pick one of the two Arkhai tracks. The escrow extensions track is more novel; the applications track is more demonstrable.

---

## TIER 2: REAL ANGLE EXISTS -- Requires creative framing but the fit is defensible

### Uniswap -- "Agentic Finance" ($5,000)

**Angle:** Private RFQ (Request for Quote). In traditional finance, large trades happen through private negotiation to avoid market impact. Right now on Uniswap, large swaps get sandwiched by MEV bots because everything is public. Mnemo enables a private RFQ layer: Agent A enters a room with Agent B (a market maker), reveals the size and direction of their intended trade within a scope, Agent B quotes a price, they negotiate. If they agree, the scope commits and the swap executes via Uniswap API. If they disagree, the scope closes and the market maker never learns the order (TEE guarantees). This is literally how institutional OTC desks work, but agent-to-agent.

**Feasibility:** MEDIUM. The Uniswap API integration is straightforward (swap execution). The demo would be: two agents negotiate a large swap privately, then execute it via Uniswap. The hard part is making the negotiation meaningful rather than theatrical.

**Verdict:** Strong angle. The bounty says "invent primitives we haven't imagined yet." Private RFQ for agent-to-agent swaps IS a new primitive. The "any agent that pays needs to swap" framing means Uniswap is happy to be the settlement layer. This could be a compelling submission.

---

### Locus -- "Best Use of Locus" ($3,000)

**Angle:** Locus provides agent wallets with spending controls. Mnemo's scoped reveals could gate spending: an agent's Locus wallet permissions could be scoped to a negotiation room. Within a scope, the agent can commit to payments up to a negotiated amount. If the scope closes, the payment authorization is revoked. Think of it as: the spending control IS the scope. "I authorize up to $X for this deal, but only if the deal commits."

**Feasibility:** MEDIUM. Requires Locus SDK integration. The spending controls need to map to scope lifecycle events (open/commit/close). If Locus has webhook or event-driven controls, this is tractable.

**Verdict:** Real angle. The bounty wants "agent-native payments that are core to the product." Conditional payment authorization gated by negotiation outcome IS core to Mnemo. Not a stretch.

---

### Self -- "Best Self Agent ID Integration" ($1,000)

**Angle:** Self provides ZK-powered identity for agents (human-backed credentials). In Mnemo, room entry could require Self Agent ID verification -- proving your agent has a human principal without revealing who. Inside the room, agents negotiate knowing their counterparty is human-backed (Sybil-resistant) without knowing their identity. The scoped reveal could then selectively disclose identity attributes: "I'll reveal my jurisdiction if you reveal yours" -- all ZK-verified via Self, all destroyable if the scope closes.

**Feasibility:** MEDIUM. Self has an SDK and MCP server. Integration should be clean. The demo: two agents verify each other's Self Agent IDs to enter a Mnemo room, then progressively reveal credentials within nested scopes.

**Verdict:** Genuine fit. Identity verification is load-bearing in negotiation. Self provides the identity layer, Mnemo provides the negotiation layer. The combination is natural, not forced.

---

### ENS -- "ENS Communication" ($600)

**Angle:** Mnemo rooms addressed by ENS names. Instead of connecting to a room by hex address, agents discover negotiation partners by ENS name: `agent.mnemo.eth`. Inside the room, ENS names replace addresses everywhere -- you negotiate with `counterparty.eth`, not `0x1234...`. On commit, the settlement transaction references ENS names.

**Feasibility:** HIGH. ENS resolution is straightforward. The demo could show agent-to-agent communication in a Mnemo room where all identifiers are ENS names.

**Verdict:** Real angle but thin. ENS is "core to the experience" in the sense that all addressing uses names, but it is not deeply novel. The $600 prize reflects the low bar. Worth doing as a small add-on if we are already building rooms.

---

### ENS -- "ENS Identity" ($600)

**Angle:** Same as above -- agents identify via ENS within negotiation rooms. ERC-8004 identity could be linked to ENS names, creating a unified identity layer for Mnemo agents.

**Feasibility:** HIGH. Same work as above.

**Verdict:** Could submit to both ENS tracks with the same integration. Small prize, but essentially free if we are already using ENS for agent identity.

---

### Octant -- "Mechanism Design for Public Goods Evaluation" ($1,000)

**Angle:** This is more interesting than it sounds. Public goods evaluation is a multi-stakeholder negotiation problem where evaluators have private preferences and potentially conflicts of interest. Mnemo rooms could host evaluation discussions where reviewers reveal their assessments in scopes -- if the group cannot reach consensus, individual assessments are destroyed (preventing retaliation). Committed assessments become the public evaluation. This is a novel mechanism: "private deliberation with committed outcomes."

**Feasibility:** MEDIUM. The demo would be agents representing evaluators negotiating grant assessments in a Mnemo room. The mechanism design angle is strong but abstract.

**Verdict:** Real angle. "Private deliberation" for public goods evaluation is a genuine contribution to mechanism design. The question is whether Octant judges care about the privacy primitive or just want data analysis tools.

---

### Octant -- "Agents for Public Goods Data Analysis" ($1,000)

**Angle:** Agents analyzing project data privately to avoid bias contamination. Evaluator agents could share intermediate findings in scopes, combine insights without anchoring bias (destroy the scope if findings conflict), then commit only the synthesis.

**Feasibility:** LOW-MEDIUM. More of a stretch -- the data analysis is the core, Mnemo is auxiliary.

**Verdict:** Thin. The bounty wants data analysis capabilities, not negotiation infrastructure.

---

### OpenServ -- "Ship Something Real with OpenServ" ($4,500)

**Angle:** OpenServ provides multi-agent workflows, x402-native services, and ERC-8004. Mnemo rooms could be deployed as an OpenServ service -- agents on the OpenServ network can hire a Mnemo room as a private negotiation venue, paying per-session via x402. The room is a service: agents pay to enter, negotiate privately, and settle.

**Feasibility:** MEDIUM. Requires OpenServ SDK integration. The "Mnemo-as-a-service" framing maps well to their agent economy model.

**Verdict:** Real angle. The bounty wants "agentic economy products" and "x402-native services." A paid private negotiation room is both. $4.5K total prize makes this worth pursuing.

---

### Bankr -- "Best Bankr LLM Gateway Use" ($5,000)

**Angle:** Bankr provides a multi-model LLM gateway with on-chain wallets. The self-sustaining economics angle: a Mnemo room service charges fees for private negotiations, those fees fund the inference costs (via Bankr gateway) of the agents operating the room. The room pays for itself. Trading agents negotiate privately in Mnemo rooms, use Bankr for inference, and the negotiation fees sustain the system.

**Feasibility:** MEDIUM. Requires Bankr LLM Gateway integration (OpenAI-compatible API, so should be a drop-in replacement). The self-sustaining economics narrative needs to be demonstrated with real on-chain flows.

**Verdict:** Real angle. The "self-sustaining" framing is what Bankr judges want. A negotiation service that funds its own inference from deal fees is a clean story. The question is whether it is different enough from "just another trading bot."

---

### Lido -- "stETH Agent Treasury" ($3,000)

**Angle:** At first glance this seems irrelevant -- it is about yield-bearing agent budgets. But consider: an agent's negotiation budget could be funded by stETH yield. A parent agent stakes ETH via Lido, and sub-agents receive yield-funded budgets for entering Mnemo negotiation rooms (paying room fees, posting escrow, etc.). The principal is structurally inaccessible -- agents can only spend yield to negotiate and settle deals. This maps to the bounty's "multi-agent system where a parent agent allocates yield budgets to sub-agents."

**Feasibility:** LOW-MEDIUM. The core work is Solidity (the stETH treasury contract), which is not Mnemo's focus. You would need to build the contract AND show agents using the yield in Mnemo rooms.

**Verdict:** Stretch. The Lido integration is load-bearing Solidity work that distracts from Mnemo's core. The conceptual fit exists but the implementation cost is high.

---

## TIER 3: THIN FIT -- Could mention but not worth targeting

### Celo -- "Best Agent on Celo" ($5,000)

**Angle:** Celo is an L2 for low-cost payments. Mnemo settlement could happen on Celo instead of (or in addition to) Base. Agents negotiating real-world payments (remittances, micropayments) could use Mnemo rooms to negotiate exchange rates or payment terms privately, then settle on Celo.

**Feasibility:** MEDIUM (technically simple -- just deploy to Celo). The question is whether the demo is compelling on Celo specifically vs. Base.

**Verdict:** Thin fit. Celo is just an alternative settlement chain. Nothing about Celo specifically enhances Mnemo. Worth doing ONLY if the "real-world payments" narrative resonates with judges -- e.g., agents negotiating remittance corridors.

---

### Status Network -- "Go Gasless" ($50/team)

**Angle:** Deploy the Mnemo room contract on Status Network's testnet, execute a gasless negotiation commitment. Agents negotiate in a Mnemo room, and the on-chain settlement costs zero gas.

**Feasibility:** HIGH. Literally just deploy to their testnet and submit a tx hash.

**Verdict:** Free $50 if we are deploying contracts anyway. No narrative value but zero effort. Do it.

---

### Olas -- "Build an Agent for Pearl" ($1,000) / "Hire/Monetize on Marketplace" ($500-$1,000)

**Angle:** Package a Mnemo negotiation agent as an Olas agent. Other agents could hire the Mnemo agent on the Olas Marketplace to conduct private negotiations on their behalf.

**Feasibility:** LOW-MEDIUM. Requires following Olas's integration guide and QA checklist. The framework integration might be annoying.

**Verdict:** Thin. Olas integration is framework overhead that does not advance Mnemo's core. The marketplace tracks require 10-50 requests, which means building usage, not just a demo.

---

### Slice -- "Ethereum Web Auth / ERC-8128" ($750)

**Angle:** ERC-8128 as the authentication layer for entering Mnemo rooms. Instead of wallet signatures, agents authenticate via ERC-8128 to prove they are authorized to enter a negotiation room.

**Feasibility:** MEDIUM. Need to understand ERC-8128 spec and implement it as room auth.

**Verdict:** Thin. Auth is not Mnemo's differentiator. Would only matter if ERC-8128 integration is trivially easy and adds a bullet point.

---

### Slice -- "The Future of Commerce" ($750)

**Angle:** Agent-to-agent price negotiation for Slice store products. An agent buyer enters a Mnemo room with a Slice merchant agent, negotiates a price within a scope (revealing budget, quantity), and if terms commit, the checkout executes on Slice.

**Feasibility:** LOW-MEDIUM. Requires Slice store integration.

**Verdict:** Real angle conceptually (commerce involves negotiation) but Slice's prize structure is small and the integration work is specific to their platform. Not worth prioritizing.

---

### Slice -- "Slice Hooks" ($700)

**Angle:** A Slice hook that gates checkout on a Mnemo negotiation outcome. The pricing strategy IS the negotiation -- price is determined in a private room, not listed publicly.

**Feasibility:** LOW. Requires understanding Slice hooks architecture.

**Verdict:** Interesting idea (dynamic private pricing) but too niche for hackathon time.

---

### SuperRare -- "SuperRare Partner Track" ($2,500)

**Angle:** Private art auction via Mnemo. Bidders enter a room, reveal bids within scopes, and the auction resolves privately -- losing bids are destroyed (the artist never knows what the losing bidders were willing to pay). This is a sealed-bid auction with TEE enforcement. Alternatively: two agents negotiate a private sale price for an NFT, with the negotiation history destroyed if no deal is reached.

**Feasibility:** MEDIUM. Requires Rare Protocol CLI integration (ERC-721 deployment, minting, auction). The sealed-bid auction demo would be compelling but is a full project on its own.

**Verdict:** Real angle -- sealed-bid auctions with information destruction are a genuine use case. But the bounty emphasizes "artistic expression" and "agent behavior shapes the artwork," which is not Mnemo's vibe. The judges want generative art, not infrastructure.

---

### Merit Systems -- "Build with AgentCash" ($1,750)

**Angle:** Agents in a Mnemo room pay for negotiation services (information lookups, verification, escrow) via AgentCash x402 payments at request time. Each reveal in a scope could cost something -- pay-per-reveal. The x402 layer is load-bearing because agents are buying and selling information within the room.

**Feasibility:** MEDIUM. AgentCash is an MCP server, so integration should be clean. The "pay-per-reveal" framing makes x402 genuinely load-bearing.

**Verdict:** Real angle. Pay-per-reveal in a negotiation room is a use case where micropayments are actually necessary (you don't want a subscription for a one-time negotiation). $1,750 prize is decent. Worth considering as an add-on.

---

### Markee -- "GitHub Integration" ($800)

**Angle:** None. This is about adding a Markee message to a GitHub repo and getting views.

**Feasibility:** Trivially easy but completely unrelated to Mnemo.

**Verdict:** Irrelevant to Mnemo's primitive. It is a marketing/distribution bounty. You could claim the $800 by putting a Markee message in the Mnemo repo if it gets traffic, but it has nothing to do with the technology.

---

### ampersend -- "Best Agent Built with ampersend-sdk" ($500)

**Angle:** Would need to check what ampersend-sdk actually provides. If it is a messaging/communication SDK, Mnemo rooms could use it as a transport layer. If it is something else, possibly irrelevant.

**Feasibility:** UNKNOWN without checking the SDK.

**Verdict:** $500 and unknown fit. Low priority unless the SDK turns out to be a messaging primitive.

---

### Lido -- "Vault Position Monitor" ($1,500) and "Lido MCP" ($5,000)

**Angle:** Essentially no connection to Mnemo. These are monitoring tools and MCP server implementations for Lido-specific operations.

**Feasibility:** N/A.

**Verdict:** Irrelevant. These are Lido product integrations, not negotiation/privacy problems.

---

### Synthesis Community -- "Open Track" ($14,559)

**Angle:** This is the open track -- any project qualifies. Mnemo as submitted is eligible.

**Feasibility:** HIGH. No integration requirements.

**Verdict:** Always submit to this. It is a community-judged open track with the second-largest prize pool.

---

## STRATEGIC SUMMARY: What to actually target

**Primary targets (genuine fit, high prize, defensible narrative):**

1. **Protocol Labs -- Agents With Receipts** ($8K) -- Mnemo IS this bounty
2. **Venice -- Private Agents, Trusted Actions** ($11.5K VVV) -- "deal negotiation agents" is literally us
3. **MetaMask -- Best Use of Delegations** ($5K) -- scoped reveals as a novel permission model for delegations
4. **Uniswap -- Agentic Finance** ($5K) -- private RFQ between agents, settled via Uniswap
5. **Synthesis Community -- Open Track** ($14.6K) -- submit by default

**Strong secondary targets (worth the integration effort):**

6. **Protocol Labs -- Let the Agent Cook** ($8K) -- same submission as #1, different framing
7. **OpenServ -- Ship Something Real** ($4.5K) -- Mnemo-as-a-service on the agent economy
8. **Merit Systems -- AgentCash** ($1.75K) -- pay-per-reveal via x402
9. **Self -- Agent ID** ($1K) -- ZK identity verification at room entry
10. **Locus** ($3K) -- scoped spending controls

**Free money (minimal effort add-ons):**

11. **Status Network** ($50) -- deploy contract to their testnet
12. **ENS** (up to $1.5K across 3 tracks) -- use ENS names for agent addressing

**The big insight:** The trading/commerce angle is stronger than it initially appears. Private RFQ is how trillions of dollars of real-world OTC trading already works. Mnemo gives agents the same capability. The Uniswap submission should frame it this way: "Every DEX swap above a certain size gets MEV-extracted because it is public. Mnemo enables the agent equivalent of calling your broker and asking for a private quote." That narrative would resonate with Uniswap judges who understand the MEV problem.
