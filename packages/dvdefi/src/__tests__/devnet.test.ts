/**
 * Integration test for the Devnet service (anvil management).
 *
 * Requires `anvil` to be installed.
 */
import { describe, test, expect } from "bun:test"
import { Effect, Scope } from "effect"
import { makeDevnet } from "../Devnet.js"

describe("Devnet", () => {
  test(
    "start anvil, get chain id, snapshot/revert, fund account",
    async () => {
      await Effect.scoped(
        Effect.gen(function* () {
          // Start anvil on a random port to avoid conflicts
          const port = 18545 + Math.floor(Math.random() * 1000)
          const devnet = yield* makeDevnet({ port })

          // Verify we can talk to it
          const chainId = yield* devnet.rpc<string>({
            method: "eth_chainId",
          })
          expect(chainId).toBe("0x7a69") // anvil default chain id = 31337

          // Get block number
          const blockNum = yield* devnet.getBlockNumber()
          expect(blockNum).toBe(0n)

          // Fund an account
          const testAddr = "0x1234567890abcdef1234567890abcdef12345678"
          yield* devnet.fundAccount(testAddr, 10n ** 18n) // 1 ETH
          const balance = yield* devnet.getBalance(testAddr)
          expect(balance).toBe(10n ** 18n)

          // Snapshot
          const snapId = yield* devnet.snapshot()
          expect(snapId).toBeTruthy()

          // Fund more
          yield* devnet.fundAccount(testAddr, 2n * 10n ** 18n) // now 2 ETH
          const balance2 = yield* devnet.getBalance(testAddr)
          expect(balance2).toBe(2n * 10n ** 18n)

          // Revert
          const reverted = yield* devnet.revert(snapId)
          expect(reverted).toBe(true)

          // Balance should be back to 1 ETH
          const balance3 = yield* devnet.getBalance(testAddr)
          expect(balance3).toBe(10n ** 18n)

          // Mine a block
          yield* devnet.mine()
          const blockNum2 = yield* devnet.getBlockNumber()
          // Block number should have increased (at least 1 from mine, possibly
          // more from the setBalance calls)
          expect(blockNum2).toBeGreaterThan(0n)
        }),
      ).pipe(Effect.runPromise)
    },
    { timeout: 30_000 },
  )
})
