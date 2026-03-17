# voltaire-effect Integration for Mnemo Verifier Harness

## Source Analysis

This document is based on a deep read of the voltaire-effect source code at
`repos/voltaire/packages/voltaire-effect/`. All API references come from the
actual TypeScript source, not the README.

**Package**: `voltaire-effect` v1.1.0 (alpha, published to npm)
**Peer deps**: `effect ^3.19.0`, `@effect/platform ^0.94.0`, `@tevm/voltaire workspace:*`

---

## 1. Actual voltaire-effect API Surface

### 1.1 Provider (Read-Only Blockchain Access)

The core abstraction is `ProviderService`, an Effect `Context.Tag` wrapping a
single `request(method, params?)` RPC method. Everything else is free functions
that depend on this tag.

```typescript
// ProviderService.ts
export class ProviderService extends Context.Tag("ProviderService")<
  ProviderService,
  { readonly request: <T>(method: string, params?: unknown[]) => Effect.Effect<T, TransportError> }
>() {}
```

**Provider factories** (compose Transport + Provider into one layer):

| Factory | Requirements | Use case |
|---------|-------------|----------|
| `HttpProviderFetch(url)` | None | Simplest — bundles FetchHttpClient |
| `HttpProvider(url)` | `HttpClient` | When you provide your own HttpClient |
| `TestProvider(mocks)` | None | Unit testing with mock responses |
| `WebSocketProvider(url)` | `WebSocketConstructor` | Subscriptions |
| `IpcProvider(path)` | `FileSystem` | Local node via Unix socket |

**For anvil devnet**: `HttpProviderFetch('http://127.0.0.1:8545')` — zero config.

### 1.2 Free Functions (Provider Operations)

All free functions have the signature:
```
fn(params) => Effect.Effect<Result, ErrorType, ProviderService>
```

Key functions for our use case:

| Function | Signature | Anvil use |
|----------|-----------|-----------|
| `getBalance(address, blockTag?)` | `Effect<bigint, TransportError \| ProviderResponseError, ProviderService>` | Check ETH balances |
| `getStorageAt(address, slot, blockTag?)` | `Effect<0x${string}, TransportError, ProviderService>` | Read contract storage |
| `call(request, blockTag?)` | `Effect<0x${string}, CallError, ProviderService>` | eth_call for view functions |
| `getCode(address, blockTag?)` | `Effect<0x${string}, TransportError, ProviderService>` | Check if contract is deployed |
| `getBlockNumber()` | `Effect<bigint, ...>` | Track block progression |
| `getBlock(args?)` | `Effect<BlockType, ...>` | Block metadata |
| `getTransactionReceipt(hash)` | `Effect<ReceiptType, ...>` | Confirm tx inclusion |
| `getLogs(filter)` | `Effect<LogType[], ...>` | Read contract events |
| `estimateGas(request)` | `Effect<bigint, ...>` | Gas estimation |
| `sendTransaction(tx)` | `Effect<0x${string}, TransportError, ProviderService>` | eth_sendTransaction (unlocked accounts) |
| `sendRawTransaction(signedTx)` | `Effect<0x${string}, TransportError, ProviderService>` | eth_sendRawTransaction |
| `waitForTransactionReceipt(args)` | `Effect<ReceiptType, ..., ProviderService>` | Poll until tx confirms |
| `getTransactionCount(address, blockTag?)` | `Effect<bigint, ...>` | Nonce lookup |

### 1.3 Contract System

**Single contract**:
```typescript
import { Contract, HttpProviderFetch } from 'voltaire-effect'

const program = Effect.gen(function* () {
  const token = yield* Contract(tokenAddress, erc20Abi)
  const balance = yield* token.read.balanceOf(userAddress)    // view call
  const txHash  = yield* token.write.transfer(recipient, amt) // state change
  const events  = yield* token.getEvents('Transfer', { fromBlock: 'latest' })
  const simResult = yield* token.simulate.transfer(recipient, amt) // dry run
})
```

**Contract registry** (multiple named contracts):
```typescript
const Contracts = makeContractRegistry({
  Escrow:    { abi: escrowAbi, address: ESCROW_ADDR },
  Verifier:  { abi: verifierAbi, address: VERIFIER_ADDR },
  ERC20:     { abi: erc20Abi }, // factory — no address
})

const program = Effect.gen(function* () {
  const { Escrow, Verifier, ERC20 } = yield* Contracts.Service
  const token = yield* ERC20.at(dynamicTokenAddress)
  // ...
}).pipe(
  Effect.provide(Contracts.layer),
  Effect.provide(HttpProviderFetch('http://127.0.0.1:8545'))
)
```

**ContractInstance shape**:
```typescript
interface ContractInstance<TAbi> {
  address: AddressType
  abi: TAbi
  read:     { [viewFn]: (...args) => Effect<result, ContractCallError, ProviderService> }
  write:    { [mutFn]:  (...args) => Effect<HashType, ContractWriteError, SignerService> }
  simulate: { [mutFn]:  (...args) => Effect<result, ContractCallError, ProviderService> }
  getEvents: (name, filter?) => Effect<DecodedEvent[], ContractEventError, ProviderService>
}
```

### 1.4 readContract (Standalone Action)

For one-off typed reads without creating a full Contract:
```typescript
import { readContract } from 'voltaire-effect'

const balance = yield* readContract({
  address: tokenAddr,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [userAddr],
  blockTag: 'latest',
})
// Type: Effect<bigint, ReadContractError, ProviderService>
```

Full type inference: function name autocomplete, argument type checking,
return type inference from ABI outputs.

### 1.5 Signer & Account (Transaction Signing)

**LocalAccount** — in-memory private key signing:
```typescript
const signerLayer = Signer.fromPrivateKey(privateKeyHex, Provider)
// Requires: TransportService, Secp256k1Service, KeccakService
```

**Signer.Live** — the full signing layer:
- Requires: `AccountService | ProviderService | TransportService`
- Auto-fills: nonce, chainId, gas estimation, EIP-1559 fee parameters
- Serializes and broadcasts via `eth_sendRawTransaction`

**For anvil unlocked accounts**: We do NOT need the Signer at all.
Anvil auto-unlocks default accounts, so `sendTransaction({ from, to, value })`
works directly through `ProviderService` — no signing required.

### 1.6 JSON-RPC Anvil Cheatcodes

The `jsonrpc/Anvil.ts` module provides request builders (not Effect services):

```typescript
import { JsonRpc } from 'voltaire-effect'

// These return Effect<JsonRpcRequest, never, IdCounterService>
JsonRpc.Anvil.SetBalanceRequest(address, hexBalance)
JsonRpc.Anvil.SnapshotRequest()
JsonRpc.Anvil.RevertRequest(snapshotId)
JsonRpc.Anvil.SetCodeRequest(address, bytecode)
JsonRpc.Anvil.SetStorageAtRequest(address, slot, value)
JsonRpc.Anvil.ImpersonateAccountRequest(address)
JsonRpc.Anvil.MineRequest(blocks?, interval?)
JsonRpc.Anvil.SetNextBlockTimestampRequest(timestamp)
JsonRpc.Anvil.IncreaseTimeRequest(seconds)
JsonRpc.Anvil.DumpStateRequest()
JsonRpc.Anvil.LoadStateRequest(state)
```

**Important caveat**: These are JSON-RPC *request builders*, not Effect
services that send the request. They build `{ jsonrpc: "2.0", method, params, id }`
objects. To actually execute them, you'd need to feed them through a transport.
For our harness, we'll build thin wrappers that use `ProviderService.request()`
directly for anvil cheatcodes.

### 1.7 Error Types

All errors extend `Data.TaggedError` — structural, composable, pattern-matchable:

| Error | Used by |
|-------|---------|
| `TransportError` | All RPC calls (network/protocol failures) |
| `ProviderResponseError` | Invalid/unexpected RPC responses |
| `ProviderNotFoundError` | Missing block/tx/receipt |
| `ProviderValidationError` | Bad inputs before RPC call |
| `ProviderTimeoutError` | Polling timeouts |
| `ContractCallError` | Contract read failures |
| `ContractWriteError` | Contract write failures |
| `ContractEventError` | Event query/decode failures |
| `SignerError` | Signing and broadcast failures |
| `AccountError` | Key/signing failures |

---

## 2. Operation Comparison: voltaire-effect vs cast CLI

| Operation | voltaire-effect | cast CLI |
|-----------|----------------|----------|
| **Get ETH balance** | `yield* getBalance(addr)` -> `bigint` | `cast balance $ADDR --rpc-url $RPC` -> string |
| **Deploy contract** | `yield* sendTransaction({ from, data: bytecode })` | `forge create --rpc-url ...` |
| **Call view function** | `yield* token.read.balanceOf(addr)` | `cast call $ADDR "balanceOf(address)" $ARG` |
| **Send transaction** | `yield* sendTransaction({ from, to, value })` | `cast send $TO --value $V --from $F` |
| **Read storage slot** | `yield* getStorageAt(addr, slot)` -> `0x...` | `cast storage $ADDR $SLOT` |
| **Check code exists** | `yield* getCode(addr)` -> `0x...` | `cast code $ADDR` |
| **Get tx receipt** | `yield* getTransactionReceipt(hash)` -> typed | `cast receipt $HASH` |
| **Snapshot devnet** | `yield* provider.request('evm_snapshot')` | `cast rpc evm_snapshot` |
| **Revert snapshot** | `yield* provider.request('evm_revert', [id])` | `cast rpc evm_revert $ID` |
| **Set balance** | `yield* provider.request('anvil_setBalance', [addr, hex])` | `cast rpc anvil_setBalance $ADDR $HEX` |
| **Mine blocks** | `yield* provider.request('anvil_mine', [n])` | `cast rpc anvil_mine $N` |
| **Impersonate** | `yield* provider.request('anvil_impersonateAccount', [addr])` | `cast rpc anvil_impersonateAccount $ADDR` |
| **Wait for receipt** | `yield* waitForTransactionReceipt({ hash, timeout })` | Loop: `cast receipt` + sleep |
| **Read events** | `yield* token.getEvents('Transfer', { fromBlock: ... })` | `cast logs --from-block ...` + manual decode |

**Key advantages of voltaire-effect**:

1. **Typed returns**: `getBalance` returns `bigint`, not a string to parse
2. **Typed errors**: Every operation has a precise error type in the Effect channel
3. **Contract type safety**: ABI-derived `.read`/`.write` methods with autocomplete
4. **Composability**: Chain operations with `Effect.gen`, add retry/timeout declaratively
5. **Dependency injection**: ProviderService in the R channel means invariant checkers
   can declare exactly what they need
6. **No process spawning**: Everything is in-process, no shell overhead

---

## 3. Hybrid Architecture

### What voltaire-effect handles

- All on-chain reads (balance, storage, code, events, call)
- Transaction sending (via unlocked anvil accounts or signed)
- Contract interaction (typed ABI encoding/decoding)
- Devnet manipulation (snapshot/revert/setBalance via raw RPC)
- Event monitoring and receipt polling

### What Foundry CLI handles

- `forge build` — Solidity compilation (produces ABI + bytecode artifacts)
- `forge test` — Running Solidity test suites
- `anvil` — Starting the devnet process itself
- `forge create` — Only if we want Foundry's deployment workflow (optional)

### Architecture Diagram

```
                    Effect Runtime
                         |
         +---------------+---------------+
         |               |               |
   AnvilService    ProviderService   ContractRegistry
   (devnet mgmt)   (RPC access)     (typed contracts)
         |               |               |
         v               v               v
   child_process    HTTP Transport    ABI encode/decode
   (anvil start)   (fetch to :8545)  (voltaire primitives)
         |               |
         +-------+-------+
                 |
            anvil :8545
```

### Effect Service Layers

```typescript
// === Layer 1: Anvil Process Management (Foundry CLI) ===
// Starts/stops anvil, manages the devnet lifecycle
class AnvilService extends Context.Tag("AnvilService")<
  AnvilService,
  {
    readonly url: string
    readonly accounts: readonly { address: string; privateKey: string }[]
    readonly stop: () => Effect.Effect<void>
  }
>() {}

// === Layer 2: Provider (voltaire-effect) ===
// Reads chain state, sends transactions
// Created from AnvilService.url
const DevnetProvider = Layer.effect(
  ProviderService,
  Effect.gen(function* () {
    const anvil = yield* AnvilService
    // HttpProviderFetch composes Transport + Provider + FetchHttpClient
    // But we need access to the underlying ProviderService, so we
    // build the layer and extract it
    return yield* Effect.provide(
      ProviderService,
      HttpProviderFetch(anvil.url)
    )
  })
)

// === Layer 3: Devnet Cheatcodes (wraps anvil_ / evm_ RPC methods) ===
class DevnetCheatcodes extends Context.Tag("DevnetCheatcodes")<
  DevnetCheatcodes,
  {
    readonly snapshot: () => Effect.Effect<string, TransportError>
    readonly revert: (id: string) => Effect.Effect<boolean, TransportError>
    readonly setBalance: (addr: string, wei: bigint) => Effect.Effect<void, TransportError>
    readonly mine: (blocks?: number) => Effect.Effect<void, TransportError>
    readonly impersonate: (addr: string) => Effect.Effect<void, TransportError>
    readonly setStorageAt: (addr: string, slot: string, value: string) => Effect.Effect<void, TransportError>
    readonly setCode: (addr: string, code: string) => Effect.Effect<void, TransportError>
    readonly increaseTime: (seconds: number) => Effect.Effect<void, TransportError>
  }
>() {}

// Implementation: thin wrappers over ProviderService.request
const DevnetCheatcodesLive = Layer.effect(
  DevnetCheatcodes,
  Effect.gen(function* () {
    const provider = yield* ProviderService
    return {
      snapshot: () => provider.request<string>('evm_snapshot'),
      revert: (id) => provider.request<boolean>('evm_revert', [id]),
      setBalance: (addr, wei) =>
        provider.request<null>('anvil_setBalance', [addr, `0x${wei.toString(16)}`])
          .pipe(Effect.asVoid),
      mine: (blocks = 1) =>
        provider.request<null>('anvil_mine', [blocks]).pipe(Effect.asVoid),
      impersonate: (addr) =>
        provider.request<null>('anvil_impersonateAccount', [addr]).pipe(Effect.asVoid),
      setStorageAt: (addr, slot, value) =>
        provider.request<null>('anvil_setStorageAt', [addr, slot, value]).pipe(Effect.asVoid),
      setCode: (addr, code) =>
        provider.request<null>('anvil_setCode', [addr, code]).pipe(Effect.asVoid),
      increaseTime: (seconds) =>
        provider.request<null>('evm_increaseTime', [seconds]).pipe(Effect.asVoid),
    }
  })
)

// === Layer 4: Contract Registry (voltaire-effect) ===
const DemoContracts = makeContractRegistry({
  Escrow: { abi: escrowAbi, address: ESCROW_ADDR },
  BugBounty: { abi: bugBountyAbi, address: BUG_BOUNTY_ADDR },
  ERC20: { abi: erc20Abi }, // factory for any token
})

// === Layer 5: Forge CLI (compilation only) ===
class ForgeService extends Context.Tag("ForgeService")<
  ForgeService,
  {
    readonly build: () => Effect.Effect<{ contracts: Map<string, { abi: any; bytecode: string }> }>
    readonly getArtifact: (name: string) => Effect.Effect<{ abi: any; bytecode: string }>
  }
>() {}
```

### Scoped Dependencies for Different Roles

This is the key architectural insight — Effect's `R` (Requirements) channel
lets us give each component precisely what it needs:

```typescript
// Invariant checker: read-only access, no signing, no cheatcodes
type InvariantChecker = Effect.Effect<
  InvariantResult,
  InvariantError,
  ProviderService  // can ONLY read chain state
>

// PoC script runner: needs cheatcodes + tx sending + contracts
type PoCRunner = Effect.Effect<
  PoCResult,
  PoCError,
  ProviderService | DevnetCheatcodes | typeof DemoContracts.Service
>

// Verifier: read-only + contracts (no cheatcodes, no raw tx)
type Verifier = Effect.Effect<
  VerificationResult,
  VerificationError,
  ProviderService | typeof DemoContracts.Service
>
```

The type system **enforces** that an invariant checker cannot call
`anvil_setBalance` or `sendTransaction` — it literally does not have those
services in its type signature. This is far more powerful than a `cast` CLI
approach where any script can shell out to anything.

---

## 4. Invariant Checkers with Typed Providers

### Example: Balance Conservation Invariant

```typescript
import { Effect } from 'effect'
import { getBalance, ProviderService } from 'voltaire-effect'

interface BalanceInvariantConfig {
  readonly addresses: readonly string[]
  readonly expectedTotal: bigint
}

const checkBalanceConservation = (
  config: BalanceInvariantConfig
): Effect.Effect<boolean, TransportError | ProviderResponseError, ProviderService> =>
  Effect.gen(function* () {
    const balances = yield* Effect.forEach(
      config.addresses,
      (addr) => getBalance(addr),
      { concurrency: 'unbounded' }  // parallel reads
    )
    const total = balances.reduce((sum, b) => sum + b, 0n)
    return total === config.expectedTotal
  })
```

### Example: Contract State Invariant

```typescript
const checkEscrowInvariant = Effect.gen(function* () {
  const { Escrow } = yield* DemoContracts.Service

  // All reads are typed — balanceOf returns bigint, not string
  const escrowBalance = yield* Escrow.read.getLockedAmount()
  const tokenBalance = yield* getBalance(Escrow.address)

  // The escrow should always hold at least as much ETH as it claims
  return tokenBalance >= escrowBalance
}).pipe(
  Effect.provide(DemoContracts.layer),
  // ProviderService still needed — will be provided at runtime
)
```

### Example: Snapshot-Based Invariant Check

```typescript
const withSnapshotInvariant = <A, E>(
  action: Effect.Effect<A, E, ProviderService | DevnetCheatcodes>,
  invariants: Effect.Effect<boolean, any, ProviderService>[],
): Effect.Effect<A, E | TransportError, ProviderService | DevnetCheatcodes> =>
  Effect.gen(function* () {
    const cheat = yield* DevnetCheatcodes

    // Snapshot before
    const snapId = yield* cheat.snapshot()

    // Check invariants before
    const beforeResults = yield* Effect.forEach(invariants, (inv) =>
      inv.pipe(Effect.catchAll(() => Effect.succeed(false)))
    )

    // Run the action
    const result = yield* action

    // Check invariants after
    const afterResults = yield* Effect.forEach(invariants, (inv) =>
      inv.pipe(Effect.catchAll(() => Effect.succeed(false)))
    )

    // Revert to snapshot (clean state)
    yield* cheat.revert(snapId)

    // Report any broken invariants
    for (let i = 0; i < invariants.length; i++) {
      if (beforeResults[i] && !afterResults[i]) {
        yield* Effect.logWarning(`Invariant ${i} broken by action`)
      }
    }

    return result
  })
```

---

## 5. What Works for Us, What Doesn't

### Works well

- **Provider free functions**: `getBalance`, `getStorageAt`, `call`, `getCode`,
  `getLogs`, `sendTransaction` — cover all our read/write needs
- **Contract system**: `makeContractRegistry` + `Contract()` give us typed
  `.read`/`.write`/`.getEvents` with ABI inference
- **HttpProviderFetch**: Zero-config connection to anvil
- **Error types**: Discriminated unions via `Data.TaggedError` — composable
- **TestProvider**: Mock provider for unit tests — we can test invariant
  checkers without running anvil

### Works but needs wrappers

- **Anvil cheatcodes**: The `jsonrpc/Anvil.ts` module builds request objects,
  not Effect services. We need thin `DevnetCheatcodes` wrappers (shown above).
  Trivial — just `provider.request()` calls.
- **Contract deployment**: No `forge create` equivalent, but
  `sendTransaction({ from, data: bytecode })` works for anvil with unlocked
  accounts. We still need `forge build` for compilation.
- **Wait for receipt**: `waitForTransactionReceipt` exists but needs
  ProviderService. Works fine.

### Doesn't cover (use Foundry CLI)

- **Solidity compilation**: No equivalent. Use `forge build`.
- **Running Solidity tests**: No equivalent. Use `forge test`.
- **Starting anvil**: Not a library concern. Use `child_process`.
- **Forge scripts**: If we have `.sol` scripts, use `forge script`.

### Potential concerns

- **Alpha status**: voltaire-effect is v1.1.0, marked alpha. API may change.
  However, the core patterns (ProviderService tag, free functions, Contract
  factory) are stable Effect-TS idioms.
- **@tevm/voltaire dependency**: The base primitives package is `workspace:*`
  in voltaire's monorepo. For our project, we'd need the npm-published version.
  Need to verify `@tevm/voltaire` is published to npm with matching version.
- **WASM crypto**: voltaire's keccak256 is WASM-optimized. For our demo this
  is irrelevant (we're not doing heavy hashing), but it's a nice bonus.
- **Bundle size**: voltaire-effect re-exports ~150 primitive namespaces. With
  tree-shaking this is fine, but be aware.

---

## 6. Dependencies to Add

```jsonc
// packages/harness/package.json
{
  "dependencies": {
    // Core
    "effect": "^3.19.0",
    "@effect/platform": "^0.94.0",
    "@effect/platform-node": "^0.104.0",

    // voltaire
    "voltaire-effect": "^1.1.0",
    "@tevm/voltaire": "latest",  // check npm for exact version

    // We already have @effect/ai — these compose naturally
  }
}
```

**Alternative**: If `@tevm/voltaire` npm publication is unreliable (alpha),
we can vendor the specific modules we need or use the repo as a git dependency:

```jsonc
{
  "dependencies": {
    "voltaire-effect": "github:evmts/voltaire#main&path=packages/voltaire-effect"
  }
}
```

---

## 7. Recommendation

**Use voltaire-effect** for all on-chain interaction in the verifier harness.
The Effect service layer architecture maps perfectly to our needs:

1. **ProviderService** as the single RPC abstraction
2. **DevnetCheatcodes** service for anvil manipulation (thin wrapper)
3. **ContractRegistry** for typed contract access
4. **ForgeService** for compilation (shells out to `forge build`)
5. **AnvilService** for devnet lifecycle (shells out to `anvil`)

The key architectural win is **scoped dependencies via Effect's R channel**.
An invariant checker that requires only `ProviderService` literally cannot
send transactions or manipulate devnet state — the type system prevents it.
This is impossible with `cast` CLI, where any script can run any command.

For the hackathon demo, the hybrid approach is:
- `anvil` process started by `AnvilService` (Effect-managed)
- `forge build` for contract compilation
- `voltaire-effect` for everything else (reads, writes, invariants, events)
- `cast` only as a debugging escape hatch, never in production code paths
