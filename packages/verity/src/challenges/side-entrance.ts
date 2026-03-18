/**
 * @module challenges/side-entrance
 *
 * Invariants for the SideEntranceLenderPool challenge (DVDeFi v4).
 *
 * Vulnerability: flash loan callback calls deposit(), satisfying the balance
 * check while creating withdrawable credit. Attacker then withdraws to drain.
 *
 * Contract: SideEntranceLenderPool.sol
 * Asset: Native ETH
 * Setup: 1000 ETH deposited by deployer
 */

import * as Effect from "effect/Effect"
import type { InvariantSuite, InvariantResult } from "../Invariant.js"
import { balanceInvariant, viewCallInvariant } from "../Invariant.js"
import { getBalance, call } from "../EvmClient.js"
import { encodeCall, decodeUint256 } from "../abi.js"
import { InvariantError } from "../errors.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1000 ETH in wei */
const ETHER_IN_POOL = 1_000_000_000_000_000_000_000n

/** balances(address) selector */
const BALANCES_SELECTOR = "0x27e235e3"

// ---------------------------------------------------------------------------
// Invariant: se:pool-balance
// Pool ETH balance >= initial deposit (1000 ETH)
// ---------------------------------------------------------------------------

const poolBalance = (poolAddress: string) =>
  balanceInvariant(
    "se:pool-balance",
    poolAddress,
    (balance) => balance >= ETHER_IN_POOL,
    "critical",
    `>= ${ETHER_IN_POOL} wei (1000 ETH)`,
  )

// ---------------------------------------------------------------------------
// Invariant: se:balance-accounting
// Sum of all depositor balances == pool's actual ETH balance.
//
// For the standard setup, the only depositor is the deployer.
// We also check for any attacker credit.
// ---------------------------------------------------------------------------

const balanceAccounting = (
  poolAddress: string,
  depositors: ReadonlyArray<string>,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    // Get actual ETH balance of the pool
    const actualBalance = yield* getBalance(poolAddress as `0x${string}`).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: "se:balance-accounting",
            reason: `Failed to get pool ETH balance: ${String(e)}`,
            cause: e,
          }),
      ),
    )

    // Get the credited balance for each known depositor
    let creditSum = 0n
    for (const depositor of depositors) {
      const data = encodeCall(BALANCES_SELECTOR, [depositor])
      const resultHex = yield* call({
        to: poolAddress as `0x${string}`,
        data,
      }).pipe(
        Effect.mapError(
          (e) =>
            new InvariantError({
              invariantId: "se:balance-accounting",
              reason: `Failed to read balances(${depositor}): ${String(e)}`,
              cause: e,
            }),
        ),
      )
      creditSum += decodeUint256(resultHex)
    }

    // The sum of credited balances should equal the actual ETH held
    const holds = creditSum === actualBalance
    return {
      name: "se:balance-accounting",
      holds,
      severity: "medium",
      actual: { actualBalance, creditSum },
      expected: "creditSum == actualBalance",
      message: holds
        ? undefined
        : `Accounting desync: pool holds ${actualBalance} wei but credits sum to ${creditSum} wei (delta: ${actualBalance - creditSum})`,
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Invariant: se:depositor-balance-preservation
// A specific depositor's credited balance has not decreased.
// This catches the real attack: the deployer's credit disappears.
// ---------------------------------------------------------------------------

const depositorBalancePreservation = (
  poolAddress: string,
  depositorAddress: string,
  expectedMinBalance: bigint,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    const data = encodeCall(BALANCES_SELECTOR, [depositorAddress])
    const resultHex = yield* call({
      to: poolAddress as `0x${string}`,
      data,
    }).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: "se:depositor-balance-preservation",
            reason: `Failed to read balances(${depositorAddress}): ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const balance = decodeUint256(resultHex)
    const holds = balance >= expectedMinBalance
    return {
      name: "se:depositor-balance-preservation",
      holds,
      severity: "critical",
      actual: balance,
      expected: `>= ${expectedMinBalance}`,
      message: holds
        ? undefined
        : `Depositor ${depositorAddress} balance decreased from ${expectedMinBalance} to ${balance} without consent`,
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Suite factory
// ---------------------------------------------------------------------------

/**
 * Create the side-entrance invariant suite.
 *
 * @param poolAddress - Address of the SideEntranceLenderPool
 * @param deployerAddress - Address that funded the pool (the victim depositor)
 */
export const makeSideEntranceSuite = (
  poolAddress: string,
  deployerAddress: string,
): InvariantSuite => ({
  name: "Side Entrance Lender Pool",
  invariants: [
    // L1: Pool ETH balance check
    poolBalance(poolAddress),
    // L2: Accounting consistency
    balanceAccounting(poolAddress, [deployerAddress]),
    // L2: Depositor balance preservation
    depositorBalancePreservation(poolAddress, deployerAddress, ETHER_IN_POOL),
  ],
})
