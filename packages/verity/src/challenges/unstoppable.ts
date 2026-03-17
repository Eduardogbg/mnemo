/**
 * @module challenges/unstoppable
 *
 * Invariants for the UnstoppableVault challenge (DVDeFi v4).
 *
 * Vulnerability: Direct token transfer (bypassing deposit()) breaks the
 * convertToShares(totalSupply) == totalAssets() check in flashLoan(),
 * permanently bricking all flash loans (DoS).
 *
 * Contracts: UnstoppableVault.sol (ERC4626), UnstoppableMonitor.sol, DamnValuableToken.sol
 * Asset: DamnValuableToken via ERC4626 vault
 * Setup: 1,000,000 DVT deposited, monitor owns the vault
 */

import * as Effect from "effect/Effect"
import type { InvariantSuite, InvariantResult } from "../Invariant.js"
import { call } from "../EvmClient.js"
import { encodeCallWithUint256, decodeUint256, decodeBool } from "../abi.js"
import { InvariantError } from "../errors.js"

// ---------------------------------------------------------------------------
// Function selectors
// ---------------------------------------------------------------------------

/** totalAssets() -> uint256 */
const TOTAL_ASSETS_SELECTOR = "0x01e1d114"

/** totalSupply() -> uint256 */
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd"

/** convertToShares(uint256 assets) -> uint256 */
const CONVERT_TO_SHARES_SELECTOR = "0xc6e6f592"

/** paused() -> bool */
const PAUSED_SELECTOR = "0x5c975abb"

/** owner() -> address */
const OWNER_SELECTOR = "0x8da5cb5b"

// ---------------------------------------------------------------------------
// Helper: map call errors
// ---------------------------------------------------------------------------

const mapCallErr = (id: string, detail: string) => (e: unknown) =>
  new InvariantError({
    invariantId: id,
    reason: `${detail}: ${String(e)}`,
    cause: e,
  })

// ---------------------------------------------------------------------------
// Invariant: us:shares-assets-consistency
// convertToShares(totalSupply) == totalAssets()
//
// This is the core invariant. If it breaks, flashLoan() reverts forever.
// ---------------------------------------------------------------------------

const sharesAssetsConsistency = (
  vaultAddress: string,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    // 1. totalAssets()
    const totalAssetsHex = yield* call({
      to: vaultAddress as `0x${string}`,
      data: TOTAL_ASSETS_SELECTOR as `0x${string}`,
    }).pipe(Effect.mapError(mapCallErr("us:shares-assets-consistency", "totalAssets() failed")))
    const totalAssets = decodeUint256(totalAssetsHex)

    // 2. totalSupply()
    const totalSupplyHex = yield* call({
      to: vaultAddress as `0x${string}`,
      data: TOTAL_SUPPLY_SELECTOR as `0x${string}`,
    }).pipe(Effect.mapError(mapCallErr("us:shares-assets-consistency", "totalSupply() failed")))
    const totalSupply = decodeUint256(totalSupplyHex)

    // 3. convertToShares(totalSupply)
    const convertData = encodeCallWithUint256(CONVERT_TO_SHARES_SELECTOR, totalSupply)
    const convertedSharesHex = yield* call({
      to: vaultAddress as `0x${string}`,
      data: convertData,
    }).pipe(
      Effect.mapError(mapCallErr("us:shares-assets-consistency", "convertToShares() failed")),
    )
    const convertedShares = decodeUint256(convertedSharesHex)

    const holds = convertedShares === totalAssets
    return {
      name: "us:shares-assets-consistency",
      holds,
      actual: { totalAssets, totalSupply, convertedShares },
      expected: `convertToShares(${totalSupply}) == totalAssets()`,
      message: holds
        ? undefined
        : `Accounting desync: convertToShares(${totalSupply}) = ${convertedShares}, but totalAssets() = ${totalAssets} (delta: ${totalAssets - convertedShares})`,
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Invariant: us:vault-not-paused
// vault.paused() == false
// ---------------------------------------------------------------------------

const vaultNotPaused = (
  vaultAddress: string,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    const pausedHex = yield* call({
      to: vaultAddress as `0x${string}`,
      data: PAUSED_SELECTOR as `0x${string}`,
    }).pipe(Effect.mapError(mapCallErr("us:vault-not-paused", "paused() failed")))
    const isPaused = decodeBool(pausedHex)
    const holds = !isPaused
    return {
      name: "us:vault-not-paused",
      holds,
      actual: isPaused,
      expected: false,
      message: holds ? undefined : "Vault is paused -- flash loans are disabled",
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Invariant: us:flash-loan-callable
// Composite check: shares/assets consistent AND vault not paused.
// If either fails, flashLoan() will revert.
// ---------------------------------------------------------------------------

const flashLoanCallable = (
  vaultAddress: string,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    const consistency = yield* sharesAssetsConsistency(vaultAddress)
    const paused = yield* vaultNotPaused(vaultAddress)

    const holds = consistency.holds && paused.holds
    const reasons: string[] = []
    if (!consistency.holds) reasons.push("accounting desync")
    if (!paused.holds) reasons.push("vault paused")

    return {
      name: "us:flash-loan-callable",
      holds,
      actual: { consistencyHolds: consistency.holds, notPaused: paused.holds },
      expected: "consistent=true, paused=false",
      message: holds
        ? undefined
        : `Flash loan bricked: ${reasons.join(" + ")}`,
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Invariant: us:vault-ownership-stable
// vault.owner() has not changed from expected (monitor contract)
// ---------------------------------------------------------------------------

const vaultOwnershipStable = (
  vaultAddress: string,
  expectedOwner: string,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    const ownerHex = yield* call({
      to: vaultAddress as `0x${string}`,
      data: OWNER_SELECTOR as `0x${string}`,
    }).pipe(Effect.mapError(mapCallErr("us:vault-ownership-stable", "owner() failed")))

    // Extract the address from the 32-byte return value (last 20 bytes)
    const rawOwner = ownerHex.length >= 42
      ? `0x${ownerHex.slice(-40).toLowerCase()}`
      : ownerHex.toLowerCase()
    const expected = expectedOwner.toLowerCase()
    const holds = rawOwner === expected

    return {
      name: "us:vault-ownership-stable",
      holds,
      actual: rawOwner,
      expected: expectedOwner,
      message: holds
        ? undefined
        : `Vault ownership changed from ${expectedOwner} to ${rawOwner}`,
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Suite factory
// ---------------------------------------------------------------------------

/**
 * Create the Unstoppable vault invariant suite.
 *
 * @param vaultAddress - Address of the UnstoppableVault
 * @param monitorAddress - Address of the UnstoppableMonitor (expected vault owner)
 */
export const makeUnstoppableSuite = (
  vaultAddress: string,
  monitorAddress: string,
): InvariantSuite => ({
  name: "Unstoppable Vault",
  invariants: [
    // L1: Flash loan liveness (composite)
    flashLoanCallable(vaultAddress),
    // L2: Shares/assets consistency (the core invariant)
    sharesAssetsConsistency(vaultAddress),
    // L3: Vault not paused
    vaultNotPaused(vaultAddress),
    // L3: Vault ownership stable
    vaultOwnershipStable(vaultAddress, monitorAddress),
  ],
})

// Export individual invariants for composability
export {
  sharesAssetsConsistency,
  vaultNotPaused,
  flashLoanCallable,
  vaultOwnershipStable,
}
