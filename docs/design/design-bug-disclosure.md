# Mnemo Bug Disclosure Agent — Design Document

---

## 1. Overview

A private bug disclosure system where a security researcher's AI agent and a protocol's AI agent negotiate a bug bounty inside a Mnemo room (TEE-backed negotiation with scoped reveals). The core value proposition: the researcher can prove a bug is real without permanently surrendering the information, and the protocol can verify before paying — with on-chain enforcement of the deal terms.

---

## 2. Full Agent Interaction Flow

### Phase 0: Identity & Discovery

1. **Researcher's agent** discovers a vulnerability in Protocol X.
2. Researcher's agent looks up Protocol X's Mnemo endpoint (published via ENS text record or on-chain registry). This is a public URL pointing to the protocol's always-on bounty agent.
3. Both agents verify each other's ERC-8004 identity on-chain. The researcher proves they control an address (could be a fresh one for pseudonymity). The protocol agent proves it is authorized to act on behalf of Protocol X (multi-sig or governance-delegated key).

### Phase 1: Pre-Deal Negotiation (Outer Scope)

4. Researcher's agent opens a Mnemo room. Both agents enter.
5. Researcher's agent reveals **metadata only** in the outer scope:
   - Affected component (e.g., "lending pool liquidation logic")
   - Severity claim (Critical / High / Medium / Low)
   - Chain and contract addresses affected
   - A hash commitment `H(bug_details || nonce)` — proves the researcher has the details without revealing them
6. Protocol's agent responds with its bounty schedule (or the published schedule is already known):
   - Critical: up to $500k
   - High: up to $100k
   - Medium: up to $25k
   - Low: up to $5k
7. Both agents negotiate the **pre-deal terms**:
   - Severity-contingent payout: "If verified as Critical, pay $X; if High, pay $Y; if not a valid bug, pay $0"
   - Verification criteria: what constitutes a valid bug (e.g., "demonstrates unauthorized fund extraction on a fork of mainnet state")
   - Timeout: how long the protocol's agent has to verify (e.g., 30 minutes)
   - Dispute resolution: what happens if the agents disagree on severity (covered in Section 5)
8. Once terms are agreed, the **pre-deal is committed on-chain** (see Section 4). The protocol's escrow contract locks funds for the maximum possible payout.

### Phase 2: Scoped Disclosure (Inner Scope)

9. Researcher's agent opens an **inner scope** (nested inside the room). Per Mnemo's owner alternation rule, the inner scope's owner is the protocol's agent — meaning the protocol's agent controls whether this scope commits or closes. This is intentional: the researcher is the one revealing, so the protocol needs to be the one who can't unilaterally force a commit of partial information.

   **Wait — this needs careful thought.** If the protocol's agent owns the inner scope, it could close the scope (destroying the bug details) AND still have "seen" them during the scope's lifetime. The TEE guarantees the data is destroyed on close, but the protocol's agent's *inference state* during the scope included the bug details. This is the fundamental tension.

   **Resolution:** The inner scope owner should be the *researcher's agent*. The researcher reveals the bug, the protocol's agent runs verification inside the TEE, and then:
   - If verification passes AND escrow payout is triggered on-chain → researcher commits the scope (details become permanent record, useful for the protocol's remediation)
   - If verification fails → researcher closes the scope (details destroyed)
   - If the protocol's agent stalls (doesn't trigger payout within timeout) → researcher closes the scope, escrow returns to protocol

   The key insight: the protocol's agent never gets to "keep" the bug details without paying. The TEE ensures the agent's memory is wiped when the scope closes. The protocol's agent binary is attested — it cannot exfiltrate data outside the TEE during scope lifetime.

10. Researcher's agent reveals inside the inner scope:
    - Full vulnerability description
    - Proof-of-concept (PoC) script or transaction sequence
    - Affected code paths with line references
    - The nonce for the hash commitment (protocol verifies `H(bug_details || nonce)` matches Phase 1)

11. Protocol's agent runs verification (see Section 5 for mechanism details).

12. Verification outcomes:
    - **Valid bug, severity confirmed** → Protocol's agent signs a verification attestation inside the TEE. This triggers the escrow payout on-chain. Researcher commits the scope.
    - **Valid bug, lower severity** → Agents negotiate within the pre-deal's severity-contingent terms. Payout at lower tier.
    - **Not a valid bug** → Protocol's agent provides rejection reason. Researcher closes the scope. Escrow returns.
    - **Timeout** → Researcher closes scope. Escrow returns. Researcher is free to disclose elsewhere.

### Phase 3: Settlement

13. On-chain escrow resolves based on the signed verification attestation from inside the TEE.
14. If scope was committed, the bug details are now a permanent record — the protocol can use them for remediation.
15. If scope was closed, the TEE has destroyed all bug detail state. The protocol retains only the outer-scope metadata (affected component, severity claim) which is not enough to exploit anything.

---

## 3. Docker Compose Architecture

The entire negotiation happens inside a single TEE instance (Phala dstack). The Docker Compose defines the following services:

```yaml
services:
  # === Core Mnemo Runtime ===
  
  mnemo-runtime:
    # The Mnemo harness (@effect/ai TypeScript)
    # Manages room state, scope lifecycle, DAG, consent
    # Exposes internal API for agents to interact with the room
    build: ./mnemo-runtime
    volumes:
      - room-state:/data/room
    networks:
      - internal

  researcher-agent:
    # The researcher's AI agent
    # Loaded with the vulnerability details (injected at room creation, encrypted)
    # Uses Redpill for inference (GPU-TEE, dual attestation)
    build: ./agents/researcher
    environment:
      - REDPILL_API_KEY=${REDPILL_API_KEY}
      - AGENT_ROLE=researcher
    networks:
      - internal
      - inference  # can reach Redpill API

  protocol-agent:
    # The protocol's AI agent
    # Has access to the devenv for verification
    # Uses Redpill for inference
    build: ./agents/protocol
    environment:
      - REDPILL_API_KEY=${REDPILL_API_KEY}
      - AGENT_ROLE=protocol
    networks:
      - internal
      - inference
      - devenv  # can reach the dev environment

  # === Dev Environment (for bug verification) ===

  anvil:
    # Foundry's Anvil — local Ethereum fork
    # Forks mainnet (or target chain) state at a specific block
    # The protocol agent uses this to replay/test the PoC
    image: ghcr.io/foundry-rs/foundry:latest
    entrypoint: ["anvil", "--fork-url", "${RPC_URL}", "--fork-block-number", "${BLOCK_NUMBER}"]
    networks:
      - devenv

  sandbox-runner:
    # Sandboxed execution environment for PoC scripts
    # Runs researcher-provided PoC in isolation
    # Node.js + Python + Foundry CLI (forge, cast)
    # NO network access except to anvil
    # Resource-limited (CPU, memory, time)
    build: ./sandbox
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
    networks:
      - devenv  # can only reach anvil, nothing else

  code-checkout:
    # Contains the protocol's source code (git checkout)
    # Read-only volume shared with sandbox-runner
    # Cloned at room creation from the protocol's public repo
    build: ./code-checkout
    volumes:
      - protocol-code:/code:ro
    networks:
      - devenv

  # === Infrastructure ===

  attestation-service:
    # Generates and verifies TEE attestation reports
    # Used during room setup and for on-chain verification
    build: ./attestation
    networks:
      - internal
      - external  # needs to post attestations

networks:
  internal:    # mnemo runtime <-> agents
    internal: true
  inference:   # agents -> Redpill API (outbound only)
  devenv:      # protocol agent -> anvil/sandbox (isolated)
    internal: true
  external:    # attestation posting, on-chain settlement

volumes:
  room-state:
  protocol-code:
```

### Key Isolation Properties

- **sandbox-runner** has NO internet access. It can only talk to the anvil fork. This prevents a malicious PoC from exfiltrating data.
- **researcher-agent** has no access to the devenv network. It submits the PoC to the room; the protocol-agent passes it to the sandbox.
- **anvil** forks chain state at room creation time. It is deterministic and isolated.
- The entire Docker Compose runs inside the TEE. Phala dstack's attestation covers all containers.

### What This Enables Beyond Bug Disclosure

This "negotiation room with attached dev environment" pattern generalizes to:

- **Audit negotiations:** An auditor's agent reviews code in the TEE, reveals findings in scoped reveals, protocol pays per-finding.
- **Code review for hire:** A reviewer agent examines proprietary code inside the TEE, provides feedback in scopes, code never leaves the TEE.
- **Competitive analysis:** Two protocols' agents compare implementations inside a TEE to identify integration opportunities without revealing proprietary logic.
- **Private code benchmarking:** A protocol wants to benchmark against a competitor's approach — both provide code to the TEE, results are scoped.

The dev environment containers would vary per use case (different chain forks, different language runtimes, different test frameworks), but the pattern is the same: isolated execution inside the TEE, results only visible within scopes.

---

## 4. On-Chain Pre-Deal Contract Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMnemoBountyEscrow {
    
    enum Severity { None, Low, Medium, High, Critical }
    enum DealStatus { Proposed, Funded, Verified, Disputed, Resolved, Expired }
    
    struct BountyTerms {
        address researcher;          // Researcher's address (can be fresh/pseudonymous)
        address protocol;            // Protocol's authorized address
        bytes32 bugCommitment;       // H(bug_details || nonce) from Phase 1
        bytes32 teeAttestation;      // Attestation hash of the TEE instance
        uint256[4] payoutSchedule;   // [low, medium, high, critical] in wei
        uint40 verificationTimeout;  // Seconds the protocol has to verify
        uint40 createdAt;
    }
    
    /// @notice Protocol creates and funds the escrow after pre-deal is agreed
    /// @dev Must send msg.value >= payoutSchedule[Critical] (max possible)
    function createDeal(
        BountyTerms calldata terms
    ) external payable returns (uint256 dealId);
    
    /// @notice Called by the TEE attestation service after successful verification
    /// @dev Only callable by the attested TEE instance (verified via attestation)
    /// @param dealId The deal being resolved
    /// @param severity The verified severity level
    /// @param teeSignature Signature from the TEE enclave proving verification happened
    function resolve(
        uint256 dealId,
        Severity severity,
        bytes calldata teeSignature
    ) external;
    
    /// @notice Called if verification times out — researcher can reclaim, escrow returns
    function claimTimeout(uint256 dealId) external;
    
    /// @notice Called if either party disputes the resolution
    /// @dev Triggers a dispute period where a human arbitrator or DAO can intervene
    function dispute(uint256 dealId, string calldata reason) external;
    
    /// @notice Arbitrator resolves a dispute
    function arbitrate(uint256 dealId, Severity severity) external;
    
    event DealCreated(uint256 indexed dealId, address researcher, address protocol);
    event DealResolved(uint256 indexed dealId, Severity severity, uint256 payout);
    event DealDisputed(uint256 indexed dealId, address disputedBy);
    event DealTimedOut(uint256 indexed dealId);
}
```

### How It Works

1. After Phase 1 negotiation, the protocol calls `createDeal()` with the agreed terms, sending the maximum payout amount as escrow.
2. The TEE instance's identity is bound to the deal via `teeAttestation`. Only that specific TEE can call `resolve()`.
3. Inside the TEE, after verification, the protocol's agent and the TEE attestation service co-sign the resolution. The TEE calls `resolve()` with the verified severity.
4. The contract pays out the appropriate amount to the researcher and returns the remainder to the protocol.
5. If the protocol's agent stalls, the researcher calls `claimTimeout()` after the deadline. The escrow returns to the protocol (no payment, but the researcher is free to disclose elsewhere).

### Edge Case: Deliberate Verification Failure

Eduardo identified this: what if the protocol's agent deliberately fails verification to avoid paying?

**Mitigations:**

1. **PoC-based verification is mostly automatable.** If the researcher provides a PoC script that demonstrates the bug on a forked chain, verification is "run this script, check if the invariant is violated." The protocol's agent would have to deliberately ignore passing tests, which is detectable.

2. **Verification is logged inside the TEE.** The TEE records the sandbox-runner's stdout/stderr. If the PoC clearly demonstrates the bug (e.g., unauthorized token transfer succeeds), the log is part of the attestation. A dishonest "not a valid bug" claim is provably false.

3. **Dispute mechanism.** If the researcher believes the protocol acted dishonestly, they can call `dispute()`. This triggers human arbitration. The TEE logs (including PoC execution results) can be revealed to the arbitrator under a separate scope. The arbitrator can override.

4. **Reputation.** Protocols that dispute valid bugs get flagged. Researchers can check a protocol's dispute history before engaging.

5. **Practical reality check:** This is the hardest problem in the design. A sufficiently adversarial protocol agent could claim "the PoC didn't demonstrate what the researcher claims" and force a dispute. The dispute resolution mechanism is the ultimate backstop, and it requires some form of trusted third party (arbitrator, DAO vote, etc.). This is strictly better than the status quo (where there is no enforcement at all), but it is not fully trustless.

---

## 5. Verification Mechanism

This is the most technically challenging part. Here is a realistic approach.

### Approach: Script-Based Verification (Recommended for Hackathon)

The researcher's agent provides a **structured PoC package**:

```typescript
interface ProofOfConcept {
  // Human-readable description of the vulnerability
  description: string;
  
  // The invariant that should hold but doesn't
  // e.g., "User cannot withdraw more than their deposited balance"
  invariant: string;
  
  // Foundry test file that demonstrates the violation
  // Must be self-contained (no external dependencies beyond the protocol's code)
  foundryTest: string;  // Solidity test file contents
  
  // OR: a cast script (sequence of transactions)
  castScript?: string;
  
  // Expected outcome
  expectedResult: {
    type: 'test_failure' | 'unauthorized_transfer' | 'state_violation';
    details: string;
  };
}
```

### Verification Steps (Protocol Agent)

1. **Parse the PoC.** The protocol agent reads the PoC package. It does not need to "understand" the vulnerability deeply — it needs to execute the test and interpret the result.

2. **Static safety check.** Before running anything, the protocol agent (or a simple static analysis tool) checks that the PoC:
   - Only interacts with the protocol's contracts (no arbitrary external calls)
   - Does not contain obvious resource exhaustion (infinite loops, massive allocations)
   - References contract addresses that actually belong to the protocol

3. **Execute in sandbox.** The protocol agent passes the Foundry test to the sandbox-runner, which:
   - Places the test file in the protocol's code checkout
   - Runs `forge test --match-test <test_name> --fork-url http://anvil:8545 -vvv`
   - Captures stdout, stderr, and exit code
   - Returns results to the protocol agent

4. **Interpret results.** The protocol agent checks:
   - Did the test pass? (Foundry convention: a test that demonstrates a vulnerability often *passes* — it asserts that the exploit works)
   - Does the output match the claimed invariant violation?
   - What is the severity based on the impact? (fund loss = Critical, unauthorized state change = High, etc.)

5. **Classification.** The protocol agent maps the result to the pre-deal severity schedule and signs the verification attestation.

### What Model Capabilities Are Needed

**Researcher's agent (easier):**
- Needs to describe the vulnerability clearly and package a PoC
- The researcher (human) can pre-load this — the agent is mostly a negotiation wrapper
- Model quality: mid-tier is fine (DeepSeek V3 0324 via Redpill, Qwen 2.5 72B)

**Protocol's agent (harder):**
- Needs to interpret PoC execution results
- Needs to classify severity
- Does NOT need to discover the vulnerability — just verify it
- The verification is mostly mechanical: "did the test pass? what does the output show?"

**Realistic assessment for open-source models:**

| Task | Difficulty | Models That Could Handle It |
|---|---|---|
| Negotiate bounty terms | Low | DeepSeek V3, Qwen 2.5 72B, Llama 3.3 70B |
| Parse a Foundry test output | Medium | DeepSeek V3, Qwen 2.5 Coder 32B |
| Classify severity from PoC results | Medium | DeepSeek V3 (best bet), Qwen 2.5 72B |
| Understand a novel vulnerability from description alone | Hard | Frontier models only (Claude, GPT-4.5+) |
| Write a verification test from scratch | Very Hard | Not realistic for current open-source |

**The key design decision:** We do NOT require the protocol's agent to *understand* the vulnerability. We require it to *run a provided PoC and interpret the results*. This dramatically lowers the model capability bar. DeepSeek V3 0324 via Redpill is realistic for this.

**Fallback for the hackathon demo:** If model-driven interpretation is unreliable, make the verification even more mechanical:
- The PoC script outputs a structured JSON result: `{ "exploit_succeeded": true, "funds_at_risk": "1000 ETH", "invariant_violated": "balance_check" }`
- The protocol agent just checks the JSON fields against the pre-deal criteria
- This is less impressive but actually works

---

## 6. Trust Model & Attestation Flow

### Who Runs the TEE?

**Option A: Third-party TEE operator (Phala Network)**
- Both parties trust Phala's TEE infrastructure
- Neither party controls the TEE
- Attestation is verified against Phala's on-chain registry
- **This is the right answer for production.** It is analogous to how HackerOne is a trusted intermediary, except the "intermediary" is a hardware enclave with cryptographic attestation rather than a company with a legal team.

**Option B: Either party runs the TEE, with remote attestation**
- The other party verifies the TEE attestation before entering the room
- In theory, TEE guarantees hold regardless of who runs the hardware
- In practice, there are side-channel attacks against SGX/TDX, and the party running the hardware has more attack surface
- **Not recommended for high-value bounties.** Acceptable for a demo.

**For the hackathon: Option B (self-hosted) for the demo, with the design targeting Option A.**

### Attestation Flow

```
1. Room creator (researcher) deploys Docker Compose to Phala dstack
2. dstack generates a TEE attestation report containing:
   - Hash of all container images (Docker image digests)
   - Hash of the Docker Compose configuration
   - The TEE's ephemeral public key
3. Attestation report is posted on-chain (or IPFS with on-chain hash)
4. Protocol's agent (or protocol's infrastructure) verifies:
   - The container image hashes match known-good Mnemo runtime images
   - The Docker Compose config matches the expected architecture
   - The TEE attestation is valid (Intel/AMD signature chain)
5. Protocol's agent joins the room, establishing encrypted channel to the TEE
6. All subsequent communication is encrypted to the TEE's ephemeral key
```

### What the TEE Guarantees

- **Confidentiality:** Bug details inside a scope are not visible outside the TEE. Not to the TEE operator, not to the researcher (once submitted), not to anyone except the agents running inside.
- **Integrity:** The Mnemo runtime's scope lifecycle (open/commit/close) executes as specified. A closed scope's data is destroyed.
- **Attestation:** Both parties can verify they are talking to the correct code running in a real TEE.

### What the TEE Does NOT Guarantee

- **Side channels.** A sufficiently motivated attacker running the TEE hardware could potentially extract information via power analysis, timing attacks, etc. This is a known limitation of current TEE technology. For most bug bounty scenarios, this attack is not economically rational (it is cheaper to just pay the bounty).
- **Agent correctness.** The TEE guarantees the *runtime environment* is correct. It does not guarantee that the *agents* behave honestly. A buggy or malicious agent binary could still misbehave. Attestation of the agent images mitigates this — both parties verify the agent code before joining.
- **Availability.** The TEE operator could shut down the TEE mid-negotiation. This is handled by the timeout mechanism: if the TEE goes offline, the on-chain escrow eventually returns to the protocol, and the researcher is free to disclose elsewhere.

---

## 7. Generalization Beyond Bug Disclosure

The pattern is: **private negotiation + verifiable computation + on-chain settlement**. Bug disclosure is one instance. Here are others:

### Smart Contract Audit Negotiation
- Auditor's agent reviews protocol code inside the TEE
- Findings are revealed in individual scopes (one per finding)
- Protocol pays per-finding based on severity
- If the protocol disputes a finding, the scope can be closed (finding retracted) or escalated
- **Advantage over status quo:** Auditors currently write reports and hope they get paid. This makes it transactional per-finding.

### Private Code Review / Consulting
- A developer's agent reviews proprietary code inside the TEE
- Provides feedback/suggestions in scopes
- The code owner pays for accepted suggestions
- Code never leaves the TEE
- **Use case:** A protocol wants advice from a competitor's developer without revealing their codebase publicly.

### Vulnerability Trading (Secondary Market)
- Researcher A discovers a bug, gets a commitment hash on-chain
- Researcher A's agent negotiates with Buyer B's agent inside a TEE
- Buyer verifies the bug is real, pays, and receives the right to disclose
- **This is ethically fraught** but technically possible. The design should probably not optimize for this.

### MEV Strategy Negotiation
- Two MEV searchers want to collaborate on a strategy without revealing their approaches
- They can each reveal partial strategies in scopes, test combined profitability on a fork, and commit only if both agree
- **Very natural fit for the devenv architecture.**

---

## 8. Limitations & Honest Feasibility Assessment

### What Is Buildable for the Hackathon (March 13-22)

**Realistic demo scope:**
1. Two agents (researcher + protocol) negotiating in a Mnemo room — **yes, this is the core harness work already planned**
2. Pre-deal committed on-chain (Base testnet) — **yes, straightforward Solidity contract**
3. A PoC script executed in a Foundry sandbox inside Docker Compose — **yes, Anvil + Forge are easy to containerize**
4. Scope commit/close based on verification result — **yes, this is core Mnemo**
5. Running inside Phala dstack — **uncertain, depends on dstack local dev progress**

**Likely cuts for the demo:**
- TEE attestation flow will be mocked (generate attestation report, but verification is not end-to-end)
- The "protocol agent verifies the bug" step will use a scripted scenario rather than genuinely autonomous agent reasoning
- Dispute resolution will be contract interface only (no actual arbitration flow)
- ERC-8004 identity will be simplified (just address verification, not full identity attestation)

### Hard Problems That Are Not Solved

1. **Agent capability for real verification.** Current open-source models cannot reliably understand novel smart contract vulnerabilities. The PoC-script approach is a workaround, not a solution. A truly adversarial researcher could provide a PoC that looks like it demonstrates a bug but actually does something else. The protocol's agent might not catch this.

2. **TEE side channels.** If the protocol is running the TEE (or has physical access to the TEE operator's hardware), they could theoretically extract bug details even if the scope is closed. This is a fundamental TEE limitation, not a Mnemo limitation. Phala's network of distributed TEE operators mitigates this but does not eliminate it.

3. **Scope closure does not erase understanding.** Even if the TEE destroys the raw bug details when a scope closes, the protocol's agent may have already formed "understanding" of the vulnerability during the scope's lifetime. If the protocol's agent is running a model with a context window, and the scope closes, the model's weights are not affected — but the inference context is destroyed. However, if the TEE operator is adversarial, they could have logged the inference context. This is again the TEE trust assumption.

4. **Economic rationality.** For very high-value bugs (e.g., $100M+ at risk), the protocol has strong incentive to find the bug independently after learning the affected component from the outer scope metadata. The outer scope reveals "lending pool liquidation logic" — the protocol's security team might be able to find the bug themselves given this hint. Mitigation: the outer scope metadata should be as vague as the researcher wants it to be.

5. **Legal enforceability.** The on-chain escrow is technically enforceable, but legal systems do not yet recognize TEE-attested smart contract interactions as binding agreements in most jurisdictions. The pre-deal is enforceable on-chain but potentially unenforceable in court.

### What Makes This Better Than the Status Quo Anyway

Despite the limitations above, this is strictly better than current options:

| Property | HackerOne/Immunefi | Direct Disclosure | Full Public Disclosure | Mnemo |
|---|---|---|---|---|
| Researcher retains leverage | No (platform has details) | No (protocol has details) | N/A (everyone has details) | Yes (scope closure) |
| Protocol can verify before paying | Yes (via triage team) | Partially | N/A | Yes (in TEE) |
| Enforceable payout | Partially (legal) | No | No | Yes (on-chain escrow) |
| Speed | Days to weeks | Variable | Immediate | Minutes (agent negotiation) |
| Trust assumption | Platform integrity | Protocol goodwill | None needed | TEE + attestation |
| Cost | 20-30% platform fee | $0 | $0 | Gas + TEE compute |
| Pseudonymous researcher | Platform-dependent | Possible | Possible | Yes (ERC-8004) |

The most compelling improvement is **speed + enforceability**. A researcher currently waits weeks for triage on HackerOne and months for payout. Here, the negotiation takes minutes, verification takes minutes, and payout is immediate upon verification.

### Honest Bottom Line

The core flow (negotiate terms, escrow funds, reveal in scope, verify, pay or close) is sound and buildable. The dev environment in Docker Compose is straightforward engineering. The on-chain contract is simple.

The hard parts are: (a) making the protocol's agent smart enough to verify real bugs autonomously, and (b) trusting TEE guarantees for high-stakes scenarios. For the hackathon, (a) is solved by using scripted/mechanical verification (PoC script outputs structured results), and (b) is acknowledged as an assumption.

This is a genuinely useful primitive even with these limitations. The "PoC script in a sandbox" verification approach is realistic and works for a large class of smart contract bugs (reentrancy, access control, arithmetic errors — anything demonstrable by a transaction sequence). The harder bugs (logic errors requiring deep protocol understanding) would still need human-in-the-loop verification, which could be a Phase 2 feature (human auditor joins the TEE room under NDA-equivalent scope constraints).

---

## 9. Suggested Implementation Order (for hackathon)

1. **Day 1-2:** On-chain escrow contract on Base testnet. Simple, well-understood Solidity.
2. **Day 2-3:** Docker Compose with Anvil + sandbox-runner. Get PoC execution working standalone.
3. **Day 3-5:** Integrate with Mnemo harness. Two agents negotiating, opening/closing scopes, triggering escrow.
4. **Day 5-7:** Demo scenario end-to-end. Pick a real (known, patched) vulnerability (e.g., a past Euler Finance or Curve exploit), write a PoC for it, and run the full flow.
5. **Day 7-8:** Polish, attestation mocking, presentation prep.

The best demo would be: "Here is a real vulnerability from [past exploit]. Watch the researcher's agent and protocol's agent negotiate a bounty, the protocol's agent verify the bug on a mainnet fork, and the payout happen on-chain — all inside a TEE, all in under 5 minutes."
