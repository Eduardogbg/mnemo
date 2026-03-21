/**
 * LLM Provider layer — swappable inference backend.
 *
 * Defines a `Provider` Effect service that wraps an OpenAI-compatible chat
 * completions API (/chat/completions). Uses direct fetch for maximum
 * compatibility with OpenRouter, Redpill, and other OpenAI-compatible
 * providers.
 *
 * Note: @effect/ai-openai v0.37+ uses OpenAI's Responses API (/responses)
 * which is NOT supported by OpenRouter or other third-party providers.
 * We use direct fetch to /chat/completions instead.
 */
import { Context, Effect, Layer, Redacted } from "effect"
import { ProviderError } from "./Errors.js"
import type { ToolDefinition, ToolCall, GenerateTextResult } from "./tools.js"

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  readonly apiKey: Redacted.Redacted<string>
  readonly baseURL: string
  readonly model: string
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface ProviderService {
  /**
   * Send a chat-completions request and get back text + optional tool calls.
   */
  readonly generateText: (options: {
    readonly system?: string
    readonly messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>
    readonly tools?: ReadonlyArray<ToolDefinition>
  }) => Effect.Effect<GenerateTextResult, ProviderError>

  /** The underlying config, useful for introspection / logging. */
  readonly config: ProviderConfig
}

export class Provider extends Context.Tag("@mnemo/core/Provider")<
  Provider,
  ProviderService
>() {}

// ---------------------------------------------------------------------------
// Chat Completions implementation
// ---------------------------------------------------------------------------

/**
 * Build a ProviderService using direct fetch to /chat/completions.
 *
 * Uses the standard OpenAI Chat Completions API which is supported by
 * all OpenAI-compatible providers (OpenRouter, Redpill, etc.).
 */
const makeChatCompletionsProvider = (config: ProviderConfig): ProviderService => ({
  config,
  generateText: ({ system, messages, tools }) =>
    chatCompletions(config, system, messages, tools),
})

// ---------------------------------------------------------------------------
// Direct fetch to /chat/completions
// ---------------------------------------------------------------------------

/**
 * Make a direct OpenAI-compatible chat completions API call.
 * Supports optional tool/function definitions.
 */
const chatCompletions = (
  config: ProviderConfig,
  system: string | undefined,
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
  tools?: ReadonlyArray<ToolDefinition>,
): Effect.Effect<GenerateTextResult, ProviderError> =>
  Effect.tryPromise({
    try: async () => {
      const apiMessages: Array<{ role: string; content: string }> = []
      if (system) {
        apiMessages.push({ role: "system", content: system })
      }
      for (const m of messages) {
        apiMessages.push({ role: m.role, content: m.content })
      }

      const body: Record<string, unknown> = {
        model: config.model,
        messages: apiMessages,
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 1024,
      }

      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
        body.tool_choice = "auto"
      }

      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Redacted.value(config.apiKey)}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000), // 5 minute timeout for long responses
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API error ${response.status}: ${errorText.slice(0, 500)}`)
      }

      const json = (await response.json()) as {
        choices: Array<{
          finish_reason?: string
          message: {
            content?: string | null
            tool_calls?: Array<{
              function?: { name: string; arguments: string }
            }>
          }
        }>
      }

      const choice = json.choices[0]
      if (!choice) throw new Error("No choices in response")

      if (choice.finish_reason === "length") {
        console.warn("[Provider] Response truncated (finish_reason: length) — tool calls may be incomplete")
      }

      const text = choice.message.content ?? ""
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
        .filter((tc) => {
          if (!tc.function) {
            console.warn("[Provider] Skipping tool call with missing function field")
            return false
          }
          return true
        })
        .map((tc) => {
          const fn = tc.function!
          let args: Record<string, unknown>
          try {
            args = JSON.parse(fn.arguments) as Record<string, unknown>
          } catch {
            throw new Error(
              `Malformed tool call arguments for "${fn.name}": ${fn.arguments}`
            )
          }
          return { name: fn.name, args }
        })

      return { text, toolCalls } satisfies GenerateTextResult
    },
    catch: (error) =>
      new ProviderError({
        message: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      }),
  })

// ---------------------------------------------------------------------------
// Layer constructors
// ---------------------------------------------------------------------------

/**
 * Create an OpenRouter provider layer from explicit config.
 */
export const layerFromConfig = (config: ProviderConfig): Layer.Layer<Provider> =>
  Layer.succeed(Provider, makeChatCompletionsProvider(config))

/**
 * Create an OpenRouter provider layer reading OPENROUTER_API_KEY from env.
 * Uses a cheap model by default (deepseek/deepseek-chat).
 */
export const OpenRouterLayer: Layer.Layer<Provider, ProviderError> = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const apiKey = typeof process !== "undefined" ? process.env.OPENROUTER_API_KEY : undefined
    if (!apiKey) {
      return yield* Effect.fail(
        new ProviderError({ message: "OPENROUTER_API_KEY not set in environment" })
      )
    }
    return makeChatCompletionsProvider({
      apiKey: Redacted.make(apiKey),
      baseURL: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-chat",
      temperature: 0.7,
      maxTokens: 1024,
    })
  })
).pipe(Layer.catchAll((e) => Layer.fail(e)))

/**
 * Create a mock provider layer for testing — returns a fixed response.
 * The respond function returns a GenerateTextResult (text + toolCalls).
 */
export const mockLayer = (
  respond: (messages: ReadonlyArray<{ role: string; content: string }>) => GenerateTextResult
): Layer.Layer<Provider> =>
  Layer.succeed(
    Provider,
    {
      config: {
        apiKey: Redacted.make("mock-key"),
        baseURL: "http://mock",
        model: "mock-model",
      },
      generateText: ({ messages }) =>
        Effect.succeed(respond(messages as Array<{ role: string; content: string }>)),
    } satisfies ProviderService
  )
