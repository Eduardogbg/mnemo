/**
 * Harness errors — RoomError + re-exports from @mnemo/core.
 */
import { Data } from "effect"
export { ProviderError, AgentError, StateError } from "@mnemo/core"

export class RoomError extends Data.TaggedError("RoomError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
