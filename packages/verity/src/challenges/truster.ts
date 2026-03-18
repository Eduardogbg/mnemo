/**
 * @module challenges/truster
 *
 * Invariants for the TrusterLenderPool challenge (DVDeFi v4).
 *
 * Vulnerability: flashLoan() accepts arbitrary target + data for an external call,
 * allowing the pool to be tricked into approving an attacker to spend its tokens.
 *
 * Contracts: TrusterLenderPool.sol, DamnValuableToken.sol
 * Asset: DamnValuableToken (ERC20)
 * Setup: 1,000,000 DVT in pool
 */

import * as Effect from "effect/Effect"
import type { InvariantSuite, InvariantResult } from "../Invariant.js"
import { tokenBalanceInvariant, noApprovalInvariant } from "../Invariant.js"
import { call, getLogs } from "../EvmClient.js"
import { encodeCall, decodeUint256 } from "../abi.js"
import { InvariantError } from "../errors.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1,000,000 DVT in wei (18 decimals) */
const TOKENS_IN_POOL = 1_000_000_000_000_000_000_000_000n

/** allowance(address,address) selector */
const ALLOWANCE_SELECTOR = "0xdd62ed3e"

/** Approval event topic0 */
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as `0x${string}`

// ---------------------------------------------------------------------------
// Invariant: tr:pool-token-balance
// Pool token balance >= initial amount (1M DVT)
// ---------------------------------------------------------------------------

const poolTokenBalance = (tokenAddress: string, poolAddress: string) =>
  tokenBalanceInvariant(
    "tr:pool-token-balance",
    tokenAddress,
    poolAddress,
    (balance) => balance >= TOKENS_IN_POOL,
    "critical",
    `>= ${TOKENS_IN_POOL} (1,000,000 DVT)`,
  )

// ---------------------------------------------------------------------------
// Invariant: tr:no-unauthorized-allowances
// No Approval events from pool to any external address.
// The pool contract should never call approve().
// ---------------------------------------------------------------------------

const noUnauthorizedAllowances = (
  tokenAddress: string,
  poolAddress: string,
  fromBlock: `0x${string}` | "earliest",
) =>
  noApprovalInvariant(
    "tr:no-unauthorized-allowances",
    tokenAddress,
    poolAddress,
    fromBlock,
    "high",
  )

// ---------------------------------------------------------------------------
// Invariant: tr:pool-allowance-zero
// Check that the pool has not approved a specific suspect address.
// Useful when the attacker address is known.
// ---------------------------------------------------------------------------

const poolAllowanceZero = (
  tokenAddress: string,
  poolAddress: string,
  suspectAddress: string,
): Effect.Effect<InvariantResult, InvariantError, import("voltaire-effect").ProviderService> =>
  Effect.gen(function* () {
    // allowance(address owner, address spender)
    // We need both addresses as args
    const data = encodeCall(ALLOWANCE_SELECTOR, [poolAddress, suspectAddress])
    const resultHex = yield* call({
      to: tokenAddress as `0x${string}`,
      data,
    }).pipe(
      Effect.mapError(
        (e) =>
          new InvariantError({
            invariantId: "tr:pool-allowance-zero",
            reason: `Failed to read allowance(${poolAddress}, ${suspectAddress}): ${String(e)}`,
            cause: e,
          }),
      ),
    )
    const allowance = decodeUint256(resultHex)
    const holds = allowance === 0n
    return {
      name: "tr:pool-allowance-zero",
      holds,
      severity: "critical",
      actual: allowance,
      expected: "0",
      message: holds
        ? undefined
        : `Pool has approved ${suspectAddress} to spend ${allowance} tokens`,
    } satisfies InvariantResult
  })

// ---------------------------------------------------------------------------
// Suite factory
// ---------------------------------------------------------------------------

/**
 * Create the Truster invariant suite.
 *
 * @param tokenAddress - Address of the DamnValuableToken
 * @param poolAddress - Address of the TrusterLenderPool
 * @param fromBlock - Block number after setup (for event scanning). Use "earliest" for full scan.
 */
export const makeTrusterSuite = (
  tokenAddress: string,
  poolAddress: string,
  fromBlock: `0x${string}` | "earliest" = "earliest",
): InvariantSuite => ({
  name: "Truster Lender Pool",
  invariants: [
    // L1: Pool retains all tokens
    poolTokenBalance(tokenAddress, poolAddress),
    // L2: No Approval events from pool
    noUnauthorizedAllowances(tokenAddress, poolAddress, fromBlock),
  ],
})

// Export individual invariants for composability
export { poolTokenBalance, noUnauthorizedAllowances, poolAllowanceZero }
