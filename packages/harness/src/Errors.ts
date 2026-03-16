/**
 * Typed error hierarchy for the Mnemo harness.
 *
 * Every module uses these rather than raw Error or string failures.
 * All extend Data.TaggedError for pattern matching via Effect's catchTag.
 */
import { Data } from "effect"

// ---------------------------------------------------------------------------
// Provider errors — LLM call failures
// ---------------------------------------------------------------------------

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Agent errors — agent execution failures
// ---------------------------------------------------------------------------

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string
  readonly agentId: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Room errors — negotiation room failures
// ---------------------------------------------------------------------------

export class RoomError extends Data.TaggedError("RoomError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// State errors — state management failures
// ---------------------------------------------------------------------------

export class StateError extends Data.TaggedError("StateError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
