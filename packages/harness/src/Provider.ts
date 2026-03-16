/**
 * LLM Provider layer — swappable inference backend.
 *
 * Defines a `Provider` Effect service that wraps an OpenAI-compatible chat
 * completions API. The default implementation targets OpenRouter via
 * @effect/ai-openai (which speaks the OpenAI wire protocol). The layer is
 * trivially replaceable with Redpill, Venice, or a test mock.
 *
 * Uses @effect/ai + @effect/ai-openai for the actual HTTP calls — no Vercel
 * AI SDK dependency.
 */
import { Context, Effect, Layer, Redacted } from "effect"
import { LanguageModel } from "@effect/ai"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { FetchHttpClient } from "@effect/platform"
import { ProviderError } from "./Errors.js"

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
   * Send a chat-completions request and get back the assistant's text.
   */
  readonly generateText: (options: {
    readonly system?: string
    readonly messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>
  }) => Effect.Effect<string, ProviderError>

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
    generateText: ({ system, messages }) => {
      // Build the prompt as a multi-part conversation.
      // @effect/ai's LanguageModel.generateText accepts a Prompt, which can
      // be a plain string or an array of message objects.
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
        Effect.map((response) => response.text),
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
        // Widen the type to remove any remaining service requirements —
        // the layer above provides everything.
        Effect.scoped,
      ) as Effect.Effect<string, ProviderError>
    },
  }
}

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
 */
export const mockLayer = (
  respond: (messages: ReadonlyArray<{ role: string; content: string }>) => string
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
