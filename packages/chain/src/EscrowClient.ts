/**
 * EscrowClient — Effect service for MnemoEscrow contract interactions.
 *
 * Dual-target via Effect layers:
 *   - local(anvilUrl): simulates escrow operations for demo
 *   - sepolia(privateKey, escrowAddress): real Base Sepolia transactions
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
import { mnemoEscrowAbi } from "./erc8004/abi.js"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class EscrowError extends Data.TaggedError("EscrowError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscrowStatus = "Created" | "Funded" | "Released" | "Refunded" | "Expired"

const STATUS_MAP: Record<number, EscrowStatus> = {
  0: "Created",
  1: "Funded",
  2: "Released",
  3: "Refunded",
  4: "Expired",
}

export interface EscrowData {
  readonly escrowId: bigint
  readonly tee: string
  readonly funder: string
  readonly payee: string
  readonly amount: bigint
  readonly deadline: bigint
  readonly commitHash: string
  readonly status: EscrowStatus
}

export interface CreateEscrowParams {
  readonly funder: string
  readonly payee: string
  readonly amount: bigint
  readonly deadline: bigint
  readonly commitHash: string  // bytes32 hex
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface EscrowService {
  /** Create a new escrow. Returns escrow ID and tx hash. */
  readonly create: (params: CreateEscrowParams) => Effect.Effect<
    { escrowId: bigint; txHash: string },
    EscrowError
  >
  /** Fund an existing escrow. Returns tx hash. */
  readonly fund: (escrowId: bigint, amount: bigint) => Effect.Effect<string, EscrowError>
  /** Release escrow to payee (TEE only). Returns tx hash. */
  readonly release: (escrowId: bigint) => Effect.Effect<string, EscrowError>
  /** Refund escrow to funder (TEE only). Returns tx hash. */
  readonly refund: (escrowId: bigint) => Effect.Effect<string, EscrowError>
  /** Get escrow data by ID. */
  readonly get: (escrowId: bigint) => Effect.Effect<EscrowData, EscrowError>
  /** Contract address. */
  readonly address: string
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Escrow extends Context.Tag("@mnemo/chain/Escrow")<
  Escrow,
  EscrowService
>() {}

// ---------------------------------------------------------------------------
// Local layer (simulated)
// ---------------------------------------------------------------------------

export const localLayer = (_anvilUrl: string): Layer.Layer<Escrow> => {
  let nextId = 0n
  const store = new Map<bigint, EscrowData>()

  const service: EscrowService = {
    address: "0x" + "E5c70" + "0".repeat(34),

    create: (params) =>
      Effect.gen(function* () {
        const escrowId = nextId++
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        store.set(escrowId, {
          escrowId,
          tee: "0x" + "TEE0".repeat(10),
          funder: params.funder,
          payee: params.payee,
          amount: params.amount,
          deadline: params.deadline,
          commitHash: params.commitHash,
          status: "Created",
        })
        yield* Effect.log(
          `[Escrow/local] create(funder=${params.funder.slice(0, 10)}..., amount=${params.amount}) → id=${escrowId}`,
        )
        return { escrowId, txHash }
      }),

    fund: (escrowId, _amount) =>
      Effect.gen(function* () {
        const e = store.get(escrowId)
        if (!e) return yield* Effect.fail(new EscrowError({ message: `Escrow ${escrowId} not found` }))
        store.set(escrowId, { ...e, status: "Funded" })
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        yield* Effect.log(`[Escrow/local] fund(${escrowId}) → ${txHash}`)
        return txHash
      }),

    release: (escrowId) =>
      Effect.gen(function* () {
        const e = store.get(escrowId)
        if (!e) return yield* Effect.fail(new EscrowError({ message: `Escrow ${escrowId} not found` }))
        store.set(escrowId, { ...e, status: "Released" })
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        yield* Effect.log(`[Escrow/local] release(${escrowId}) → ${txHash}`)
        return txHash
      }),

    refund: (escrowId) =>
      Effect.gen(function* () {
        const e = store.get(escrowId)
        if (!e) return yield* Effect.fail(new EscrowError({ message: `Escrow ${escrowId} not found` }))
        store.set(escrowId, { ...e, status: "Refunded" })
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        yield* Effect.log(`[Escrow/local] refund(${escrowId}) → ${txHash}`)
        return txHash
      }),

    get: (escrowId) =>
      Effect.gen(function* () {
        const e = store.get(escrowId)
        if (!e) return yield* Effect.fail(new EscrowError({ message: `Escrow ${escrowId} not found` }))
        return e
      }),
  }

  return Layer.succeed(Escrow, service)
}

// ---------------------------------------------------------------------------
// Sepolia layer (real Base Sepolia transactions)
// ---------------------------------------------------------------------------

const wrap = (message: string) => (cause: unknown) =>
  new EscrowError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  })

export const sepoliaLayer = (
  privateKey: string,
  escrowAddress: string,
): Layer.Layer<Escrow> => {
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

  const service: EscrowService = {
    address: escrowAddress,

    create: (params) =>
      Effect.gen(function* () {
        const contract = yield* Contract(escrowAddress as any, mnemoEscrowAbi as any)
        const result = yield* (contract as any).write.create(
          params.funder,
          params.payee,
          params.amount,
          params.deadline,
          params.commitHash,
        )
        yield* Effect.log(`[Escrow/sepolia] create → tx ${result}`)
        return { escrowId: 0n, txHash: String(result) }
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("create")),
      ) as Effect.Effect<{ escrowId: bigint; txHash: string }, EscrowError>,

    fund: (escrowId, _amount) =>
      Effect.gen(function* () {
        const contract = yield* Contract(escrowAddress as any, mnemoEscrowAbi as any)
        const result = yield* (contract as any).write.fund(escrowId)
        yield* Effect.log(`[Escrow/sepolia] fund(${escrowId}) → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("fund")),
      ) as Effect.Effect<string, EscrowError>,

    release: (escrowId) =>
      Effect.gen(function* () {
        const contract = yield* Contract(escrowAddress as any, mnemoEscrowAbi as any)
        const result = yield* (contract as any).write.release(escrowId)
        yield* Effect.log(`[Escrow/sepolia] release(${escrowId}) → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("release")),
      ) as Effect.Effect<string, EscrowError>,

    refund: (escrowId) =>
      Effect.gen(function* () {
        const contract = yield* Contract(escrowAddress as any, mnemoEscrowAbi as any)
        const result = yield* (contract as any).write.refund(escrowId)
        yield* Effect.log(`[Escrow/sepolia] refund(${escrowId}) → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("refund")),
      ) as Effect.Effect<string, EscrowError>,

    get: (escrowId) =>
      Effect.gen(function* () {
        const contract = yield* Contract(escrowAddress as any, mnemoEscrowAbi as any)
        const result: any = yield* (contract as any).read.getEscrow(escrowId)
        const tuple = result[0] ?? result
        return {
          escrowId,
          tee: String(tuple[0] ?? tuple.tee),
          funder: String(tuple[1] ?? tuple.funder),
          payee: String(tuple[2] ?? tuple.payee),
          amount: BigInt(String(tuple[3] ?? tuple.amount)),
          deadline: BigInt(String(tuple[4] ?? tuple.deadline)),
          commitHash: String(tuple[5] ?? tuple.commitHash),
          status: STATUS_MAP[Number(tuple[6] ?? tuple.status)] ?? "Created",
        } satisfies EscrowData
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("get")),
      ) as Effect.Effect<EscrowData, EscrowError>,
  }

  return Layer.succeed(Escrow, service)
}
