/**
 * HybridPipeline — orchestrates verification using both:
 *   - dvdefi's forge tests (Solidity-level exploit + patch verification)
 *   - verity's typed invariants (RPC-level pre/post invariant checking)
 *
 * Flow:
 *   1. forge build
 *   2. Snapshot devnet
 *   3. Run verity invariants (pre-exploit) — should all hold
 *   4. Run forge exploit test — should pass (exploit works)
 *   5. Run verity invariants (post-exploit) — should break
 *   6. Revert devnet
 *   7. Run forge patched test — should pass (exploit blocked)
 *   8. Produce verdict with evidence from both systems
 */
import { Data, Effect, Layer } from "effect"
import { Devnet, Foundry, type ForgeTestResult, type FoundryError, type DevnetError, type ChallengeContext } from "@mnemo/dvdefi"
import {
  type InvariantResult,
  type Severity,
  runSuite,
} from "@mnemo/verity"
import type { HybridChallenge } from "./HybridChallenge.js"
import { verityLayerFromDevnet } from "./Bridge.js"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class HybridVerificationError extends Data.TaggedError("HybridVerificationError")<{
  readonly reason: string
  readonly phase: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type Verdict = "VALID_BUG" | "INVALID" | "TEST_ARTIFACT" | "BUILD_FAILURE"

export interface HybridResult {
  readonly challengeId: string
  readonly verdict: Verdict
  readonly severity: Severity | null

  /** Forge test results */
  readonly exploitTest: ForgeTestResult
  readonly patchedTest: ForgeTestResult | null

  /** Verity invariant results */
  readonly preInvariants: ReadonlyArray<InvariantResult> | null
  readonly postInvariants: ReadonlyArray<InvariantResult> | null
  readonly brokenInvariants: ReadonlyArray<string>

  readonly evidence: string
  readonly executionTimeMs: number
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full hybrid verification: forge tests + verity invariants.
 *
 * @param challenge - The hybrid challenge definition
 * @param dvdefiRoot - Absolute path to the DVDeFi repo
 * @param ctx - Challenge context with deployed addresses (for invariant binding)
 */
export const verifyHybrid = (
  challenge: HybridChallenge,
  dvdefiRoot: string,
  ctx: ChallengeContext,
): Effect.Effect<
  HybridResult,
  HybridVerificationError | FoundryError | DevnetError,
  Devnet | Foundry
> =>
  Effect.gen(function* () {
    const start = Date.now()
    const devnet = yield* Devnet
    const foundry = yield* Foundry

    // Step 1: Build
    yield* foundry.build(dvdefiRoot).pipe(
      Effect.mapError(
        (e) =>
          new HybridVerificationError({
            reason: `Build failed: ${e.reason}`,
            phase: "build",
            cause: e,
          }),
      ),
    )

    // Step 2: Create verity invariant suite from deployed addresses
    const suite = challenge.makeInvariantSuite(ctx)

    // Step 3: Snapshot devnet
    const snapshotId = yield* devnet.snapshot()

    // Step 4: Run verity invariants (pre-exploit)
    // Bridge dvdefi's devnet to verity's provider
    const verityLayer = verityLayerFromDevnet.pipe(
      Layer.provide(Layer.succeed(Devnet, devnet)),
    )

    const preInvariants = yield* runSuite(suite).pipe(
      Effect.provide(verityLayer),
      Effect.mapError(
        (e) =>
          new HybridVerificationError({
            reason: `Pre-exploit invariant check failed: ${String(e)}`,
            phase: "pre-invariants",
            cause: e,
          }),
      ),
    )

    const preBroken = preInvariants.filter((r) => !r.holds)
    if (preBroken.length > 0) {
      yield* devnet.revert(snapshotId)
      return {
        challengeId: challenge.id,
        verdict: "INVALID" as Verdict,
        severity: null,
        exploitTest: { passed: false, stdout: "", stderr: "Pre-exploit invariants already broken", exitCode: -1 },
        patchedTest: null,
        preInvariants,
        postInvariants: null,
        brokenInvariants: preBroken.map((r) => r.name),
        evidence: `Pre-exploit invariants already broken: ${preBroken.map((r) => r.name).join(", ")}`,
        executionTimeMs: Date.now() - start,
      }
    }

    // Step 5: Run forge exploit test
    const exploitTest = yield* foundry.test(
      dvdefiRoot,
      challenge.forge.tests.exploit,
      challenge.forge.tests.exploitFunction,
    )

    if (!exploitTest.passed) {
      yield* devnet.revert(snapshotId)
      return {
        challengeId: challenge.id,
        verdict: "INVALID" as Verdict,
        severity: null,
        exploitTest,
        patchedTest: null,
        preInvariants,
        postInvariants: null,
        brokenInvariants: [],
        evidence: `Exploit test failed.\n${exploitTest.stderr}`,
        executionTimeMs: Date.now() - start,
      }
    }

    // Step 6: Run verity invariants (post-exploit)
    const postInvariants = yield* runSuite(suite).pipe(
      Effect.provide(verityLayer),
      Effect.mapError(
        (e) =>
          new HybridVerificationError({
            reason: `Post-exploit invariant check failed: ${String(e)}`,
            phase: "post-invariants",
            cause: e,
          }),
      ),
    )

    const broken = postInvariants.filter((r) => !r.holds)
    const brokenNames = broken.map((r) => r.name)

    // Step 7: Revert devnet
    yield* devnet.revert(snapshotId)

    // Step 8: Run forge patched test
    const patchedTest = yield* foundry.test(
      dvdefiRoot,
      challenge.forge.tests.patched,
      challenge.forge.tests.patchedFunction,
    )

    // Step 9: Classify verdict
    const hasBrokenInvariants = brokenNames.length > 0
    let verdict: Verdict

    if (exploitTest.passed && patchedTest.passed && hasBrokenInvariants) {
      // Gold: exploit works, patch blocks it, invariants confirm the break
      verdict = "VALID_BUG"
    } else if (exploitTest.passed && patchedTest.passed && !hasBrokenInvariants) {
      // Forge says valid but invariants don't catch it — still valid, just missing invariants
      verdict = "VALID_BUG"
    } else if (exploitTest.passed && !patchedTest.passed) {
      verdict = "TEST_ARTIFACT"
    } else {
      verdict = "INVALID"
    }

    return {
      challengeId: challenge.id,
      verdict,
      severity: verdict === "VALID_BUG" ? challenge.severity : null,
      exploitTest,
      patchedTest,
      preInvariants,
      postInvariants,
      brokenInvariants: brokenNames,
      evidence: makeEvidence(challenge, verdict, exploitTest, patchedTest, brokenNames),
      executionTimeMs: Date.now() - start,
    }
  })

/**
 * Run forge-only verification (no invariant checking).
 * Faster, doesn't require a running devnet with deployed contracts.
 */
export const verifyForgeOnly = (
  challenge: HybridChallenge,
  dvdefiRoot: string,
): Effect.Effect<HybridResult, HybridVerificationError | FoundryError, Foundry> =>
  Effect.gen(function* () {
    const start = Date.now()
    const foundry = yield* Foundry

    // Build
    yield* foundry.build(dvdefiRoot).pipe(
      Effect.mapError(
        (e) =>
          new HybridVerificationError({
            reason: `Build failed: ${e.reason}`,
            phase: "build",
            cause: e,
          }),
      ),
    )

    // Exploit test
    const exploitTest = yield* foundry.test(
      dvdefiRoot,
      challenge.forge.tests.exploit,
      challenge.forge.tests.exploitFunction,
    )

    if (!exploitTest.passed) {
      return {
        challengeId: challenge.id,
        verdict: "INVALID" as Verdict,
        severity: null,
        exploitTest,
        patchedTest: null,
        preInvariants: null,
        postInvariants: null,
        brokenInvariants: [],
        evidence: `Exploit test failed.\n${exploitTest.stderr}`,
        executionTimeMs: Date.now() - start,
      }
    }

    // Patched test
    const patchedTest = yield* foundry.test(
      dvdefiRoot,
      challenge.forge.tests.patched,
      challenge.forge.tests.patchedFunction,
    )

    const verdict: Verdict =
      exploitTest.passed && patchedTest.passed
        ? "VALID_BUG"
        : exploitTest.passed && !patchedTest.passed
          ? "TEST_ARTIFACT"
          : "INVALID"

    return {
      challengeId: challenge.id,
      verdict,
      severity: verdict === "VALID_BUG" ? challenge.severity : null,
      exploitTest,
      patchedTest,
      preInvariants: null,
      postInvariants: null,
      brokenInvariants: [],
      evidence: makeEvidence(challenge, verdict, exploitTest, patchedTest, []),
      executionTimeMs: Date.now() - start,
    }
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEvidence = (
  challenge: HybridChallenge,
  verdict: Verdict,
  exploit: ForgeTestResult,
  patched: ForgeTestResult | null,
  brokenInvariants: ReadonlyArray<string>,
): string => {
  const lines: string[] = [
    `Challenge: ${challenge.name} (${challenge.id})`,
    `Verdict: ${verdict}`,
    `Severity: ${challenge.severity}`,
    `Exploit test: ${exploit.passed ? "PASSED" : "FAILED"}`,
  ]
  if (patched) {
    lines.push(`Patched test: ${patched.passed ? "PASSED" : "FAILED"}`)
  }
  if (brokenInvariants.length > 0) {
    lines.push(`Broken invariants: ${brokenInvariants.join(", ")}`)
  }
  if (verdict === "VALID_BUG") {
    lines.push(
      "The exploit successfully demonstrates the vulnerability. " +
      "The patched contracts are immune to the exploit.",
    )
  }
  return lines.join("\n")
}
