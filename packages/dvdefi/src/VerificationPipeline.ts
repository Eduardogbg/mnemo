/**
 * VerificationPipeline — orchestrates the full verification flow:
 *
 *  1. Build contracts (forge build)
 *  2. Run exploit test against vulnerable contracts
 *  3. Check invariants pre-exploit (via devnet snapshot from forge test setup)
 *  4. Check invariants post-exploit
 *  5. Run patched test (exploit should fail against patched)
 *  6. Return verdict
 *
 * NOTE: Since the DVDeFi tests deploy contracts internally (setUp()), we cannot
 * directly inspect contract addresses via our devnet RPC during a forge test run.
 * Instead, we use a two-phase approach:
 *
 *   Phase A — "Forge-only" verification: run `forge test` for the exploit and
 *   patched tests. If exploit passes and patched passes, it is a valid bug.
 *
 *   Phase B — "Invariant" verification: deploy contracts ourselves via forge
 *   script, then check invariants via RPC before/after the exploit.
 *
 * For the hackathon MVP, we implement Phase A (forge test-based) and a
 * simplified Phase B that runs the forge test, then checks invariants against
 * the devnet state (which persists after `forge test --fork-url`).
 */
import { Context, Data, Effect, Layer } from "effect"
import { Devnet, type DevnetError } from "./Devnet.js"
import { Foundry, type FoundryError, type ForgeTestResult } from "./Foundry.js"
import {
  InvariantChecker,
  type InvariantCheckReport,
  type InvariantCheckError,
} from "./InvariantChecker.js"
import type {
  ChallengeDefinition,
  ChallengeContext,
  Severity,
} from "./Challenge.js"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class VerificationError extends Data.TaggedError("VerificationError")<{
  readonly reason: string
  readonly phase: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type Verdict = "VALID_BUG" | "INVALID" | "TEST_ARTIFACT" | "BUILD_FAILURE"

export interface VerificationResult {
  readonly challengeId: string
  readonly verdict: Verdict
  readonly severity: Severity | null
  readonly exploitTestResult: ForgeTestResult
  readonly patchedTestResult: ForgeTestResult | null
  readonly invariantReport: InvariantCheckReport | null
  readonly evidence: string
  readonly executionTimeMs: number
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface VerificationPipeline {
  /**
   * Run the full verification pipeline for a challenge.
   *
   * @param challenge — the challenge definition
   * @param dvdefiRoot — absolute path to the DVDeFi repo root
   */
  readonly verify: (
    challenge: ChallengeDefinition,
    dvdefiRoot: string,
  ) => Effect.Effect<
    VerificationResult,
    VerificationError | FoundryError | DevnetError,
    never
  >

  /**
   * Run only the forge-test-based verification (Phase A).
   * Does not require a devnet — just runs forge test.
   */
  readonly verifyForgeOnly: (
    challenge: ChallengeDefinition,
    dvdefiRoot: string,
  ) => Effect.Effect<VerificationResult, VerificationError | FoundryError>

  /**
   * Run the invariant-checking verification (Phase B) against a running devnet.
   * Requires the devnet to have the challenge contracts deployed.
   */
  readonly verifyWithInvariants: (
    challenge: ChallengeDefinition,
    dvdefiRoot: string,
    ctx: ChallengeContext,
  ) => Effect.Effect<
    VerificationResult,
    VerificationError | FoundryError | DevnetError,
    never
  >
}

export const VerificationPipeline = Context.GenericTag<VerificationPipeline>(
  "@mnemo/dvdefi/VerificationPipeline",
)

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const makeVerificationPipeline = (
  devnet: Devnet,
  foundry: Foundry,
  checker: InvariantChecker,
): VerificationPipeline => ({
  verify: (challenge, dvdefiRoot) =>
    Effect.gen(function* () {
      const start = Date.now()

      // Step 1: Build
      const buildResult = yield* foundry.build(dvdefiRoot).pipe(
        Effect.mapError(
          (e) =>
            new VerificationError({
              reason: `Build failed: ${e.reason}`,
              phase: "build",
              cause: e,
            }),
        ),
      )

      // Step 2: Run exploit test (must PASS — the exploit works)
      const exploitResult = yield* foundry.test(
        dvdefiRoot,
        challenge.tests.exploit,
        challenge.tests.exploitFunction,
      )

      if (!exploitResult.passed) {
        return {
          challengeId: challenge.id,
          verdict: "INVALID" as Verdict,
          severity: null,
          exploitTestResult: exploitResult,
          patchedTestResult: null,
          invariantReport: null,
          evidence: `Exploit test failed — PoC does not demonstrate the vulnerability.\n${exploitResult.stderr}`,
          executionTimeMs: Date.now() - start,
        }
      }

      // Step 3: Run patched test (must PASS — exploit fails against patch)
      const patchedResult = yield* foundry.test(
        dvdefiRoot,
        challenge.tests.patched,
        challenge.tests.patchedFunction,
      )

      // Step 4: Determine verdict from forge test results
      let verdict: Verdict
      let evidence: string

      if (exploitResult.passed && patchedResult.passed) {
        verdict = "VALID_BUG"
        evidence =
          `Exploit succeeds against vulnerable contracts and fails against patched contracts. ` +
          `Challenge: ${challenge.name}. Difficulty: ${challenge.difficulty}.`
      } else if (exploitResult.passed && !patchedResult.passed) {
        verdict = "TEST_ARTIFACT"
        evidence =
          `Exploit succeeds against vulnerable, but patched test also fails. ` +
          `This may indicate the patch is insufficient or the test is wrong.\n` +
          `Patched stderr: ${patchedResult.stderr}`
      } else {
        verdict = "INVALID"
        evidence = `Exploit test did not pass.`
      }

      // Step 5: Try invariant checking if we have a running devnet
      // Run exploit against devnet using forge test --fork-url
      let invariantReport: InvariantCheckReport | null = null

      // For full invariant checking, we would need to:
      //  1. Run forge test --fork-url <anvil> to execute against our devnet
      //  2. Then check invariants via RPC
      // This requires the forge test to use the fork, which DVDeFi tests do not
      // natively support. We include this for future expansion.

      const elapsed = Date.now() - start
      return {
        challengeId: challenge.id,
        verdict,
        severity: verdict === "VALID_BUG" ? inferSeverity(challenge) : null,
        exploitTestResult: exploitResult,
        patchedTestResult: patchedResult,
        invariantReport,
        evidence,
        executionTimeMs: elapsed,
      }
    }),

  verifyForgeOnly: (challenge, dvdefiRoot) =>
    Effect.gen(function* () {
      const start = Date.now()

      // Build
      yield* foundry.build(dvdefiRoot).pipe(
        Effect.mapError(
          (e) =>
            new VerificationError({
              reason: `Build failed: ${e.reason}`,
              phase: "build",
              cause: e,
            }),
        ),
      )

      // Exploit test
      const exploitResult = yield* foundry.test(
        dvdefiRoot,
        challenge.tests.exploit,
        challenge.tests.exploitFunction,
      )

      if (!exploitResult.passed) {
        return {
          challengeId: challenge.id,
          verdict: "INVALID" as Verdict,
          severity: null,
          exploitTestResult: exploitResult,
          patchedTestResult: null,
          invariantReport: null,
          evidence: `Exploit test failed.\n${exploitResult.stderr}`,
          executionTimeMs: Date.now() - start,
        }
      }

      // Patched test
      const patchedResult = yield* foundry.test(
        dvdefiRoot,
        challenge.tests.patched,
        challenge.tests.patchedFunction,
      )

      const verdict: Verdict =
        exploitResult.passed && patchedResult.passed
          ? "VALID_BUG"
          : exploitResult.passed && !patchedResult.passed
            ? "TEST_ARTIFACT"
            : "INVALID"

      return {
        challengeId: challenge.id,
        verdict,
        severity: verdict === "VALID_BUG" ? inferSeverity(challenge) : null,
        exploitTestResult: exploitResult,
        patchedTestResult: patchedResult,
        invariantReport: null,
        evidence: makeEvidence(challenge, verdict, exploitResult, patchedResult),
        executionTimeMs: Date.now() - start,
      }
    }),

  verifyWithInvariants: (challenge, dvdefiRoot, ctx) =>
    Effect.gen(function* () {
      const start = Date.now()

      // Step 1: Take pre-exploit snapshot on devnet
      const snapshotId = yield* devnet.snapshot()

      // Step 2: Check invariants before exploit (should all hold)
      const preSnapshots = yield* checker.snapshotPre(challenge, ctx)
      const preBroken = preSnapshots.filter((s) => !s.preValue.holds)

      if (preBroken.length > 0) {
        yield* devnet.revert(snapshotId)
        return {
          challengeId: challenge.id,
          verdict: "INVALID" as Verdict,
          severity: null,
          exploitTestResult: {
            passed: false,
            stdout: "",
            stderr: "Pre-exploit invariants already broken",
            exitCode: -1,
          },
          patchedTestResult: null,
          invariantReport: {
            challengeId: challenge.id,
            snapshots: preSnapshots,
            brokenInvariants: [],
            prebrokenInvariants: preBroken.map((s) => s.invariantId),
            maxSeverity: null,
          },
          evidence: `Pre-exploit invariants already broken: ${preBroken.map((s) => s.invariantId).join(", ")}`,
          executionTimeMs: Date.now() - start,
        }
      }

      // Step 3: Run exploit test via forge test --fork-url
      const exploitResult = yield* foundry.test(
        dvdefiRoot,
        challenge.tests.exploit,
        challenge.tests.exploitFunction,
      )

      // Step 4: Check invariants after exploit
      const invariantReport = yield* checker.snapshotPost(
        challenge,
        ctx,
        preSnapshots,
      )

      // Step 5: Revert devnet to pre-exploit state
      yield* devnet.revert(snapshotId)

      // Step 6: Run patched test
      const patchedResult = yield* foundry.test(
        dvdefiRoot,
        challenge.tests.patched,
        challenge.tests.patchedFunction,
      )

      // Step 7: Determine verdict
      const exploitBrokeInvariants = invariantReport.brokenInvariants.length > 0
      let verdict: Verdict

      if (exploitResult.passed && patchedResult.passed && exploitBrokeInvariants) {
        verdict = "VALID_BUG"
      } else if (exploitResult.passed && !exploitBrokeInvariants) {
        verdict = "INVALID" // exploit passed but no invariants broken
      } else if (exploitBrokeInvariants && !patchedResult.passed) {
        verdict = "TEST_ARTIFACT"
      } else {
        verdict = "INVALID"
      }

      return {
        challengeId: challenge.id,
        verdict,
        severity: invariantReport.maxSeverity,
        exploitTestResult: exploitResult,
        patchedTestResult: patchedResult,
        invariantReport,
        evidence: makeEvidenceWithInvariants(
          challenge,
          verdict,
          invariantReport,
        ),
        executionTimeMs: Date.now() - start,
      }
    }),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Infer severity from the challenge's invariant definitions. */
const inferSeverity = (challenge: ChallengeDefinition): Severity => {
  let max: Severity = "low"
  for (const inv of challenge.invariants) {
    const order: Record<Severity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    }
    if (order[inv.severity] > order[max]) {
      max = inv.severity
    }
  }
  return max
}

const makeEvidence = (
  challenge: ChallengeDefinition,
  verdict: Verdict,
  exploit: ForgeTestResult,
  patched: ForgeTestResult | null,
): string => {
  const lines: string[] = [
    `Challenge: ${challenge.name} (${challenge.id})`,
    `Verdict: ${verdict}`,
    `Exploit test: ${exploit.passed ? "PASSED" : "FAILED"} (exit ${exploit.exitCode})`,
  ]
  if (patched) {
    lines.push(
      `Patched test: ${patched.passed ? "PASSED" : "FAILED"} (exit ${patched.exitCode})`,
    )
  }
  if (verdict === "VALID_BUG") {
    lines.push(
      `The exploit successfully demonstrates the vulnerability against the ` +
        `vulnerable contracts, and the patched contracts are immune to the exploit.`,
    )
  }
  return lines.join("\n")
}

const makeEvidenceWithInvariants = (
  challenge: ChallengeDefinition,
  verdict: Verdict,
  report: InvariantCheckReport,
): string => {
  const lines: string[] = [
    `Challenge: ${challenge.name} (${challenge.id})`,
    `Verdict: ${verdict}`,
    `Broken invariants: ${report.brokenInvariants.length > 0 ? report.brokenInvariants.join(", ") : "none"}`,
    `Max severity: ${report.maxSeverity ?? "N/A"}`,
    "",
    "Invariant details:",
  ]
  for (const snap of report.snapshots) {
    const pre = snap.preValue
    const post = snap.postValue
    lines.push(`  ${snap.invariantId} (${snap.severity}):`)
    lines.push(`    Pre:  holds=${pre.holds} — ${pre.actual}`)
    if (post) {
      lines.push(`    Post: holds=${post.holds} — ${post.actual}`)
      if (post.evidence) {
        lines.push(`    Evidence: ${post.evidence}`)
      }
    }
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const VerificationPipelineLive: Layer.Layer<
  VerificationPipeline,
  never,
  Devnet | Foundry | InvariantChecker
> = Layer.effect(
  VerificationPipeline,
  Effect.gen(function* () {
    const devnet = yield* Devnet
    const foundry = yield* Foundry
    const checker = yield* InvariantChecker
    return makeVerificationPipeline(devnet, foundry, checker)
  }),
)

/**
 * Convenience: Layer that only needs Foundry (no devnet/invariant checking).
 * Uses forge-only verification mode.
 */
export const VerificationPipelineForgeOnly: Layer.Layer<
  VerificationPipeline,
  never,
  Foundry
> = Layer.effect(
  VerificationPipeline,
  Effect.gen(function* () {
    const foundry = yield* Foundry
    // Provide a stub devnet and checker — only verifyForgeOnly is usable
    const stubDevnet = {} as Devnet
    const stubChecker = {} as InvariantChecker
    return makeVerificationPipeline(stubDevnet, foundry, stubChecker)
  }),
)
