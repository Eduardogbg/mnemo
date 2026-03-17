/**
 * InvariantChecker — Effect service that runs invariant checks against
 * a live devnet for a given challenge.
 */
import { Context, Data, Effect, Layer } from "effect"
import { Devnet, type DevnetError } from "./Devnet.js"
import type {
  ChallengeContext,
  ChallengeDefinition,
  InvariantResult,
  Severity,
} from "./Challenge.js"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class InvariantCheckError extends Data.TaggedError(
  "InvariantCheckError",
)<{
  readonly invariantId: string
  readonly reason: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface InvariantSnapshot {
  readonly invariantId: string
  readonly description: string
  readonly severity: Severity
  readonly preValue: InvariantResult
  readonly postValue?: InvariantResult
}

export interface InvariantCheckReport {
  readonly challengeId: string
  /** All snapshots (pre and optionally post). */
  readonly snapshots: readonly InvariantSnapshot[]
  /** IDs of invariants that were broken (post check failed). */
  readonly brokenInvariants: readonly string[]
  /** IDs of invariants that were already broken before the PoC. */
  readonly prebrokenInvariants: readonly string[]
  /** Maximum severity among broken invariants. */
  readonly maxSeverity: Severity | null
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface InvariantChecker {
  /**
   * Run all invariant checks for a challenge at the current devnet state.
   * Returns results for each invariant.
   */
  readonly checkAll: (
    challenge: ChallengeDefinition,
    ctx: ChallengeContext,
  ) => Effect.Effect<readonly InvariantResult[], DevnetError>

  /**
   * Run a specific invariant by id.
   */
  readonly checkOne: (
    challenge: ChallengeDefinition,
    ctx: ChallengeContext,
    invariantId: string,
  ) => Effect.Effect<InvariantResult, DevnetError | InvariantCheckError>

  /**
   * Run pre-PoC checks, return snapshot data for later comparison.
   */
  readonly snapshotPre: (
    challenge: ChallengeDefinition,
    ctx: ChallengeContext,
  ) => Effect.Effect<readonly InvariantSnapshot[], DevnetError>

  /**
   * Run post-PoC checks, filling in the postValue on existing snapshots.
   * Returns a complete report.
   */
  readonly snapshotPost: (
    challenge: ChallengeDefinition,
    ctx: ChallengeContext,
    preSnapshots: readonly InvariantSnapshot[],
  ) => Effect.Effect<InvariantCheckReport, DevnetError>
}

export const InvariantChecker = Context.GenericTag<InvariantChecker>(
  "@mnemo/dvdefi/InvariantChecker",
)

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const maxSeverity = (a: Severity, b: Severity): Severity =>
  SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const makeInvariantChecker = (devnet: Devnet): InvariantChecker => ({
  checkAll: (challenge, ctx) =>
    Effect.forEach(
      challenge.invariants,
      (inv) => inv.check(devnet, ctx),
      { concurrency: "unbounded" },
    ),

  checkOne: (challenge, ctx, invariantId) =>
    Effect.gen(function* () {
      const inv = challenge.invariants.find((i) => i.id === invariantId)
      if (!inv) {
        return yield* Effect.fail(
          new InvariantCheckError({
            invariantId,
            reason: `Invariant ${invariantId} not found in challenge ${challenge.id}`,
          }),
        )
      }
      return yield* inv.check(devnet, ctx)
    }),

  snapshotPre: (challenge, ctx) =>
    Effect.gen(function* () {
      const results = yield* Effect.forEach(
        challenge.invariants,
        (inv) => inv.check(devnet, ctx),
        { concurrency: "unbounded" },
      )
      return challenge.invariants.map((inv, i) => ({
        invariantId: inv.id,
        description: inv.description,
        severity: inv.severity,
        preValue: results[i]!,
      }))
    }),

  snapshotPost: (challenge, ctx, preSnapshots) =>
    Effect.gen(function* () {
      const postResults = yield* Effect.forEach(
        challenge.invariants,
        (inv) => inv.check(devnet, ctx),
        { concurrency: "unbounded" },
      )

      const snapshots: InvariantSnapshot[] = preSnapshots.map(
        (pre, i) => ({
          ...pre,
          postValue: postResults[i]!,
        }),
      )

      const brokenInvariants = snapshots
        .filter((s) => s.postValue && !s.postValue.holds)
        .map((s) => s.invariantId)

      const prebrokenInvariants = snapshots
        .filter((s) => !s.preValue.holds)
        .map((s) => s.invariantId)

      let severity: Severity | null = null
      for (const id of brokenInvariants) {
        const snap = snapshots.find((s) => s.invariantId === id)
        if (snap) {
          severity =
            severity === null ? snap.severity : maxSeverity(severity, snap.severity)
        }
      }

      return {
        challengeId: challenge.id,
        snapshots,
        brokenInvariants,
        prebrokenInvariants,
        maxSeverity: severity,
      }
    }),
})

/**
 * Create an InvariantChecker Layer from a Devnet service.
 */
export const InvariantCheckerLive: Layer.Layer<InvariantChecker, never, Devnet> =
  Layer.effect(
    InvariantChecker,
    Effect.gen(function* () {
      const devnet = yield* Devnet
      return makeInvariantChecker(devnet)
    }),
  )
