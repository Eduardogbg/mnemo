/**
 * HybridChallenge — unified challenge definition that combines:
 *   - dvdefi's forge test paths (for Solidity-level verification)
 *   - verity's typed Effect invariants (for RPC-level verification)
 *
 * This is the single source of truth for a challenge in the verifier.
 * Severity is no longer hardcoded here — it's derived from broken invariants.
 */
import type { ChallengeDefinition as DvDefiChallenge, ChallengeContext } from "@mnemo/dvdefi"
import type { InvariantSuite } from "@mnemo/verity"

export interface HybridChallenge {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly difficulty: "trivial" | "low" | "moderate" | "hard"

  /** Forge test paths — from dvdefi */
  readonly forge: {
    readonly contracts: {
      readonly vulnerable: readonly string[]
      readonly patched: readonly string[]
    }
    readonly tests: {
      readonly exploit: string
      readonly exploitFunction: string
      readonly patched: string
      readonly patchedFunction: string
    }
  }

  /**
   * Factory that creates a verity InvariantSuite from deployed addresses.
   * Called after contracts are deployed to bind invariants to concrete addresses.
   */
  readonly makeInvariantSuite: (ctx: ChallengeContext) => InvariantSuite

  /** The underlying dvdefi challenge (for forge-only verification) */
  readonly dvdefi: DvDefiChallenge
}
