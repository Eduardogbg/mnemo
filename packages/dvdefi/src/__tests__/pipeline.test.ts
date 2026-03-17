/**
 * Integration test for the VerificationPipeline.
 *
 * Requires `forge` to be installed and the DVDeFi repo at
 * `repos/damn-vulnerable-defi/` relative to the project root.
 */
import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as path from "node:path"

import {
  VerificationPipeline,
  VerificationPipelineForgeOnly,
  FoundryLive,
  SideEntrance,
  Truster,
  Unstoppable,
} from "../index.js"
import type { ChallengeDefinition } from "../Challenge.js"

// Resolve the DVDeFi root relative to this file
const DVDEFI_ROOT = path.resolve(
  import.meta.dir,
  "../../../../repos/damn-vulnerable-defi",
)

// Build the layer: VerificationPipeline backed by Foundry only
const TestLayer = VerificationPipelineForgeOnly.pipe(Layer.provide(FoundryLive))

const runVerify = (challenge: ChallengeDefinition) =>
  Effect.gen(function* () {
    const pipeline = yield* VerificationPipeline
    return yield* pipeline.verifyForgeOnly(challenge, DVDEFI_ROOT)
  }).pipe(Effect.provide(TestLayer), Effect.runPromise)

describe("VerificationPipeline (forge-only)", () => {
  test(
    "Side Entrance — VALID_BUG",
    async () => {
      const result = await runVerify(SideEntrance)
      expect(result.verdict).toBe("VALID_BUG")
      expect(result.exploitTestResult.passed).toBe(true)
      expect(result.patchedTestResult?.passed).toBe(true)
      expect(result.severity).toBe("critical")
      console.log("Side Entrance evidence:", result.evidence)
      console.log(`Execution time: ${result.executionTimeMs}ms`)
    },
    { timeout: 60_000 },
  )

  test(
    "Truster — VALID_BUG",
    async () => {
      const result = await runVerify(Truster)
      expect(result.verdict).toBe("VALID_BUG")
      expect(result.exploitTestResult.passed).toBe(true)
      expect(result.patchedTestResult?.passed).toBe(true)
      expect(result.severity).toBe("critical")
      console.log("Truster evidence:", result.evidence)
      console.log(`Execution time: ${result.executionTimeMs}ms`)
    },
    { timeout: 60_000 },
  )

  test(
    "Unstoppable — VALID_BUG",
    async () => {
      const result = await runVerify(Unstoppable)
      expect(result.verdict).toBe("VALID_BUG")
      expect(result.exploitTestResult.passed).toBe(true)
      expect(result.patchedTestResult?.passed).toBe(true)
      expect(result.severity).toBe("medium")
      console.log("Unstoppable evidence:", result.evidence)
      console.log(`Execution time: ${result.executionTimeMs}ms`)
    },
    { timeout: 60_000 },
  )
})
