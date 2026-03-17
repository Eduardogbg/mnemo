/**
 * Unstoppable — hybrid challenge wiring dvdefi forge tests
 * with verity's typed invariant suite.
 */
import { Unstoppable as dvdefiChallenge } from "@mnemo/dvdefi"
import { makeUnstoppableSuite } from "@mnemo/verity"
import type { HybridChallenge } from "../HybridChallenge.js"

export const Unstoppable: HybridChallenge = {
  id: "unstoppable",
  name: "Unstoppable",
  description: dvdefiChallenge.description,
  difficulty: "low",
  severity: "high",

  forge: {
    contracts: dvdefiChallenge.contracts,
    tests: dvdefiChallenge.tests,
  },

  makeInvariantSuite: (ctx) =>
    makeUnstoppableSuite(
      ctx.addresses["vault"]!,
      ctx.addresses["token"]!,
    ),

  dvdefi: dvdefiChallenge,
}
