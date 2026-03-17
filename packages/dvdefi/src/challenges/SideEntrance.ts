/**
 * Side Entrance challenge definition.
 *
 * Vulnerability: flash loan callback can call deposit(), satisfying the
 * balance check while creating withdrawable credit. Attacker then withdraws
 * to drain the pool.
 */
import { Effect } from "effect"
import type { ChallengeDefinition, InvariantDef } from "../Challenge.js"
import type { Devnet, DevnetError } from "../Devnet.js"
import type { ChallengeContext } from "../Challenge.js"
import type { InvariantResult } from "../Challenge.js"

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * se:pool-balance — Pool ETH balance >= initial deposit (1000 ETH).
 * The simplest and most critical invariant: did the pool get drained?
 */
const poolBalance: InvariantDef = {
  id: "se:pool-balance",
  description: "Pool ETH balance >= initial deposit (1000 ETH)",
  severity: "critical",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const poolAddress = ctx.addresses["pool"]!
      const expected = ctx.amounts["poolBalance"]!
      const balance = yield* devnet.getBalance(poolAddress)
      return {
        invariantId: "se:pool-balance",
        holds: balance >= expected,
        actual: `${balance.toString()} wei`,
        expected: `>= ${expected.toString()} wei`,
        evidence:
          balance < expected
            ? `Pool drained: lost ${(expected - balance).toString()} wei (${Number(expected - balance) / 1e18} ETH)`
            : undefined,
      }
    }),
}

/**
 * se:balance-accounting — Sum of known depositor balances == pool ETH balance.
 * Uses the public `balances(address)` getter (selector 0x27e235e3).
 */
const balanceAccounting: InvariantDef = {
  id: "se:balance-accounting",
  description: "Sum of depositor balances == pool ETH balance",
  severity: "critical",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const poolAddress = ctx.addresses["pool"]!
      const deployer = ctx.addresses["deployer"]!

      // Get actual ETH balance
      const actualBalance = yield* devnet.getBalance(poolAddress)

      // Get deployer's credited balance via balances(address) getter
      const deployerCreditHex = yield* devnet.ethCall(
        poolAddress,
        `0x27e235e3${deployer.slice(2).toLowerCase().padStart(64, "0")}`,
      )
      const deployerCredit = BigInt(deployerCreditHex)

      // If there is an attacker address, check that too
      let totalCredit = deployerCredit
      const attacker = ctx.addresses["attacker"]
      if (attacker) {
        const attackerCreditHex = yield* devnet.ethCall(
          poolAddress,
          `0x27e235e3${attacker.slice(2).toLowerCase().padStart(64, "0")}`,
        )
        totalCredit += BigInt(attackerCreditHex)
      }

      const holds = totalCredit === actualBalance
      return {
        invariantId: "se:balance-accounting",
        holds,
        actual: `credits=${totalCredit.toString()}, balance=${actualBalance.toString()}`,
        expected: "credits == balance",
        evidence: !holds
          ? `Accounting desync: credited=${totalCredit}, actual=${actualBalance}, delta=${actualBalance - totalCredit}`
          : undefined,
      }
    }),
}

// ---------------------------------------------------------------------------
// Challenge definition
// ---------------------------------------------------------------------------

export const SideEntrance: ChallengeDefinition = {
  id: "side-entrance",
  name: "Side Entrance",
  description:
    "Flash loan pool where deposit() can be called during the callback, " +
    "allowing the attacker to satisfy the balance check while creating " +
    "withdrawable credit. Pool is drained via withdraw().",
  difficulty: "trivial",

  contracts: {
    vulnerable: ["src/side-entrance/SideEntranceLenderPool.sol"],
    patched: ["src/side-entrance/SideEntranceLenderPoolPatched.sol"],
  },

  tests: {
    exploit: "test/side-entrance/SideEntrance.t.sol",
    exploitFunction: "test_sideEntrance",
    patched: "test/side-entrance/SideEntrancePatched.t.sol",
    patchedFunction: "test_sideEntrancePatched",
  },

  invariants: [poolBalance, balanceAccounting],
}
