/**
 * Agent abstraction — wraps an LLM persona with a system prompt and role.
 *
 * An Agent does not hold a reference to a specific provider. Instead, it
 * declares a dependency on the Provider service via Effect's context.
 * The actual provider is injected at the layer level, making agents
 * trivially testable with mocks.
 */
import { Context, Effect, Layer } from "effect"
import { Provider } from "./Provider.js"
import { State, type Message } from "./State.js"
import { AgentError } from "./Errors.js"
import type { ToolDefinition, ToolCall } from "./tools.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "researcher" | "protocol" | "generic"

export interface AgentConfig {
  readonly id: string
  readonly role: AgentRole
  readonly systemPrompt: string
  readonly tools?: ReadonlyArray<ToolDefinition>
}

export interface AgentRunResult {
  readonly agentId: string
  readonly response: string
  readonly toolCalls: ReadonlyArray<ToolCall>
}

export interface AgentService {
  /** The agent's configuration. */
  readonly config: AgentConfig

  /**
   * Run a single turn: send a message to the LLM (with conversation history
   * as context) and return the response.
   *
   * The response is also persisted to the State service.
   */
  readonly run: (userMessage: string) => Effect.Effect<
    AgentRunResult,
    AgentError,
    Provider | State
  >

  /**
   * Run with explicit message history (does not read from State).
   * Useful for room orchestration where the room controls context.
   */
  readonly runWithHistory: (
    history: ReadonlyArray<Message>,
    userMessage: string
  ) => Effect.Effect<AgentRunResult, AgentError, Provider>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Agent extends Context.Tag("@mnemo/core/Agent")<
  Agent,
  AgentService
>() {}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create an AgentService from config. The returned service still needs
 * Provider and State in its environment — they are injected at the call site.
 */
export const makeAgent = (config: AgentConfig): AgentService => ({
  config,

  run: (userMessage) =>
    Effect.gen(function* () {
      const provider = yield* Provider
      const state = yield* State

      // Get conversation history
      const history = yield* state.getMessagesForAgent(config.id).pipe(
        Effect.mapError(
          (e) => new AgentError({ message: e.message, agentId: config.id, cause: e })
        )
      )

      // Build messages for the LLM
      const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
        (m) => ({
          role: m.agentId === config.id ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })
      )
      messages.push({ role: "user", content: userMessage })

      // Call the LLM
      const result = yield* provider
        .generateText({
          system: config.systemPrompt,
          messages,
          tools: config.tools,
        })
        .pipe(
          Effect.mapError(
            (e) => new AgentError({ message: e.message, agentId: config.id, cause: e })
          )
        )

      // Persist the user message and assistant response
      yield* state
        .appendMessage(config.id, "user", userMessage)
        .pipe(
          Effect.mapError(
            (e) => new AgentError({ message: e.message, agentId: config.id, cause: e })
          )
        )
      yield* state
        .appendMessage(config.id, "assistant", result.text)
        .pipe(
          Effect.mapError(
            (e) => new AgentError({ message: e.message, agentId: config.id, cause: e })
          )
        )

      return {
        agentId: config.id,
        response: result.text,
        toolCalls: result.toolCalls,
      } satisfies AgentRunResult
    }),

  runWithHistory: (history, userMessage) =>
    Effect.gen(function* () {
      const provider = yield* Provider

      const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
        (m) => ({
          role: m.agentId === config.id ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })
      )
      messages.push({ role: "user", content: userMessage })

      const result = yield* provider
        .generateText({
          system: config.systemPrompt,
          messages,
          tools: config.tools,
        })
        .pipe(
          Effect.mapError(
            (e) => new AgentError({ message: e.message, agentId: config.id, cause: e })
          )
        )

      return {
        agentId: config.id,
        response: result.text,
        toolCalls: result.toolCalls,
      } satisfies AgentRunResult
    }),
})

// ---------------------------------------------------------------------------
// Convenience layer — if you want a single Agent in context
// ---------------------------------------------------------------------------

/**
 * Create a layer that provides a single Agent service from config.
 */
export const layer = (config: AgentConfig): Layer.Layer<Agent> =>
  Layer.succeed(Agent, makeAgent(config))
