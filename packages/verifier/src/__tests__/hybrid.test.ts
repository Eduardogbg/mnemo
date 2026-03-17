/**
 * Integration test — runs the hybrid verifier against DVDeFi challenges.
 *
 * Requires: forge, anvil installed and on PATH.
 * Runs against: repos/damn-vulnerable-defi/
 */
import { describe, test, expect } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { FoundryLive } from "@mnemo/dvdefi"
import { getChallenge, verifyForgeOnly } from "../index.js"
import * as path from "node:path"

const DVDEFI_ROOT = path.resolve(
  import.meta.dir,
  "../../../../repos/damn-vulnerable-defi",
)

describe("Hybrid Verifier — forge-only mode", () => {
  test("side-entrance: VALID_BUG", async () => {
    const challenge = getChallenge("side-entrance")!
    expect(challenge).toBeDefined()

    const result = await Effect.runPromise(
      verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
        Effect.provide(FoundryLive),
      ),
    )

    expect(result.verdict).toBe("VALID_BUG")
    expect(result.exploitTest.passed).toBe(true)
    expect(result.patchedTest?.passed).toBe(true)
    expect(result.severity).toBe("critical")
  }, 60_000)

  test("truster: VALID_BUG", async () => {
    const challenge = getChallenge("truster")!
    const result = await Effect.runPromise(
      verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
        Effect.provide(FoundryLive),
      ),
    )

    expect(result.verdict).toBe("VALID_BUG")
    expect(result.exploitTest.passed).toBe(true)
    expect(result.patchedTest?.passed).toBe(true)
    expect(result.severity).toBe("critical")
  }, 60_000)

  test("unstoppable: VALID_BUG", async () => {
    const challenge = getChallenge("unstoppable")!
    const result = await Effect.runPromise(
      verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
        Effect.provide(FoundryLive),
      ),
    )

    expect(result.verdict).toBe("VALID_BUG")
    expect(result.exploitTest.passed).toBe(true)
    expect(result.patchedTest?.passed).toBe(true)
    expect(result.severity).toBe("high")
  }, 60_000)

  test("challenge registry lists all 3", () => {
    const { listChallenges } = require("../index.js")
    const challenges = listChallenges()
    expect(challenges.length).toBe(3)
    expect(challenges.map((c: any) => c.id).sort()).toEqual([
      "side-entrance",
      "truster",
      "unstoppable",
    ])
  })
})
