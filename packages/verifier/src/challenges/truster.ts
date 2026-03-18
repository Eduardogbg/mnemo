/**
 * Truster — hybrid challenge wiring dvdefi forge tests
 * with verity's typed invariant suite.
 */
import { Truster as dvdefiChallenge } from "@mnemo/dvdefi"
import { makeTrusterSuite } from "@mnemo/verity"
import type { HybridChallenge } from "../HybridChallenge.js"

export const Truster: HybridChallenge = {
  id: "truster",
  name: "Truster",
  description: dvdefiChallenge.description,
  difficulty: "low",

  forge: {
    contracts: dvdefiChallenge.contracts,
    tests: dvdefiChallenge.tests,
  },

  makeInvariantSuite: (ctx) =>
    makeTrusterSuite(
      ctx.addresses["token"]!,
      ctx.addresses["pool"]!,
    ),

  dvdefi: dvdefiChallenge,
}
