/**
 * @module Invariant
 *
 * Core types and helper constructors for on-chain invariants.
 *
 * Key design constraint: an Invariant's R channel is EvmClient (ProviderService)
 * only -- it can read chain state but cannot send transactions or manipulate
 * the devnet. This is enforced at the type level by Effect's requirement channel.
 */

import * as Effect from "effect/Effect"
import { ProviderService } from "voltaire-effect"
import {
  getBalance,
  call,
  getStorageAt,
  getLogs,
} from "./EvmClient.js"
import { InvariantError } from "./errors.js"
import { encodeCall, decodeUint256 } from "./abi.js"

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface InvariantResult {
  /** Unique identifier for this invariant (e.g. "se:pool-balance") */
  readonly name: string
  /** Whether the invariant holds */
  readonly holds: boolean
  /** The measured on-chain value */
  readonly actual?: unknown
  /** What was expected */
  readonly expected?: unknown
  /** Human-readable explanation (especially useful when broken) */
  readonly message?: string
}

// ---------------------------------------------------------------------------
// Core Invariant type
// ---------------------------------------------------------------------------

/**
 * An Invariant is an Effect that reads chain state and returns a result.
 * The R channel is ProviderService (aliased as EvmClient) -- read-only access.
 * An invariant literally cannot send transactions or call cheatcodes.
 */
export type Invariant = Effect.Effect<InvariantResult, InvariantError, ProviderService>

// ---------------------------------------------------------------------------
// Invariant suite
// ---------------------------------------------------------------------------

export interface InvariantSuite {
  readonly name: string
  readonly invariants: ReadonlyArray<Invariant>
}

// ---------------------------------------------------------------------------
// Helper: run all invariants in a suite
// ---------------------------------------------------------------------------

export const runSuite = (
  suite: InvariantSuite,
): Effect.Effect<ReadonlyArray<InvariantResult>, InvariantError, ProviderService> =>
  Effect.forEach(suite.invariants, (inv) => inv, { concurrency: "unbounded" })

// ---------------------------------------------------------------------------
// Helper constructors
// ---------------------------------------------------------------------------

/**
 * Invariant that checks an ETH balance against a predicate.
 */
export const balanceInvariant = (
  name: string,
  address: string,
  predicate: (balance: bigint) => boolean,
  description?: string,
): Invariant =>
  Effect.gen(function* () {
    const balance = yield* getBalance(address as `0x${string}`).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: name,
            reason: `Failed to get balance for ${address}: ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const holds = predicate(balance)
    return {
      name,
      holds,
      actual: balance,
      expected: description ?? "predicate",
      message: holds ? undefined : `Balance invariant broken: ${balance} wei at ${address}`,
    } satisfies InvariantResult
  })

/**
 * Invariant that checks an ERC20 token balance via eth_call.
 * Uses the standard balanceOf(address) selector: 0x70a08231
 */
export const tokenBalanceInvariant = (
  name: string,
  tokenAddress: string,
  account: string,
  predicate: (balance: bigint) => boolean,
  description?: string,
): Invariant =>
  Effect.gen(function* () {
    const data = encodeCall("0x70a08231", [account])
    const resultHex = yield* call({
      to: tokenAddress as `0x${string}`,
      data,
    }).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: name,
            reason: `Failed to read balanceOf(${account}) on ${tokenAddress}: ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const balance = decodeUint256(resultHex)
    const holds = predicate(balance)
    return {
      name,
      holds,
      actual: balance,
      expected: description ?? "predicate",
      message: holds
        ? undefined
        : `Token balance invariant broken: ${balance} for ${account} on ${tokenAddress}`,
    } satisfies InvariantResult
  })

/**
 * Invariant that checks a raw storage slot against a predicate.
 */
export const storageInvariant = (
  name: string,
  address: string,
  slot: string,
  predicate: (value: bigint) => boolean,
  description?: string,
): Invariant =>
  Effect.gen(function* () {
    const hex = yield* getStorageAt(
      address as `0x${string}`,
      slot as `0x${string}`,
    ).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: name,
            reason: `Failed to read storage at ${address}[${slot}]: ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const value = BigInt(hex)
    const holds = predicate(value)
    return {
      name,
      holds,
      actual: value,
      expected: description ?? "predicate",
      message: holds
        ? undefined
        : `Storage invariant broken: slot ${slot} at ${address} = ${value}`,
    } satisfies InvariantResult
  })

/**
 * Invariant that checks that no ERC20 Approval events were emitted
 * from a specific owner address within a block range.
 *
 * Approval event topic0: 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925
 */
export const noApprovalInvariant = (
  name: string,
  tokenAddress: string,
  ownerAddress: string,
  fromBlock: `0x${string}` | "earliest",
): Invariant =>
  Effect.gen(function* () {
    const paddedOwner = `0x${ownerAddress.slice(2).padStart(64, "0")}` as `0x${string}`
    const logs = yield* getLogs({
      address: tokenAddress as `0x${string}`,
      topics: [
        "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as `0x${string}`,
        paddedOwner,
      ],
      fromBlock,
      toBlock: "latest",
    }).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: name,
            reason: `Failed to query Approval logs: ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const holds = logs.length === 0
    return {
      name,
      holds,
      actual: `${logs.length} Approval events from ${ownerAddress}`,
      expected: "0 Approval events",
      message: holds
        ? undefined
        : `${logs.length} unauthorized Approval event(s) emitted by ${ownerAddress} on ${tokenAddress}`,
    } satisfies InvariantResult
  })

/**
 * Invariant that makes a view call and checks the decoded uint256 result
 * against a predicate. Generic helper for any single-return-value view function.
 */
export const viewCallInvariant = (
  name: string,
  contractAddress: string,
  selector: string,
  args: string[],
  predicate: (value: bigint) => boolean,
  description?: string,
): Invariant =>
  Effect.gen(function* () {
    const data = encodeCall(selector, args)
    const resultHex = yield* call({
      to: contractAddress as `0x${string}`,
      data,
    }).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: name,
            reason: `View call failed (${selector}): ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const value = decodeUint256(resultHex)
    const holds = predicate(value)
    return {
      name,
      holds,
      actual: value,
      expected: description ?? "predicate",
      message: holds ? undefined : `View call invariant broken: ${name} = ${value}`,
    } satisfies InvariantResult
  })
