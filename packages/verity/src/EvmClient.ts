/**
 * @module EvmClient
 *
 * Thin convenience layer over voltaire-effect's ProviderService.
 * Re-exports the free functions that constitute read-only chain access,
 * plus the ProviderService tag and HttpProviderFetch factory for layer construction.
 *
 * The EvmClient type alias makes the R channel semantics explicit:
 * an Effect requiring EvmClient can ONLY read chain state.
 */

import type * as Effect from "effect/Effect"

// Re-export the service tag -- this IS our EvmClient
export {
  ProviderService as EvmClient,
  type ProviderShape as EvmClientShape,
} from "voltaire-effect"

// Re-export the zero-config HTTP provider factory
export { HttpProviderFetch } from "voltaire-effect"

// Re-export read-only free functions
export {
  getBalance,
  getStorageAt,
  getCode,
  getBlockNumber,
  call,
  getLogs,
  getBlock,
  getTransactionReceipt,
  waitForTransactionReceipt,
} from "voltaire-effect"

// Re-export types used by consumers
export type {
  CallRequest,
  LogFilter,
  LogType,
  BlockTag,
  AddressInput,
  HashInput,
  ReceiptType,
  RpcTransactionRequest,
} from "voltaire-effect"

// Re-export error types
export type {
  TransportError,
  ProviderResponseError,
  CallError,
} from "voltaire-effect"
