# Autonomous Agent Research for Mnemo Bug Disclosure

> Research document. March 20, 2026.
> Context: Defining "autonomous agent" for Mnemo's bug disclosure product, targeting Protocol Labs ERC-8004 bounty ($8,004) and "Let the Agent Cook" bounty ($8,000).

---

## 1. Agent Autonomy Patterns

### 1.1 The OODA Loop Applied to Agents

The standard autonomous agent decision loop maps directly from Boyd's OODA (Observe-Orient-Decide-Act) to the software pattern that hackathon judges look for:

```
OBSERVE  -->  ORIENT  -->  DECIDE  -->  ACT  -->  (loop)
   |             |            |           |
   v             v            v           v
Gather state   Analyze     Select      Execute
from env       context     action      action
```

For hackathon judges, the canonical version from the Protocol Labs bounty is:

```
DISCOVER --> PLAN --> EXECUTE --> VERIFY --> SUBMIT
```

The critical insight from agent research: **the loop itself is what makes it autonomous, not any single phase**. If `act` does not feed back into `observe`, you have a pipeline, not an agent. Judges look for evidence of the feedback loop -- self-correction, retries on failure, plan adjustment based on verification results.

### 1.2 Mapping to Mnemo's Bug Disclosure Agents

**Researcher Agent OODA Loop:**

| Phase | Action | Evidence for Judges |
|-------|--------|-------------------|
| DISCOVER | Receive vulnerability report (or detect one via static analysis) | Log: "Received vuln report for SideEntranceLenderPool, assessing submission viability" |
| PLAN | Evaluate severity, check if bounty program exists, decide whether to submit | Log: "Severity assessment: Critical (complete fund drain). Bounty program found. Proceeding." |
| EXECUTE | Enter Mnemo room, reveal metadata in outer scope, negotiate terms | Log: "Opened room. Revealed: contract=SideEntranceLenderPool, severity=Critical. Awaiting buyer response." |
| VERIFY | Check buyer's counter-offer against pre-committed terms. Verify escrow funded. | Log: "Buyer offered $50k for Critical. Matches minimum ($25k). Escrow confirmed on-chain: 0xabc..." |
| DECIDE | Accept deal and reveal PoC, or walk away | Log: "Terms acceptable. Opening inner scope for PoC reveal." |
| SUBMIT | Post reputation update on-chain, close session | Log: "Negotiation committed. Reputation updated: ERC-8004 validation submitted." |

**Protocol Agent OODA Loop:**

| Phase | Action | Evidence for Judges |
|-------|--------|-------------------|
| DISCOVER | Receive incoming negotiation request, verify counterparty ERC-8004 identity | Log: "Incoming negotiation from agent 0x123 (ERC-8004 ID #42). Reputation: 12 verified bugs, 0 invalid." |
| PLAN | Assess claim metadata against bounty schedule, check for duplicates | Log: "Claim: SideEntranceLenderPool Critical. Schedule: Critical=$50k. No known duplicates." |
| EXECUTE | Respond with terms, fund escrow when agreed | Log: "Responded with terms: Critical=$50k, High=$20k. Awaiting PoC." |
| VERIFY | Run PoC through verification pipeline (deploy, run, check invariant) | Log: "Verification: invariant broken on vulnerable, holds on patched. VALID BUG confirmed." |
| DECIDE | Accept (release escrow + promote scope) or reject (refund + close scope) | Log: "Verdict: VALID, Critical. Releasing escrow and promoting scope." |
| SUBMIT | Record outcome on-chain, update reputation | Log: "Payment released: tx 0xdef... Reputation feedback submitted for researcher agent." |

### 1.3 What Winning Hackathon Submissions Look Like

From analyzing 2025-2026 hackathon winners:

**Microsoft AI Agents Hackathon 2025** (18,000 registrants, 570 submissions):
- Winner "Agentic Software Factory" used multi-agent collaboration with specialized roles (planner, coder, QA). Key pattern: each agent had a clear role and the system demonstrated autonomous handoffs between agents.
- Judges valued: multi-tool orchestration, real API usage (not mocks), visible decision logs.

**Kong Agentic AI Hackathon 2025**:
- Winner was an autonomous SRE agent that monitored, detected failures, and auto-rolled back configurations. Key: it ran a full OODA loop (observe metrics, detect anomaly, decide to rollback, execute, verify recovery).

**Consensus Hong Kong 2026**:
- "FoundrAI" won as an autonomous agent managing project lifecycle including hiring human developers. Key: end-to-end autonomy with real-world side effects.

**Common winning patterns:**
1. Multi-agent systems with specialized roles beat single-agent systems
2. Real tool usage (not mocked) -- actual API calls, actual on-chain transactions
3. Structured execution logs showing the decision loop clearly
4. Self-correction: agent detects failure, adjusts plan, retries
5. Safety guardrails: validation before irreversible actions

### 1.4 What Judges Will Look For (Protocol Labs Bounties)

From the bounty descriptions, the explicit judging criteria are:

**"Let the Agent Cook" ($8,000):**
1. Full decision loop: discover, plan, execute, verify, submit
2. ERC-8004 identity registration (real on-chain tx)
3. `agent.json` manifest (name, wallet, identity, tools, constraints)
4. `agent_log.json` showing decisions, tool calls, retries, failures
5. Multi-tool orchestration (scores higher than single tool)
6. Safety guardrails before irreversible actions
7. Compute budget awareness

**"Agents With Receipts" ($8,004):**
1. ERC-8004 registry interactions via real on-chain transactions
2. Autonomous agent architecture with planning, execution, verification, decision loops
3. Agent identity + operator model (ERC-8004 linked to operator wallet)
4. On-chain verifiability (viewable on block explorer)
5. DevSpot Agent Manifest compatibility (`agent.json`, `agent_log.json`)

---

## 2. Agent Identity Lifecycle

### 2.1 ERC-8004 Registration Flow

ERC-8004 defines three registries on Ethereum (live on mainnet since January 29, 2026, also on Sepolia):

**Identity Registry** (ERC-721 based):
```
1. Agent owner calls register(agentURI, metadata[])
2. Receives NFT token ID = agent's global identifier
3. agentURI points to registration file (JSON) with:
   - Agent name, description
   - Services and endpoints (A2A, MCP)
   - Supported trust models (tee-attestation, reputation)
4. Owner calls setAgentWallet(agentId, wallet, signature)
   - Links payment address with EIP-712 proof
```

**Reputation Registry** (feedback-based):
```
1. After completed interaction, counterparty calls:
   giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
   - value: int128 (positive or negative)
   - tags: categorization ("bug-disclosure", "critical")
   - feedbackURI: off-chain details (proof of payment, context)
2. Agent can respond: appendResponse(agentId, clientAddress, feedbackIndex, responseURI, responseHash)
3. Anyone can read: getSummary(agentId) for aggregated reputation
```

**Validation Registry** (proof-based):
```
1. Agent owner submits work: validationRequest(validatorAddress, agentId, requestURI, requestHash)
2. Validator (e.g., TEE attestation oracle) responds:
   validationResponse(requestHash, response, responseURI, responseHash, tag)
   - response: 0-100 scale (0=fail, 100=pass)
3. Anyone reads: getValidationStatus(requestHash) for verification proof
```

### 2.2 Minimal Viable Identity for Mnemo Demo

**What we must implement (2 days):**

```
Phase 1: Registration (at agent startup)
├── Deploy or reference existing IdentityRegistry on Base Sepolia
├── Researcher agent: register("ipfs://researcher-agent.json")
├── Protocol agent: register("ipfs://protocol-agent.json")
├── Both: setAgentWallet(agentId, operatorWallet, sig)
└── Log: ERC-8004 registration tx hashes (viewable on basescan)

Phase 2: Identity verification (at room entry)
├── Each agent reads counterparty's ERC-8004 identity
├── Verify: ownerOf(agentId) matches expected operator
├── Verify: agentURI resolves to valid registration file
├── Optional: check reputation summary (getSummary)
└── Log: "Verified counterparty identity: agent #42, operator 0xabc"

Phase 3: Reputation update (after negotiation)
├── On successful commit: both agents call giveFeedback
│   ├── Researcher gives positive feedback to protocol agent
│   └── Protocol gives positive feedback to researcher agent
│   └── Tags: "bug-disclosure", severity level
├── On abort/rejection: optional negative or neutral feedback
└── Log: reputation update tx hashes

Phase 4: Validation (optional, stretch goal)
├── TEE attestation as validation proof
├── Agent submits validationRequest to a TEE validator
├── TEE validator responds with attestation-backed score
└── Creates: identity <-> TEE <-> reputation triangle
```

### 2.3 agent.json Manifest (DevSpot Format)

```json
{
  "name": "mnemo-researcher-agent",
  "version": "1.0.0",
  "operator": {
    "wallet": "0x...",
    "erc8004_identity": 42,
    "registry": "0x8004A818BFB912233c491871b3d84c89A494BD9e"
  },
  "tools": [
    "mnemo:enter_room",
    "mnemo:reveal_metadata",
    "mnemo:open_scope",
    "mnemo:close_scope",
    "mnemo:negotiate_terms",
    "mnemo:submit_poc",
    "erc8004:register",
    "erc8004:give_feedback",
    "chain:read_escrow",
    "chain:verify_identity"
  ],
  "tech_stack": ["typescript", "effect", "phala-dstack", "foundry"],
  "compute_constraints": {
    "max_turns": 30,
    "max_llm_calls": 60,
    "model": "deepseek-v3",
    "budget_usd": 0.50
  },
  "task_categories": ["bug-disclosure", "negotiation", "verification"],
  "trust_models": ["tee-attestation", "reputation"]
}
```

### 2.4 agent_log.json Structure

```json
{
  "agent_id": "mnemo-researcher-agent",
  "erc8004_identity": 42,
  "session_id": "room-abc123",
  "started_at": "2026-03-20T14:00:00Z",
  "completed_at": "2026-03-20T14:03:22Z",
  "outcome": "committed",
  "turns": [
    {
      "turn": 1,
      "phase": "discover",
      "action": "assess_vulnerability",
      "reasoning": "Received vuln report for SideEntranceLenderPool. Flash loan deposit/withdraw confusion. Severity: Critical.",
      "tool_calls": [],
      "decision": "proceed_to_negotiation"
    },
    {
      "turn": 2,
      "phase": "plan",
      "action": "prepare_submission",
      "reasoning": "Bounty program exists. Critical = $50k minimum. Preparing metadata for outer scope.",
      "tool_calls": ["erc8004:verify_identity(counterparty=43)"],
      "decision": "enter_room"
    },
    {
      "turn": 3,
      "phase": "execute",
      "action": "negotiate",
      "reasoning": "Buyer offered $50k for Critical. Above minimum ($25k). Escrow funded.",
      "tool_calls": [
        "mnemo:enter_room(counterparty=43)",
        "mnemo:reveal_metadata({contract: 'SideEntranceLenderPool', severity: 'critical'})",
        "chain:read_escrow(room=abc123)"
      ],
      "decision": "reveal_poc"
    },
    {
      "turn": 4,
      "phase": "verify",
      "action": "confirm_escrow",
      "reasoning": "Escrow confirmed on-chain. Amount matches agreed terms.",
      "tool_calls": ["chain:read_escrow(room=abc123)"],
      "result": "escrow_confirmed",
      "decision": "open_inner_scope"
    },
    {
      "turn": 5,
      "phase": "execute",
      "action": "reveal_poc",
      "tool_calls": ["mnemo:open_scope({poc: '...', nonce: '...'})"],
      "decision": "await_verification"
    },
    {
      "turn": 6,
      "phase": "verify",
      "action": "check_outcome",
      "reasoning": "Verification verdict: VALID BUG, Critical. Buyer accepted. Scope promoted.",
      "tool_calls": [],
      "decision": "accept_commit"
    },
    {
      "turn": 7,
      "phase": "submit",
      "action": "finalize",
      "tool_calls": [
        "erc8004:give_feedback(agent=43, value=100, tag='bug-disclosure')"
      ],
      "decision": "session_complete"
    }
  ],
  "tool_call_count": 7,
  "llm_call_count": 7,
  "compute_cost_usd": 0.12,
  "on_chain_transactions": [
    {"type": "erc8004_register", "tx": "0x...", "chain": "base-sepolia"},
    {"type": "escrow_verify", "tx": "0x...", "chain": "base-sepolia"},
    {"type": "reputation_feedback", "tx": "0x...", "chain": "base-sepolia"}
  ]
}
```

---

## 3. Negotiation Agent Examples

### 3.1 Existing Projects

**ERC-8183: Agentic Commerce (most relevant)**

The closest existing standard to what Mnemo does. ERC-8183 defines:
- Job lifecycle: Open, Funded, Submitted, Terminal
- Escrow: payment locks when job is created, releases on evaluator approval
- Walk-away: if deadline passes without completion, funds auto-refund
- Evaluator role: independent party who attests job completion
- BNBAgent SDK is the first live implementation (launched March 18, 2026)

How ERC-8183 handles the four key problems:

| Problem | ERC-8183 Approach | Mnemo's Approach |
|---------|-------------------|-----------------|
| Pre-committed terms | `setBudget(jobId, amount)` fixes price before work | Terms negotiated in outer scope, committed before PoC reveal |
| Progressive reveal | Not supported (all-or-nothing submission) | Core primitive: scoped reveals with retraction |
| Walk-away | Deadline-based auto-refund | Scope close = information destroyed, escrow refunds |
| On-chain settlement | ERC-8183 escrow contract | MnemoEscrow on Base Sepolia |

**Key difference**: ERC-8183 is for one-shot jobs (client posts job, provider submits result). Mnemo is for interactive negotiation where information reveals are progressive and reversible. ERC-8183 has no concept of "the provider reveals partial information, the client evaluates, then decides whether to see the full thing." This is Mnemo's core primitive.

**UMA Dispute Resolution (used by BNBAgent SDK)**

When an ERC-8183 job outcome is disputed, BNBAgent SDK routes to UMA's Data Verification Mechanism (DVM):
- Token holders vote on dispute resolution
- Economic incentive: voters stake tokens, correct voters earn rewards
- Dispute window before settlement is final

This is relevant to Mnemo's stretch goal (dispute flow) but out of scope for hackathon.

### 3.2 How Mnemo's "Lawyer Agent" Differs

The lawyer metaphor captures something no existing project does well:

1. **Pre-committed terms**: The agent enters the room with a mandate -- "accept Critical at $25k+, High at $10k+, walk away below $5k." This is not a smart contract constraint; it is a prompt-level constraint enforced by the agent's decision loop. The agent's private state contains:
   ```
   Private state (researcher agent):
   - Minimum acceptable: $25,000 for Critical, $10,000 for High
   - Walk-away threshold: any offer below $5,000
   - Negotiation strategy: start at $75,000, settle around $50,000
   - Hard constraint: never reveal PoC before escrow is funded
   ```

2. **Progressive information reveal**: No existing system does this. ERC-8183 is all-or-nothing. ImmuneFi is submit-and-hope. Mnemo's scoped reveals let the researcher show "I have a Critical for SideEntranceLenderPool" (outer scope) without showing the PoC (inner scope). The buyer can evaluate the claim's category and fund escrow before seeing details.

3. **Walk-away with information destruction**: When a scope closes, the content is destroyed (not just hidden -- the TEE forgets it). This is enforced by the protocol state machine (Quint spec, 15 invariants). No existing negotiation agent system has this guarantee.

4. **On-chain settlement after agreement**: On commit, the escrow releases and the scope promotes (PoC details become permanent). The on-chain transaction is the settlement; the TEE attestation is the proof that the process was fair.

### 3.3 Concrete Agent Decision Trees

**Researcher Agent Decision Tree:**
```
START
├── Receive vulnerability report
│   ├── Assess severity (Critical/High/Medium/Low)
│   ├── Check: does target have bounty program?
│   │   ├── No -> STOP (or submit anyway for reputation)
│   │   └── Yes -> continue
│   └── Check: is this a duplicate? (hash comparison if available)
│       ├── Likely duplicate -> STOP
│       └── Likely new -> continue
│
├── Enter room, verify counterparty (ERC-8004)
│   ├── Counterparty reputation < threshold -> WALK AWAY
│   └── Counterparty reputation OK -> continue
│
├── Reveal metadata in outer scope
│   ├── Contract name, severity claim, commitment hash
│   └── Await buyer response
│
├── Negotiate terms
│   ├── Buyer offers below walk-away -> CLOSE SCOPE, exit
│   ├── Buyer offers below minimum but above walk-away -> COUNTER
│   ├── Buyer offers above minimum -> ACCEPT
│   └── Buyer ghosts (timeout) -> CLOSE SCOPE, exit
│
├── Verify escrow funded (on-chain check)
│   ├── Not funded -> WAIT (with timeout)
│   ├── Funded below agreed amount -> DISPUTE / CLOSE
│   └── Funded at agreed amount -> continue
│
├── Open inner scope, reveal PoC
│   └── Await verification verdict
│
├── Receive verdict
│   ├── VALID + buyer accepts -> COMMIT (scope promotes, payment releases)
│   ├── VALID + buyer rejects -> CLOSE inner scope (PoC destroyed, escrow refunds)
│   ├── INVALID -> CLOSE inner scope (no payment)
│   └── Verification error -> RETRY or ABORT
│
└── Post-session: update reputation on-chain
```

---

## 4. Fork Resistance via TEE Binding

### 4.1 The Identity Triangle

Mnemo's fork resistance comes from binding three independently verifiable properties:

```
        ERC-8004 Identity
        (on-chain, NFT #42)
              /\
             /  \
            /    \
           /      \
  Docker Image     TEE Attestation
  Hash (code)      (execution proof)
```

Each vertex can be independently verified:
- **ERC-8004**: Anyone reads the Identity Registry on-chain
- **Docker Image**: `docker inspect --format='{{.Id}}' image` gives the hash
- **TEE Attestation**: Intel TDX quote verified via Phala's attestation service

The binding: the TEE attestation contains the `app_hash` which commits to the Docker image. The Docker image contains the code that registered the ERC-8004 identity. The ERC-8004 identity's registration file declares the TEE attestation as a supported trust model.

### 4.2 Phala's app_hash Mechanism

Phala Cloud uses Intel TDX (Trust Domain Extensions) with the following measurement chain:

```
RTMR3 = hash(docker-compose.yml)
       = hash(image digests + startup args + env vars)
```

The `compose-hash` is recorded by TEE hardware during boot. Properties:

1. **Deterministic**: Same docker-compose.yml always produces the same RTMR3
2. **Tamper-evident**: Modifying the image, args, or env vars changes RTMR3
3. **Hardware-rooted**: Intel TDX hardware signs the measurement; cannot be faked in software
4. **Includes image digests**: Even if you pull the "same" tag, the digest must match

The verification flow:
```
1. Agent boots in Phala CVM
2. TEE measures: RTMR3 = SHA256(docker-compose.yml content)
3. docker-compose.yml includes image hashes:
   image: ghcr.io/mnemo/researcher-agent@sha256:abc123...
4. TEE generates attestation quote containing RTMR3
5. Anyone can:
   a. Fetch the attestation quote
   b. Verify Intel TDX signature
   c. Compare RTMR3 against expected compose hash
   d. Confirm the code running matches the published source
```

### 4.3 Fork Resistance Analysis

**Attack: Fork the open-source Mnemo agent, deploy your own version**

What happens:
1. Forker builds new Docker image -> new image digest
2. New image digest -> new docker-compose.yml content -> new RTMR3
3. New CVM -> new TEE-derived keys (Phala derives keys from app identity)
4. New keys -> must register a NEW ERC-8004 identity (cannot sign as the original)
5. New identity -> ZERO reputation

**The fork gets:**
- Working code (it is open source)
- A new identity with no history
- An honest attestation proving it runs the forked code

**The fork does NOT get:**
- The original agent's reputation (12 verified bugs, $2M paid out)
- The original agent's TEE-derived keys
- The ability to impersonate the original agent

**This is the right design**: forks compete on merit. You can fork the code, but you cannot fork the reputation. This mirrors how law firms work -- you can start a new firm with the same expertise, but you start with zero client history.

### 4.4 Phala TEE Agent Reference Implementation

Phala has published `erc-8004-tee-agent` (GitHub) implementing this exact pattern:

- TEE key derivation via `tee_auth.py` -- keys never leave Intel TDX enclave
- Identity registration on Sepolia IdentityRegistry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`)
- `AGENT_SALT` environment variable ensures identical code + different salt = different identity
- `sign_message` tool uses TEE-derived keys for all on-chain interactions
- `generate_attestation` tool produces Intel TDX attestation proof on demand

**What we can reuse from this reference:**
- TEE key derivation pattern (adapt from Python to TypeScript via `@phala/dstack-sdk`)
- Registration flow (mint NFT on IdentityRegistry, set agent URI, set wallet)
- Attestation endpoint pattern (expose `/api/tee/attestation`)

---

## 5. Minimal Demo Agent Spec (2-Day Implementation)

### 5.1 What "Autonomous Agent Architecture" Requires (Minimum Bar)

From the bounty requirements, the absolute minimum is:

1. **A decision loop that runs without human intervention** -- observe state, reason about it, choose an action, execute it, verify the result
2. **Tool calls** -- the agent must call real tools (not just generate text). At minimum: on-chain reads, ERC-8004 registration, escrow verification
3. **Self-correction** -- when a tool call fails or verification fails, the agent must detect this and adjust (retry, change plan, or abort gracefully)
4. **Structured logs** -- `agent_log.json` showing each decision with reasoning
5. **ERC-8004 identity** -- real on-chain registration transaction

### 5.2 Minimal Agent Architecture

```typescript
interface AgentConfig {
  role: "researcher" | "protocol";
  erc8004Identity: number;        // token ID
  operatorWallet: string;
  privateInstructions: string;    // natural language mandate
  tools: Tool[];                  // available tool definitions
  maxTurns: number;
  walkAwayConditions: WalkAwayRule[];
}

// The core loop -- this IS the autonomous agent
async function agentLoop(config: AgentConfig, room: MnemoRoom): Promise<AgentLog> {
  const log: AgentLog = { turns: [], toolCalls: 0, llmCalls: 0 };

  // Phase 1: DISCOVER
  log.addPhase("discover", "Assessing negotiation opportunity");
  const counterparty = await tools.verifyIdentity(room.counterpartyId);  // ERC-8004 read
  if (counterparty.reputation < config.minReputation) {
    log.addDecision("walk_away", "Counterparty reputation below threshold");
    return log;
  }

  // Phase 2: PLAN
  log.addPhase("plan", "Preparing negotiation strategy");
  const strategy = await llm.plan(config.privateInstructions, counterparty);
  log.addDecision("proceed", strategy.reasoning);

  // Phase 3-5: EXECUTE + VERIFY + DECIDE (negotiation loop)
  while (room.status === "active" && log.turns.length < config.maxTurns) {
    // OBSERVE
    const context = room.getVisibleContext(config.role);
    const legalActions = room.getLegalActions(config.role);

    // ORIENT + DECIDE
    const { action, reasoning } = await llm.decide(context, legalActions, config.privateInstructions);
    log.addTurn(action, reasoning);

    // ACT
    const result = await room.applyAction(config.role, action);

    // VERIFY
    if (result.isError) {
      log.addRetry(action, result.error);
      // Self-correction: ask LLM to choose a different action
      const corrected = await llm.selfCorrect(context, action, result.error, legalActions);
      await room.applyAction(config.role, corrected.action);
      log.addTurn(corrected.action, corrected.reasoning + " [self-corrected]");
    }

    // Check walk-away conditions
    if (shouldWalkAway(context, config.walkAwayConditions)) {
      log.addDecision("walk_away", "Walk-away condition triggered");
      await room.applyAction(config.role, { type: "close_scope" });
      break;
    }

    // Check escrow (if applicable)
    if (action.type === "accept_terms") {
      const escrow = await tools.readEscrow(room.escrowAddress);   // on-chain read
      if (!escrow.funded || escrow.amount < strategy.minimumAmount) {
        log.addDecision("wait", "Escrow not yet funded or below minimum");
        continue;
      }
      log.addVerification("escrow_confirmed", escrow);
    }
  }

  // Phase 6: SUBMIT
  log.addPhase("submit", "Finalizing session");
  if (room.status === "committed") {
    await tools.giveFeedback(room.counterpartyId, 100, "bug-disclosure");  // on-chain tx
    log.addOnChainTx("reputation_feedback", tx.hash);
  }

  return log;
}
```

### 5.3 Minimum Tool Set

For the demo, the agent needs these real tools (not mocks):

```
MUST HAVE (satisfy bounty requirements):
1. erc8004_register       -- register agent identity on-chain (1 tx)
2. erc8004_verify         -- read counterparty identity from registry
3. erc8004_give_feedback  -- post reputation feedback on-chain (1 tx)
4. escrow_read            -- check escrow status on-chain (read call)
5. mnemo_negotiate        -- the XML-tag action from harness design

NICE TO HAVE (impress judges):
6. escrow_fund            -- protocol agent funds escrow (1 tx)
7. escrow_release         -- release payment on commit (1 tx)
8. tee_attest             -- generate TEE attestation proof
9. poc_verify             -- run PoC against invariant (foundry)
```

### 5.4 Two-Day Implementation Plan

**Day 1 (March 20): Foundation**

Morning:
- [ ] Implement `agent.json` manifest for both agents
- [ ] Implement ERC-8004 registration (use Phala's reference IdentityRegistry on Sepolia)
- [ ] Wire up the `agentLoop` skeleton with phase logging

Afternoon:
- [ ] Implement the 5 must-have tools as @effect/ai tool definitions
- [ ] Implement `agent_log.json` generation (structured log output)
- [ ] Test: agent registers ERC-8004 identity, enters room, runs one negotiation turn

Evening:
- [ ] Connect to existing harness turn loop
- [ ] Implement walk-away conditions and self-correction (retry on parse failure)
- [ ] Test: full negotiation loop (researcher + protocol agents, 10 turns)

**Day 2 (March 21): Integration + Polish**

Morning:
- [ ] Integrate verification pipeline (PoC against Side Entrance)
- [ ] Wire escrow read/verify tools to Base Sepolia
- [ ] Implement reputation feedback (giveFeedback after commit)

Afternoon:
- [ ] End-to-end test: register identities, negotiate, verify PoC, commit, update reputation
- [ ] Generate demo `agent_log.json` from real run
- [ ] Record key on-chain transaction hashes for submission

Evening:
- [ ] Polish logs, ensure all on-chain txs are viewable on basescan
- [ ] Write submission narrative
- [ ] Record demo video

### 5.5 What We Can Skip (and Still Win)

**Skip without penalty:**
- Multi-agent swarms (2 agents is fine for negotiation)
- General-purpose task decomposition (domain-specific is OK if autonomous)
- Complex compute budget tracking (simple turn count + LLM call count suffices)
- TEE attestation in validation registry (stretch goal)

**Cannot skip:**
- ERC-8004 on-chain registration (hard requirement)
- `agent.json` and `agent_log.json` (hard requirement for DevSpot compatibility)
- The decision loop with visible phases (discover/plan/execute/verify/submit)
- Real tool calls (at least on-chain reads + 1 write)
- Self-correction evidence in logs (at least one retry example)

### 5.6 The Narrative for Judges

The pitch for why Mnemo's negotiation agents are genuinely autonomous:

> "Most hackathon agents are autonomous in a single dimension -- they can code, or deploy, or analyze. Mnemo's agents are autonomous in a multi-party adversarial setting. Each agent has private goals, private information, and must make strategic decisions about what to reveal, when to reveal it, and when to walk away. This is a harder autonomy problem than single-agent task completion because each agent's optimal action depends on the other agent's unknown private state.
>
> The decision loop is: observe the room state, reason about counterparty intentions from their revealed information, decide whether to reveal more or withdraw, execute the chosen protocol action, verify the counterparty's response (including on-chain escrow status), and iterate. Self-correction happens when a proposed action is rejected by the protocol state machine -- the agent must understand why it was rejected and choose a legal alternative.
>
> Agent identity matters because negotiation is repeated. A researcher agent with a track record of 12 valid critical bugs gets different treatment than an unknown agent. ERC-8004 reputation accumulates across sessions, making identity a load-bearing component of the system, not a compliance checkbox."

---

## 6. Key References

**ERC-8004 Specification and Implementation:**
- [ERC-8004: Trustless Agents (EIP)](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Contracts (GitHub)](https://github.com/erc-8004/erc-8004-contracts)
- [Phala ERC-8004 TEE Agent (GitHub)](https://github.com/Phala-Network/erc-8004-tee-agent)
- [Deploy ERC-8004 Agent on Phala](https://phala.com/posts/erc-8004-launch)
- [ERC-8004 Practical Explainer (Composable Security)](https://composable-security.com/blog/erc-8004-a-practical-explainer-for-trustless-agents/)
- [QuickNode Developer Guide](https://blog.quicknode.com/erc-8004-a-developers-guide-to-trustless-ai-agent-identity/)

**ERC-8183 (Agentic Commerce, for context):**
- [ERC-8183: Agentic Commerce (EIP)](https://eips.ethereum.org/EIPS/eip-8183)
- [BNBAgent SDK (first implementation)](https://www.bnbchain.org/en/blog/bnbagent-sdk-the-first-live-erc-8183-implementation-for-onchain-ai-agents)

**Phala TEE and Attestation:**
- [Phala Attestation Verification](https://docs.phala.com/phala-cloud/attestation/verify-your-application)
- [TEE Attestation Guide](https://phala.com/posts/how-to-generate-attestation-repport-and-prove-your-application-runs-in-tee)

**Agent Architecture Patterns:**
- [OODA Loop for Agentic AI (NVIDIA)](https://developer.nvidia.com/blog/optimizing-data-center-performance-with-ai-agents-and-the-ooda-loop-strategy/)
- [Schneier on OODA Loop Problem](https://www.schneier.com/blog/archives/2025/10/agentic-ais-ooda-loop-problem.html)
- [Microsoft AI Agents Hackathon Winners](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/ai-agents-hackathon-2025-%E2%80%93-category-winners-showcase/4415088)
- [Kong Agentic AI Hackathon Winners](https://konghq.com/blog/news/winners-of-kong-agentic-ai-hackathon)
- [Consensus HK 2026 Hackathon](https://www.coindesk.com/tech/2026/02/12/ai-powered-agents-dominate-the-easya-x-consensus-hong-kong-hackathon)
