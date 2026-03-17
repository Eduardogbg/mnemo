/**
 * Challenge registry — all available DVDeFi challenges.
 */
import type { ChallengeDefinition } from "../Challenge.js"
import { SideEntrance } from "./SideEntrance.js"
import { Truster } from "./Truster.js"
import { Unstoppable } from "./Unstoppable.js"

export { SideEntrance } from "./SideEntrance.js"
export { Truster } from "./Truster.js"
export { Unstoppable } from "./Unstoppable.js"

/**
 * All registered challenges, keyed by challenge id.
 */
export const ChallengeRegistry: ReadonlyMap<string, ChallengeDefinition> =
  new Map([
    [SideEntrance.id, SideEntrance],
    [Truster.id, Truster],
    [Unstoppable.id, Unstoppable],
  ])

/**
 * Get a challenge by id. Returns undefined if not found.
 */
export const getChallenge = (id: string): ChallengeDefinition | undefined =>
  ChallengeRegistry.get(id)

/**
 * List all challenge ids.
 */
export const listChallenges = (): readonly string[] =>
  Array.from(ChallengeRegistry.keys())
