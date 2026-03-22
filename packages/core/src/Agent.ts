/**
 * Agent abstraction — wraps an LLM persona with a system prompt and role.
 *
 * An Agent does not hold a reference to a specific provider. Instead, it
 * declares a dependency on LanguageModel.LanguageModel via Effect's context.
 * The actual model is injected at the layer level, making agents
 * trivially testable with mocks.
 */
import { Context, Effect, Layer } from "effect"
import * as LanguageModel from "@effect/ai/LanguageModel"
import { State, type Message } from "./State.js"
import { AgentError } from "./Errors.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "researcher" | "protocol" | "generic"

export interface AgentConfig {
  readonly id: string
  readonly role: AgentRole
  readonly systemPrompt: string
  /**
   * Optional toolkit (from @effect/ai Toolkit.make()). Stored as `any` because
   * the concrete tool types vary per agent. Room provides the handler layers.
   */
  readonly toolkit?: any
}

export interface AgentRunResult {
  readonly agentId: string
  readonly response: string
  readonly toolCalls: ReadonlyArray<{
    readonly name: string
    readonly params: Record<string, unknown>
  }>
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
    LanguageModel.LanguageModel | State
  >

  /**
   * Run with explicit message history (does not read from State).
   * Useful for room orchestration where the room controls context.
   *
   * When toolkit is set, the caller MUST provide the handler layer in the
   * Effect environment (Room does this via Effect.provide).
   */
  readonly runWithHistory: (
    history: ReadonlyArray<Message>,
    userMessage: string
  ) => Effect.Effect<AgentRunResult, AgentError, LanguageModel.LanguageModel>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Agent extends Context.Tag("@mnemo/core/Agent")<
  Agent,
  AgentService
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Call LanguageModel.generateText with optional toolkit.
 * Uses `disableToolCallResolution: true` so Room can inspect tool calls.
 * The `as any` casts are necessary because the toolkit's concrete type
 * (and thus its handler requirements) varies per agent, but we guarantee
 * the handler layer is provided by the caller.
 */
const callLM = (
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  toolkit: any | undefined,
): Effect.Effect<
  LanguageModel.GenerateTextResponse<any>,
  unknown,
  LanguageModel.LanguageModel
> => {
  const options: any = {
    prompt: [
      { role: "system" as const, content: systemPrompt },
      ...messages,
    ],
    disableToolCallResolution: true,
  }
  if (toolkit) {
    options.toolkit = toolkit
  }
  return (LanguageModel.generateText(options) as any).pipe(Effect.scoped)
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create an AgentService from config. The returned service still needs
 * LanguageModel and State in its environment — they are injected at the call site.
 */
export const makeAgent = (config: AgentConfig): AgentService => ({
  config,

  run: (userMessage) =>
    Effect.gen(function* () {
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
      const response = yield* callLM(
        config.systemPrompt,
        messages,
        config.toolkit,
      ).pipe(
        Effect.mapError(
          (e) => new AgentError({
            message: e instanceof Error ? e.message : String(e),
            agentId: config.id,
            cause: e,
          })
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
        .appendMessage(config.id, "assistant", response.text)
        .pipe(
          Effect.mapError(
            (e) => new AgentError({ message: e.message, agentId: config.id, cause: e })
          )
        )

      return {
        agentId: config.id,
        response: response.text,
        toolCalls: response.toolCalls.map((tc) => ({
          name: tc.name,
          params: tc.params as Record<string, unknown>,
        })),
      } satisfies AgentRunResult
    }),

  runWithHistory: (history, userMessage) =>
    Effect.gen(function* () {
      const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
        (m) => ({
          role: m.agentId === config.id ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })
      )
      messages.push({ role: "user", content: userMessage })

      const response = yield* callLM(
        config.systemPrompt,
        messages,
        config.toolkit,
      ).pipe(
        Effect.mapError(
          (e) => new AgentError({
            message: e instanceof Error ? e.message : String(e),
            agentId: config.id,
            cause: e,
          })
        )
      )

      return {
        agentId: config.id,
        response: response.text,
        toolCalls: response.toolCalls.map((tc) => ({
          name: tc.name,
          params: tc.params as Record<string, unknown>,
        })),
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
