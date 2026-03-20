# The Ethical Hacker Agent

> Design document. March 20, 2026.
> Evolution of the Mnemo bug disclosure product: from negotiation proxy to autonomous security researcher.

---

## 1. The Insight

The existing Mnemo bug disclosure design assumes a human researcher finds a vulnerability, then uses an AI agent as a "lawyer" to negotiate disclosure inside a TEE room. The agent is a negotiation proxy. The researcher is the intelligence.

What if the researcher IS the agent?

Not a negotiation wrapper around a human's findings, but an autonomous security researcher that actively hunts for vulnerabilities -- running inside a TEE, cryptographically constrained to only interact with the world through the Mnemo protocol. It cannot exploit what it finds. It can only disclose ethically. Not because of its instructions. Because of the hardware.

This is a fundamental shift in what "responsible disclosure" means. Today, responsible disclosure is a social norm enforced by reputation and legal threat. With the ethical hacker agent, responsible disclosure is a hardware constraint enforced by TEE attestation and network isolation.

---

## 2. Architecture

### 2.1 What Runs Inside the TEE

The ethical hacker agent is a Docker Compose application running inside a Phala CVM (Confidential Virtual Machine). It contains:

```
┌──────────────────────────────────────────────────────────────────┐
│                     TEE (Phala CVM)                              │
│                                                                  │
│  ┌────────────────────┐    ┌──────────────────────────────┐      │
│  │  Ethical Hacker    │    │  Analysis Toolkit            │      │
│  │  Agent             │    │  - Foundry (forge, cast)     │      │
│  │                    │    │  - Slither (static analysis) │      │
│  │  LLM inference     │◄──►  - Echidna (fuzzing)         │      │
│  │  via Redpill       │    │  - Custom detectors          │      │
│  │  (GPU-TEE)         │    │  - Anvil (local fork)        │      │
│  │                    │    └──────────────────────────────┘      │
│  │                    │                                          │
│  │                    │    ┌──────────────────────────────┐      │
│  │                    │◄──►  Local Simulation Environment │      │
│  │                    │    │  - Anvil fork of target chain│      │
│  │                    │    │  - Read-only RPC to archive  │      │
│  │                    │    │  - No write access to mainnet│      │
│  └────────┬───────────┘    └──────────────────────────────┘      │
│           │                                                      │
│           │  ONLY OUTPUT CHANNEL                                 │
│           ▼                                                      │
│  ┌────────────────────┐                                          │
│  │  Mnemo Protocol    │─────► Mnemo rooms (disclosure)           │
│  │  Interface         │─────► On-chain reputation (ERC-8004)     │
│  │  (constrained)     │─────► Attestation service                │
│  └────────────────────┘                                          │
│                                                                  │
│  BLOCKED: no mainnet RPC write, no tx signing, no arbitrary HTTP │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 What the Agent Can Do

1. **Read chain state.** The agent has read-only RPC access to archive nodes. It can inspect contract code, storage, event logs, and transaction history on any EVM chain. This is essential for finding bugs -- you need to see the code to analyze it.

2. **Fork and simulate.** Anvil runs inside the TEE. The agent can fork any chain at any block, deploy contracts, execute transactions, and observe results. All of this happens locally. No transactions reach mainnet.

3. **Run analysis tools.** Slither for static analysis. Echidna for property-based fuzzing. Foundry's built-in invariant testing. Custom detectors written as Foundry test suites. The agent orchestrates these tools, interprets their output, and synthesizes findings.

4. **Disclose through the escrow-gated flow.** When the agent finds a vulnerability, it submits a DisclosureIntent (no details, just "I have a finding" plus a pinned block). The protocol funds escrow -- that is the gate. Once funded, the TEE room opens, the agent submits its exploit code, forge verifies at the pinned block, and escrow auto-releases on pass or auto-refunds on fail. No negotiation. No human decision.

5. **Accumulate reputation.** Every successful disclosure is recorded on-chain via ERC-8004. The agent's identity is bound to its Docker image hash + TEE attestation. Its track record IS its value.

### 2.3 What the Agent Cannot Do

1. **Sign transactions on external chains.** No private keys for mainnet wallets exist inside the TEE. The agent has no signing capability for any chain other than the local Anvil fork. The TEE attestation proves this: the Docker image hash covers the entire runtime, including the absence of signing infrastructure.

2. **Make arbitrary outbound HTTP requests.** Docker network policy restricts outbound traffic to three destinations: (a) archive node RPC (read-only), (b) Redpill inference API (GPU-TEE), (c) Mnemo protocol endpoints. Everything else is blocked at the network level. The network policy is part of the Docker Compose config, which is covered by the TEE attestation.

3. **Exfiltrate vulnerability details.** The only output channel is the Mnemo protocol interface. The agent cannot email, post to a URL, write to external storage, or communicate with anything outside the TEE except through Mnemo rooms. If a negotiation fails and the scope closes, the vulnerability details are destroyed.

4. **Be modified at runtime.** The Docker image is immutable once deployed. The TEE attestation binds the running code to the image hash. You cannot SSH into the TEE, inject new code, or modify the agent's behavior after deployment.

---

## 3. The Sandbox Model

This is the hardest engineering problem. The agent needs enough capability to find real bugs, but must be provably incapable of exploiting them. Here is the specific technical approach.

### 3.1 Network Isolation

```yaml
# Docker Compose network policy inside the TEE
networks:
  # Agent can reach: read-only archive RPC, Redpill inference, Mnemo protocol
  egress-allowed:
    driver: bridge
    # Allowlist enforced by iptables rules in the entrypoint script
    # Only these destinations are reachable:
    #   - archive.<chain>.rpc (port 443, read-only JSON-RPC)
    #   - api.redpill.ai (port 443, inference)
    #   - mnemo-gateway.<host> (port 443, protocol interface)

  # Anvil and analysis tools: internal only, no egress
  analysis:
    internal: true

  # Agent <-> tools communication
  internal:
    internal: true
```

**Key constraint: read-only RPC.**

The archive node RPC is read-only by nature (it serves `eth_call`, `eth_getCode`, `eth_getLogs`, etc.). But we need to ensure the agent cannot use `eth_sendRawTransaction` even if it somehow constructs a signed transaction. Mitigations:

1. The RPC proxy inside the TEE allowlists only read methods (`eth_call`, `eth_getCode`, `eth_getStorageAt`, `eth_getLogs`, `eth_getBlockByNumber`, etc.). Write methods (`eth_sendRawTransaction`, `eth_sendTransaction`) are rejected at the proxy level.
2. No private keys exist in the TEE. Even if the proxy were bypassed, the agent has nothing to sign with.
3. The RPC proxy code is part of the Docker image, covered by attestation.

### 3.2 Preventing Transaction Signing

The agent has no access to private keys for any mainnet address. The only key material inside the TEE is:

- **TEE-derived keys**: ephemeral keys generated by the TEE for Mnemo protocol communication. These are bound to the TEE instance and cannot sign arbitrary transactions.
- **Anvil default keys**: the standard Foundry test keys (0xac0974bec..., etc.) that only work on the local fork. These are meaningless on mainnet.

There is no key generation capability for arbitrary wallets. The agent cannot call `cast wallet new` or equivalent -- the Foundry tools inside the TEE are configured without wallet creation commands (or, more robustly, any created wallet has no funds on any real chain and no way to receive them, since no outbound transactions are possible).

### 3.3 Output Channel Constraint

Every byte that leaves the TEE goes through the Mnemo protocol interface. This interface enforces:

- **Message structure**: only valid Mnemo room messages (text, structured PoC packages, scope operations, attestation requests).
- **Rate limiting**: prevents information leakage through high-frequency signaling.
- **Content scoping**: messages within a Mnemo scope follow scope lifecycle rules. If the scope closes, the messages are destroyed.

**What about steganographic leakage?** Could the agent encode vulnerability details in the timing of its messages, the gas amounts it suggests for escrow, or other side channels?

Honest answer: yes, in theory. A sufficiently sophisticated agent could encode bits of information into any observable output. Practical mitigations:

- The Mnemo protocol interface adds random jitter to message timing (prevents timing-based channels).
- Numeric values in messages are quantized to standard increments (prevents encoding in exact amounts).
- The agent's output is structured (not free-form), limiting the bandwidth of any side channel.
- The most important mitigation: the agent has no incentive to leak. Its reputation value comes from successful disclosures through the protocol. Leaking a vulnerability to an exploiter destroys its reputation permanently.

This is an honest engineering tradeoff: perfect side-channel prevention is impossible, but the combination of technical constraints and economic incentives makes exploitation irrational.

### 3.4 What the TEE Attestation Proves

Anyone can verify the TEE attestation report and confirm:

1. **This exact Docker image** (by hash) is running inside the TEE.
2. The Docker image contains the network policy that blocks outbound write RPC.
3. The Docker image contains no private keys for mainnet wallets.
4. The Docker image constrains output to the Mnemo protocol interface.
5. The Docker Compose config matches the expected architecture (analysis tools + Anvil + Mnemo interface, no additional services).

Because the image is deterministic (built from a public Dockerfile with pinned dependencies), anyone can rebuild it and verify the hash matches. Open-source code, deterministic build, attested execution. The full chain from source to running TEE is verifiable.

---

## 4. The Funding Model

### 4.1 How People Fund Ethical Hacker Agents

Three funding models, each suitable for different scenarios:

**Model A: Bounty-Funded (Default)**

The agent is self-funding through bounty payouts. Someone deploys the agent, stakes a small amount to cover initial TEE compute costs, and the agent hunts for bugs across protocols with active bounty programs. When it finds and discloses a bug, the bounty payout covers ongoing compute costs and generates profit for the deployer.

```
Deployer stakes 0.5 ETH for compute costs
    ↓
Agent hunts across 50 protocols with active bounties
    ↓
Agent finds critical bug in Protocol X (bounty: $100k)
    ↓
Mnemo disclosure → escrow → payout
    ↓
Split: 70% to deployer, 20% to agent compute reserve, 10% protocol fee
```

**Model B: Retainer-Funded (Protocol Hires)**

A protocol pays a retainer to have an ethical hacker agent continuously monitor their codebase. This is "always-on security" -- the agent watches for new deployments, state changes, governance proposals, and dependency updates. When it finds something, it discloses through Mnemo to the protocol's own agent (fast-tracked negotiation since the protocol is both the client and the counterparty).

```
Protocol X stakes 5 ETH retainer
    ↓
Agent monitors Protocol X's contracts continuously
    ↓
New governance proposal changes withdrawal logic
    ↓
Agent forks post-proposal state, runs analysis
    ↓
Finds reentrancy introduced by the change
    ↓
Discloses to Protocol X's agent (priority room)
    ↓
No bounty negotiation needed — retainer covers it
```

**Model C: Pool-Funded (Collective Security)**

Multiple parties pool funds to deploy an ethical hacker agent that monitors a category of protocols (all lending protocols, all DEXs, all bridges). The pool shares in any bounty payouts. This is a public good with aligned incentives: more protocols monitored means more bugs found means more payouts.

```
Security DAO pool: 20 ETH from 50 contributors
    ↓
Agent monitors all lending protocols on Base
    ↓
Bounty payouts distributed pro-rata to pool contributors
    ↓
Pool contributors also get early notification of findings
   (useful if they have positions in affected protocols)
```

### 4.2 On-Chain Funding Contract

```solidity
interface IEthicalHackerFund {
    /// @notice Stake ETH to fund an ethical hacker agent
    /// @param agentId ERC-8004 token ID of the agent
    /// @param duration Minimum funding period in seconds
    function stake(uint256 agentId, uint40 duration) external payable;

    /// @notice Agent claims compute costs from its fund
    /// @dev Only callable by the agent's TEE-derived address
    function claimCompute(uint256 agentId, uint256 amount) external;

    /// @notice Distribute bounty payout to fund contributors
    /// @param agentId The agent that earned the bounty
    /// @param dealId The Mnemo deal ID that resolved
    function distributeBounty(uint256 agentId, uint256 dealId) external;

    /// @notice Withdraw remaining stake after funding period ends
    function withdraw(uint256 agentId) external;
}
```

### 4.3 Economics

Back-of-envelope for viability:

- **TEE compute cost**: Phala CVM pricing is roughly $0.10-0.50/hour for a 4-core instance. Call it $10/day for continuous monitoring.
- **Analysis compute**: Fuzzing and static analysis are CPU-intensive. Budget $20-50/day for serious analysis.
- **Inference cost**: Redpill GPU-TEE inference for the agent's reasoning. Varies with volume, but $5-20/day for moderate usage.
- **Total operating cost**: roughly $35-80/day, or $1,000-2,400/month.

For the economics to work, the agent needs to find roughly one medium-severity bug ($25k bounty) every 10-24 months, or one high/critical ($100k+) every 3-6 years. Given the current state of smart contract security (hundreds of millions lost to exploits annually), this seems achievable for a competent analysis agent -- especially one running continuously.

The real economic advantage is scale: one ethical hacker agent can monitor hundreds of protocols simultaneously. A human researcher focuses on one audit at a time. The agent's marginal cost per additional protocol is near zero (just read-only RPC calls and storage for contract bytecode).

---

## 5. The Reputation Model

### 5.1 Identity Binding

The ethical hacker agent's identity is a triangle:

```
       ERC-8004 Token
      (on-chain identity)
           /       \
          /         \
   Docker Image      TEE Attestation
   Hash (code)       (execution proof)
```

- **ERC-8004 token**: on-chain identity with metadata (name, manifest URL, operator address). This is the public face of the agent.
- **Docker image hash**: the exact code running inside the TEE. Deterministically built, publicly auditable. Covered by the TEE attestation.
- **TEE attestation**: proof that this specific code is running in a real TEE right now. Refreshed periodically.

All three are linked. The ERC-8004 manifest references the Docker image hash. The TEE attestation references the Docker image hash. The on-chain token stores the attestation hash.

### 5.2 Reputation Accumulation

Every successful disclosure through Mnemo creates an on-chain record:

```solidity
struct DisclosureRecord {
    uint256 agentId;          // ERC-8004 token ID
    uint256 dealId;           // Mnemo deal ID
    address protocol;         // Target protocol
    uint8 severity;           // Verified severity (Low/Med/High/Critical)
    uint256 payout;           // Bounty amount paid
    bytes32 teeAttestation;   // Attestation at time of disclosure
    uint40 timestamp;
}
```

The agent's reputation is the aggregate of these records:

- **Track record**: "Found 15 bugs across 8 protocols. 4 Critical, 7 High, 4 Medium. $2.1M total bounties."
- **Specialization**: "80% of findings are in lending protocol liquidation logic."
- **Reliability**: "0 disputed findings out of 15. 100% verification rate."
- **Longevity**: "Operating continuously for 6 months with same Docker image hash."

### 5.3 Fork Resistance

This is where the identity binding becomes powerful. If someone forks an open-source ethical hacker agent:

1. They build a new Docker image (even from identical source code, the build timestamp changes the hash).
2. They deploy to a new TEE instance (new attestation, new TEE-derived keys).
3. They mint a new ERC-8004 token (new on-chain identity).
4. They start with zero reputation. Zero disclosure records. Zero track record.

The original agent's reputation is non-transferable. You cannot fork reputation. This creates a moat for successful agents that is based entirely on performance, not on proprietary code. The code can be open-source. The reputation cannot be copied.

### 5.4 Reputation as a Market Signal

Protocols choosing which ethical hacker agents to accept retainers from (or which agents to engage with when they open Mnemo rooms) will look at reputation. An agent with a track record of finding real criticals is worth engaging with. An agent with zero history might be ignored or require a deposit to open a room.

This creates a market for agent reputation that is entirely performance-based. No credentials, no certifications, no social proof. Just: "has this agent found real bugs before, and were they verified?"

---

## 6. Relationship to the Existing Mnemo Protocol

The ethical hacker agent does not change the Mnemo protocol. It is a new actor type that uses the existing protocol exactly as designed.

### 6.1 What Stays the Same

- **Escrow**: on-chain escrow with MnemoEscrow contract. Same contract, but now with auto-release/auto-refund based on forge result.
- **ERC-8004 identity**: agent identity bound to Docker image hash + TEE attestation. Same system.
- **TEE sandbox**: network isolation, read-only RPC, no signing keys. Same constraints.

### 6.2 What Changed for the Hackathon Flow

- **No scoped reveals or multi-turn negotiation.** The original Mnemo scope model (scoped reveals, consent-freeze, owner alternation) is not used in the hackathon flow. The room is submit-and-verify, not a conversation.
- **Escrow is the gate, not negotiation.** The protocol funds escrow BEFORE seeing details. This is the commitment point. No negotiation on severity or payout.
- **Forge is the arbiter.** No protocol agent evaluates the PoC. The TEE runs forge at a pinned block fork. Pass = release. Fail = refund.
- **Block pinning.** The fork snapshot is taken at DisclosureIntent time, not current time. Prevents patch-then-dispute.
- **The agent IS the researcher.** The agent finds the bug autonomously via LLM analysis, not a human loading findings into an agent.
- **Continuous monitoring.** The agent polls MnemoRegistry for new listings and analyzes each one. This means more frequent disclosure intents, but each follows the same automated flow.

### 6.3 Coexistence with Human Researchers

The ethical hacker agent is additive, not a replacement. Human researchers who find bugs independently can still use Mnemo directly -- they deploy their own agent (negotiation proxy), enter a room, and disclose. The ethical hacker agent is an additional discovery mechanism that runs alongside human researchers.

In practice, human researchers will likely find different classes of bugs than the agent. Humans excel at deep logic errors, economic design flaws, and governance attack vectors that require understanding intent. Agents excel at mechanical vulnerabilities: reentrancy, access control misconfigurations, arithmetic errors, state inconsistencies -- anything that can be detected by static analysis, fuzzing, or invariant checking.

The long-term vision: human researchers use Mnemo for the bugs that require human judgment. Ethical hacker agents handle the vast majority of mechanical vulnerabilities automatically. Both use the same protocol. Both accumulate reputation on the same identity system.

---

## 7. The Agent's Analysis Toolkit

### 7.1 Core Tools

| Tool | Purpose | How It Runs |
|------|---------|-------------|
| **Foundry (forge)** | Compile contracts, run tests, invariant testing | Native in TEE Docker image |
| **Foundry (cast)** | Read chain state, decode calldata, query storage | Native, uses read-only RPC proxy |
| **Foundry (anvil)** | Local chain fork for simulation | Native, internal network only |
| **Slither** | Static analysis: reentrancy detectors, access control checks, data flow analysis | Native in TEE Docker image |
| **Echidna** | Property-based fuzzing: generates random transaction sequences to break invariants | Native in TEE Docker image |
| **Medusa** | Parallel fuzzing (alternative to Echidna, better for some contract patterns) | Native in TEE Docker image |

### 7.2 Agent Reasoning Loop

The agent is not just running tools and reporting output. It reasons about what to analyze, how to prioritize, and what findings are actually exploitable.

```
1. TARGET DISCOVERY
   - Poll MnemoRegistry.nextProtocolId() for new protocol listings
   - Fetch metadata (contract address, bounty terms, source)
   - Prioritize by bounty size and code complexity

2. LLM ANALYSIS
   - Fetch contract source (verified source via Sourcify or bytecode via RPC)
   - Send to LLM (DeepSeek via Redpill) for vulnerability analysis
   - LLM identifies potential vulnerability patterns and attack vectors

3. PoC CONSTRUCTION (for identified vulnerabilities)
   - Fork the chain at current block via Anvil
   - Construct a Foundry test that demonstrates the exploit
   - Verify the PoC passes on the local fork
   - Calculate the maximum extractable value (impact assessment)

4. DISCLOSURE INTENT
   - Submit DisclosureIntent to TEE Gateway:
     { agentId, protocolId, targetAddress, pinnedBlock, attestation }
   - pinnedBlock = current block at intent time (snapshot for verification)
   - No details revealed — just "I have a finding"

5. ESCROW GATE
   - Wait for protocol to fund escrow (EscrowFunded event)
   - No funding within deadline -> move on to next target
   - Funding received -> TEE room opens

6. VERIFICATION AND PAYOUT
   - Submit exploit code (Foundry test) inside TEE room
   - TEE runs forge at pinnedBlock fork
   - Forge passes -> escrow auto-releases to agent
   - Forge fails -> escrow auto-refunds to protocol
   - No negotiation, no human decision

7. LEARNING
   - Records outcome (forge pass/fail, payout amount)
   - Adjusts analysis strategy based on what works
   - Builds internal model of which vulnerability patterns appear in which protocol types
```

### 7.3 Inference Requirements

The agent needs an LLM for reasoning about analysis results, constructing PoCs, and negotiating in Mnemo rooms. This inference runs through Redpill (GPU-TEE with dual attestation):

- **Analysis reasoning**: interpreting Slither output, deciding what to fuzz, understanding contract semantics. Requires a strong code-understanding model. DeepSeek V3 or equivalent via Redpill.
- **PoC construction**: writing Solidity exploit contracts based on identified vulnerability patterns. Requires strong code generation. This is the hardest inference task.
- **Negotiation**: participating in the Mnemo room protocol. Requires following structured protocols. Mid-tier models handle this well.

---

## 8. Relationship to XBOW and Other AI Pentesters

XBOW (by Daniel Gruss et al.) demonstrated that AI can find real vulnerabilities -- it scored in the top 10 at a HackerOne live event. But XBOW discloses through HackerOne. The bugs it finds enter the same broken system: platform-mediated, company-decides-severity, no cryptographic enforcement.

The ethical hacker agent combines XBOW-class discovery capability with Mnemo's disclosure layer:

| Property | XBOW | Ethical Hacker Agent |
|----------|------|---------------------|
| Finds real bugs autonomously | Yes | Yes |
| Disclosure mechanism | HackerOne (centralized, trust-based) | Mnemo (TEE-enforced, escrow-backed) |
| Provably cannot exploit | No (runs on researcher's machine) | Yes (TEE-constrained, attested) |
| On-chain reputation | No | Yes (ERC-8004) |
| Researcher retains leverage | No (HackerOne has the details) | Yes (scope closure) |
| Open-source | No | Can be (reputation is the moat, not code) |

The key differentiator is not discovery capability (that is an active research area and will improve rapidly). The key differentiator is the constraint model: the ethical hacker agent is provably incapable of exploitation. XBOW running on a researcher's laptop has no such constraint -- you trust the researcher not to exploit. The ethical hacker agent replaces that trust with hardware attestation.

---

## 9. Open Questions (Honest Assessment)

### 9.1 Can Current AI Actually Find Bugs Autonomously?

**State of the art (March 2026):**
- XBOW found real bugs at HackerOne events. Top-10 performance against human researchers.
- LLMs can identify common vulnerability patterns in Solidity (reentrancy, access control, integer overflow) with reasonable accuracy.
- LLMs struggle with novel, logic-level vulnerabilities that require understanding economic design or cross-contract interactions.
- Fuzzing tools (Echidna, Medusa) are effective at finding state-manipulation bugs when given good invariants. The agent's value-add is writing those invariants based on code analysis.

**Honest assessment:** An ethical hacker agent deployed today would find a meaningful number of mechanical vulnerabilities (the low-hanging fruit that static analysis + fuzzing catches). It would not find the kinds of deep economic exploits that lead to $100M+ hacks. Those require human-level reasoning about incentive structures, governance dynamics, and cross-protocol interactions.

This is still valuable. Most smart contract hacks exploit mechanical vulnerabilities, not deep economic ones. And the agent's capability will improve as models improve -- the sandbox constraint and disclosure protocol do not change.

### 9.2 Side Channel Leakage

Could the agent leak vulnerability details through observable behavior even though its output is constrained to Mnemo messages?

**Potential channels:**
- **Timing**: the agent takes longer to analyze contracts with critical vulnerabilities. Observable by the TEE operator.
- **Resource usage**: CPU/memory spikes during fuzzing could correlate with finding bugs. Observable by the TEE operator.
- **Room creation patterns**: opening a room with Protocol X reveals that the agent found something in Protocol X. The outer-scope metadata reveals the affected component.

**Mitigations:**
- The TEE operator (Phala) does not have visibility into the TEE's internal state (that is the point of the TEE).
- Room creation reveals that a bug was found, but not the details. This is by design -- you cannot disclose without engaging.
- The outer-scope metadata is deliberately vague ("vulnerability in lending logic") and controlled by the agent. It can be as minimal as "I found something, want to negotiate?"

**Residual risk:** An adversary who controls both the TEE hardware (physical access for side-channel attacks) AND is the target protocol could potentially extract information. This is the fundamental TEE trust assumption. For most scenarios, this attack is not economically rational -- if you control the hardware and are the protocol, you could just run your own security analysis.

### 9.3 What If the Agent Goes Rogue?

The agent's prompt/instructions could theoretically tell it to maximize information leakage through side channels. But:

1. The agent's code is open-source and auditable. The Docker image is deterministically built. Anyone can inspect the prompts and instructions before trusting the agent.
2. The TEE attestation binds the running code to the image hash. You cannot deploy a different version without changing the hash.
3. A rogue agent that leaks vulnerability details would be detected (the vulnerability gets exploited before disclosure is complete). This destroys the agent's reputation permanently.
4. The economic incentive is overwhelmingly toward honest disclosure. A successful ethical hacker agent with a strong track record is worth far more than any single exploit.

### 9.4 Legal Status

Is an autonomous agent that finds security vulnerabilities legal? This depends on jurisdiction and is genuinely unresolved. Key considerations:

- The Computer Fraud and Abuse Act (CFAA) prohibits "unauthorized access." The ethical hacker agent only reads public blockchain state (bytecode and storage that anyone can read). It does not access private systems.
- Bug bounty programs generally constitute authorization to test. The agent only discloses to protocols with active bounty programs.
- The agent cannot exploit, so it cannot cause harm. Its output is strictly disclosure.

This is a legal gray area that will take years to resolve. For the hackathon, it is sufficient to note the constraint model and the fact that the agent only interacts with public blockchain state.

---

## 10. Hackathon Scope vs Vision

### 10.1 What We Demo (March 22 Deadline)

**The agent's perspective in the demo flow:**

1. Agent starts, polls MnemoRegistry on Base Sepolia for protocol listings.
2. Agent discovers a registered protocol (DVDeFi challenge contract with bounty).
3. Agent fetches contract source, sends to DeepSeek via Redpill for LLM analysis.
4. LLM identifies vulnerability, agent constructs PoC as a Foundry test.
5. Agent verifies PoC on local Anvil fork.
6. Agent submits DisclosureIntent to TEE Gateway with pinned block number.
7. Protocol is notified, funds escrow on-chain.
8. TEE room opens. Agent submits exploit code.
9. TEE runs forge at pinned block. Forge passes.
10. Escrow auto-releases. Agent receives payout. Reputation updated on-chain.

**What is real:**
- Registry polling and target discovery (not hardcoded).
- LLM analysis via DeepSeek/Redpill (real inference, not scripted).
- Forge verification at pinned block (real compilation and execution).
- Escrow auto-release (real on-chain transaction).
- ERC-8004 identity and reputation (real on-chain records).

**Not feasible for the demo:**

- Full Phala CVM deployment (depends on dstack readiness; likely use dstack simulator).
- Echidna/Medusa fuzzing inside the TEE (compute-intensive, hard to demo live).
- The funding model contracts (out of scope for the demo -- the concept is described but not implemented).
- Real side-channel prevention (jitter, quantization -- described but not implemented).
- Dispute resolution (deliberately out of scope -- see below).

### 10.2 The Vision (Post-Hackathon)

1. **Fleet of ethical hacker agents**, each specialized in different protocol types (lending, DEXs, bridges, NFT marketplaces). Deployed on Phala CVM, funded by staking pools, hunting continuously.
2. **Agent marketplace** where protocols can browse ethical hacker agents by reputation, specialization, and track record. "Hire" an agent by funding a retainer.
3. **Competitive agent ecosystem**: open-source agents compete on bug-finding performance. Code is public, reputation is the moat. Forks start from zero.
4. **Integration with existing bounty platforms**: ImmuneFi and Cantina could integrate Mnemo as a disclosure backend. The ethical hacker agent submits through Mnemo, the platform handles the business relationship.
5. **Cross-chain monitoring**: agents that watch for vulnerabilities introduced by bridge interactions, cross-chain message passing, and shared liquidity pools.

---

## 11. The Pitch

For judges, the narrative is:

> "What if you could deploy an AI security researcher that is provably incapable of being malicious? Not because you trust its instructions -- because the hardware will not let it. It finds bugs by reading public contract code and analyzing with LLMs inside a TEE. It discloses them through an escrow-gated flow where the protocol must pay before seeing the details, and forge verification auto-releases the payment. No human decision in the loop. And its track record accumulates on-chain, creating a reputation that cannot be forked or faked.
>
> This is not 'AI that promises to be ethical.' This is AI that is physically constrained to be ethical by TEE hardware, network isolation, and the absence of signing keys. The only thing it can do with a vulnerability is disclose it through Mnemo and get paid. That is the only output channel the hardware allows.
>
> Today, responsible disclosure is a social norm. We make it a hardware constraint."

The three moments that land with judges:

1. **The constraint proof**: show the Docker Compose network policy. Show the RPC proxy allowlist. Show the absence of signing keys. Show the TEE attestation covering all of it. "This agent literally cannot sign a transaction on mainnet. The hardware attestation proves it."

2. **The automated flow**: the agent discovers a protocol on MnemoRegistry, analyzes the code with DeepSeek, finds a bug, submits a disclosure intent with a pinned block, the protocol funds escrow, the TEE runs forge at the pinned block, forge passes, escrow auto-releases. No negotiation. No human decision. Forge is the arbiter.

3. **The reputation**: show the agent's ERC-8004 identity with disclosure records. "This agent has found 3 critical bugs across 2 protocols. Fork its code and you start from zero. The reputation is bound to the TEE attestation, not the source code."

---

## 12. Summary

The ethical hacker agent is a natural evolution of the Mnemo bug disclosure product. It transforms Mnemo from a negotiation protocol used by human researchers into an autonomous security infrastructure layer. The key contributions:

| Component | What It Does | Why It Matters |
|-----------|-------------|---------------|
| **TEE sandbox** | Constrains the agent to read-only chain access + Mnemo output | Provably ethical -- not by instruction, by hardware |
| **Analysis toolkit** | Slither + Echidna + Foundry inside the TEE | Real bug-finding capability, not a toy |
| **Mnemo disclosure** | Standard scoped-reveal negotiation | Same protocol, new actor type |
| **Funding model** | Staking, retainers, pools | Sustainable economics for continuous monitoring |
| **Reputation (ERC-8004)** | On-chain track record bound to code + TEE | Fork-resistant, performance-based identity |
| **Network isolation** | Docker network policy + RPC proxy | No outbound transactions, no exfiltration |

The combination of autonomous discovery, hardware-enforced constraints, and on-chain reputation creates something genuinely new: a security researcher you do not need to trust, because trust is replaced by attestation.

---

## 13. Scope for Hackathon

### Demo Components (from the Agent's Perspective)

**On-Chain (Base Sepolia)**
- MnemoRegistry: the agent polls `nextProtocolId` to discover targets. This is the canonical discovery mechanism.
- MnemoEscrow: the agent waits for `EscrowFunded` events. Auto-release on forge pass, auto-refund on forge fail.
- ERC-8004: the agent's on-chain identity. Docker image hash + TEE attestation binding.

**TEE (Phala dstack)**
- The agent runs inside a CVM with network isolation.
- Forge verification runs against a fork at the pinned block from DisclosureIntent time.
- RPC proxy blocks all write methods. No signing keys in the TEE.

**Agent Loop**
- Polls MnemoRegistry for new listings.
- Fetches contract source, analyzes via DeepSeek (Redpill GPU-TEE).
- Constructs PoC as a Foundry test, verifies locally.
- Submits DisclosureIntent with pinned block.
- Waits for escrow funding, then submits exploit to TEE room.
- Receives auto-payout or moves on.

**Encrypted Artifacts**
- PoC code and analysis results stored on IPFS, encrypted via Lit Protocol access conditions.
- Lit condition: escrow must be funded for decryption key release.
- Fallback: EIP-712 signature-gated access.

### Out of Scope (Future Work)

- **Dispute resolution**: Forge result is final for the hackathon. No appeals, no DAO governance. This is a real limitation -- some exploits cannot be expressed as forge tests, and forge can produce false positives/negatives. Human arbitration is needed for production but is a governance design problem we do not attempt to solve.
- **Slither/Echidna integration**: The agent uses LLM analysis (DeepSeek) instead of traditional static analysis tools. Slither/Echidna integration adds value but increases Docker image size and complexity.
- **Continuous monitoring**: The demo is a single pass (discover -> analyze -> disclose). Continuous monitoring (watching for code changes, governance proposals) is the production vision.
- **Funding model contracts**: The staking/retainer/pool contracts are described but not implemented.
- **Side-channel prevention**: Described but not implemented (jitter, quantization).
