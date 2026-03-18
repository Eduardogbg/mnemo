/**
 * @module example
 *
 * Demonstrates how the verity layers compose for different access levels.
 *
 * This file is a reference -- not meant to be imported as a library module.
 * It shows the three key patterns:
 *
 * 1. Read-only invariant checking (only needs EvmClient)
 * 2. Full verification pipeline (needs EvmClient + DevnetCheatcodes)
 * 3. Individual invariant composition
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  // Layer factories
  HttpProviderFetch,
  DevnetCheatcodes,
  DevnetCheatcodesLive,
  // Invariant suites
  makeSideEntranceSuite,
  makeTrusterSuite,
  makeUnstoppableSuite,
  // Invariant runner
  runSuite,
  // Verification pipeline
  verify,
  // Types
  type ChallengeDefinition,
  type PoCScript,
  type VerificationResult,
  // Individual invariants for composition
  balanceInvariant,
  tokenBalanceInvariant,
  // Error types
  PoCError,
} from "./index.js"

// ==========================================================================
// Example 1: Read-only invariant checking
//
// An invariant checker ONLY gets ProviderService (EvmClient).
// It can read chain state but cannot send transactions or call cheatcodes.
// This is enforced by the type system -- the R channel only has ProviderService.
// ==========================================================================

const checkInvariantsReadOnly = (rpcUrl: string) => {
  const poolAddress = "0x..." // filled in at runtime
  const deployerAddress = "0x..."

  const suite = makeSideEntranceSuite(poolAddress, deployerAddress)

  // runSuite returns Effect<InvariantResult[], InvariantError, ProviderService>
  // We provide only ProviderService -- read-only access
  const program = runSuite(suite).pipe(
    Effect.provide(HttpProviderFetch(rpcUrl)),
  )

  // This would NOT typecheck:
  // const program = DevnetCheatcodes.pipe(Effect.provide(HttpProviderFetch(rpcUrl)))
  // Because HttpProviderFetch does not provide DevnetCheatcodes

  return program
}

// ==========================================================================
// Example 2: Full verification pipeline
//
// The verify() function needs both ProviderService and DevnetCheatcodes.
// We compose the layers: provider + cheatcodes (which depends on provider).
// ==========================================================================

const runFullVerification = (rpcUrl: string) => {
  // Layer composition:
  // HttpProviderFetch provides ProviderService
  // DevnetCheatcodesLive requires ProviderService, provides DevnetCheatcodes
  const provider = HttpProviderFetch(rpcUrl)
  const cheatcodes = DevnetCheatcodesLive.pipe(Layer.provide(provider))
  const fullLayer = Layer.merge(provider, cheatcodes)

  // Define a mock challenge for demonstration
  const challenge: ChallengeDefinition = {
    id: "side-entrance",
    name: "Side Entrance Lender Pool",
    difficulty: "trivial",
    description: "Flash loan + deposit() drain",
    setup: Effect.succeed({
      contracts: { pool: "0x..." },
      setupBlock: 1n,
    }),
    invariants: makeSideEntranceSuite("0x...", "0x..."),
  }

  // Mock exploit (in practice, this would be a real PoC)
  const exploit: PoCScript = Effect.succeed({
    success: true,
    description: "Drained pool via flash loan + deposit",
    txHashes: ["0xabc..."],
  })

  // verify() returns Effect<VerificationResult, ..., ProviderService | DevnetCheatcodes>
  const program = verify(challenge, exploit).pipe(
    Effect.provide(fullLayer),
  )

  return program
}

// ==========================================================================
// Example 3: Composing individual invariants
//
// You can mix built-in helpers with custom invariants.
// All share the same R channel (ProviderService) so they compose freely.
// ==========================================================================

const customInvariantSuite = () => {
  const poolAddr = "0x..."
  const tokenAddr = "0x..."

  return {
    name: "Custom Mixed Suite",
    invariants: [
      // Built-in: ETH balance check
      balanceInvariant(
        "pool-eth",
        poolAddr,
        (b) => b >= 1_000_000_000_000_000_000_000n, // >= 1000 ETH
        "critical",
      ),

      // Built-in: ERC20 balance check
      tokenBalanceInvariant(
        "pool-dvt",
        tokenAddr,
        poolAddr,
        (b) => b >= 1_000_000_000_000_000_000_000_000n, // >= 1M tokens
        "critical",
      ),

      // Custom: any Effect<InvariantResult, InvariantError, ProviderService>
      // can be an invariant
      Effect.succeed({
        name: "always-true",
        holds: true,
        severity: "low" as const,
        message: "This invariant always holds (placeholder)",
      }),
    ],
  } as const
}
