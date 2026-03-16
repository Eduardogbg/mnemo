# Autonomous Use Cases for Mnemo's Scoped Reveals

Here are my best ideas, ranked roughly by how compelling they'd be for hackathon judges.

---

## Tier 1: The Demo Scenario (build this one)

### 1. Autonomous Cloud Compute RFQ with Conditional Workload Disclosure

**Setup:** A buyer agent needs GPU compute for a specific ML training job. It queries multiple compute providers (seller agents) — think Akash, io.net, Lambda, or simulated equivalents. The buyer has a proprietary model architecture and dataset size that it does NOT want to leak to providers (because that reveals its R&D direction). The sellers have dynamic pricing they don't want competitors to see.

**Why scoped reveals are essential:**
- The buyer opens a scope and reveals "I need 8xH100 for ~72 hours" to get a ballpark quote. This is the outer scope — cheap information.
- If the ballpark is within budget, the buyer opens a NESTED scope and reveals the actual workload profile (memory requirements, interconnect needs, checkpoint frequency) to get a precise quote. The owner alternation rule means the seller now owns this inner scope — they can't just walk away with the workload profile without committing to a price.
- If the precise quote is too high, the inner scope CLOSES. The seller's TEE destroys the workload profile. The seller literally cannot reconstruct what the buyer needed beyond "8xH100 for ~72 hours." Without TEE + scoped reveals, the seller has already seen your workload and can infer your model architecture.
- The buyer runs this negotiation CONCURRENTLY against 5 providers, each in their own room. No provider knows what the others quoted.

**The autonomous loop:**
1. **Discover:** Agent queries a registry (or crawls known endpoints) for compute providers with H100 availability.
2. **Plan:** Agent sets budget ceiling, minimum SLA requirements, and a scoring function (price × reliability × latency).
3. **Execute:** Opens rooms with each provider. Runs the two-scope negotiation. Forks the DAG if a provider counteroffers — explores both the original and counter terms in parallel branches.
4. **Verify:** Checks provider reputation on-chain, verifies TEE attestation of the provider's agent, confirms the final price matches the committed quote.
5. **Submit:** Commits the best deal on Base (escrow deposit), closes all other rooms (destroying all revealed info from losing bids).

**Why judges love it:** This is a REAL problem. Anyone who's procured cloud compute knows you don't want providers knowing your workload. It demonstrates concurrency (multiple rooms), nesting (two-level reveal), and the DAG (forking on counteroffers). It's also extremely demo-able — you can show the buyer agent's decision tree, the scopes opening and closing, and the final on-chain settlement.

---

## Tier 2: Strong Scenarios

### 2. Autonomous Insurance Underwriting with Private Risk Disclosure

**Setup:** A fleet management agent (representing a trucking company) needs cargo insurance for a specific route. Multiple insurer agents compete. The fleet agent knows the cargo value, route details, and its internal accident history — all highly sensitive. The insurers have proprietary risk models they don't want to expose.

**Why scoped reveals matter:**
- Outer scope: Fleet agent reveals "cargo category: electronics, route: US domestic, value band: $500K-$1M." Gets ballpark premiums.
- Inner scope (owned by fleet agent): Fleet agent reveals exact cargo manifest and route waypoints. Insurer returns a precise premium. If the premium is acceptable, commit. If not, close — the insurer never learns you're shipping 10,000 GPUs from Taipei to Austin via a specific port.
- Critical detail: The fleet agent can reveal its safety record (low accident rate) to get a better premium, but ONLY in a scope that closes if the premium doesn't improve enough. This means the fleet agent can "test" whether honesty is rewarded without permanently revealing its data. This is impossible without scoped reveals — once you tell an insurer your accident history, you can't un-tell them.

**Autonomous loop:** Fleet agent monitors its logistics system, detects a new shipment that needs coverage, queries insurer registry, runs parallel negotiations, commits the best policy, and posts the policy hash on-chain as proof of coverage.

**Why it's compelling:** Insurance is a $6T industry where information asymmetry is THE core problem. This directly attacks adverse selection with a cryptographic primitive.

### 3. Autonomous Salary Negotiation Agent

**Setup:** A job-seeker's agent negotiates compensation with a company's hiring agent. The job-seeker has a reservation salary (minimum they'll accept), competing offers, and personal constraints (relocation costs, equity preferences). The company has a budget range, internal equity bands, and urgency level.

**Why scoped reveals matter:**
- The job-seeker agent reveals "I have a competing offer" in a scope. The company agent can respond with a counteroffer. If the counteroffer beats the competing offer, commit. If not, close — the company never learns the seeker HAD a competing offer (which would otherwise signal they're actively shopping and might leave soon anyway).
- Deeper: The seeker reveals the competing offer's EXACT number in a nested scope, but only if the company first reveals its budget ceiling in the parent scope. Owner alternation enforces this — the company can't extract the competing offer number without having first committed its own budget ceiling.
- DAG forking: The seeker agent can explore "more base salary" vs "more equity" as parallel branches of the same negotiation, without the company knowing which path they prefer.

**Autonomous loop:** Agent ingests the user's resume, desired role, and constraints once. Then it discovers open positions (job boards, APIs), initiates negotiations, runs the scoped protocol, and returns with committed offer letters. The human only acts at the very end — accept or reject the final committed deal.

**Why it's compelling:** Everyone understands salary negotiation. The "I'll show you my competing offer only if your counter beats X" mechanic is instantly graspable and obviously valuable. Judges will feel the problem viscerally.

### 4. Autonomous API / Data Licensing Negotiation

**Setup:** A startup's agent needs access to a proprietary dataset (satellite imagery, financial data, medical records) for a specific use case. Multiple data providers have different pricing models, coverage, and freshness guarantees. The buyer doesn't want to reveal its exact use case (competitive intelligence). The sellers don't want to reveal their pricing tiers to the market.

**Why scoped reveals matter:**
- The buyer wants to reveal "I need satellite imagery of agricultural land in Iowa, 2024-2025" to get pricing. But this reveals their business thesis (probably precision agriculture). In a scope, they can reveal it, get a quote, and if the price is wrong, close — the seller can't go sell that market insight to a competitor.
- Nested scope for sample data: The seller reveals a data SAMPLE inside a scope. The buyer's agent runs quality checks (resolution, coverage, freshness) programmatically. If quality is insufficient, the scope closes and the buyer never had access to the sample (TEE guarantees no exfiltration). This solves the massive real-world problem of "try before you buy" in data markets without piracy risk.

**Why it's compelling:** Data marketplaces are a known hard problem. The "sample in a scope" pattern is a genuinely novel primitive — it's like a read-only transaction that can be rolled back.

---

## Tier 3: Creative / Edgy Ideas

### 5. Autonomous Vulnerability Disclosure Negotiation

**Setup:** A security researcher's agent discovers a vulnerability in a protocol. It needs to negotiate a bug bounty with the protocol's agent. The researcher doesn't want to reveal the vulnerability details without a payout commitment. The protocol doesn't want to commit money without knowing the severity.

**Why scoped reveals matter:** This is the classic "I know something you don't, but telling you destroys my leverage" problem. The researcher reveals severity classification (critical/high/medium) in an outer scope. If the protocol's offered bounty range is acceptable, a nested scope reveals the actual vulnerability details. The protocol's agent verifies the vulnerability programmatically (runs it against a testnet). If valid, commit — bounty paid, details retained. If invalid or duplicate, close — but the protocol provably cannot have retained the details because TEE.

**Autonomous loop:** Researcher agent runs continuous fuzzing, discovers bugs, queries bug bounty registries, negotiates payouts, and either commits (gets paid) or moves on. Fully autonomous vulnerability-to-cash pipeline.

**Why it's compelling:** This is a REAL pain point in security. Current bug bounty platforms require trust ("please don't patch without paying me"). Scoped reveals make it trustless. It also has great narrative energy — "we solved responsible disclosure with a cryptographic primitive."

### 6. Autonomous Cross-DEX OTC Block Trade Negotiation

**Setup:** A treasury management agent for a DAO needs to sell a large position (say, 500K tokens) without moving the market. It negotiates OTC with multiple market maker agents. The DAO doesn't want to reveal its sell pressure (it would crash the token). The market makers don't want to reveal their inventory or pricing models.

**Why scoped reveals matter:**
- The DAO agent reveals "I want to sell a large-cap governance token, notional $2-5M" in an outer scope. Gets indicative pricing.
- Inner scope: reveals the exact token and amount. Market maker gives a firm quote. If the spread is too wide, close — the market maker never learns which DAO is dumping which token. Without this, the market maker could front-run the information.
- DAG usage: The DAO agent forks to negotiate different lot sizes with different makers (split the block vs. single fill), evaluating total execution cost across strategies.

**Why it's compelling:** OTC desks are a real and massive part of crypto markets. The information leakage problem is well-known and currently "solved" by trusting your OTC desk, which is... not great (see FTX/Alameda). This makes it trustless.

### 7. Autonomous M&A Due Diligence Rooms

**Setup:** An acquiring company's agent and a target company's agent conduct preliminary due diligence. The acquirer wants to see financials before making an offer. The target doesn't want to reveal financials to someone who might be a competitor fishing for intel.

**Why scoped reveals matter:** The target reveals revenue range in an outer scope. If the acquirer's indicative offer range is acceptable, a nested scope reveals detailed financials (margins, growth rates, customer concentration). The acquirer's agent runs valuation models inside the TEE. If the valuation supports the indicative range, commit — both parties move to formal LOI. If not, close — the acquirer provably never exfiltrated the detailed financials. This is the "clean room" concept from M&A, but actually enforced by hardware rather than lawyers.

---

## The "Why This Primitive" Argument (for judges)

The through-line across all these scenarios is: **Mnemo solves the information asymmetry deadlock.** In every negotiation, there's a tension between "I need to share information to get a good deal" and "sharing information weakens my position." Today this is solved by:
- Trust (which fails — see every data breach)
- Legal contracts (which are slow, expensive, and unenforceable for agents)
- Not sharing (which leads to worse outcomes for everyone)

Scoped reveals are a genuinely new primitive: **conditional information sharing with hardware-enforced rollback.** It's not encryption (the counterparty DOES see the data). It's not access control (the counterparty CAN process the data). It's **transactional visibility** — you can show someone something and then make them unsee it, and the TEE guarantees it.

For the "fully autonomous" angle: the key insight is that autonomous agents NEED this primitive MORE than humans do. Humans can at least rely on reputation, relationships, and legal recourse. Agents have none of that. An autonomous agent negotiating on the open internet has zero trust basis with its counterparty. Scoped reveals give it a trust primitive that doesn't require identity, reputation, or legal systems — just hardware attestation. This is why "let the agent cook" and Mnemo are a natural fit.

---

## My Recommendation: Build Scenario 1 (Compute RFQ)

Reasons:
- It's the most demo-able (you can show real compute provider APIs or simulate them convincingly)
- It exercises ALL of Mnemo's primitives: rooms, scopes, nesting, owner alternation, DAG forking, on-chain settlement
- It's a real problem that hackathon judges (who are developers) personally understand
- The autonomous loop is clean and completable in a hackathon timeframe
- You can use Scenario 5 (vuln disclosure) or Scenario 3 (salary) as the "and here are other use cases" slides
