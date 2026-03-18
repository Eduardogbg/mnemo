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

  forge: {
    contracts: dvdefiChallenge.contracts,
    tests: dvdefiChallenge.tests,
  },

  makeInvariantSuite: (ctx) => {
    const vault = ctx.addresses["vault"]
    const monitor = ctx.addresses["monitor"]
    if (!vault || !monitor) {
      throw new Error(`unstoppable: missing addresses (vault=${vault}, monitor=${monitor})`)
    }
    return makeUnstoppableSuite(vault, monitor)
  },

  dvdefi: dvdefiChallenge,
}
