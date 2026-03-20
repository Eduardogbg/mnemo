/**
 * ERC-8004 Effect layers — dual-target (local Anvil + Base Sepolia).
 *
 * Both provide the same Erc8004 service tag. The demo script picks via config.
 *
 * Local:   Simulated registries for demo/testing
 * Sepolia: Connects to canonical contracts on Base Sepolia with real signing
 */
import { Effect, Layer } from "effect"
import {
  Contract,
  HttpProviderFetch,
  HttpTransport,
  LocalAccount,
  Signer,
  CryptoLive,
} from "voltaire-effect"
import { FetchHttpClient } from "@effect/platform"
import {
  identityRegistryAbi,
  reputationRegistryAbi,
  IDENTITY_REGISTRY_ADDRESS,
  REPUTATION_REGISTRY_ADDRESS,
} from "./abi.js"
import { Erc8004, Erc8004Error, type Erc8004Service, type FeedbackEntry } from "./Erc8004.js"

// ---------------------------------------------------------------------------
// Helper: wrap voltaire errors
// ---------------------------------------------------------------------------

const wrap = (message: string) => (cause: unknown) =>
  new Erc8004Error({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  })

// ---------------------------------------------------------------------------
// Local layer (simulated)
// ---------------------------------------------------------------------------

/**
 * Create a local ERC-8004 layer backed by simulated registries.
 * For the hackathon demo — simulates the interface without real contracts.
 */
export const localLayer = (_anvilUrl: string): Layer.Layer<Erc8004> => {
  const service: Erc8004Service = {
    identityAddress: IDENTITY_REGISTRY_ADDRESS,
    reputationAddress: REPUTATION_REGISTRY_ADDRESS,

    registerAgent: (agentURI) =>
      Effect.gen(function* () {
        const hash = simpleHash(agentURI)
        yield* Effect.log(`[ERC-8004/local] Registered agent "${agentURI}" → ID ${hash}`)
        return BigInt(hash)
      }),

    setAgentMetadata: (agentId, key, _value) =>
      Effect.gen(function* () {
        const txHash = `0x${agentId.toString(16).padStart(64, "0")}`
        yield* Effect.log(`[ERC-8004/local] setMetadata(${agentId}, "${key}") → ${txHash}`)
        return txHash
      }),

    getAgentMetadata: (agentId, key) =>
      Effect.gen(function* () {
        yield* Effect.log(`[ERC-8004/local] getMetadata(${agentId}, "${key}")`)
        return "0x"
      }),

    getAgentURI: (agentId) =>
      Effect.succeed(`local://agent/${agentId}`),

    giveFeedback: (params) =>
      Effect.gen(function* () {
        const txHash = `0x${Date.now().toString(16).padStart(64, "0")}`
        yield* Effect.log(
          `[ERC-8004/local] giveFeedback(agent=${params.agentId}, value=${params.value}, ` +
          `tags=["${params.tag1}", "${params.tag2}"]) → ${txHash}`,
        )
        return txHash
      }),

    getFeedbackCount: (_agentId) =>
      Effect.succeed(0n),

    getFeedback: (_agentId, _index) =>
      Effect.fail(new Erc8004Error({ message: "No feedback in local mode" })),
  }

  return Layer.succeed(Erc8004, service)
}

// ---------------------------------------------------------------------------
// Sepolia layer (canonical registries on Base Sepolia)
// ---------------------------------------------------------------------------

/**
 * Create a Base Sepolia ERC-8004 layer using voltaire-effect's Contract().
 * Requires a private key for signing transactions.
 */
export const sepoliaLayer = (privateKey: string): Layer.Layer<Erc8004> => {
  const rpcUrl = "https://sepolia.base.org"

  // Common layer stack for write operations
  const writeStack = Layer.mergeAll(
    Signer.Live,
    LocalAccount(privateKey as any),
    HttpProviderFetch(rpcUrl),
    HttpTransport(rpcUrl),
    CryptoLive,
    FetchHttpClient.layer,
  )

  // Common layer stack for read operations
  const readStack = Layer.mergeAll(
    HttpProviderFetch(rpcUrl),
    HttpTransport(rpcUrl),
    FetchHttpClient.layer,
  )

  const service: Erc8004Service = {
    identityAddress: IDENTITY_REGISTRY_ADDRESS,
    reputationAddress: REPUTATION_REGISTRY_ADDRESS,

    registerAgent: (agentURI) =>
      Effect.gen(function* () {
        const identity = yield* Contract(IDENTITY_REGISTRY_ADDRESS as any, identityRegistryAbi as any)
        const result = yield* (identity as any).write.register(agentURI)
        yield* Effect.log(`[ERC-8004/sepolia] register("${agentURI}") → tx ${result}`)
        return BigInt(String(result).slice(0, 18))
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("registerAgent")),
      ) as Effect.Effect<bigint, Erc8004Error>,

    setAgentMetadata: (agentId, key, value) =>
      Effect.gen(function* () {
        const identity = yield* Contract(IDENTITY_REGISTRY_ADDRESS as any, identityRegistryAbi as any)
        const result = yield* (identity as any).write.setMetadata(agentId, key, value)
        yield* Effect.log(`[ERC-8004/sepolia] setMetadata(${agentId}, "${key}") → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("setAgentMetadata")),
      ) as Effect.Effect<string, Erc8004Error>,

    getAgentMetadata: (agentId, key) =>
      Effect.gen(function* () {
        const identity = yield* Contract(IDENTITY_REGISTRY_ADDRESS as any, identityRegistryAbi as any)
        const result = yield* (identity as any).read.getMetadata(agentId, key)
        return String(result)
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("getAgentMetadata")),
      ) as Effect.Effect<string, Erc8004Error>,

    getAgentURI: (agentId) =>
      Effect.gen(function* () {
        const identity = yield* Contract(IDENTITY_REGISTRY_ADDRESS as any, identityRegistryAbi as any)
        const result = yield* (identity as any).read.agentURI(agentId)
        return String(result)
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("getAgentURI")),
      ) as Effect.Effect<string, Erc8004Error>,

    giveFeedback: (params) =>
      Effect.gen(function* () {
        const reputation = yield* Contract(REPUTATION_REGISTRY_ADDRESS as any, reputationRegistryAbi as any)
        const result = yield* (reputation as any).write.giveFeedback(
          params.agentId,
          params.value,
          0n,
          params.tag1,
          params.tag2,
          "",
          params.feedbackURI ?? "",
          params.feedbackHash,
        )
        yield* Effect.log(`[ERC-8004/sepolia] giveFeedback(agent=${params.agentId}) → tx ${result}`)
        return String(result)
      }).pipe(
        Effect.provide(writeStack),
        Effect.mapError(wrap("giveFeedback")),
      ) as Effect.Effect<string, Erc8004Error>,

    getFeedbackCount: (agentId) =>
      Effect.gen(function* () {
        const reputation = yield* Contract(REPUTATION_REGISTRY_ADDRESS as any, reputationRegistryAbi as any)
        const result = yield* (reputation as any).read.getFeedbackCount(agentId)
        return BigInt(String(result))
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("getFeedbackCount")),
      ) as Effect.Effect<bigint, Erc8004Error>,

    getFeedback: (agentId, index) =>
      Effect.gen(function* () {
        const reputation = yield* Contract(REPUTATION_REGISTRY_ADDRESS as any, reputationRegistryAbi as any)
        const result: any = yield* (reputation as any).read.getFeedback(agentId, index)
        return {
          client: String(result[0]),
          value: BigInt(String(result[1])),
          valueDecimals: Number(result[2]),
          tag1: String(result[3]),
          tag2: String(result[4]),
          endpoint: String(result[5]),
          feedbackURI: String(result[6]),
          feedbackHash: String(result[7]),
          timestamp: BigInt(String(result[8])),
        } satisfies FeedbackEntry
      }).pipe(
        Effect.provide(readStack),
        Effect.mapError(wrap("getFeedback")),
      ) as Effect.Effect<FeedbackEntry, Erc8004Error>,
  }

  return Layer.succeed(Erc8004, service)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simpleHash(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}
