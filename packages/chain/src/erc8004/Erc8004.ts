/**
 * ERC-8004 Identity + Reputation — Effect service for on-chain agent identity.
 *
 * Uses voltaire-effect's Contract() factory for type-safe interactions with
 * the canonical ERC-8004 registries on Base Sepolia.
 */
import { Context, Effect, Data } from "effect"
import {
  Contract,
  type ContractCallError,
  type ContractWriteError,
} from "voltaire-effect"
import {
  identityRegistryAbi,
  reputationRegistryAbi,
  IDENTITY_REGISTRY_ADDRESS,
  REPUTATION_REGISTRY_ADDRESS,
} from "./abi.js"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class Erc8004Error extends Data.TaggedError("Erc8004Error")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackParams {
  readonly agentId: bigint
  readonly value: bigint  // int128 — positive for good, negative for bad
  readonly tag1: string
  readonly tag2: string
  readonly feedbackURI?: string
  readonly feedbackHash: string  // bytes32 hex
}

export interface FeedbackEntry {
  readonly client: string
  readonly value: bigint
  readonly valueDecimals: number
  readonly tag1: string
  readonly tag2: string
  readonly endpoint: string
  readonly feedbackURI: string
  readonly feedbackHash: string
  readonly timestamp: bigint
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Erc8004Service {
  /** Register a new agent identity. Returns the agent ID. */
  readonly registerAgent: (agentURI: string) => Effect.Effect<bigint, Erc8004Error>
  /** Set metadata on an agent identity. */
  readonly setAgentMetadata: (
    agentId: bigint,
    key: string,
    value: Uint8Array,
  ) => Effect.Effect<string, Erc8004Error>
  /** Get metadata for an agent identity. */
  readonly getAgentMetadata: (
    agentId: bigint,
    key: string,
  ) => Effect.Effect<string, Erc8004Error>
  /** Get the agent URI for a given agent ID. */
  readonly getAgentURI: (agentId: bigint) => Effect.Effect<string, Erc8004Error>
  /** Give feedback via the Reputation Registry. Returns tx hash. */
  readonly giveFeedback: (params: FeedbackParams) => Effect.Effect<string, Erc8004Error>
  /** Read feedback count for an agent. */
  readonly getFeedbackCount: (agentId: bigint) => Effect.Effect<bigint, Erc8004Error>
  /** Read a specific feedback entry. */
  readonly getFeedback: (
    agentId: bigint,
    index: bigint,
  ) => Effect.Effect<FeedbackEntry, Erc8004Error>
  /** Identity registry address. */
  readonly identityAddress: string
  /** Reputation registry address. */
  readonly reputationAddress: string
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Erc8004 extends Context.Tag("@mnemo/chain/Erc8004")<
  Erc8004,
  Erc8004Service
>() {}
