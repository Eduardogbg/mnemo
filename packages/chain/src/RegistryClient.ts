/**
 * RegistryClient — Effect service for MnemoRegistry contract interactions.
 *
 * Dual-target via Effect layers:
 *   - localLayer(): simulates registry operations in-memory for demo/testing
 *   - sepoliaLayer(privateKey, registryAddress): real Base Sepolia transactions
 */
import { Context, Effect, Layer, Data } from "effect"
import {
  Contract,
  HttpProviderFetch,
  HttpTransport,
  LocalAccount,
  Signer,
  CryptoLive,
} from "voltaire-effect"
import { FetchHttpClient } from "@effect/platform"
import { mnemoRegistryAbi } from "./erc8004/abi.js"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class RegistryError extends Data.TaggedError("RegistryError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProtocolData {
  readonly protocolId: bigint
  readonly owner: string
  readonly metadataURI: string
  readonly maxBounty: bigint
  readonly active: boolean
  readonly registeredAt: bigint
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface RegistryService {
  /** Register a new protocol. Returns protocol ID and tx hash. */
  readonly register: (metadataURI: string, maxBounty: bigint) => Effect.Effect<
    { protocolId: bigint; txHash: string },
    RegistryError
  >
  /** Update metadata and bounty for an existing protocol. Returns tx hash. */
  readonly update: (protocolId: bigint, metadataURI: string, maxBounty: bigint) => Effect.Effect<string, RegistryError>
  /** Deactivate a protocol listing. Returns tx hash. */
  readonly deactivate: (protocolId: bigint) => Effect.Effect<string, RegistryError>
  /** Get protocol data by ID. */
  readonly get: (protocolId: bigint) => Effect.Effect<ProtocolData, RegistryError>
  /** Check if a protocol is active. */
  readonly isActive: (protocolId: bigint) => Effect.Effect<boolean, RegistryError>
  /** Contract address. */
  readonly address: string
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Registry extends Context.Tag("@mnemo/chain/Registry")<
  Registry,
  RegistryService
>() {}

// ---------------------------------------------------------------------------
// Local layer (simulated)
// ---------------------------------------------------------------------------

export const localLayer = (): Layer.Layer<Registry> => {
  let nextId = 0n
  const store = new Map<bigint, ProtocolData>()

  const service: RegistryService = {
    address: "0x" + "Re910" + "0".repeat(34),

    register: (metadataURI, maxBounty) =>
      Effect.gen(function* () {
        if (maxBounty === 0n) {
          return yield* Effect.fail(new RegistryError({ message: "maxBounty must be > 0" }))
        }
        const protocolId = nextId++
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        store.set(protocolId, {
          protocolId,
          owner: "0x" + "OWNER0".repeat(7).slice(0, 40),
          metadataURI,
          maxBounty,
          active: true,
          registeredAt: BigInt(Math.floor(Date.now() / 1000)),
        })
        yield* Effect.log(
          `[Registry/local] register(metadataURI=${metadataURI.slice(0, 20)}..., maxBounty=${maxBounty}) → id=${protocolId}`,
        )
        return { protocolId, txHash }
      }),

    update: (protocolId, metadataURI, maxBounty) =>
      Effect.gen(function* () {
        const p = store.get(protocolId)
        if (!p) return yield* Effect.fail(new RegistryError({ message: `Protocol ${protocolId} not found` }))
        if (maxBounty === 0n) {
          return yield* Effect.fail(new RegistryError({ message: "maxBounty must be > 0" }))
        }
        store.set(protocolId, { ...p, metadataURI, maxBounty })
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        yield* Effect.log(`[Registry/local] update(${protocolId}) → ${txHash}`)
        return txHash
      }),

    deactivate: (protocolId) =>
      Effect.gen(function* () {
        const p = store.get(protocolId)
        if (!p) return yield* Effect.fail(new RegistryError({ message: `Protocol ${protocolId} not found` }))
        if (!p.active) return yield* Effect.fail(new RegistryError({ message: `Protocol ${protocolId} already inactive` }))
        store.set(protocolId, { ...p, active: false })
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        yield* Effect.log(`[Registry/local] deactivate(${protocolId}) → ${txHash}`)
        return txHash
      }),

    get: (protocolId) =>
      Effect.gen(function* () {
        const p = store.get(protocolId)
        if (!p) return yield* Effect.fail(new RegistryError({ message: `Protocol ${protocolId} not found` }))
        return p
      }),

    isActive: (protocolId) =>
      Effect.gen(function* () {
        const p = store.get(protocolId)
        if (!p) return false
        return p.active
      }),
  }

  return Layer.succeed(Registry, service)
}

// ---------------------------------------------------------------------------
// Sepolia layer (real Base Sepolia transactions)
// ---------------------------------------------------------------------------

const wrap = (message: string) => (cause: unknown) =>
  new RegistryError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  })

export const sepoliaLayer = (
  privateKey: string,
  registryAddress: string,
): Layer.Layer<Registry> => {
  const rpcUrl = "https://sepolia.base.org"

  const writeStack = Layer.mergeAll(
    Signer.Live,
    LocalAccount(privateKey as any),
    HttpProviderFetch(rpcUrl),
    HttpTransport(rpcUrl),
    CryptoLive,
    FetchHttpClient.layer,
  )

  const readStack = Layer.mergeAll(
    HttpProviderFetch(rpcUrl),
    HttpTransport(rpcUrl),
    FetchHttpClient.layer,
  )

  const service: RegistryService = {
    address: registryAddress,

    register: (metadataURI, maxBounty) =>
      Effect.gen(function* () {
        const contract = yield* Contract(registryAddress as any, mnemoRegistryAbi as any)
        const result = yield* (contract as any).write.register(metadataURI, maxBounty)
        yield* Effect.log(`[Registry/sepolia] register → tx ${result}`)
        return { protocolId: 0n, txHash: String(result) }
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("register")),
      ) as Effect.Effect<{ protocolId: bigint; txHash: string }, RegistryError>,

    update: (protocolId, metadataURI, maxBounty) =>
      Effect.gen(function* () {
        const contract = yield* Contract(registryAddress as any, mnemoRegistryAbi as any)
        const result = yield* (contract as any).write.update(protocolId, metadataURI, maxBounty)
        yield* Effect.log(`[Registry/sepolia] update(${protocolId}) → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("update")),
      ) as Effect.Effect<string, RegistryError>,

    deactivate: (protocolId) =>
      Effect.gen(function* () {
        const contract = yield* Contract(registryAddress as any, mnemoRegistryAbi as any)
        const result = yield* (contract as any).write.deactivate(protocolId)
        yield* Effect.log(`[Registry/sepolia] deactivate(${protocolId}) → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("deactivate")),
      ) as Effect.Effect<string, RegistryError>,

    get: (protocolId) =>
      Effect.gen(function* () {
        const contract = yield* Contract(registryAddress as any, mnemoRegistryAbi as any)
        const result: any = yield* (contract as any).read.getProtocol(protocolId)
        const tuple = result[0] ?? result
        return {
          protocolId,
          owner: String(tuple[0] ?? tuple.owner),
          metadataURI: String(tuple[1] ?? tuple.metadataURI),
          maxBounty: BigInt(String(tuple[2] ?? tuple.maxBounty)),
          active: Boolean(tuple[3] ?? tuple.active),
          registeredAt: BigInt(String(tuple[4] ?? tuple.registeredAt)),
        } satisfies ProtocolData
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("get")),
      ) as Effect.Effect<ProtocolData, RegistryError>,

    isActive: (protocolId) =>
      Effect.gen(function* () {
        const contract = yield* Contract(registryAddress as any, mnemoRegistryAbi as any)
        const result: any = yield* (contract as any).read.isActive(protocolId)
        return Boolean(result[0] ?? result)
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("isActive")),
      ) as Effect.Effect<boolean, RegistryError>,
  }

  return Layer.succeed(Registry, service)
}
