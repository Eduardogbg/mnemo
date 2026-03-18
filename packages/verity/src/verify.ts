/**
 * @module verify
 *
 * The verification pipeline: snapshot -> check invariants -> run exploit ->
 * check invariants again -> classify verdict.
 *
 * This is the core loop that the TEE verifier runs.
 */

import * as Effect from "effect/Effect"
import { ProviderService } from "voltaire-effect"
import { DevnetCheatcodes } from "./DevnetCheatcodes.js"
import type { ChallengeDefinition, VerificationResult } from "./Challenge.js"
import type { InvariantResult } from "./Invariant.js"
import { runSuite, maxSeverity } from "./Invariant.js"
import type { PoCScript } from "./PoCScript.js"
import { InvariantError, PoCError } from "./errors.js"

// ---------------------------------------------------------------------------
// Verification pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full verification pipeline for a challenge.
 *
 * 1. Check all invariants hold (pre-exploit)
 * 2. Snapshot
 * 3. Run the exploit
 * 4. Check invariants again (post-exploit)
 * 5. Revert to snapshot
 * 6. Classify verdict
 *
 * Requires both ProviderService (for invariant checks) and
 * DevnetCheatcodes (for snapshot/revert).
 */
export const verify = (
  challenge: ChallengeDefinition,
  exploit: PoCScript,
): Effect.Effect<
  VerificationResult,
  InvariantError | PoCError,
  ProviderService | DevnetCheatcodes
> =>
  Effect.gen(function* () {
    const cheat = yield* DevnetCheatcodes
    const startTime = Date.now()

    // Phase 1: Pre-exploit invariant check
    const preResults = yield* runSuite(challenge.invariants)

    // Verify all invariants hold before exploit
    const preBroken = preResults.filter((r) => !r.holds)
    if (preBroken.length > 0) {
      return {
        challengeId: challenge.id,
        verdict: "INVALID" as const,
        maxBrokenSeverity: null,
        preResults: preResults.map(toResultSummary),
        postResults: [],
        brokenInvariants: preBroken.map((r) => r.name),
        evidence: `Pre-exploit invariants already broken: ${preBroken.map((r) => r.name).join(", ")}. Setup may be incorrect.`,
        executionTimeMs: Date.now() - startTime,
      } satisfies VerificationResult
    }

    // Phase 2: Snapshot before exploit
    const snapId = yield* cheat.snapshot().pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: "*",
            reason: `Snapshot failed: ${String(e)}`,
            cause: e,
          }),
      ),
    )

    // Phase 3: Run the exploit
    const pocResult = yield* exploit.pipe(
      Effect.mapError(
        (e) =>
          new PoCError({
            reason: `Exploit execution failed: ${String(e)}`,
            cause: e,
          }),
      ),
    )

    // Phase 4: Post-exploit invariant check
    const postResults = yield* runSuite(challenge.invariants)

    // Phase 5: Revert to snapshot (clean up)
    yield* cheat.revert(snapId).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: "*",
            reason: `Revert failed: ${String(e)}`,
            cause: e,
          }),
      ),
    )

    // Phase 6: Classify verdict
    const broken = postResults.filter((r) => !r.holds)
    const brokenNames = broken.map((r) => r.name)

    const verdict = broken.length > 0 ? "VALID_BUG" as const : "INVALID" as const
    const derivedSeverity = maxSeverity(broken)

    const evidence = broken.length > 0
      ? broken
          .map((r) => r.message ?? `${r.name}: expected ${String(r.expected)}, got ${String(r.actual)}`)
          .join("; ")
      : "No invariants were broken by the exploit."

    return {
      challengeId: challenge.id,
      verdict,
      maxBrokenSeverity: derivedSeverity,
      preResults: preResults.map(toResultSummary),
      postResults: postResults.map(toResultSummary),
      brokenInvariants: brokenNames,
      evidence,
      executionTimeMs: Date.now() - startTime,
    } satisfies VerificationResult
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toResultSummary = (r: InvariantResult) => ({
  name: r.name,
  holds: r.holds,
  actual: r.actual,
  expected: r.expected,
})
