/**
 * Challenge — shared types for DVDeFi challenge definitions.
 */
import { Effect } from "effect"
import type { Devnet, DevnetError } from "./Devnet.js"

// ---------------------------------------------------------------------------
// Invariant types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "high" | "medium" | "low"

export interface InvariantResult {
  readonly invariantId: string
  readonly holds: boolean
  readonly actual: string
  readonly expected: string
  readonly evidence?: string
}

export interface InvariantDef {
  readonly id: string
  readonly description: string
  readonly severity: Severity
  /** The check function receives a Devnet + challenge-specific context. */
  readonly check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ) => Effect.Effect<InvariantResult, DevnetError>
}

// ---------------------------------------------------------------------------
// Challenge context — addresses deployed for a particular run
// ---------------------------------------------------------------------------

export interface ChallengeContext {
  /** Addresses deployed during setup, keyed by role name. */
  readonly addresses: Record<string, string>
  /** Initial amounts for balance-based invariants. */
  readonly amounts: Record<string, bigint>
  /** Block number at the end of setup. */
  readonly setupBlock: bigint
}

// ---------------------------------------------------------------------------
// Challenge definition
// ---------------------------------------------------------------------------

export interface ChallengeDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly difficulty: "trivial" | "low" | "moderate" | "hard"

  /** Contract source paths, relative to DVDeFi project root. */
  readonly contracts: {
    readonly vulnerable: readonly string[]
    readonly patched: readonly string[]
  }

  /** Forge test file paths, relative to DVDeFi project root. */
  readonly tests: {
    /** Exploit test that should PASS against vulnerable, breaking invariants. */
    readonly exploit: string
    /** Exploit function name in the test contract. */
    readonly exploitFunction: string
    /** Patched test that should PASS (exploit fails against patched). */
    readonly patched: string
    /** Patched test function name. */
    readonly patchedFunction: string
  }

  /** Invariant definitions for this challenge. */
  readonly invariants: readonly InvariantDef[]
}
