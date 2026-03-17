/**
 * Challenge registry — all hybrid challenges available for verification.
 */
import type { HybridChallenge } from "../HybridChallenge.js"
import { SideEntrance } from "./side-entrance.js"
import { Truster } from "./truster.js"
import { Unstoppable } from "./unstoppable.js"

export { SideEntrance, Truster, Unstoppable }

export const ChallengeRegistry: ReadonlyMap<string, HybridChallenge> = new Map([
  ["side-entrance", SideEntrance],
  ["truster", Truster],
  ["unstoppable", Unstoppable],
])

export const getChallenge = (id: string): HybridChallenge | undefined =>
  ChallengeRegistry.get(id)

export const listChallenges = (): ReadonlyArray<HybridChallenge> =>
  [...ChallengeRegistry.values()]
