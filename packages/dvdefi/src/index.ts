/**
 * @mnemo/dvdefi — DVDeFi environment integration for the Mnemo bug
 * disclosure verification system.
 *
 * Wraps Damn Vulnerable DeFi challenges into a programmatic environment
 * that the verifier harness can use.
 */

// Core services
export {
  Devnet,
  DevnetLive,
  makeDevnet,
  DevnetError,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type LogEntry,
} from "./Devnet.js"

export {
  Foundry,
  FoundryLive,
  FoundryError,
  type ForgeTestResult,
  type ForgeScriptResult,
  type ForgeBuildResult,
  type ContractArtifact,
} from "./Foundry.js"

// Challenge types and registry
export {
  type ChallengeDefinition,
  type ChallengeContext,
  type InvariantDef,
  type InvariantResult,
  type Severity,
} from "./Challenge.js"

export {
  ChallengeRegistry,
  getChallenge,
  listChallenges,
  SideEntrance,
  Truster,
  Unstoppable,
} from "./challenges/index.js"

// Invariant checker
export {
  InvariantChecker,
  InvariantCheckerLive,
  InvariantCheckError,
  type InvariantSnapshot,
  type InvariantCheckReport,
} from "./InvariantChecker.js"

// Verification pipeline
export {
  VerificationPipeline,
  VerificationPipelineLive,
  VerificationPipelineForgeOnly,
  VerificationError,
  type VerificationResult,
  type Verdict,
} from "./VerificationPipeline.js"
