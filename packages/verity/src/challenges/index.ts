/**
 * @module challenges
 *
 * Re-exports all DVDeFi challenge invariant suites.
 */

export { makeSideEntranceSuite } from "./side-entrance.js"
export {
  makeTrusterSuite,
  poolTokenBalance,
  noUnauthorizedAllowances,
  poolAllowanceZero,
} from "./truster.js"
export {
  makeUnstoppableSuite,
  sharesAssetsConsistency,
  vaultNotPaused,
  flashLoanCallable,
  vaultOwnershipStable,
} from "./unstoppable.js"
