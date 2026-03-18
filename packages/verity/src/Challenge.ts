/**
 * @module Challenge
 *
 * The ChallengeDefinition type ties together setup, invariants, exploit, and patch
 * for a single vulnerability verification challenge.
 */

import type * as Effect from "effect/Effect"
import type { ProviderService } from "voltaire-effect"
import type { DevnetCheatcodes } from "./DevnetCheatcodes.js"
import type { InvariantSuite } from "./Invariant.js"
import type { PoCScript } from "./PoCScript.js"
import type { SetupError } from "./errors.js"

// ---------------------------------------------------------------------------
// Setup result
// ---------------------------------------------------------------------------

export interface SetupResult {
  /** Deployed contract addresses, keyed by role name */
  readonly contracts: Record<string, string>
  /** Block number after setup completed */
  readonly setupBlock: bigint
  /** Any additional context needed by invariants */
  readonly context?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Verification verdict
// ---------------------------------------------------------------------------

export type Verdict = "VALID_BUG" | "INVALID" | "TEST_ARTIFACT"

export type Severity = "critical" | "high" | "medium" | "low"

export interface VerificationResult {
  readonly challengeId: string
  readonly verdict: Verdict
  /** Max severity among broken invariants, or null if none broken */
  readonly maxBrokenSeverity: Severity | null
  /** Results from pre-exploit invariant check */
  readonly preResults: ReadonlyArray<{
    readonly name: string
    readonly holds: boolean
    readonly actual?: unknown
    readonly expected?: unknown
  }>
  /** Results from post-exploit invariant check */
  readonly postResults: ReadonlyArray<{
    readonly name: string
    readonly holds: boolean
    readonly actual?: unknown
    readonly expected?: unknown
  }>
  /** Which invariants were broken by the exploit */
  readonly brokenInvariants: ReadonlyArray<string>
  /** Human-readable evidence summary */
  readonly evidence: string
  /** Total execution time in ms */
  readonly executionTimeMs: number
}

// ---------------------------------------------------------------------------
// Challenge definition
// ---------------------------------------------------------------------------

export interface ChallengeDefinition {
  /** Unique challenge ID (e.g. "side-entrance") */
  readonly id: string
  /** Human-readable name */
  readonly name: string
  /** Difficulty rating */
  readonly difficulty: "trivial" | "low" | "moderate" | "hard"
  /** Short description of the vulnerability */
  readonly description: string

  /**
   * How to set up the vulnerable environment.
   * Deploys contracts, funds pools, configures initial state.
   * Requires full devnet access.
   */
  readonly setup: Effect.Effect<SetupResult, SetupError, ProviderService | DevnetCheatcodes>

  /**
   * Invariants that should hold before exploit and break after.
   * These are read-only -- they only need ProviderService.
   */
  readonly invariants: InvariantSuite

  /**
   * The known exploit (for testing the verification pipeline).
   * Optional -- in production, the prover supplies this.
   */
  readonly knownExploit?: PoCScript

  /**
   * How to deploy the patched version at the same addresses.
   * Uses setCode cheatcode to hot-swap bytecode.
   */
  readonly patchSetup?: Effect.Effect<SetupResult, SetupError, ProviderService | DevnetCheatcodes>
}
