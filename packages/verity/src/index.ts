/**
 * @module @mnemo/verity
 *
 * Verity -- the verification toolkit for Mnemo's bug disclosure system.
 *
 * Provides typed Effect interfaces for writing invariants and PoC scripts
 * against EVM devnets, powered by voltaire-effect.
 *
 * ## Architecture
 *
 * The key insight: Effect's R (requirements) channel enforces scoped access
 * at the type level.
 *
 * - Invariants require only EvmClient (ProviderService) -- read-only access.
 *   An invariant literally cannot send transactions or call cheatcodes.
 *
 * - PoC scripts require EvmClient + DevnetCheatcodes -- full devnet access.
 *
 * - The verification pipeline composes both: it reads chain state to check
 *   invariants, runs the exploit, then checks again.
 *
 * ## Usage
 *
 * ```typescript
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import {
 *   EvmClient, HttpProviderFetch,
 *   DevnetCheatcodes, DevnetCheatcodesLive,
 *   makeSideEntranceSuite, runSuite, verify,
 * } from "@mnemo/verity"
 *
 * const rpcUrl = "http://127.0.0.1:8545"
 *
 * // Read-only: check invariants (only needs EvmClient)
 * const suite = makeSideEntranceSuite(poolAddr, deployerAddr)
 * const checkResult = runSuite(suite).pipe(
 *   Effect.provide(HttpProviderFetch(rpcUrl))
 * )
 *
 * // Full access: run verification pipeline
 * const provider = HttpProviderFetch(rpcUrl)
 * const cheatcodes = DevnetCheatcodesLive.pipe(Layer.provide(provider))
 * const fullLayer = Layer.merge(provider, cheatcodes)
 *
 * const result = verify(challenge, exploit).pipe(
 *   Effect.provide(fullLayer)
 * )
 * ```
 */

// -- EvmClient (read-only chain access) --
export {
  EvmClient,
  type EvmClientShape,
  HttpProviderFetch,
  getBalance,
  getStorageAt,
  getCode,
  getBlockNumber,
  call,
  getLogs,
  getBlock,
  getTransactionReceipt,
  waitForTransactionReceipt,
} from "./EvmClient.js"

export type {
  CallRequest,
  LogFilter,
  LogType,
  BlockTag,
  AddressInput,
  HashInput,
  ReceiptType,
  RpcTransactionRequest,
  TransportError,
  ProviderResponseError,
  CallError,
} from "./EvmClient.js"

// -- DevnetCheatcodes --
export {
  DevnetCheatcodes,
  type DevnetCheatcodesShape,
  DevnetCheatcodesLive,
} from "./DevnetCheatcodes.js"

// -- Invariant types and helpers --
export {
  type InvariantResult,
  type Invariant,
  type InvariantSuite,
  runSuite,
  maxSeverity,
  balanceInvariant,
  tokenBalanceInvariant,
  storageInvariant,
  noApprovalInvariant,
  viewCallInvariant,
} from "./Invariant.js"

// -- PoC script types --
export { type PoCResult, type PoCScript } from "./PoCScript.js"

// -- Challenge definition --
export {
  type ChallengeDefinition,
  type SetupResult,
  type Verdict,
  type Severity,
  SEVERITIES,
  type VerificationResult,
} from "./Challenge.js"

// -- Verification pipeline --
export { verify } from "./verify.js"

// -- Error types --
export {
  InvariantError,
  PoCError,
  SetupError,
  CheatcodeError,
} from "./errors.js"

// -- ABI encoding helpers --
export {
  encodeCall,
  encodeCallWithUint256,
  decodeUint256,
  decodeBool,
  padAddress,
  padUint256,
} from "./abi.js"

// -- Concrete challenge invariant suites --
export {
  makeSideEntranceSuite,
  makeTrusterSuite,
  makeUnstoppableSuite,
  // Individual invariants for composition
  poolTokenBalance,
  noUnauthorizedAllowances,
  poolAllowanceZero,
  sharesAssetsConsistency,
  vaultNotPaused,
  flashLoanCallable,
  vaultOwnershipStable,
} from "./challenges/index.js"
