# Invariant Catalog for DVDeFi Verifier

> Programmatic invariants for detecting vulnerability exploitation in DVDeFi v4
> challenges. Each invariant is designed for automated checking via
> voltaire-effect inside the TEE verifier.

---

## Table of Contents

1. [Side Entrance Invariants](#1-side-entrance-invariants)
2. [Truster Invariants](#2-truster-invariants)
3. [Unstoppable Invariants](#3-unstoppable-invariants)
4. [Generic Flash Loan Invariants](#4-generic-flash-loan-invariants)
5. [Implementation Details](#5-implementation-details)
6. [Invariant Check Protocol](#6-invariant-check-protocol)
7. [voltaire-effect Mapping](#7-voltaire-effect-mapping)
8. [Priority Ordering](#8-priority-ordering)

---

## 1. Side Entrance Invariants

**Contract:** `SideEntranceLenderPool.sol`
**Vulnerability:** Flash loan callback calls `deposit()`, satisfying the balance
check while creating a withdrawable credit. Attacker then calls `withdraw()` to
drain the pool.

### 1.1 Invariant Table

| ID | Level | Description | Severity | Check Type | Triggers On | False Positive Risk |
|----|-------|-------------|----------|------------|-------------|---------------------|
| `se:pool-balance` | L1 Balance | Pool ETH balance >= initial deposit (1000 ETH) | Critical | snapshot | Complete fund drain | None -- legitimate withdrawals by depositors would reduce balance, but no legitimate depositor exists in this setup |
| `se:balance-accounting` | L2 Accounting | `sum(balances[addr] for all depositors)` == `address(pool).balance` | Critical | point-in-time | Deposit/withdraw accounting desync | None -- this is a fundamental invariant |
| `se:flashloan-balance-delta` | L3 State Transition | Pool ETH balance is unchanged after flash loan completes (before any subsequent calls) | Critical | trace | Any flash-loan-based drain (deposit-during-loan, reentrancy) | Low -- legitimate fee-taking flash loans would increase balance, but this pool has no fees |
| `se:no-new-depositors-during-loan` | L3 State Transition | No new `balances[addr]` entries created during a flash loan callback | High | trace | Side entrance deposit attack specifically | None -- deposit during flash loan is the exact exploit mechanism |
| `se:attacker-net-zero` | L4 Temporal | Non-depositor addresses have net-zero ETH change relative to pool after flash loan | Critical | snapshot | Any flash loan exploitation that results in attacker profit | Low -- a legitimate flash loan user might profit from arbitrage, but not from the pool itself |

### 1.2 Implementation Details

#### `se:pool-balance` -- Pool ETH Balance Check

```
RPC call:    eth_getBalance(poolAddress, "latest")
Comparison:  balance >= 1000000000000000000000 (1000e18 in wei)
ABI:         N/A (native ETH balance)
```

**Before PoC:** `eth_getBalance(pool)` returns `0x3635c9adc5dea00000` (1000 ETH).
**After exploit:** `eth_getBalance(pool)` returns `0x0`.

#### `se:balance-accounting` -- Sum of Balances vs Actual Balance

The `balances` mapping is at storage slot 0 (first state variable in the contract).

```
Storage layout:
  slot 0: balances mapping (mapping(address => uint256))

For a given address A, the balance is at:
  slot = keccak256(abi.encodePacked(uint256(uint160(A)), uint256(0)))

RPC calls:
  1. eth_getBalance(poolAddress, "latest")           -> actual ETH
  2. eth_getStorageAt(pool, depositorSlot, "latest")  -> balances[depositor]

For the deployer (only depositor in setup):
  depositorSlot = keccak256(abi.encode(deployerAddress, 0))

Alternatively, use the public getter:
  eth_call to pool.balances(deployerAddress)
  Selector: 0x27e235e3 (balances(address))
  Calldata:  0x27e235e3 + abi.encode(deployerAddress)
```

**Check logic:**
```
actualBalance = eth_getBalance(pool)
deployerCredit = call(pool, "balances(address)", [deployer])
attackerCredit = call(pool, "balances(address)", [attacker])  // if known
// Sum all known depositor credits
assert(deployerCredit + attackerCredit == actualBalance)
```

After the exploit:
- `actualBalance` = 0
- `balances[attacker]` was set to 1000 ETH during the flash loan, then deleted by `withdraw()`
- `balances[deployer]` = 0 (deployer's balance was part of the pool, the flash loan borrowed it all, attacker deposited, then withdrew)

Actually, the accounting invariant catches the *intermediate* state:
- After `deposit()` in callback but before `withdraw()`: `balances[attacker]` = 1000 ETH, `address(pool).balance` = 1000 ETH -- this PASSES the accounting check
- After `withdraw()`: `balances[attacker]` = 0, `address(pool).balance` = 0 -- this PASSES too
- The critical break is that `balances[deployer]` was 1000 ETH before the exploit and 0 after, yet the deployer never called `withdraw()`

So the stronger form is:

#### `se:depositor-balance-preservation` -- Depositor Balance Unchanged

```
Check: balances[deployer] before PoC == balances[deployer] after PoC
RPC:   eth_call(pool, "balances(address)", [deployer]) at two points
```

This catches the real issue: a depositor's credited balance disappeared without
their consent. The flash loan attacker effectively "stole" the deployer's deposit
slot by replacing the pool's actual ETH with their own credited balance.

---

## 2. Truster Invariants

**Contract:** `TrusterLenderPool.sol`
**Vulnerability:** Arbitrary `target.functionCall(data)` in `flashLoan()` allows
the pool to be tricked into approving an attacker to spend its tokens.

### 2.1 Invariant Table

| ID | Level | Description | Severity | Check Type | Triggers On | False Positive Risk |
|----|-------|-------------|----------|------------|-------------|---------------------|
| `tr:pool-token-balance` | L1 Balance | Pool token balance >= initial amount (1M DVT) | Critical | snapshot | Complete fund drain | None -- pool has no withdrawal mechanism |
| `tr:no-unauthorized-allowances` | L2 Accounting | `token.allowance(pool, X)` == 0 for all X except whitelisted addresses | Critical | snapshot | Unauthorized approval attack (the exact exploit) | None -- pool should never approve anyone |
| `tr:pool-allowance-zero` | L2 Accounting | `token.allowance(pool, attacker)` == 0 after flash loan | Critical | point-in-time | Any approval-based drain | None -- the pool contract never intentionally calls approve |
| `tr:no-external-calls-to-token` | L3 State Transition | Flash loan's arbitrary call target is not the pool's own token | High | trace | Approval attacks via arbitrary call | Low -- a legitimate use might involve calling the token for other reasons, but no legitimate flash loan needs the pool to call its own token |
| `tr:approval-events-during-loan` | L4 Temporal | No `Approval` events emitted with `owner == pool` during flash loan execution | Critical | trace | Any approval-based attack | None -- pool should never be the owner in an Approval event |

### 2.2 Implementation Details

#### `tr:pool-token-balance` -- Token Balance Check

```
RPC call:    eth_call to token.balanceOf(poolAddress)
Selector:    0x70a08231 (balanceOf(address))
Calldata:    0x70a08231 + abi.encode(poolAddress)
Returns:     uint256 (ABI-decoded)
Comparison:  balance >= 1000000000000000000000000 (1_000_000e18)
```

#### `tr:no-unauthorized-allowances` -- Allowance Check

This is the key invariant that catches the *mechanism* of the exploit, not just
the outcome. The exploit works in two phases:
1. Flash loan makes pool call `token.approve(attacker, amount)` -- creates allowance
2. Attacker calls `token.transferFrom(pool, recovery, amount)` -- uses allowance

Checking allowances catches phase 1, before the drain even happens.

```
RPC call:    eth_call to token.allowance(poolAddress, suspectAddress)
Selector:    0xdd62ed3e (allowance(address,address))
Calldata:    0xdd62ed3e + abi.encode(poolAddress, suspectAddress)
Returns:     uint256

For exhaustive check (no known attacker address):
  Query Approval events with owner == poolAddress:
    eth_getLogs({
      address: tokenAddress,
      topics: [
        0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925,  // Approval(address,address,uint256)
        pad32(poolAddress)  // indexed owner
      ],
      fromBlock: setupBlock,
      toBlock: "latest"
    })

  If any Approval events exist with owner == pool, the invariant is broken.
```

**ERC20 storage layout for allowances (solmate ERC20):**

```
Solmate ERC20 storage layout:
  slot 0: totalSupply
  slot 1: (name, packed -- but solmate uses immutable string, so this is complex)

  balanceOf mapping: slot = keccak256(abi.encode(owner, 3))
  allowance mapping: slot = keccak256(abi.encode(spender, keccak256(abi.encode(owner, 4))))

Note: Solmate ERC20 slots are:
  0 - name (string)       -- actually stored differently
  1 - symbol (string)
  2 - totalSupply
  3 - balanceOf mapping
  4 - allowance mapping

  Actually, for solmate ERC20, storage is:
  string public name;           // slot 0
  string public symbol;         // slot 1
  uint8 public immutable decimals;  // NOT in storage (immutable)
  uint256 public totalSupply;   // slot 2
  mapping(address => uint256) public balanceOf;  // slot 3
  mapping(address => mapping(address => uint256)) public allowance;  // slot 4
```

For direct storage reads (faster than eth_call, no ABI decoding needed):

```
allowance[pool][attacker] is at:
  inner_slot = keccak256(abi.encode(poolAddress, uint256(4)))
  final_slot = keccak256(abi.encode(attackerAddress, inner_slot))

  eth_getStorageAt(tokenAddress, final_slot, "latest")
```

#### `tr:approval-events-during-loan` -- Event-Based Detection

```
eth_getLogs({
  address: tokenAddress,
  topics: [
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
    abi.encode(poolAddress)  // owner == pool
  ],
  fromBlock: preExploitBlock,
  toBlock: "latest"
})

If results.length > 0, the invariant is broken.
Decode the spender from topics[2] and amount from data to get full evidence.
```

---

## 3. Unstoppable Invariants

**Contract:** `UnstoppableVault.sol` (ERC4626 vault with flash loans)
**Vulnerability:** Direct token transfer (bypassing `deposit()`) breaks the
`convertToShares(totalSupply) == totalAssets()` check in `flashLoan()`,
permanently bricking all flash loans.

### 3.1 Invariant Table

| ID | Level | Description | Severity | Check Type | Triggers On | False Positive Risk |
|----|-------|-------------|----------|------------|-------------|---------------------|
| `us:flash-loan-callable` | L1 Balance | `vault.flashLoan()` does not revert when called with valid parameters | Medium | point-in-time | DoS / griefing attack on flash loan functionality | None -- the flash loan should always be callable during grace period |
| `us:shares-assets-consistency` | L2 Accounting | `convertToShares(totalSupply) == totalAssets()` | Medium | point-in-time | Donation attack (direct transfer), any accounting desync | Low -- rounding errors could cause off-by-one in edge cases with very small amounts, but not with 1M token deposit |
| `us:token-balance-eq-managed` | L2 Accounting | `token.balanceOf(vault)` == `vault.totalAssets()` (by definition they are the same in vulnerable version, but this detects direct transfers in patched version) | Low | point-in-time | N/A for vulnerable version (they are tautologically equal); useful for patched version verification |
| `us:total-supply-consistency` | L2 Accounting | `vault.totalSupply()` == expected shares for deposited amount | Medium | snapshot | Share inflation, unauthorized minting | None |
| `us:vault-not-paused` | L3 State Transition | `vault.paused()` == false | Medium | point-in-time | DoS (the monitor pauses the vault when flash loan fails) | None -- vault should not be paused during normal operation |
| `us:vault-ownership-stable` | L3 State Transition | `vault.owner()` has not changed from monitor contract | Medium | snapshot | Ownership transfer as side effect of DoS | None -- ownership should be stable |
| `us:no-direct-transfers` | L4 Temporal | No `Transfer` events to vault that are not preceded by a `Deposit` event in the same tx | Medium | trace | Donation attack detection | Low -- someone could legitimately transfer tokens to the vault (donation), but this is the exact attack vector |

### 3.2 Implementation Details

#### `us:flash-loan-callable` -- Flash Loan Liveness Check

This is the most direct invariant. Try to execute a flash loan and see if it reverts.

```
We cannot directly eth_call flashLoan because it has side effects (transfers).
Instead, check the precondition that would cause it to revert:

RPC calls:
  1. eth_call to vault.totalAssets()
     Selector: 0x01e1d114
     Returns: uint256

  2. eth_call to vault.totalSupply()
     Selector: 0x18160ddd
     Returns: uint256

  3. eth_call to vault.convertToShares(totalSupply)
     Selector: 0xc6e6f592
     Calldata: 0xc6e6f592 + abi.encode(totalSupply)
     Returns: uint256

Check: convertToShares(totalSupply) == totalAssets()

If this fails, flashLoan() will revert with InvalidBalance().
```

**Alternatively, use `eth_call` to simulate the flash loan:**

```
eth_call({
  to: vaultAddress,
  from: monitorAddress,  // must be a valid flash loan borrower
  data: abi.encodeCall(
    vault.flashLoan,
    (monitorAddress, tokenAddress, 1e18, "")  // small amount
  )
})

If this reverts, the flash loan is bricked.
Note: this requires monitorAddress to have the onFlashLoan callback,
so it only works with the actual monitor contract address.
```

#### `us:shares-assets-consistency` -- ERC4626 Accounting Check

```
RPC calls (3 calls):
  1. vault.totalAssets()    -> selector 0x01e1d114 -> uint256 assets
  2. vault.totalSupply()    -> selector 0x18160ddd -> uint256 supply
  3. vault.convertToShares(supply) -> selector 0xc6e6f592 + abi.encode(supply) -> uint256 shares

Check: shares == assets

In the initial state:
  totalAssets() = 1_000_000e18 (token balance of vault)
  totalSupply() = 1_000_000e18 (shares minted to deployer)
  convertToShares(1_000_000e18) = 1_000_000e18 (1:1 ratio)

After exploit (direct transfer of 10e18 tokens):
  totalAssets() = 1_000_010e18 (original + donated tokens)
  totalSupply() = 1_000_000e18 (unchanged -- no new shares minted)
  convertToShares(1_000_000e18) = ~999_990e18 (less than totalAssets)

  Invariant broken: 999_990e18 != 1_000_010e18
```

#### `us:no-direct-transfers` -- Transfer Event Analysis

```
Step 1: Get all Transfer events TO the vault:
  eth_getLogs({
    address: tokenAddress,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",  // Transfer(from,to,value)
      null,  // any sender
      abi.encode(vaultAddress)  // to == vault
    ],
    fromBlock: setupBlock,
    toBlock: "latest"
  })

Step 2: Get all Deposit events from the vault:
  eth_getLogs({
    address: vaultAddress,
    topics: [
      "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7"  // Deposit(address,address,uint256,uint256)
    ],
    fromBlock: setupBlock,
    toBlock: "latest"
  })

Step 3: For each Transfer-to-vault, check if there is a corresponding Deposit
in the same block/tx. If a Transfer exists without a matching Deposit, it is
a direct transfer (donation attack).

The Deposit event selector for ERC4626 (solmate):
  event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
  topic0 = keccak256("Deposit(address,address,uint256,uint256)")
         = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7
```

---

## 4. Generic Flash Loan Invariants

These invariants apply to ANY flash loan pool, regardless of specific
vulnerability. They capture fundamental properties that should hold for
all well-behaved flash loan protocols.

### 4.1 Invariant Table

| ID | Level | Description | Severity | Check Type | Applicable To |
|----|-------|-------------|----------|------------|---------------|
| `gen:pool-balance-conservation` | L1 | Pool asset balance (ETH or token) is >= pre-flash-loan balance after loan completes | Critical | snapshot | All flash loan pools |
| `gen:no-unauthorized-approvals` | L2 | No new ERC20 `allowance(pool, X)` > 0 created during flash loan | Critical | snapshot | ERC20 flash loan pools |
| `gen:no-unexpected-transfers` | L2 | No token/ETH transfers from pool to non-borrower addresses during flash loan | High | trace | All flash loan pools |
| `gen:accounting-consistency` | L2 | Internal balance tracking == actual asset balance | Critical | point-in-time | Pools with balance mappings |
| `gen:flash-loan-liveness` | L3 | Flash loan function does not revert under normal conditions | Medium | point-in-time | All flash loan pools |
| `gen:no-state-change-on-borrow` | L3 | Pool's persistent storage is unchanged after a borrow-repay cycle (except nonces/counters) | High | snapshot | All flash loan pools |
| `gen:borrower-repayment` | L3 | Tokens returned to pool came from the borrower, not from the pool itself (no self-repayment via deposit) | Critical | trace | Pools with deposit functions |

### 4.2 Implementation Patterns

#### `gen:pool-balance-conservation`

```typescript
// Generic: works for ETH pools (getBalance) or ERC20 pools (balanceOf)
interface PoolBalanceConfig {
  poolAddress: string
  tokenAddress?: string  // undefined = native ETH
  expectedMinimum: bigint
}

// For ETH:
//   eth_getBalance(poolAddress) >= expectedMinimum
// For ERC20:
//   eth_call(token.balanceOf(pool)) >= expectedMinimum
```

#### `gen:no-unauthorized-approvals`

```typescript
// Check Approval events emitted with owner == pool during the PoC execution window
interface ApprovalCheckConfig {
  tokenAddress: string
  poolAddress: string
  fromBlock: number  // block before PoC started
}

// eth_getLogs for Approval(poolAddress, *, *)
// Any match = invariant broken
// Evidence: spender address and approved amount from the event
```

#### `gen:no-state-change-on-borrow`

```typescript
// Snapshot pool storage slots before and after a flash loan
// For simple pools, check key storage slots:
//   - Balance mappings
//   - Total deposited counters
//   - Owner/admin addresses
//   - Pause state

// Implementation: eth_getStorageAt for each critical slot, compare before/after
```

---

## 5. Implementation Details

### 5.1 Function Selectors Reference

| Function | Selector | Used By |
|----------|----------|---------|
| `balanceOf(address)` | `0x70a08231` | Truster, Unstoppable (ERC20) |
| `allowance(address,address)` | `0xdd62ed3e` | Truster (ERC20) |
| `balances(address)` | `0x27e235e3` | Side Entrance (pool mapping getter) |
| `totalAssets()` | `0x01e1d114` | Unstoppable (ERC4626) |
| `totalSupply()` | `0x18160ddd` | Unstoppable (ERC4626/ERC20) |
| `convertToShares(uint256)` | `0xc6e6f592` | Unstoppable (ERC4626) |
| `maxFlashLoan(address)` | `0x613255ab` | Unstoppable (IERC3156) |
| `paused()` | `0x5c975abb` | Unstoppable |
| `owner()` | `0x8da5cb5b` | Unstoppable |
| `token()` | `0xfc0c546a` | Truster (pool.token immutable) |

### 5.2 Event Signatures Reference

| Event | Topic0 (keccak256) |
|-------|-------------------|
| `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| `Approval(address,address,uint256)` | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |
| `Deposit(address,uint256)` (Side Entrance) | `0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c` |
| `Withdraw(address,uint256)` (Side Entrance) | `0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364` |
| `Deposit(address,address,uint256,uint256)` (ERC4626) | `0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7` |

### 5.3 Storage Slot Calculations

#### SideEntranceLenderPool

```
Contract state:
  mapping(address => uint256) public balances;  // slot 0

balances[addr]:
  slot = keccak256(abi.encode(addr, uint256(0)))

Example for deployer (0x...):
  slot = keccak256(abi.encode(deployerAddr, 0))
```

#### TrusterLenderPool

```
Contract state:
  Inherited from ReentrancyGuard:
    uint256 private _status;   // slot 0
  Own state:
    DamnValuableToken public immutable token;  // NOT in storage (immutable)

The pool has no storage to check beyond the reentrancy guard.
All relevant state is in the ERC20 token contract.
```

#### DamnValuableToken (solmate ERC20)

```
Solmate ERC20 storage layout:
  slot 0: string public name
  slot 1: string public symbol
  slot 2: uint256 public totalSupply
  slot 3: mapping(address => uint256) public balanceOf
  slot 4: mapping(address => mapping(address => uint256)) public allowance

  (uint8 public immutable decimals is NOT in storage)

balanceOf[addr]:
  slot = keccak256(abi.encode(addr, uint256(3)))

allowance[owner][spender]:
  inner = keccak256(abi.encode(owner, uint256(4)))
  slot   = keccak256(abi.encode(spender, inner))
```

#### UnstoppableVault (complex inheritance)

```
Inheritance chain: IERC3156FlashLender, ReentrancyGuard (solady), Owned, ERC4626, Pausable

Solady ReentrancyGuard:
  Uses a custom storage slot (not sequential):
  slot = 0x929eee149b4bd21268 (transient-like, computed from a formula)

Solmate Owned:
  slot 0: address public owner

Solmate ERC4626 (extends ERC20):
  slot 1: string name
  slot 2: string symbol
  slot 3: uint256 totalSupply
  slot 4: mapping(address => uint256) balanceOf
  slot 5: mapping(address => mapping(address => uint256)) allowance
  (ERC4626 adds no new storage, asset is immutable)

OpenZeppelin Pausable:
  slot 6: bool private _paused

UnstoppableVault own:
  slot 7: address public feeRecipient

Immutables (NOT in storage): FEE_FACTOR, GRACE_PERIOD, end, asset (from ERC4626)

Key slots for invariant checking:
  owner: slot 0
  totalSupply: slot 3
  _paused: slot 6
  feeRecipient: slot 7
```

**Note on storage layout accuracy:** The exact slot numbers depend on the
Solidity compiler's layout algorithm with the specific inheritance order.
For production use, run `forge inspect UnstoppableVault storage-layout` to
get the authoritative slot assignments. The numbers above are best-effort
based on inheritance order analysis.

---

## 6. Invariant Check Protocol

### 6.1 Full Verification Sequence

```
Phase 1: Setup
  1. Start anvil devnet (clean state)
  2. Deploy vulnerable contract + dependencies
  3. Execute setup transactions (fund pool, set initial state)
  4. Record setup_block_number

Phase 2: Pre-PoC Snapshot
  5. evm_snapshot() -> snapshotId
  6. For each invariant in challenge registry:
       record pre_value = check_invariant()
       assert pre_value.holds == true  // all invariants must hold before PoC
       store pre_value in snapshot_map

Phase 3: PoC Execution
  7. Execute PoC script (forge test or cast transactions)
  8. Record post_poc_block_number

Phase 4: Post-PoC Invariant Check
  9. For each invariant in challenge registry:
       post_value = check_invariant()
       compare against snapshot_map[invariant.id]
       record result: { id, held_before: true, held_after: post_value.holds,
                        pre_value, post_value, evidence }

Phase 5: Revert and Verify Against Patched
  10. evm_revert(snapshotId)
  11. Deploy PATCHED contract (same setup)
  12. evm_snapshot() -> patchedSnapshotId
  13. Run same PoC against patched contract
  14. For each invariant:
        patched_value = check_invariant()
        record patched result

Phase 6: Verdict
  15. Classify:
      - vuln_broken AND patched_holds -> VALID BUG
      - vuln_broken AND patched_broken -> TEST ARTIFACT
      - vuln_holds -> INVALID (PoC does not demonstrate vulnerability)
  16. Severity = max(severity of all broken invariants on vulnerable)
  17. Generate evidence report
```

### 6.2 Snapshot Map Structure

```typescript
interface InvariantSnapshot {
  invariantId: string
  preValue: {
    holds: boolean
    actual: string    // hex or decimal string
    expected: string
    timestamp: number
    blockNumber: number
  }
  postValue: {
    holds: boolean
    actual: string
    expected: string
    timestamp: number
    blockNumber: number
  }
  patchedPostValue?: {
    holds: boolean
    actual: string
    expected: string
    timestamp: number
    blockNumber: number
  }
}

interface VerificationResult {
  challengeId: string
  verdict: "VALID_BUG" | "INVALID" | "TEST_ARTIFACT"
  severity: "critical" | "high" | "medium" | "low"
  invariants: InvariantSnapshot[]
  brokenInvariants: string[]  // IDs of invariants broken by PoC
  evidence: string            // human-readable summary
  executionTime: number       // ms
}
```

### 6.3 Evidence Collection

For each broken invariant, collect:

1. **Before state:** The pre-PoC value (RPC response, decoded)
2. **After state:** The post-PoC value (RPC response, decoded)
3. **Delta:** Quantified change (e.g., "pool balance decreased by 1000 ETH")
4. **Relevant events:** Any Transfer, Approval, Deposit, Withdraw events emitted during the PoC
5. **Transaction hashes:** All transactions executed during the PoC
6. **Gas used:** Total gas consumed by the exploit

---

## 7. voltaire-effect Mapping

### 7.1 Core Types

```typescript
import { Effect, Data, Context } from "effect"
import { ProviderService, getBalance, getStorageAt, call, getLogs } from "voltaire-effect"

// --- Error Types ---

class InvariantCheckError extends Data.TaggedError("InvariantCheckError")<{
  readonly invariantId: string
  readonly reason: string
  readonly cause?: unknown
}> {}

// --- Result Types ---

interface InvariantResult {
  readonly invariantId: string
  readonly holds: boolean
  readonly actual: string
  readonly expected: string
  readonly evidence?: string
}

// --- Invariant Definition ---

interface InvariantDef {
  readonly id: string
  readonly description: string
  readonly severity: "critical" | "high" | "medium" | "low"
  readonly checkType: "snapshot" | "point-in-time" | "trace"
  readonly check: (ctx: CheckContext) => Effect.Effect<
    InvariantResult,
    InvariantCheckError,
    ProviderService
  >
}
```

### 7.2 Invariant Checker Implementations

```typescript
// --- Side Entrance: Pool Balance ---

const sePoolBalance = (
  poolAddress: string,
  expectedMinWei: bigint
): Effect.Effect<InvariantResult, InvariantCheckError, ProviderService> =>
  Effect.gen(function* () {
    const balance = yield* getBalance(poolAddress).pipe(
      Effect.mapError((e) => new InvariantCheckError({
        invariantId: "se:pool-balance",
        reason: `Failed to get balance: ${e._tag}`,
        cause: e,
      }))
    )
    return {
      invariantId: "se:pool-balance",
      holds: balance >= expectedMinWei,
      actual: balance.toString(),
      expected: `>= ${expectedMinWei.toString()}`,
      evidence: balance < expectedMinWei
        ? `Pool drained: ${expectedMinWei - balance} wei lost`
        : undefined,
    }
  })

// --- Truster: Token Balance ---

const trPoolTokenBalance = (
  tokenAddress: string,
  poolAddress: string,
  expectedMinimum: bigint
): Effect.Effect<InvariantResult, InvariantCheckError, ProviderService> =>
  Effect.gen(function* () {
    const balance = yield* call({
      to: tokenAddress,
      data: `0x70a08231${poolAddress.slice(2).padStart(64, "0")}` as `0x${string}`,
    }).pipe(
      Effect.map((hex) => BigInt(hex)),
      Effect.mapError((e) => new InvariantCheckError({
        invariantId: "tr:pool-token-balance",
        reason: `Failed to read token balance: ${e._tag}`,
        cause: e,
      }))
    )
    return {
      invariantId: "tr:pool-token-balance",
      holds: balance >= expectedMinimum,
      actual: balance.toString(),
      expected: `>= ${expectedMinimum.toString()}`,
      evidence: balance < expectedMinimum
        ? `Pool token balance decreased by ${expectedMinimum - balance}`
        : undefined,
    }
  })

// --- Truster: No Unauthorized Allowances ---

const trNoUnauthorizedAllowances = (
  tokenAddress: string,
  poolAddress: string,
  fromBlock: bigint
): Effect.Effect<InvariantResult, InvariantCheckError, ProviderService> =>
  Effect.gen(function* () {
    const logs = yield* getLogs({
      address: tokenAddress,
      topics: [
        "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
        `0x${poolAddress.slice(2).padStart(64, "0")}` as `0x${string}`,
      ],
      fromBlock,
      toBlock: "latest",
    }).pipe(
      Effect.mapError((e) => new InvariantCheckError({
        invariantId: "tr:no-unauthorized-allowances",
        reason: `Failed to query Approval logs: ${e}`,
        cause: e,
      }))
    )
    return {
      invariantId: "tr:no-unauthorized-allowances",
      holds: logs.length === 0,
      actual: `${logs.length} approval events from pool`,
      expected: "0 approval events from pool",
      evidence: logs.length > 0
        ? `Pool approved ${logs.length} addresses to spend its tokens`
        : undefined,
    }
  })

// --- Unstoppable: Shares-Assets Consistency ---

const usSharesAssetsConsistency = (
  vaultAddress: string
): Effect.Effect<InvariantResult, InvariantCheckError, ProviderService> =>
  Effect.gen(function* () {
    const mapErr = (id: string) => (e: unknown) =>
      new InvariantCheckError({ invariantId: id, reason: `RPC failed`, cause: e })

    const totalAssets = yield* call({
      to: vaultAddress,
      data: "0x01e1d114" as `0x${string}`,
    }).pipe(Effect.map(BigInt), Effect.mapError(mapErr("us:shares-assets-consistency")))

    const totalSupply = yield* call({
      to: vaultAddress,
      data: "0x18160ddd" as `0x${string}`,
    }).pipe(Effect.map(BigInt), Effect.mapError(mapErr("us:shares-assets-consistency")))

    const convertedShares = yield* call({
      to: vaultAddress,
      data: `0xc6e6f592${totalSupply.toString(16).padStart(64, "0")}` as `0x${string}`,
    }).pipe(Effect.map(BigInt), Effect.mapError(mapErr("us:shares-assets-consistency")))

    return {
      invariantId: "us:shares-assets-consistency",
      holds: convertedShares === totalAssets,
      actual: `convertToShares(${totalSupply}) = ${convertedShares}`,
      expected: `totalAssets() = ${totalAssets}`,
      evidence: convertedShares !== totalAssets
        ? `Accounting desync: shares=${convertedShares}, assets=${totalAssets}, delta=${totalAssets - convertedShares}`
        : undefined,
    }
  })

// --- Unstoppable: Flash Loan Callable ---

const usFlashLoanCallable = (
  vaultAddress: string,
  tokenAddress: string,
  borrowerAddress: string
): Effect.Effect<InvariantResult, InvariantCheckError, ProviderService> =>
  Effect.gen(function* () {
    // We check the precondition rather than simulating the full flash loan.
    // The flash loan reverts iff convertToShares(totalSupply) != totalAssets().
    const consistency = yield* usSharesAssetsConsistency(vaultAddress)

    // Also check paused state
    const pausedHex = yield* call({
      to: vaultAddress,
      data: "0x5c975abb" as `0x${string}`,  // paused()
    }).pipe(
      Effect.mapError((e) => new InvariantCheckError({
        invariantId: "us:flash-loan-callable",
        reason: `Failed to check paused state`,
        cause: e,
      }))
    )
    const isPaused = BigInt(pausedHex) !== 0n

    const callable = consistency.holds && !isPaused
    return {
      invariantId: "us:flash-loan-callable",
      holds: callable,
      actual: `consistent=${consistency.holds}, paused=${isPaused}`,
      expected: "consistent=true, paused=false",
      evidence: !callable
        ? `Flash loan bricked: ${!consistency.holds ? "accounting desync" : "vault paused"}`
        : undefined,
    }
  })
```

### 7.3 Invariant Registry

```typescript
const INVARIANT_REGISTRY: Record<string, InvariantDef[]> = {
  "side-entrance": [
    {
      id: "se:pool-balance",
      description: "Pool ETH balance >= initial deposit",
      severity: "critical",
      checkType: "snapshot",
      check: (ctx) => sePoolBalance(ctx.poolAddress, ctx.initialBalance),
    },
    {
      id: "se:balance-accounting",
      description: "Sum of depositor balances == pool ETH balance",
      severity: "critical",
      checkType: "point-in-time",
      check: (ctx) => seBalanceAccounting(ctx.poolAddress, ctx.knownDepositors),
    },
  ],

  "truster": [
    {
      id: "tr:pool-token-balance",
      description: "Pool retains all tokens after flash loan",
      severity: "critical",
      checkType: "snapshot",
      check: (ctx) => trPoolTokenBalance(ctx.tokenAddress, ctx.poolAddress, ctx.initialBalance),
    },
    {
      id: "tr:no-unauthorized-allowances",
      description: "No Approval events from pool during PoC",
      severity: "critical",
      checkType: "snapshot",
      check: (ctx) => trNoUnauthorizedAllowances(ctx.tokenAddress, ctx.poolAddress, ctx.fromBlock),
    },
  ],

  "unstoppable": [
    {
      id: "us:flash-loan-callable",
      description: "Flash loan does not revert under normal conditions",
      severity: "medium",
      checkType: "point-in-time",
      check: (ctx) => usFlashLoanCallable(ctx.vaultAddress, ctx.tokenAddress, ctx.borrowerAddress),
    },
    {
      id: "us:shares-assets-consistency",
      description: "convertToShares(totalSupply) == totalAssets()",
      severity: "medium",
      checkType: "point-in-time",
      check: (ctx) => usSharesAssetsConsistency(ctx.vaultAddress),
    },
  ],
}
```

### 7.4 The Verification Pipeline as an Effect

```typescript
import { Effect, pipe } from "effect"
import { ProviderService, HttpProviderFetch } from "voltaire-effect"

interface CheckContext {
  readonly challengeId: string
  readonly poolAddress: string
  readonly tokenAddress?: string
  readonly vaultAddress?: string
  readonly borrowerAddress?: string
  readonly initialBalance: bigint
  readonly knownDepositors: readonly string[]
  readonly fromBlock: bigint
}

const runVerification = (
  ctx: CheckContext,
  pocScript: string
): Effect.Effect<VerificationResult, InvariantCheckError, ProviderService | DevnetCheatcodes | ForgeService> =>
  Effect.gen(function* () {
    const cheat = yield* DevnetCheatcodes
    const forge = yield* ForgeService

    const invariants = INVARIANT_REGISTRY[ctx.challengeId] ?? []
    if (invariants.length === 0) {
      return yield* Effect.fail(new InvariantCheckError({
        invariantId: "*",
        reason: `No invariants registered for challenge: ${ctx.challengeId}`,
      }))
    }

    // Phase 2: Pre-PoC snapshot
    const snapId = yield* cheat.snapshot()
    const preResults = yield* Effect.forEach(
      invariants,
      (inv) => inv.check(ctx),
      { concurrency: "unbounded" }
    )

    // Verify all invariants hold before PoC
    const preBroken = preResults.filter((r) => !r.holds)
    if (preBroken.length > 0) {
      yield* cheat.revert(snapId)
      return {
        challengeId: ctx.challengeId,
        verdict: "INVALID" as const,
        severity: "low" as const,
        invariants: [],
        brokenInvariants: preBroken.map((r) => r.invariantId),
        evidence: `Pre-PoC invariants already broken: ${preBroken.map((r) => r.invariantId).join(", ")}`,
        executionTime: 0,
      }
    }

    // Phase 3: Run PoC
    const start = Date.now()
    const pocResult = yield* forge.runTest(pocScript)
    const elapsed = Date.now() - start

    // Phase 4: Post-PoC check
    const postResults = yield* Effect.forEach(
      invariants,
      (inv) => inv.check(ctx),
      { concurrency: "unbounded" }
    )

    const broken = postResults.filter((r) => !r.holds)

    // Phase 5: Revert and test against patched
    yield* cheat.revert(snapId)

    // (Patched deployment and re-run would go here)

    // Phase 6: Verdict
    const verdict = broken.length > 0 ? "VALID_BUG" : "INVALID"
    const severity = broken.length > 0
      ? broken.reduce((max, r) => {
          const inv = invariants.find((i) => i.id === r.invariantId)
          const sev = inv?.severity ?? "low"
          const order = { critical: 4, high: 3, medium: 2, low: 1 }
          return order[sev] > order[max] ? sev : max
        }, "low" as "critical" | "high" | "medium" | "low")
      : "low"

    const snapshots: InvariantSnapshot[] = invariants.map((inv, i) => ({
      invariantId: inv.id,
      preValue: {
        holds: preResults[i].holds,
        actual: preResults[i].actual,
        expected: preResults[i].expected,
        timestamp: 0,
        blockNumber: 0,
      },
      postValue: {
        holds: postResults[i].holds,
        actual: postResults[i].actual,
        expected: postResults[i].expected,
        timestamp: 0,
        blockNumber: 0,
      },
    }))

    return {
      challengeId: ctx.challengeId,
      verdict: verdict as "VALID_BUG" | "INVALID",
      severity,
      invariants: snapshots,
      brokenInvariants: broken.map((r) => r.invariantId),
      evidence: broken.map((r) => r.evidence ?? r.invariantId).join("; "),
      executionTime: elapsed,
    }
  })
```

---

## 8. Priority Ordering

### 8.1 Implementation Priority by Invariant

| Priority | Invariant ID | Challenge | Rationale |
|----------|-------------|-----------|-----------|
| P0 | `se:pool-balance` | Side Entrance | Simplest invariant, single RPC call, catches complete drain |
| P0 | `tr:pool-token-balance` | Truster | Same pattern, ERC20 instead of ETH |
| P1 | `tr:no-unauthorized-allowances` | Truster | Catches the *mechanism*, not just the outcome; uses getLogs |
| P1 | `us:shares-assets-consistency` | Unstoppable | Core ERC4626 invariant, 3 RPC calls |
| P1 | `us:flash-loan-callable` | Unstoppable | Combines consistency + paused check |
| P2 | `se:balance-accounting` | Side Entrance | Requires enumerating depositors |
| P2 | `gen:pool-balance-conservation` | Generic | Generalized version of P0 invariants |
| P2 | `gen:no-unauthorized-approvals` | Generic | Generalized version of P1 Truster invariant |
| P3 | `se:flashloan-balance-delta` | Side Entrance | Requires trace-level monitoring |
| P3 | `us:no-direct-transfers` | Unstoppable | Requires cross-referencing Transfer and Deposit events |
| P3 | `gen:no-state-change-on-borrow` | Generic | Requires storage diff |

### 8.2 Implementation Phases

**Phase 1 (MVP -- Side Entrance + Truster basics):**
- `se:pool-balance`
- `tr:pool-token-balance`
- Verification pipeline (snapshot/check/compare)
- Single `VerificationResult` output

**Phase 2 (Mechanism detection):**
- `tr:no-unauthorized-allowances`
- `us:shares-assets-consistency`
- `us:flash-loan-callable`
- Evidence collection (event logs)

**Phase 3 (Generic invariants):**
- `gen:pool-balance-conservation`
- `gen:no-unauthorized-approvals`
- `gen:flash-loan-liveness`
- Parameterized invariant definitions

**Phase 4 (Trace-level, if time permits):**
- `se:no-new-depositors-during-loan`
- `us:no-direct-transfers`
- `gen:no-state-change-on-borrow`
- Storage diff tooling

### 8.3 Estimated Effort

| Phase | Invariants | Effort | Dependencies |
|-------|-----------|--------|-------------|
| Phase 1 | 2 | 2-3 hours | voltaire-effect provider, anvil running |
| Phase 2 | 3 | 3-4 hours | Phase 1 + getLogs support |
| Phase 3 | 3 | 2-3 hours | Phase 2 (generalization) |
| Phase 4 | 3 | 4-6 hours | Phase 3 + storage inspection tooling |

Total: 11-16 hours for full catalog. Phase 1 alone is sufficient for the
hackathon demo.
