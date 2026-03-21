/**
 * Tests for RegistryClient local layer.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { mockLayer, Registry } from "../RegistryClient.js"

const layer = mockLayer()

describe("RegistryClient (local)", () => {
  test("register a protocol and verify the data", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* Registry

      const { protocolId, txHash } = yield* registry.register(
        "ipfs://QmTestMetadata123",
        1000000000000000000n,
      )
      expect(txHash).toMatch(/^0x/)
      expect(protocolId).toBe(0n)

      const data = yield* registry.get(protocolId)
      expect(data.protocolId).toBe(0n)
      expect(data.metadataURI).toBe("ipfs://QmTestMetadata123")
      expect(data.maxBounty).toBe(1000000000000000000n)
      expect(data.active).toBe(true)
      expect(data.registeredAt).toBeGreaterThan(0n)
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  })

  test("update metadata and bounty", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* Registry

      const { protocolId } = yield* registry.register(
        "ipfs://QmOriginal",
        500000000000000000n,
      )

      const updateTx = yield* registry.update(
        protocolId,
        "ipfs://QmUpdated",
        2000000000000000000n,
      )
      expect(updateTx).toMatch(/^0x/)

      const data = yield* registry.get(protocolId)
      expect(data.metadataURI).toBe("ipfs://QmUpdated")
      expect(data.maxBounty).toBe(2000000000000000000n)
      expect(data.active).toBe(true)
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  })

  test("deactivate a protocol", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* Registry

      const { protocolId } = yield* registry.register(
        "ipfs://QmDeactivateMe",
        100000000000000000n,
      )

      const deactivateTx = yield* registry.deactivate(protocolId)
      expect(deactivateTx).toMatch(/^0x/)

      const data = yield* registry.get(protocolId)
      expect(data.active).toBe(false)
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  })

  test("isActive returns correct values", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* Registry

      const { protocolId } = yield* registry.register(
        "ipfs://QmActiveCheck",
        300000000000000000n,
      )

      const activeBefore = yield* registry.isActive(protocolId)
      expect(activeBefore).toBe(true)

      yield* registry.deactivate(protocolId)

      const activeAfter = yield* registry.isActive(protocolId)
      expect(activeAfter).toBe(false)

      // Non-existent protocol returns false
      const nonExistent = yield* registry.isActive(9999n)
      expect(nonExistent).toBe(false)
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  })

  test("get returns correct data after operations", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* Registry

      // Register
      const { protocolId } = yield* registry.register(
        "ipfs://QmLifecycle",
        750000000000000000n,
      )

      // Verify initial state
      const initial = yield* registry.get(protocolId)
      expect(initial.metadataURI).toBe("ipfs://QmLifecycle")
      expect(initial.maxBounty).toBe(750000000000000000n)
      expect(initial.active).toBe(true)

      // Update
      yield* registry.update(protocolId, "ipfs://QmLifecycleV2", 1500000000000000000n)
      const updated = yield* registry.get(protocolId)
      expect(updated.metadataURI).toBe("ipfs://QmLifecycleV2")
      expect(updated.maxBounty).toBe(1500000000000000000n)
      expect(updated.active).toBe(true)

      // Deactivate
      yield* registry.deactivate(protocolId)
      const deactivated = yield* registry.get(protocolId)
      expect(deactivated.metadataURI).toBe("ipfs://QmLifecycleV2")
      expect(deactivated.active).toBe(false)
    })

    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  })

  test("get non-existent protocol fails", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* Registry
      yield* registry.get(999n)
    })

    await expect(
      Effect.runPromise(program.pipe(Effect.provide(layer)))
    ).rejects.toThrow()
  })
})
