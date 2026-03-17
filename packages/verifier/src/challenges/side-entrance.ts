/**
 * Side Entrance — hybrid challenge wiring dvdefi forge tests
 * with verity's typed invariant suite.
 */
import { SideEntrance as dvdefiChallenge } from "@mnemo/dvdefi"
import { makeSideEntranceSuite } from "@mnemo/verity"
import type { HybridChallenge } from "../HybridChallenge.js"

export const SideEntrance: HybridChallenge = {
  id: "side-entrance",
  name: "Side Entrance",
  description: dvdefiChallenge.description,
  difficulty: "trivial",
  severity: "critical",

  forge: {
    contracts: dvdefiChallenge.contracts,
    tests: dvdefiChallenge.tests,
  },

  makeInvariantSuite: (ctx) =>
    makeSideEntranceSuite(
      ctx.addresses["pool"]!,
      ctx.addresses["deployer"]!,
    ),

  dvdefi: dvdefiChallenge,
}
