/**
 * Integration test for InvariantChecker against a running Anvil devnet.
 *
 * This test:
 *  1. Starts anvil
 *  2. Runs the Side Entrance setup (forge test --fork-url) to deploy contracts
 *  3. Checks invariants hold before exploit
 *  4. Runs the exploit
 *  5. Checks invariants are broken after exploit
 *
 * Requires `anvil` and `forge` to be installed.
 *
 * NOTE: The DVDeFi tests use `vm.` cheatcodes (startPrank, deal, etc.) which
 * only work in forge's internal EVM, not against an external fork. So we cannot
 * directly use forge test --fork-url for these tests.
 *
 * Instead, we demonstrate the invariant checker by manually deploying contracts
 * using cast/forge script, or by validating the invariant logic against
 * known post-exploit state.
 *
 * For the MVP, we verify that:
 *  - The invariant definitions type-check and run correctly
 *  - Given a pool address with known state, invariants produce correct results
 */
import { describe, test, expect } from "bun:test"
import { Effect, Scope } from "effect"
import { makeDevnet } from "../Devnet.js"
import { SideEntrance } from "../challenges/SideEntrance.js"
import { Truster } from "../challenges/Truster.js"
import { Unstoppable } from "../challenges/Unstoppable.js"
import type { ChallengeContext } from "../Challenge.js"

describe("InvariantChecker", () => {
  test(
    "Side Entrance invariants detect drain via devnet state",
    async () => {
      await Effect.scoped(
        Effect.gen(function* () {
          const port = 19545 + Math.floor(Math.random() * 1000)
          const devnet = yield* makeDevnet({ port })

          // Fund a fake "pool" address with 1000 ETH to simulate pre-exploit state
          const poolAddr = "0x1111111111111111111111111111111111111111"
          const deployerAddr = "0x2222222222222222222222222222222222222222"
          const oneThousandEth = 1000n * 10n ** 18n

          yield* devnet.fundAccount(poolAddr, oneThousandEth)

          // The pool-balance invariant checks eth_getBalance
          const ctx: ChallengeContext = {
            addresses: {
              pool: poolAddr,
              deployer: deployerAddr,
            },
            amounts: {
              poolBalance: oneThousandEth,
            },
            setupBlock: 0n,
          }

          // Check pool-balance invariant — should hold
          const poolBalanceInv = SideEntrance.invariants[0]!
          const preResult = yield* poolBalanceInv.check(devnet, ctx)
          expect(preResult.holds).toBe(true)
          expect(preResult.invariantId).toBe("se:pool-balance")

          // Simulate drain: set pool balance to 0
          yield* devnet.fundAccount(poolAddr, 0n)

          const postResult = yield* poolBalanceInv.check(devnet, ctx)
          expect(postResult.holds).toBe(false)
          expect(postResult.evidence).toContain("Pool drained")
        }),
      ).pipe(Effect.runPromise)
    },
    { timeout: 30_000 },
  )

  test(
    "Challenge registry has all 3 challenges with correct invariant counts",
    () => {
      expect(SideEntrance.invariants.length).toBe(2)
      expect(Truster.invariants.length).toBe(2)
      expect(Unstoppable.invariants.length).toBe(3)

      expect(SideEntrance.id).toBe("side-entrance")
      expect(Truster.id).toBe("truster")
      expect(Unstoppable.id).toBe("unstoppable")
    },
  )
})
