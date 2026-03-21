/**
 * Integration test for EscrowClient against local Anvil.
 *
 * Requires forge + anvil to be installed.
 * Uses @mnemo/dvdefi DevnetLive for Anvil lifecycle.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mockLayer, Escrow } from "../EscrowClient.js"

describe("EscrowClient (local)", () => {
  test("create -> fund -> release lifecycle", async () => {
    const program = Effect.gen(function* () {
      const escrow = yield* Escrow

      // Create
      const { escrowId, txHash } = yield* escrow.create({
        funder: "0x" + "F000".repeat(10),
        payee: "0x" + "A000".repeat(10),
        amount: 1000000000000000n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
        commitHash: "0x" + "ab".repeat(32),
      })
      expect(txHash).toMatch(/^0x/)
      expect(escrowId).toBe(0n)

      // Verify Created status
      const created = yield* escrow.get(escrowId)
      expect(created.status).toBe("Created")

      // Fund
      const fundTx = yield* escrow.fund(escrowId, 1000000000000000n)
      expect(fundTx).toMatch(/^0x/)

      const funded = yield* escrow.get(escrowId)
      expect(funded.status).toBe("Funded")

      // Release
      const releaseTx = yield* escrow.release(escrowId)
      expect(releaseTx).toMatch(/^0x/)

      const released = yield* escrow.get(escrowId)
      expect(released.status).toBe("Released")

      return { escrowId, txHash }
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(mockLayer()))
    )
  })

  test("refund lifecycle", async () => {
    const program = Effect.gen(function* () {
      const escrow = yield* Escrow

      const { escrowId } = yield* escrow.create({
        funder: "0x" + "F000".repeat(10),
        payee: "0x" + "A000".repeat(10),
        amount: 500000000000000n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
        commitHash: "0x" + "cd".repeat(32),
      })

      yield* escrow.fund(escrowId, 500000000000000n)
      yield* escrow.refund(escrowId)

      const refunded = yield* escrow.get(escrowId)
      expect(refunded.status).toBe("Refunded")
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(mockLayer()))
    )
  })

  test("get non-existent escrow fails", async () => {
    const program = Effect.gen(function* () {
      const escrow = yield* Escrow
      yield* escrow.get(999n)
    })

    await expect(
      Effect.runPromise(
        program.pipe(Effect.provide(mockLayer()))
      )
    ).rejects.toThrow()
  })
})
