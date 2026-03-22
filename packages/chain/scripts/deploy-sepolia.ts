#!/usr/bin/env bun
/**
 * deploy-sepolia.ts — Deploy Mnemo contracts to Base Sepolia.
 *
 * Uses Effect for structured error handling and voltaire-effect for on-chain
 * interaction (signing, broadcasting, receipt polling, code verification).
 *
 * Deploys in order:
 *   1. MnemoEscrow        (no constructor args)
 *   2. MnemoReputation     (constructor: reputationRegistry, escrowAddress)
 *   3. MnemoRegistry       (no constructor args)
 *
 * Env vars (loaded from project root .env):
 *   PRIVATE_KEY            — deployer private key (required)
 *   BASE_SEPOLIA_RPC_URL   — RPC endpoint (default: https://sepolia.base.org)
 *   REPUTATION_REGISTRY    — ERC-8004 Reputation Registry address
 *                            (default: 0x8004B663890DF62C3beaA5e898e77D1EFdE8c49a)
 *   BASESCAN_API_KEY       — for contract verification (optional)
 *
 * Usage:
 *   bun run packages/chain/scripts/deploy-sepolia.ts
 *   bun run packages/chain/scripts/deploy-sepolia.ts --dry-run
 */

import { Effect, Data, Console, Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import {
  SignerService,
  Signer,
  LocalAccount,
  HttpProviderFetch,
  HttpTransport,
  CryptoLive,
  getBalance,
  waitForTransactionReceipt,
  getCode,
} from "voltaire-effect"
import * as path from "node:path"
import * as fs from "node:fs"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CONTRACTS_DIR = path.join(PROJECT_ROOT, "contracts")
const BASE_SEPOLIA_CHAIN_ID = 84532

const DEFAULT_RPC_URL = "https://sepolia.base.org"
const DEFAULT_REPUTATION_REGISTRY = "0x8004B663890DF62C3beaA5e898e77D1EFdE8c49a"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class DeployError extends Data.TaggedError("DeployError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly reason: string
}> {}

class ArtifactError extends Data.TaggedError("ArtifactError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContractArtifact {
  readonly abi: readonly Record<string, unknown>[]
  readonly bytecode: { readonly object: string }
}

interface DeployedAddresses {
  readonly escrow: string
  readonly reputation: string
  readonly registry: string
}

/** A typed constructor argument for proper ABI encoding. */
interface ConstructorArg {
  readonly type: "address" | "uint256" | "bytes32" | "bool"
  readonly value: string | bigint | boolean
}

// ---------------------------------------------------------------------------
// ABI Encoding
// ---------------------------------------------------------------------------

/**
 * Encode a value according to its Solidity ABI type into a 32-byte hex word.
 *
 * This replaces manual `.padStart(64, "0")` with explicit type-aware encoding.
 * Covers the static types used by Mnemo constructors; extend as needed.
 */
const encodeAbiValue = (arg: ConstructorArg): string => {
  switch (arg.type) {
    case "address": {
      const hex = String(arg.value).replace(/^0x/i, "").toLowerCase()
      if (hex.length > 40) throw new Error(`Invalid address: too long (${hex.length} hex chars)`)
      // ABI: address is left-padded to 32 bytes (64 hex chars)
      return hex.padStart(64, "0")
    }
    case "uint256": {
      const n = typeof arg.value === "bigint" ? arg.value : BigInt(String(arg.value))
      if (n < 0n) throw new Error("uint256 cannot be negative")
      const hex = n.toString(16)
      if (hex.length > 64) throw new Error(`uint256 overflow: ${hex.length} hex chars`)
      return hex.padStart(64, "0")
    }
    case "bytes32": {
      const hex = String(arg.value).replace(/^0x/i, "")
      if (hex.length !== 64) throw new Error(`bytes32 must be exactly 32 bytes, got ${hex.length / 2}`)
      return hex
    }
    case "bool": {
      return (arg.value ? "1" : "0").padStart(64, "0")
    }
    default:
      throw new Error(`Unsupported ABI type: ${(arg as any).type}`)
  }
}

/**
 * Encode an array of typed constructor arguments into a single hex string
 * suitable for appending to deployment bytecode or passing to forge verify.
 */
const encodeConstructorArgs = (args: readonly ConstructorArg[]): string =>
  args.map(encodeAbiValue).join("")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and capture output. */
const runCmd = (
  cmd: string[],
  cwd: string,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, DeployError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      })
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      return { stdout, stderr, exitCode }
    },
    catch: (e: unknown) =>
      new DeployError({
        reason: `Failed to run ${cmd[0]}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })

/** Derive an Ethereum address from a private key using `cast wallet address`. */
const deriveAddress = (privateKey: string): Effect.Effect<string, DeployError> =>
  Effect.gen(function* () {
    const result = yield* runCmd(["cast", "wallet", "address", privateKey], PROJECT_ROOT)
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new DeployError({ reason: `cast wallet address failed: ${result.stderr}` }),
      )
    }
    return result.stdout.trim()
  })

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const loadConfig = Effect.gen(function* () {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    return yield* Effect.fail(
      new ConfigError({
        reason:
          "PRIVATE_KEY not set. Generate one with `cast wallet new` and fund it with Base Sepolia ETH.",
      }),
    )
  }

  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_RPC_URL
  const reputationRegistry = process.env.REPUTATION_REGISTRY || DEFAULT_REPUTATION_REGISTRY
  const basescanApiKey = process.env.BASESCAN_API_KEY

  return { privateKey: normalizedKey, rpcUrl, reputationRegistry, basescanApiKey }
})

// ---------------------------------------------------------------------------
// Artifact loading
// ---------------------------------------------------------------------------

const readArtifact = (
  contractName: string,
  fileName: string,
): Effect.Effect<ContractArtifact, ArtifactError> =>
  Effect.tryPromise({
    try: async () => {
      const artifactPath = path.join(CONTRACTS_DIR, "out", fileName, `${contractName}.json`)
      const file = Bun.file(artifactPath)
      if (!(await file.exists())) {
        throw new Error(
          `Artifact not found at ${artifactPath}. Run 'forge build --via-ir' in contracts/ first.`,
        )
      }
      const json = await file.json()
      return {
        abi: json.abi as readonly Record<string, unknown>[],
        bytecode: json.bytecode as { object: string },
      }
    },
    catch: (e: unknown) =>
      new ArtifactError({
        reason: `Failed to read artifact ${contractName}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })

// ---------------------------------------------------------------------------
// Build contracts (forge build)
// ---------------------------------------------------------------------------

const forgeBuild: Effect.Effect<void, DeployError> = Effect.gen(function* () {
  const result = yield* runCmd(["forge", "build", "--via-ir"], CONTRACTS_DIR)
  if (result.exitCode !== 0) {
    return yield* Effect.fail(
      new DeployError({
        reason: `forge build failed:\n${result.stderr}`,
      }),
    )
  }
})

// ---------------------------------------------------------------------------
// Deploy a single contract via voltaire-effect Signer
// ---------------------------------------------------------------------------

/**
 * Deploy a contract by sending a raw deployment transaction through
 * voltaire-effect's SignerService. Constructor args are ABI-encoded
 * using `encodeConstructorArgs` and appended to the bytecode.
 *
 * NOTE: voltaire-effect v1.1.0 adds a proper `deployContract` action with
 * full ABI-aware encoding via `Constructor.encodeParams`. Once the project
 * upgrades from v1.0.1, this function can be replaced with that.
 */
const deployContract = (
  name: string,
  artifact: ContractArtifact,
  constructorArgs?: readonly ConstructorArg[],
): Effect.Effect<{ address: string; txHash: string }, DeployError, SignerService> =>
  Effect.gen(function* () {
    const signer = yield* SignerService

    // Build deployment data: bytecode + ABI-encoded constructor args
    let data = artifact.bytecode.object as `0x${string}`

    if (constructorArgs && constructorArgs.length > 0) {
      const encoded = encodeConstructorArgs(constructorArgs)
      data = `${data}${encoded}` as `0x${string}`
    }

    yield* Effect.log(`Deploying ${name}... (${Math.floor(data.length / 2)} bytes)`)

    // Send deployment transaction (to = undefined = contract creation)
    const txHash = yield* signer
      .sendTransaction({ to: undefined, data } as any)
      .pipe(
        Effect.mapError(
          (cause: unknown) =>
            new DeployError({
              reason: `${name} tx failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        ),
      )

    const txHashHex = String(txHash) as `0x${string}`
    yield* Effect.log(`${name} tx: ${txHashHex}`)

    // Wait for confirmation and extract contract address
    const receipt: any = yield* waitForTransactionReceipt(txHashHex).pipe(
      Effect.mapError(
        (cause: unknown) =>
          new DeployError({
            reason: `${name} receipt failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      ),
    )

    if (!receipt.contractAddress) {
      return yield* Effect.fail(
        new DeployError({ reason: `${name}: no contract address in receipt` }),
      )
    }

    const addressHex = String(receipt.contractAddress)
    yield* Effect.log(`${name} deployed: ${addressHex}`)

    return { address: addressHex, txHash: txHashHex }
  })

// ---------------------------------------------------------------------------
// Basescan verification (optional, via forge verify-contract)
// ---------------------------------------------------------------------------

const verifyOnBasescan = (
  name: string,
  address: string,
  constructorArgsHex: string | undefined,
  basescanApiKey: string,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* Effect.log(`Verifying ${name} on Basescan...`)

    const args = [
      "forge", "verify-contract",
      address,
      `src/${name}.sol:${name}`,
      "--chain-id", String(BASE_SEPOLIA_CHAIN_ID),
      "--verifier-url", "https://api-sepolia.basescan.org/api",
      "--etherscan-api-key", basescanApiKey,
      "--via-ir",
    ]

    if (constructorArgsHex) {
      args.push("--constructor-args", constructorArgsHex)
    }

    const result = yield* runCmd(args, CONTRACTS_DIR).pipe(Effect.catchAll(() => Effect.succeed(null)))

    if (result) {
      const ok = result.stdout.includes("OK") || result.stdout.includes("Already Verified")
      yield* Effect.log(`${name} verification: ${ok ? "SUCCESS" : (result.stdout.trim() || result.stderr.trim()).slice(0, 200)}`)
    }
  }).pipe(Effect.catchAll(() => Effect.log(`${name} verification skipped (error)`)))

// ---------------------------------------------------------------------------
// Main deployment pipeline
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const isDryRun = process.argv.includes("--dry-run")

  // ── 1. Config ──────────────────────────────────────────────

  const config = yield* loadConfig

  yield* Console.log("============================================")
  yield* Console.log("  Mnemo — Base Sepolia Deployment (Effect)")
  yield* Console.log("============================================")
  yield* Console.log("")
  yield* Console.log(`  RPC:         ${config.rpcUrl}`)
  yield* Console.log(`  ERC-8004:    ${config.reputationRegistry}`)
  yield* Console.log(`  Verify:      ${config.basescanApiKey ? "yes" : "no (set BASESCAN_API_KEY)"}`)
  yield* Console.log("")

  // ── 2. Build ───────────────────────────────────────────────

  yield* Console.log("[1/6] Building contracts (forge build --via-ir)...")
  yield* forgeBuild
  yield* Console.log("      OK")

  // ── 3. Load artifacts ──────────────────────────────────────

  yield* Console.log("[2/6] Loading artifacts...")
  const [escrowArt, reputationArt, registryArt] = yield* Effect.all([
    readArtifact("MnemoEscrow", "MnemoEscrow.sol"),
    readArtifact("MnemoReputation", "MnemoReputation.sol"),
    readArtifact("MnemoRegistry", "MnemoRegistry.sol"),
  ])
  yield* Console.log("      OK")

  if (isDryRun) {
    yield* Console.log("")
    yield* Console.log("  --dry-run: build + artifact load succeeded. Skipping deployment.")
    return
  }

  // ── 4. Derive deployer address and check balance ───────────

  yield* Console.log("[3/6] Checking deployer...")

  const deployerAddress = yield* deriveAddress(config.privateKey)
  yield* Console.log(`      Address: ${deployerAddress}`)

  // Layer stacks for voltaire-effect
  const writeStack = Layer.mergeAll(
    Signer.Live,
    LocalAccount(config.privateKey as any),
    HttpProviderFetch(config.rpcUrl),
    HttpTransport(config.rpcUrl),
    CryptoLive,
    FetchHttpClient.layer,
  )

  const readStack = Layer.mergeAll(
    HttpProviderFetch(config.rpcUrl),
    HttpTransport(config.rpcUrl),
    FetchHttpClient.layer,
  )

  const balance = yield* getBalance(deployerAddress as any).pipe(
    Effect.provide(readStack),
    Effect.mapError(
      (cause: unknown) =>
        new DeployError({
          reason: `Failed to fetch balance: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    ),
  )

  const balanceEth = Number(balance) / 1e18
  yield* Console.log(`      Balance: ${balanceEth.toFixed(6)} ETH`)

  if (balance === 0n) {
    return yield* Effect.fail(
      new DeployError({
        reason: [
          "Deployer has zero balance on Base Sepolia.",
          `Address: ${deployerAddress}`,
          "Fund from: https://www.alchemy.com/faucets/base-sepolia",
          "       or: https://faucet.quicknode.com/base/sepolia",
        ].join("\n"),
      }),
    )
  }

  // ── 5. Deploy contracts in order ───────────────────────────

  yield* Console.log("[4/6] Deploying MnemoEscrow...")
  const escrow = yield* deployContract("MnemoEscrow", escrowArt).pipe(
    Effect.provide(writeStack),
  )

  yield* Console.log("[5/6] Deploying MnemoReputation...")
  const reputation = yield* deployContract(
    "MnemoReputation",
    reputationArt,
    [
      { type: "address", value: config.reputationRegistry },
      { type: "address", value: escrow.address },
    ],
  ).pipe(Effect.provide(writeStack))

  yield* Console.log("[6/6] Deploying MnemoRegistry...")
  const registry = yield* deployContract("MnemoRegistry", registryArt).pipe(
    Effect.provide(writeStack),
  )

  // ── 6. Verify on-chain code ────────────────────────────────

  yield* Console.log("")
  yield* Console.log("Verifying on-chain code...")

  const deployments = [
    { name: "MnemoEscrow", addr: escrow.address },
    { name: "MnemoReputation", addr: reputation.address },
    { name: "MnemoRegistry", addr: registry.address },
  ] as const

  for (const { name, addr } of deployments) {
    const code = yield* getCode(addr as any).pipe(
      Effect.provide(readStack),
      Effect.mapError(
        (cause: unknown) =>
          new DeployError({
            reason: `getCode(${name}) failed: ${String(cause)}`,
            cause,
          }),
      ),
    )
    const codeHex = String(code)
    if (codeHex === "0x" || codeHex === "") {
      yield* Console.log(`  WARNING: ${name} at ${addr} has no code`)
    } else {
      yield* Console.log(`  ${name}: ${(codeHex.length - 2) / 2} bytes deployed`)
    }
  }

  // ── 7. Basescan verification (optional) ────────────────────

  if (config.basescanApiKey) {
    yield* Console.log("")
    yield* Console.log("Submitting Basescan verifications...")

    yield* verifyOnBasescan("MnemoEscrow", escrow.address, undefined, config.basescanApiKey)

    const reputationCtorArgs = encodeConstructorArgs([
      { type: "address", value: config.reputationRegistry },
      { type: "address", value: escrow.address },
    ])
    yield* verifyOnBasescan("MnemoReputation", reputation.address, reputationCtorArgs, config.basescanApiKey)

    yield* verifyOnBasescan("MnemoRegistry", registry.address, undefined, config.basescanApiKey)
  }

  // ── 8. Results ─────────────────────────────────────────────

  const addresses: DeployedAddresses = {
    escrow: escrow.address,
    reputation: reputation.address,
    registry: registry.address,
  }

  yield* Console.log("")
  yield* Console.log("============================================")
  yield* Console.log("  Deployment Complete")
  yield* Console.log("============================================")
  yield* Console.log("")
  yield* Console.log("=== Add to .env ===")
  yield* Console.log(`ESCROW_ADDRESS=${addresses.escrow}`)
  yield* Console.log(`ERC8004_ADDRESS=${addresses.reputation}`)
  yield* Console.log(`REGISTRY_ADDRESS=${addresses.registry}`)
  yield* Console.log("===================")
  yield* Console.log("")
  yield* Console.log("Tx hashes:")
  yield* Console.log(`  MnemoEscrow:     ${escrow.txHash}`)
  yield* Console.log(`  MnemoReputation: ${reputation.txHash}`)
  yield* Console.log(`  MnemoRegistry:   ${registry.txHash}`)
  yield* Console.log("")
  yield* Console.log(`Basescan: https://sepolia.basescan.org/address/${deployerAddress}`)

  // Write .env.deployed
  const deployedEnv = [
    `# Mnemo Base Sepolia Deployment — ${new Date().toISOString()}`,
    `ESCROW_ADDRESS=${addresses.escrow}`,
    `ERC8004_ADDRESS=${addresses.reputation}`,
    `REGISTRY_ADDRESS=${addresses.registry}`,
    `RPC_URL=${config.rpcUrl}`,
    "",
  ].join("\n")

  const deployedPath = path.join(PROJECT_ROOT, ".env.deployed")
  fs.writeFileSync(deployedPath, deployedEnv)
  yield* Console.log(`Written to ${deployedPath}`)
})

// ---------------------------------------------------------------------------
// Run with structured error handling
// ---------------------------------------------------------------------------

Effect.runPromise(
  program.pipe(
    Effect.catchTags({
      ConfigError: (e: { reason: string }) =>
        Console.error(`\nConfig error: ${e.reason}`).pipe(
          Effect.flatMap(() => Effect.sync(() => process.exit(1))),
        ),
      ArtifactError: (e: { reason: string }) =>
        Console.error(`\nArtifact error: ${e.reason}`).pipe(
          Effect.flatMap(() => Effect.sync(() => process.exit(1))),
        ),
      DeployError: (e: { reason: string }) =>
        Console.error(`\nDeploy error: ${e.reason}`).pipe(
          Effect.flatMap(() => Effect.sync(() => process.exit(1))),
        ),
    }),
    Effect.catchAll((e: unknown) =>
      Console.error(`\nUnexpected error: ${String(e)}`).pipe(
        Effect.flatMap(() => Effect.sync(() => process.exit(1))),
      ),
    ),
  ),
)
