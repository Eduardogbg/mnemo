/**
 * State management service — in-memory conversation history.
 *
 * This is a simple starting point that stores messages as an ordered list.
 * It will later evolve into the full DAG state manager from the protocol spec.
 *
 * Uses Effect Ref for safe concurrent access (though the turn loop is serial,
 * this keeps things correct if we ever parallelize).
 */
import { Context, Effect, Layer, Ref } from "effect"
import { StateError } from "./Errors.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Message {
  readonly id: number
  readonly agentId: string
  readonly role: "user" | "assistant" | "system"
  readonly content: string
  readonly timestamp: number
}

export interface StateService {
  /** Append a message to the conversation history. */
  readonly appendMessage: (
    agentId: string,
    role: Message["role"],
    content: string
  ) => Effect.Effect<Message, StateError>

  /** Get all messages in chronological order. */
  readonly getMessages: () => Effect.Effect<ReadonlyArray<Message>, StateError>

  /** Get messages for a specific agent (all messages they can see). */
  readonly getMessagesForAgent: (
    agentId: string
  ) => Effect.Effect<ReadonlyArray<Message>, StateError>

  /** Clear all state. */
  readonly clear: () => Effect.Effect<void, StateError>

  /** Get the current message count. */
  readonly messageCount: () => Effect.Effect<number, StateError>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class State extends Context.Tag("@mnemo/core/State")<
  State,
  StateService
>() {}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

const makeInMemoryState = Effect.gen(function* () {
  const messagesRef = yield* Ref.make<Array<Message>>([])
  let nextId = 0

  const service: StateService = {
    appendMessage: (agentId, role, content) =>
      Ref.modify(messagesRef, (messages) => {
        const msg: Message = {
          id: nextId++,
          agentId,
          role,
          content,
          timestamp: Date.now(),
        }
        return [msg, [...messages, msg]]
      }),

    getMessages: () => Ref.get(messagesRef),

    getMessagesForAgent: (_agentId) =>
      // For now, all agents see all messages.
      // The DAG-based state manager will filter by scope visibility.
      Ref.get(messagesRef),

    clear: () => Ref.set(messagesRef, []),

    messageCount: () => Ref.get(messagesRef).pipe(Effect.map((m) => m.length)),
  }

  return service
})

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

/**
 * In-memory state layer. Each layer instantiation creates a fresh, empty store.
 */
export const InMemoryLayer: Layer.Layer<State> = Layer.effect(State, makeInMemoryState)
