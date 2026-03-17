/**
 * Truster challenge definition.
 *
 * Vulnerability: flashLoan() accepts arbitrary target + data for functionCall(),
 * allowing the pool to be tricked into approving an attacker to spend its tokens.
 */
import { Effect } from "effect"
import type { ChallengeDefinition, InvariantDef } from "../Challenge.js"
import type { Devnet, DevnetError } from "../Devnet.js"
import type { ChallengeContext } from "../Challenge.js"
import type { InvariantResult } from "../Challenge.js"

// ---------------------------------------------------------------------------
// ABI encoding helpers
// ---------------------------------------------------------------------------

/** Pad an address to 32 bytes (left-padded with zeros). */
const padAddress = (addr: string): string =>
  addr.slice(2).toLowerCase().padStart(64, "0")

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * tr:pool-token-balance — Pool token balance >= initial amount (1M DVT).
 * Uses balanceOf(address) selector 0x70a08231.
 */
const poolTokenBalance: InvariantDef = {
  id: "tr:pool-token-balance",
  description: "Pool token balance >= initial amount (1M DVT)",
  severity: "critical",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const tokenAddress = ctx.addresses["token"]!
      const poolAddress = ctx.addresses["pool"]!
      const expected = ctx.amounts["poolBalance"]!

      const balanceHex = yield* devnet.ethCall(
        tokenAddress,
        `0x70a08231${padAddress(poolAddress)}`,
      )
      const balance = BigInt(balanceHex)

      return {
        invariantId: "tr:pool-token-balance",
        holds: balance >= expected,
        actual: `${balance.toString()} (${Number(balance / 10n ** 18n)} DVT)`,
        expected: `>= ${expected.toString()} (${Number(expected / 10n ** 18n)} DVT)`,
        evidence:
          balance < expected
            ? `Pool token balance decreased by ${(expected - balance).toString()} (${Number((expected - balance) / 10n ** 18n)} DVT)`
            : undefined,
      }
    }),
}

/**
 * tr:no-unauthorized-allowances — No Approval events from pool as owner.
 * Checks eth_getLogs for Approval(owner=pool, spender=*, value=*).
 * Topic0 for Approval(address,address,uint256) = 0x8c5be1e5...
 */
const noUnauthorizedAllowances: InvariantDef = {
  id: "tr:no-unauthorized-allowances",
  description: "No Approval events emitted with owner == pool",
  severity: "critical",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const tokenAddress = ctx.addresses["token"]!
      const poolAddress = ctx.addresses["pool"]!
      const fromBlock = `0x${ctx.setupBlock.toString(16)}`

      const logs = yield* devnet.getLogs({
        address: tokenAddress,
        topics: [
          // Approval(address indexed owner, address indexed spender, uint256 value)
          "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
          `0x${padAddress(poolAddress)}`,
        ],
        fromBlock,
        toBlock: "latest",
      })

      return {
        invariantId: "tr:no-unauthorized-allowances",
        holds: logs.length === 0,
        actual: `${logs.length} Approval events from pool`,
        expected: "0 Approval events from pool",
        evidence:
          logs.length > 0
            ? `Pool approved ${logs.length} address(es) to spend its tokens. ` +
              `First approval in tx ${logs[0]!.transactionHash}`
            : undefined,
      }
    }),
}

// ---------------------------------------------------------------------------
// Challenge definition
// ---------------------------------------------------------------------------

export const Truster: ChallengeDefinition = {
  id: "truster",
  name: "Truster",
  description:
    "Flash loan pool with arbitrary functionCall(). Attacker can make the pool " +
    "call token.approve(attacker, amount), then drain via transferFrom().",
  difficulty: "low",

  contracts: {
    vulnerable: [
      "src/truster/TrusterLenderPool.sol",
      "src/DamnValuableToken.sol",
    ],
    patched: [
      "src/truster/TrusterLenderPoolPatched.sol",
      "src/DamnValuableToken.sol",
    ],
  },

  tests: {
    exploit: "test/truster/Truster.t.sol",
    exploitFunction: "test_truster",
    patched: "test/truster/TrusterPatched.t.sol",
    patchedFunction: "test_trusterPatched",
  },

  invariants: [poolTokenBalance, noUnauthorizedAllowances],
}
