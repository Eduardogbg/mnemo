/**
 * @module DevnetCheatcodes
 *
 * Typed Effect service wrapping Anvil's test methods (anvil_* / evm_*).
 * Built on top of ProviderService.request() -- does NOT use the voltaire-effect
 * JSON-RPC request builders (which produce request objects, not Effects).
 *
 * This service provides an ergonomic API for devnet manipulation:
 * snapshot/revert, balance/code injection, time control, impersonation.
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ProviderService } from "voltaire-effect"
import { CheatcodeError } from "./errors.js"

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export interface DevnetCheatcodesShape {
  /** EVM snapshot -- returns a snapshot ID for later revert */
  readonly snapshot: () => Effect.Effect<string, CheatcodeError>

  /** Revert to a previous snapshot */
  readonly revert: (snapshotId: string) => Effect.Effect<boolean, CheatcodeError>

  /** Set the ETH balance of an address */
  readonly setBalance: (address: string, wei: bigint) => Effect.Effect<void, CheatcodeError>

  /** Mine one or more blocks, optionally with a fixed interval between them */
  readonly mine: (blocks?: number, interval?: number) => Effect.Effect<void, CheatcodeError>

  /** Set the timestamp for the next mined block */
  readonly setNextBlockTimestamp: (timestamp: number) => Effect.Effect<void, CheatcodeError>

  /** Unlock an account for eth_sendTransaction (no private key needed) */
  readonly impersonateAccount: (address: string) => Effect.Effect<void, CheatcodeError>

  /** Stop impersonating a previously impersonated account */
  readonly stopImpersonating: (address: string) => Effect.Effect<void, CheatcodeError>

  /** Replace the bytecode at an address (hot-patch a contract) */
  readonly setCode: (address: string, bytecode: string) => Effect.Effect<void, CheatcodeError>

  /** Set a storage slot value */
  readonly setStorageAt: (
    address: string,
    slot: string,
    value: string,
  ) => Effect.Effect<void, CheatcodeError>

  /** Advance time by N seconds */
  readonly increaseTime: (seconds: number) => Effect.Effect<void, CheatcodeError>

  /** Full devnet reset (optionally fork from a URL) */
  readonly reset: (options?: {
    forking?: { jsonRpcUrl: string; blockNumber?: number }
  }) => Effect.Effect<void, CheatcodeError>

  /** Dump full devnet state as hex blob */
  readonly dumpState: () => Effect.Effect<string, CheatcodeError>

  /** Load a previously dumped state */
  readonly loadState: (state: string) => Effect.Effect<void, CheatcodeError>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class DevnetCheatcodes extends Context.Tag("DevnetCheatcodes")<
  DevnetCheatcodes,
  DevnetCheatcodesShape
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

/**
 * Build a DevnetCheatcodes layer from an existing ProviderService.
 * The provider must be pointed at an Anvil (or Hardhat) devnet.
 */
export const DevnetCheatcodesLive: Layer.Layer<DevnetCheatcodes, never, ProviderService> =
  Layer.effect(
    DevnetCheatcodes,
    Effect.gen(function* () {
      const provider = yield* ProviderService

      const rpc = <T>(method: string, params: unknown[] = []) =>
        provider.request<T>(method, params).pipe(
          Effect.mapError(
            (e) =>
              new CheatcodeError({
                method,
                reason: `RPC call failed: ${String(e)}`,
                cause: e,
              }),
          ),
        )

      return DevnetCheatcodes.of({
        snapshot: () => rpc<string>("evm_snapshot"),

        revert: (snapshotId) => rpc<boolean>("evm_revert", [snapshotId]),

        setBalance: (address, wei) =>
          rpc<null>("anvil_setBalance", [address, `0x${wei.toString(16)}`]).pipe(
            Effect.asVoid,
          ),

        mine: (blocks = 1, interval?: number) =>
          rpc<null>(
            "anvil_mine",
            interval !== undefined ? [blocks, interval] : [blocks],
          ).pipe(Effect.asVoid),

        setNextBlockTimestamp: (timestamp) =>
          rpc<null>("evm_setNextBlockTimestamp", [timestamp]).pipe(Effect.asVoid),

        impersonateAccount: (address) =>
          rpc<null>("anvil_impersonateAccount", [address]).pipe(Effect.asVoid),

        stopImpersonating: (address) =>
          rpc<null>("anvil_stopImpersonatingAccount", [address]).pipe(Effect.asVoid),

        setCode: (address, bytecode) =>
          rpc<null>("anvil_setCode", [address, bytecode]).pipe(Effect.asVoid),

        setStorageAt: (address, slot, value) =>
          rpc<null>("anvil_setStorageAt", [address, slot, value]).pipe(Effect.asVoid),

        increaseTime: (seconds) =>
          rpc<null>("evm_increaseTime", [seconds]).pipe(Effect.asVoid),

        reset: (options?) =>
          rpc<null>("anvil_reset", options ? [options] : []).pipe(Effect.asVoid),

        dumpState: () => rpc<string>("anvil_dumpState"),

        loadState: (state) =>
          rpc<null>("anvil_loadState", [state]).pipe(Effect.asVoid),
      })
    }),
  )
