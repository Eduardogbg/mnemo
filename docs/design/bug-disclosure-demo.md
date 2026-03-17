# Bug Disclosure Demo — Technical Design

> Implementation plan for the Mnemo hackathon demo: a prover agent proves a vulnerability to a verifier inside a TEE, without revealing it to the buyer until commitment.

This document complements `design-bug-disclosure.md` (the protocol/agent interaction design) with concrete implementation details: which contracts to use, what invariants to check, what tools the TEE verifier needs, and how to make it work in days.

---

## 1. Problem Statement

We want to demonstrate Mnemo's core primitive — scoped reveals — with a compelling, concrete scenario:

1. **Prover agent** (researcher) claims to know a vulnerability in a smart contract.
2. **Verifier** (TEE) can independently confirm the claim is real by running a PoC against a known-vulnerable contract.
3. **Buyer agent** (protocol team) sees only the verification result (valid/invalid, severity) until they commit to paying.
4. On commitment, the full vulnerability details are revealed (scope promoted). On rejection, the details are destroyed (scope closed).

The TEE acts as a **trusted neutral party** — it has privileged access to a devnet, can deploy contracts, run PoCs, and check invariants. Neither the prover nor the buyer can tamper with the verification.

---

## 2. Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │              TEE (Phala dstack)              │
                    │                                             │
  ┌──────────┐     │  ┌──────────────┐    ┌──────────────────┐   │
  │  Prover  │────────│   Mnemo      │    │  Anvil (devnet)  │   │
  │  Agent   │     │  │   Runtime    │    │  - deploy vuln   │   │
  │ (outside │     │  │   (harness)  │    │  - deploy patched│   │
  │   TEE)   │     │  │              │    │  - run PoCs      │   │
  └──────────┘     │  └──────┬───────┘    └────────┬─────────┘   │
                    │         │                     │              │
                    │         │    ┌────────────────┘              │
                    │         │    │                               │
                    │  ┌──────▼────▼─────┐                        │
  ┌──────────┐     │  │   Verifier      │                        │
  │  Buyer   │────────│   Agent         │                        │
  │  Agent   │     │  │   (inside TEE)  │                        │
  │ (outside │     │  │   - tools:      │                        │
  │   TEE)   │     │  │     deploy()    │                        │
  └──────────┘     │  │     fund()      │                        │
                    │  │     runPoC()    │                        │
                    │  │     checkInv()  │                        │
                    │  └────────────────┘                        │
                    │                                             │
                    └─────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Base (on-chain) │
                              │  - escrow        │
                              │  - attestation   │
                              └─────────────────┘
```

**Key insight for judges:** The prover never enters the TEE. It submits a PoC script through the Mnemo room's scoped reveal. The verifier (inside the TEE) runs the PoC against real contract code on a local devnet. The buyer only sees the verification verdict until payment is confirmed. This is the "SQL transaction for sensitive information" in action.

---

## 3. Test Corpus Selection

### Why NOT evmbench

evmbench (paradigmxyz/evmbench) is **not a vulnerability test suite**. It is a benchmarking and AI agent harness platform for finding bugs in arbitrary user-submitted contracts. It has:
- A FastAPI backend, RabbitMQ job queue, and a worker that runs LLM-based detection
- A submodule pointing to OpenAI's frontier-evals
- No curated set of vulnerable contracts

It is not useful for our demo. We need contracts with **known, well-understood vulnerabilities** and clear invariants.

### Primary: Damn Vulnerable DeFi v4

[damn-vulnerable-defi](https://github.com/tinchoabbate/damn-vulnerable-defi) v4.1.0 is the right choice:

- **18 challenges**, each with a vulnerable contract and a Foundry test harness
- Uses Foundry natively (forge test, anvil-compatible)
- MIT licensed, well-documented, actively maintained
- Each challenge has explicit success conditions (invariants to break)
- Community solutions are published, so we know the PoCs work

**Selected challenges for the demo (ordered by implementation ease):**

| # | Challenge | Vulnerability | Why It Works for Demo |
|---|-----------|--------------|----------------------|
| 1 | **Side Entrance** | Flash loan deposit/withdraw confusion | Simplest invariant ("pool balance >= deposits"), clean PoC, single contract |
| 2 | **Truster** | Arbitrary function call in flash loan | Clear invariant ("only borrower repays"), demonstrates unauthorized token approval |
| 3 | **Unstoppable** | Donation attack breaks ERC4626 accounting | Good invariant ("convertToShares(totalSupply) == totalAssets()"), demonstrates DoS |
| 4 | **Naive Receiver** | Missing flash loan caller validation | Shows fee drain attack, good for severity classification demo |

### Secondary: Ethernaut (if time permits)

[Ethernaut](https://ethernaut.openzeppelin.com/) has simpler, more isolated contracts (Fallback, Re-entrancy, Delegation, Token). These are useful as additional test cases but are designed for browser-based play, not Foundry. Would require porting to Foundry tests.

### Why Not Others

- **Capture the Ether**: Outdated (Solidity 0.4-0.6), not Foundry-native
- **Paradigm CTF**: One-off event challenges, complex multi-contract setups, hard to isolate
- **CDU55/Solidity-Defects-and-Bugs**: Academic dataset, not structured as runnable tests

---

## 4. Invariant Catalog

For each selected challenge, we define the invariant, the PoC strategy, and the patched version behavior.

### 4.1 Side Entrance Lender Pool

**Contract:** `SideEntranceLenderPool.sol` — a flash loan pool for ETH

**Invariant:** `address(pool).balance >= totalDeposited`
- The pool should never have less ETH than the sum of legitimate deposits.
- Stronger: after a flash loan completes, pool balance should be unchanged.

**Vulnerability:** The `flashLoan()` function checks only that `address(this).balance >= balanceBefore` after the callback. A borrower can call `deposit()` inside the callback, which credits them with a balance entry while satisfying the flash loan repayment check. They then call `withdraw()` to drain.

**PoC strategy:**
1. Deploy `SideEntranceLenderPool`, fund with 1000 ETH
2. Deploy attacker contract that: calls `flashLoan(1000 ETH)`, in callback calls `deposit()`, then calls `withdraw()`
3. Assert: pool balance == 0, attacker balance == 1000 ETH

**Patched version:** Add a separate accounting check — track `totalFlashLoaned` and ensure deposits during flash loan callbacks do not count as repayment. Alternatively, use a reentrancy guard that prevents deposit() during flashLoan().

```solidity
// Patch: track flash loan state, reject deposit() during active loan
bool private _flashLoanActive;

function flashLoan(uint256 amount) external {
    uint256 balanceBefore = address(this).balance;
    _flashLoanActive = true;

    IFlashLoanEtherReceiver(msg.sender).execute{value: amount}();

    _flashLoanActive = false;
    if (address(this).balance < balanceBefore) revert RepayFailed();
}

function deposit() external payable {
    require(!_flashLoanActive, "No deposits during flash loan");
    unchecked { balances[msg.sender] += msg.value; }
}
```

**Severity:** Critical (complete fund drain)

---

### 4.2 Truster Lender Pool

**Contract:** `TrusterLenderPool.sol` — a flash loan pool for ERC20 tokens

**Invariant:** `token.balanceOf(pool) >= INITIAL_BALANCE` after any flash loan
- More precisely: no flash loan should enable the borrower to extract tokens beyond what they repay.

**Vulnerability:** The `flashLoan()` function accepts an arbitrary `target` address and `data` calldata, then calls `target.functionCall(data)`. The borrower can pass `target = address(token)` and `data = abi.encodeCall(token.approve, (attacker, type(uint256).max))`, causing the pool to approve the attacker to spend all its tokens.

**PoC strategy:**
1. Deploy `DamnValuableToken`, deploy `TrusterLenderPool` with 1M tokens
2. Call `flashLoan(0, player, address(token), abi.encodeCall(IERC20.approve, (player, type(uint256).max)))`
3. Call `token.transferFrom(pool, recovery, 1_000_000e18)`
4. Assert: pool balance == 0

**Patched version:** Remove the arbitrary `target`/`data` parameters. Use a callback interface instead:

```solidity
// Patch: use a typed callback, no arbitrary calls
function flashLoan(uint256 amount) external nonReentrant returns (bool) {
    uint256 balanceBefore = token.balanceOf(address(this));
    token.transfer(msg.sender, amount);
    IFlashLoanBorrower(msg.sender).onFlashLoan(amount);
    if (token.balanceOf(address(this)) < balanceBefore) revert RepayFailed();
    return true;
}
```

**Severity:** Critical (complete fund drain)

---

### 4.3 Unstoppable Vault

**Contract:** `UnstoppableVault.sol` — an ERC4626 vault with flash loans

**Invariant:** `flashLoan()` should always be callable (vault is "unstoppable")
- Specifically: `convertToShares(totalSupply) == totalAssets()` must hold for flash loans to work.

**Vulnerability:** The flash loan function requires `convertToShares(totalSupply) == balanceBefore`. If someone directly transfers tokens to the vault (bypassing `deposit()`), `totalAssets()` increases but `totalSupply` does not. The invariant check fails, bricking all flash loans permanently.

**PoC strategy:**
1. Deploy vault with 1M DVT tokens, deposit them
2. Transfer 1 DVT directly to the vault address (not via `deposit()`)
3. Try to call `flashLoan()` — it reverts with `InvalidBalance()`
4. Assert: flash loan is permanently bricked

**Patched version:** Track assets internally rather than relying on `balanceOf`:

```solidity
// Patch: use internal accounting, not balanceOf
uint256 private _totalManagedAssets;

function totalAssets() public view override returns (uint256) {
    return _totalManagedAssets; // not asset.balanceOf(address(this))
}
```

**Severity:** Medium (DoS, no fund loss — but permanent protocol disruption)

---

### 4.4 Naive Receiver Pool

**Contract:** `NaiveReceiverPool.sol` — a flash loan pool with a fixed fee

**Invariant:** `deposits[user] is only modified by user's own actions`
- No third party should be able to trigger fees against a receiver's balance.

**Vulnerability:** Anyone can call `flashLoan()` specifying any receiver. The receiver is forced to pay the 1 ETH fee each time. An attacker can call `flashLoan()` repeatedly (via multicall) to drain a receiver's balance through accumulated fees.

**PoC strategy:**
1. Deploy pool with 1000 ETH + WETH, receiver has 10 ETH deposited
2. Call `flashLoan(receiver, 0)` ten times via multicall (each costs receiver 1 ETH in fees)
3. Assert: receiver balance == 0

**Patched version:** Require `msg.sender == receiver` or use an allowance pattern:

```solidity
// Patch: only the receiver can initiate their own flash loan
function flashLoan(IERC3156FlashBorrower receiver, ...) external returns (bool) {
    require(msg.sender == address(receiver), "Only receiver can borrow");
    // ...
}
```

**Severity:** High (unauthorized fund drain, though limited to individual receiver balances)

---

## 5. TEE Verifier Tool Design

The verifier agent inside the TEE needs a minimal but complete set of tools to run verification. These are implemented as @effect/ai tool definitions that wrap Foundry CLI commands.

### 5.1 Tool Catalog

```typescript
// Tool: deploy_contract
// Deploys the vulnerable or patched version of a test contract to the local anvil devnet.
interface DeployContract {
  contractId: string;     // e.g., "side-entrance"
  version: "vulnerable" | "patched";
  constructorArgs?: string[];  // ABI-encoded constructor args
}
// Returns: { address: string, txHash: string, blockNumber: number }
// Implementation: forge create --rpc-url $ANVIL_URL src/<id>/<Version>.sol:<Contract>

// Tool: fund_wallet
// Sends ETH (or ERC20 tokens) to a specified address on the devnet.
interface FundWallet {
  address: string;
  amount: string;         // in ETH or token units
  token?: string;         // ERC20 address; omit for native ETH
}
// Returns: { txHash: string, newBalance: string }
// Implementation: cast send --rpc-url $ANVIL_URL --private-key $FUNDER_KEY ...

// Tool: run_poc
// Executes a prover-submitted PoC script in the sandbox.
// The script is a Foundry test file (Solidity) or a cast script (shell).
interface RunPoC {
  pocType: "foundry_test" | "cast_script";
  script: string;         // file contents
  timeout: number;        // max seconds (default: 60)
}
// Returns: {
//   exitCode: number,
//   stdout: string,
//   stderr: string,
//   gasUsed?: string,
//   duration: number  // ms
// }
// Implementation:
//   foundry_test: write to /tmp/PoC.t.sol, run forge test --match-test testPoC -vvv
//   cast_script:  write to /tmp/poc.sh, run in sandbox with network restricted to anvil

// Tool: check_invariant
// Checks a predefined invariant against current devnet state.
interface CheckInvariant {
  invariantId: string;    // e.g., "side-entrance:pool-balance"
  contractAddress: string;
  params?: Record<string, string>;
}
// Returns: { holds: boolean, actual: string, expected: string, details: string }
// Implementation: cast call to read state, compare against known-good value

// Tool: get_devnet_state
// Snapshots the current devnet state for comparison.
interface GetDevnetState {
  addresses: string[];    // addresses to inspect
}
// Returns: {
//   balances: Record<string, string>,
//   blockNumber: number,
//   timestamp: number
// }
// Implementation: cast balance / cast call for each address

// Tool: snapshot_devnet / revert_devnet
// Save and restore devnet state (for running PoC against vuln, then patched).
interface SnapshotDevnet {}
// Returns: { snapshotId: string }
// Implementation: cast rpc evm_snapshot

interface RevertDevnet {
  snapshotId: string;
}
// Returns: { success: boolean }
// Implementation: cast rpc evm_revert <id>
```

### 5.2 Invariant Registry

The verifier ships with a registry of known invariants per contract. This is the key to making verification mechanical rather than requiring the agent to "understand" the vulnerability.

```typescript
const INVARIANT_REGISTRY: Record<string, Invariant[]> = {
  "side-entrance": [{
    id: "pool-balance-gte-deposits",
    description: "Pool ETH balance must be >= sum of all deposits",
    check: async (ctx) => {
      const poolBalance = await ctx.cast("balance", ctx.contractAddress);
      // For simplicity: initial deposit was ETHER_IN_POOL, check it hasn't decreased
      return { holds: BigInt(poolBalance) >= ETHER_IN_POOL };
    },
    severity: "critical"
  }],

  "truster": [{
    id: "pool-token-balance",
    description: "Pool must retain all tokens after flash loan",
    check: async (ctx) => {
      const balance = await ctx.cast("call", ctx.contractAddress, "token.balanceOf(address)", [ctx.contractAddress]);
      return { holds: BigInt(balance) >= TOKENS_IN_POOL };
    },
    severity: "critical"
  }],

  "unstoppable": [{
    id: "flash-loan-available",
    description: "Flash loan function must not revert",
    check: async (ctx) => {
      try {
        await ctx.cast("call", ctx.contractAddress, "maxFlashLoan(address)", [ctx.tokenAddress]);
        return { holds: true };
      } catch {
        return { holds: false };
      }
    },
    severity: "medium"
  }],

  "naive-receiver": [{
    id: "receiver-balance-unchanged",
    description: "Receiver balance only changes via receiver's own actions",
    check: async (ctx) => {
      const balance = await ctx.cast("call", ctx.contractAddress, "deposits(address)", [ctx.receiverAddress]);
      return { holds: BigInt(balance) >= ctx.initialReceiverBalance };
    },
    severity: "high"
  }]
};
```

### 5.3 Verification Pipeline

The verifier runs this sequence for each PoC submission:

```
1. deploy_contract(contractId, "vulnerable")
2. fund_wallet(prover_wallets)
3. snapshot_devnet()                          # save clean state
4. check_invariant(contractId)                # confirm invariant holds pre-PoC
5. run_poc(prover_script)                     # execute the exploit
6. check_invariant(contractId)                # check if invariant is broken
7. revert_devnet(snapshot)                    # restore clean state
8. deploy_contract(contractId, "patched")     # deploy fixed version
9. run_poc(prover_script)                     # same exploit against patched
10. check_invariant(contractId)               # invariant should still hold
```

**Verdict logic:**
- Step 6 invariant broken AND step 10 invariant holds → **VALID BUG** (severity from registry)
- Step 6 invariant holds → **INVALID** (PoC does not demonstrate a vulnerability)
- Step 10 invariant broken → **TEST ARTIFACT** (PoC breaks both versions, not a real bug)

---

## 6. Demo Workflow (Step by Step)

### Pre-demo setup
- Anvil devnet running inside TEE Docker Compose
- Side Entrance contract source code available in the TEE
- Verifier agent loaded with invariant registry
- Escrow contract deployed on Base Sepolia

### Live demo flow

```
TIME    ACTOR           ACTION
────    ─────           ──────
0:00    Prover          Opens Mnemo room, connects to buyer
0:15    Prover          Reveals metadata in OUTER scope:
                          "Vulnerability in SideEntranceLenderPool"
                          "Severity: Critical — complete fund drain"
                          "Commitment hash: H(poc_source || nonce)"

0:30    Buyer           Responds: "Our bounty schedule: Critical=$X, High=$Y"
0:45    Both            Agree on pre-deal terms
1:00    Buyer           Escrow funded on-chain (Base Sepolia)

1:15    Prover          Opens INNER scope (scoped reveal)
                        Reveals full PoC:
                          - Foundry test file demonstrating flash loan attack
                          - Nonce for commitment hash verification

1:30    Verifier/TEE    [Automated verification pipeline]
                        1. Verifies H(poc || nonce) matches commitment
                        2. Deploys vulnerable SideEntranceLenderPool + 1000 ETH
                        3. Checks invariant: pool balance == 1000 ETH ✓
                        4. Runs PoC script
                        5. Checks invariant: pool balance == 0 ETH ✗ BROKEN
                        6. Deploys patched version + 1000 ETH
                        7. Runs same PoC
                        8. Checks invariant: pool balance == 1000 ETH ✓ HOLDS

2:00    Verifier/TEE    Verdict: VALID BUG, Severity: Critical
                        Signs verification attestation inside TEE

2:15    Buyer           Sees verdict (but NOT the PoC details — still in inner scope)
                        Buyer agent confirms: accept and pay

2:30    On-chain        Escrow releases payment to prover
                        Inner scope promoted — PoC details now permanent

2:45    Done            Buyer now has full vulnerability details for remediation
```

### Alternative path: rejection

```
2:00    Verifier/TEE    Verdict: INVALID (invariant not broken)
2:15    Prover          Closes inner scope — PoC details destroyed
                        Escrow returns to buyer
```

### What judges see

1. **Two agents negotiating in real-time** — visible chat in the Mnemo room UI
2. **On-chain escrow** — transaction on Base Sepolia block explorer
3. **PoC execution** — terminal output showing forge test results (inside TEE)
4. **Scope lifecycle** — inner scope opens (PoC enters), closes or promotes (PoC destroyed or persisted)
5. **The key moment:** the buyer sees "VALID BUG, Critical" but cannot see the actual PoC until payment is confirmed. This is the private negotiation primitive.

---

## 7. Agent-Based vs Script-Based Verification

### Full agent approach
- Verifier is an LLM agent with tools (deploy, run, check)
- Agent interprets PoC results using natural language reasoning
- **Pros:** More flexible, can handle unexpected PoC formats, can explain reasoning
- **Cons:** Harder to trust (agent could hallucinate "valid"), slower, model quality matters
- **Model requirement:** DeepSeek V3 or better for Foundry output interpretation

### Pure script approach (recommended for demo)
- Verifier is a deterministic script: deploy, run, check invariant, compare
- No LLM involved in the verification itself — just structured pipeline
- **Pros:** Deterministic, fast, trustworthy, easy to audit
- **Cons:** Less flexible (only works for pre-registered invariants), less impressive-looking
- **No model requirement** for verification step

### Hybrid (recommended for presentation)
- Use the **pure script pipeline** for actual verification (correctness matters)
- Use an **LLM agent** to narrate what is happening and classify severity (presentation matters)
- The LLM reads the script outputs and generates a human-readable report
- If the LLM disagrees with the script, the script wins (belt and suspenders)

This is the honest approach: "We use deterministic verification for correctness, and AI for the negotiation and reporting layers."

### Long-term vision: no agents needed
As noted in the design doc, the endgame may be: the TEE just runs deterministic invariant checks. The "agent" part is the negotiation wrapper — terms, escrow, scoped reveals. The verification itself does not need intelligence, just a sandbox and invariant definitions. This is actually a strength: it means the verification is provably correct, not subject to model whims.

---

## 8. Existing Tools Landscape

### Tools we will NOT use (and why)

| Tool | Status | Why Not |
|------|--------|---------|
| **Zellic V12** | Closed beta, free when released | No API mode, web-only interface. Designed for *finding* bugs, not *verifying* known ones. Cannot integrate. |
| **Nethermind AuditAgent** | $150/mo API | Designed for *auditing* (discovery), not verification. 30% recall — not reliable enough for binary "is this bug real?" checks. Overkill and expensive. |
| **Slither-MCP** (Trail of Bits) | Open source, MCP server | Static analysis — excellent for finding patterns but cannot *run* a PoC. Could complement our pipeline for static checks. Worth integrating if time allows. |
| **Trail of Bits Claude Skills** | Open source | Security-focused code review skills. Not relevant — we are not reviewing code, we are running PoCs. |

### Tools we WILL use

| Tool | Purpose |
|------|---------|
| **Foundry (forge + cast + anvil)** | Entire devnet and PoC execution stack. Native Solidity test runner, local EVM, transaction crafting. |
| **Docker** | Sandbox isolation for PoC execution. Network-restricted container with only anvil access. |
| **Phala dstack** | TEE runtime. All containers run inside the enclave. |

### Worth knowing about (future)

- **Sherlock** contest platform has severity classification guidelines that could inform our severity mapping
- **Slither** detectors could pre-screen PoC scripts for malicious patterns (resource exhaustion, arbitrary external calls)
- **Echidna** / **Medusa** fuzzers could generate PoCs automatically given invariant definitions (Phase 2)

---

## 9. Open Questions

1. **Patched contract sourcing.** For the demo, we write patched versions ourselves. For production, where do patched versions come from? The protocol would need to provide both vulnerable and patched code, or the invariant check alone (without patched-version comparison) is sufficient.

2. **PoC script safety.** A malicious prover could submit a PoC that attempts to exploit the TEE itself (container escape, resource exhaustion). Mitigations: Docker resource limits, network isolation, execution timeout, no privileged mode. But this needs testing.

3. **Deterministic replay.** Anvil is deterministic for a given fork state + block number. But if the PoC depends on specific block timestamps or randomness, results might vary. Mitigation: pin block number and timestamp in the setup.

4. **Multiple invariants per contract.** A PoC might break one invariant but not another. The severity should be based on the *broken* invariant, not the contract's overall criticality. The invariant registry handles this.

5. **Contract size limits.** Some DVDeFi challenges (Climber, Withdrawal) involve complex multi-contract setups. For the demo, stick with single-contract challenges (Side Entrance, Truster).

6. **What if the prover submits a PoC for a contract NOT in the registry?** For production: the protocol would register its own contracts and invariants. For the hackathon: we only support the curated set.

---

## 10. Implementation Plan

### Phase 1: Standalone verification pipeline (Days 1-2)

**Goal:** `forge test` a known PoC against Side Entrance, check invariant, confirm it passes/fails.

- [ ] Create `contracts/` directory with vulnerable + patched Side Entrance contracts
- [ ] Write the PoC as a Foundry test file
- [ ] Write a shell script that: deploys, runs PoC, checks invariant, reports verdict
- [ ] Dockerize: anvil container + sandbox-runner container
- [ ] Verify the PoC succeeds on vulnerable, fails on patched

**Deliverable:** `docker compose up` runs the full verification pipeline and prints a verdict.

### Phase 2: Verifier agent with tools (Days 2-3)

**Goal:** Wrap the shell pipeline in @effect/ai tool calls.

- [ ] Implement `deploy_contract`, `fund_wallet`, `run_poc`, `check_invariant` tools
- [ ] Implement invariant registry for Side Entrance + Truster
- [ ] Verifier agent receives a PoC (as text), writes it to sandbox, runs pipeline
- [ ] Agent returns structured verdict: `{ valid: boolean, severity: string, evidence: string }`

**Deliverable:** TypeScript agent that takes a PoC string and returns a verification verdict.

### Phase 3: Mnemo room integration (Days 3-5)

**Goal:** Two agents negotiate in a Mnemo room, scoped reveal triggers verification.

- [ ] Prover agent submits metadata in outer scope
- [ ] Buyer agent responds with terms
- [ ] Prover opens inner scope, submits PoC
- [ ] Verifier pipeline runs automatically on inner scope content
- [ ] Verdict determines: promote (pay) or close (reject) inner scope
- [ ] On-chain escrow interaction (Base Sepolia)

**Deliverable:** End-to-end demo of the full flow from Section 6.

### Phase 4: Polish (Days 5-7)

- [ ] Add Truster and Unstoppable as additional test cases
- [ ] UI showing room state, scope lifecycle, agent messages
- [ ] TEE attestation (mocked or real via dstack simulator)
- [ ] Record a demo video
- [ ] Write submission text

### Stretch goals (if time)

- [ ] Slither pre-screening of PoC scripts
- [ ] Multiple PoC formats (cast scripts, raw transaction sequences)
- [ ] Dispute flow demo
- [ ] Severity negotiation (prover claims Critical, verifier downgrades to High)

---

## 11. What Makes This Compelling

The demo answers a question judges will have: "Why does this need a TEE? Why not just use a normal server?"

**The answer, in one sentence:** Without the TEE, either the prover trusts the buyer not to steal the vulnerability details (current bug bounty model), or the buyer trusts the prover that the bug is real (trust-me-bro model). The TEE eliminates both trust assumptions simultaneously.

**Concrete moment in the demo:** When the verifier returns "VALID BUG, Critical" and the buyer sees this verdict but *cannot* see the PoC code — that is the primitive in action. The buyer knows the bug is real (because the TEE verified it) but does not have the details (because they are inside a scope). This is not possible without the TEE.

**Second compelling moment:** When the buyer pays and the scope promotes — the PoC details flow to the buyer instantly. Or when the buyer rejects and the scope closes — the PoC details are destroyed. The information lifecycle is controlled, not by policy, but by cryptographic hardware guarantees.

**Why this matters beyond the demo:** The same primitive works for any "verify before reveal" scenario — trade secrets, proprietary algorithms, medical data, legal discovery. The bug disclosure scenario is just the most visceral example because the stakes are concrete (money) and the verification is automatable (run a script, check an invariant).
