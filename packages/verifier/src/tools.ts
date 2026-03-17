/**
 * LLM-callable tools for the verifier agent.
 *
 * Defines three tools using @effect/ai's Tool + Toolkit pattern:
 *   - list_challenges: enumerate available DVDeFi challenges
 *   - run_verification: execute forge-only verification for a challenge
 *   - get_challenge_details: return detailed challenge metadata
 *
 * The tools wrap the existing @mnemo/verifier pipeline and are designed
 * to be composed into a Toolkit that can be passed to LanguageModel.generateText.
 */
import { Tool, Toolkit } from "@effect/ai"
import { Effect, Schema } from "effect"
import { Foundry, FoundryLive } from "@mnemo/dvdefi"
import {
  listChallenges,
  getChallenge,
  verifyForgeOnly,
  type HybridChallenge,
  type Verdict,
} from "./index.js"

// ---------------------------------------------------------------------------
// Result schemas
// ---------------------------------------------------------------------------

const ChallengeSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  difficulty: Schema.String,
  severity: Schema.String,
})

const VerificationResult = Schema.Struct({
  challengeId: Schema.String,
  verdict: Schema.String,
  severity: Schema.NullOr(Schema.String),
  evidence: Schema.String,
  executionTimeMs: Schema.Number,
})

const ChallengeDetails = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  difficulty: Schema.String,
  severity: Schema.String,
  contracts: Schema.Struct({
    vulnerable: Schema.Array(Schema.String),
    patched: Schema.Array(Schema.String),
  }),
  tests: Schema.Struct({
    exploit: Schema.String,
    exploitFunction: Schema.String,
    patched: Schema.String,
    patchedFunction: Schema.String,
  }),
})

const ChallengeList = Schema.Array(ChallengeSummary)

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const ListChallenges = Tool.make("list_challenges", {
  description:
    "List all available DVDeFi exploit challenges with their IDs, names, descriptions, and difficulty levels.",
  success: ChallengeList,
})

export const RunVerification = Tool.make("run_verification", {
  description:
    "Run the forge-only verification pipeline for a given challenge against the DVDeFi repo. " +
    "Returns a verdict (VALID_BUG, INVALID, TEST_ARTIFACT, or BUILD_FAILURE), severity, and evidence string.",
  parameters: {
    challengeId: Schema.String.annotations({
      description: "The challenge ID to verify (e.g. 'side-entrance', 'truster', 'unstoppable')",
    }),
  },
  success: VerificationResult,
  failure: Schema.String,
})

export const GetChallengeDetails = Tool.make("get_challenge_details", {
  description:
    "Get detailed information about a specific challenge: contract paths, test paths, invariant descriptions.",
  parameters: {
    challengeId: Schema.String.annotations({
      description: "The challenge ID to look up",
    }),
  },
  success: ChallengeDetails,
  failure: Schema.String,
})

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

export const VerifierToolkit = Toolkit.make(
  ListChallenges,
  RunVerification,
  GetChallengeDetails,
)

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

/**
 * Build the handler implementations for the verifier toolkit.
 *
 * @param dvdefiRoot - Absolute path to the damn-vulnerable-defi repo.
 *                     Defaults to `repos/damn-vulnerable-defi` relative to
 *                     the monorepo root (4 levels up from this file).
 */
export const makeHandlers = (dvdefiRoot?: string) => {
  const root =
    dvdefiRoot ??
    new URL("../../../../repos/damn-vulnerable-defi", import.meta.url).pathname

  return VerifierToolkit.of({
    list_challenges: () =>
      Effect.succeed(
        listChallenges().map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          difficulty: c.difficulty,
          severity: c.severity,
        })),
      ),

    run_verification: ({ challengeId }) =>
      Effect.gen(function* () {
        const challenge = getChallenge(challengeId)
        if (!challenge) {
          return yield* Effect.fail(
            `Unknown challenge ID: '${challengeId}'. Use list_challenges to see available challenges.`,
          )
        }

        const result = yield* verifyForgeOnly(challenge, root).pipe(
          Effect.provide(FoundryLive),
          Effect.mapError(
            (e) =>
              `Verification failed for '${challengeId}': ${
                "reason" in e ? e.reason : "message" in e ? (e as any).message : String(e)
              }`,
          ),
        )

        return {
          challengeId: result.challengeId,
          verdict: result.verdict,
          severity: result.severity,
          evidence: result.evidence,
          executionTimeMs: result.executionTimeMs,
        }
      }),

    get_challenge_details: ({ challengeId }) =>
      Effect.gen(function* () {
        const challenge = getChallenge(challengeId)
        if (!challenge) {
          return yield* Effect.fail(
            `Unknown challenge ID: '${challengeId}'. Use list_challenges to see available challenges.`,
          )
        }

        return {
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          difficulty: challenge.difficulty,
          severity: challenge.severity,
          contracts: {
            vulnerable: [...challenge.forge.contracts.vulnerable],
            patched: [...challenge.forge.contracts.patched],
          },
          tests: {
            exploit: challenge.forge.tests.exploit,
            exploitFunction: challenge.forge.tests.exploitFunction,
            patched: challenge.forge.tests.patched,
            patchedFunction: challenge.forge.tests.patchedFunction,
          },
        }
      }),
  })
}

// ---------------------------------------------------------------------------
// Layer — provides the toolkit handlers into Effect context
// ---------------------------------------------------------------------------

/**
 * Create a Layer that provides the verifier toolkit handlers.
 * Suitable for passing to LanguageModel.generateText via the toolkit option.
 */
export const toolkitLayer = (dvdefiRoot?: string) =>
  VerifierToolkit.toLayer(makeHandlers(dvdefiRoot))
