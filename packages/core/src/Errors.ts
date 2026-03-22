/**
 * Typed error hierarchy for Mnemo core agent primitives.
 */
import { Data } from "effect"

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string
  readonly agentId: string
  readonly cause?: unknown
}> {}

export class StateError extends Data.TaggedError("StateError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
