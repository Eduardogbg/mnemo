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

  forge: {
    contracts: dvdefiChallenge.contracts,
    tests: dvdefiChallenge.tests,
  },

  makeInvariantSuite: (ctx) => {
    const pool = ctx.addresses["pool"]
    const deployer = ctx.addresses["deployer"]
    if (!pool || !deployer) {
      throw new Error(`side-entrance: missing addresses (pool=${pool}, deployer=${deployer})`)
    }
    return makeSideEntranceSuite(pool, deployer)
  },

  dvdefi: dvdefiChallenge,
}
