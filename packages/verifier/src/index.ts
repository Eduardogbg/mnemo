/**
 * @mnemo/verifier — hybrid verification pipeline that integrates
 * dvdefi (forge tests + anvil lifecycle) with verity (typed invariants
 * via voltaire-effect).
 *
 * ## Architecture
 *
 * dvdefi manages the low-level environment:
 *   - Anvil process lifecycle (Devnet service)
 *   - Forge build/test execution (Foundry service)
 *   - Challenge file paths and test function names
 *
 * verity provides typed verification primitives:
 *   - ProviderService (read-only chain access via voltaire-effect)
 *   - DevnetCheatcodes (snapshot/revert/setBalance)
 *   - Invariant type (read-only Effect, enforced by R channel)
 *   - InvariantSuite (composable sets of invariants)
 *
 * This package bridges them:
 *   - HybridChallenge ties forge paths to verity invariant suites
 *   - Bridge connects dvdefi's Devnet.rpcUrl to verity's HttpProviderFetch
 *   - HybridPipeline orchestrates both forge tests and RPC invariant checks
 *
 * ## Usage
 *
 * ```typescript
 * import * as Effect from "effect/Effect"
 * import { DevnetLive, FoundryLive } from "@mnemo/dvdefi"
 * import { getChallenge, verifyForgeOnly, verifyHybrid } from "@mnemo/verifier"
 *
 * const challenge = getChallenge("side-entrance")!
 *
 * // Quick: forge-only (no devnet needed for invariants)
 * const forgeResult = verifyForgeOnly(challenge, dvdefiRoot).pipe(
 *   Effect.provide(FoundryLive),
 * )
 *
 * // Full: forge + verity invariants
 * const hybridResult = verifyHybrid(challenge, dvdefiRoot, ctx).pipe(
 *   Effect.provide(Layer.merge(DevnetLive(), FoundryLive)),
 * )
 * ```
 */

// -- Hybrid challenge type --
export type { HybridChallenge } from "./HybridChallenge.js"

// -- Bridge (dvdefi -> verity layer composition) --
export {
  providerFromDevnet,
  cheatcodesFromDevnet,
  verityLayerFromDevnet,
} from "./Bridge.js"

// -- Hybrid verification pipeline --
export {
  verifyHybrid,
  verifyForgeOnly,
  HybridVerificationError,
  type Verdict,
  type HybridResult,
} from "./HybridPipeline.js"

// -- Challenge registry --
export {
  SideEntrance,
  Truster,
  Unstoppable,
  ChallengeRegistry,
  getChallenge,
  listChallenges,
} from "./challenges/index.js"

// -- LLM-callable tools --
export {
  ListChallenges,
  RunVerification,
  GetChallengeDetails,
  VerifierToolkit,
  makeHandlers,
  toolkitLayer,
} from "./tools.js"

// -- Verifier agent --
export {
  VERIFIER_SYSTEM_PROMPT,
  makeVerifierAgentConfig,
} from "./VerifierAgent.js"
