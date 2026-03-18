/**
 * LLM Provider layer — swappable inference backend.
 *
 * Defines a `Provider` Effect service that wraps an OpenAI-compatible chat
 * completions API. The default implementation targets OpenRouter via
 * @effect/ai-openai (which speaks the OpenAI wire protocol). The layer is
 * trivially replaceable with Redpill, Venice, or a test mock.
 *
 * Uses @effect/ai + @effect/ai-openai for the actual HTTP calls — no Vercel
 * AI SDK dependency. When tools are present, uses a direct fetch to the
 * OpenAI-compatible endpoint (bypassing @effect/ai's complex Toolkit types).
 */
import { Context, Effect, Layer, Redacted } from "effect"
import { LanguageModel } from "@effect/ai"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { FetchHttpClient } from "@effect/platform"
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

export class Provider extends Context.Tag("@mnemo/harness/Provider")<
  Provider,
  ProviderService
>() {}

// ---------------------------------------------------------------------------
// @effect/ai-openai implementation
// ---------------------------------------------------------------------------

/**
 * Build a ProviderService that delegates to @effect/ai's LanguageModel,
 * backed by the OpenAI-compatible provider from @effect/ai-openai.
 */
const makeEffectAiProvider = (config: ProviderConfig): ProviderService => {
  // Build the composed layer that provides LanguageModel.LanguageModel:
  //   BunHttpClient -> OpenAiClient -> OpenAiLanguageModel
  const clientLayer = OpenAiClient.layer({
    apiKey: config.apiKey,
    apiUrl: config.baseURL,
  })

  const modelLayer = OpenAiLanguageModel.layer({
    model: config.model,
    config: {
      temperature: config.temperature ?? 0.7,
      max_output_tokens: config.maxTokens ?? 1024,
    },
  })

  // Full layer: HttpClient (Bun) -> OpenAiClient -> LanguageModel
  const fullLayer = modelLayer.pipe(
    Layer.provide(clientLayer),
    Layer.provide(FetchHttpClient.layer),
  )

  return {
    config,
    generateText: ({ system, messages, tools }) => {
      // When tools are present, use direct fetch to OpenAI-compatible endpoint
      // to avoid fighting @effect/ai's complex Toolkit type system.
      if (tools && tools.length > 0) {
        return generateWithTools(config, system, messages, tools)
      }

      // Build the prompt as a multi-part conversation.
      const prompt: Array<{ role: "system" | "user" | "assistant"; content: string }> = []

      if (system) {
        prompt.push({ role: "system", content: system })
      }
      for (const m of messages) {
        prompt.push({ role: m.role, content: m.content })
      }

      return LanguageModel.generateText({
        prompt,
      }).pipe(
        Effect.map((response): GenerateTextResult => ({
          text: response.text,
          toolCalls: [],
        })),
        Effect.provide(fullLayer),
        Effect.mapError((error) =>
          new ProviderError({
            message: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          })
        ),
        Effect.tapError((e) =>
          Effect.logError(`Provider error: ${e.message}`)
        ),
        Effect.scoped,
      ) as Effect.Effect<GenerateTextResult, ProviderError>
    },
  }
}

// ---------------------------------------------------------------------------
// Direct fetch for tool-augmented calls
// ---------------------------------------------------------------------------

/**
 * Make a direct OpenAI-compatible API call with native tool/function definitions.
 * Bypasses @effect/ai's Toolkit to keep the tool definition format simple.
 */
const generateWithTools = (
  config: ProviderConfig,
  system: string | undefined,
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
  tools: ReadonlyArray<ToolDefinition>,
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

      const body = {
        model: config.model,
        messages: apiMessages,
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 1024,
        tools: tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: "auto",
      }

      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Redacted.value(config.apiKey)}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API error ${response.status}: ${errorText}`)
      }

      const json = (await response.json()) as {
        choices: Array<{
          message: {
            content?: string | null
            tool_calls?: Array<{
              function: { name: string; arguments: string }
            }>
          }
        }>
      }

      const choice = json.choices[0]
      if (!choice) throw new Error("No choices in response")

      const text = choice.message.content ?? ""
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(
        (tc) => {
          let args: Record<string, unknown>
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>
          } catch {
            throw new Error(
              `Malformed tool call arguments for "${tc.function.name}": ${tc.function.arguments}`
            )
          }
          return { name: tc.function.name, args }
        },
      )

      return { text, toolCalls } satisfies GenerateTextResult
    },
    catch: (error) =>
      new ProviderError({
        message: `Tool-augmented LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
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
  Layer.succeed(Provider, makeEffectAiProvider(config))

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
    return makeEffectAiProvider({
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
