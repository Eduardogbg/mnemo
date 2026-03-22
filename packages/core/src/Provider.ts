/**
 * LLM Provider — @effect/ai LanguageModel wrappers for OpenAI-compatible APIs.
 *
 * Replaces the custom ProviderService with @effect/ai's LanguageModel interface.
 * Uses direct fetch to /chat/completions for maximum compatibility with
 * OpenRouter, Venice, Redpill, and other OpenAI-compatible providers.
 *
 * Note: @effect/ai-openai v0.37+ uses OpenAI's Responses API (/responses)
 * which is NOT supported by OpenRouter or other third-party providers.
 * We use direct fetch to /chat/completions instead.
 */
import * as AiError from "@effect/ai/AiError"
import * as LanguageModel from "@effect/ai/LanguageModel"
import * as AiModel from "@effect/ai/Model"
import type * as Prompt from "@effect/ai/Prompt"
import type * as Response from "@effect/ai/Response"
import * as Tool from "@effect/ai/Tool"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ChatCompletionsConfig {
  readonly apiKey: string | Redacted.Redacted<string>
  readonly baseURL: string
  readonly model: string
  readonly temperature?: number
  readonly maxTokens?: number
}

// ---------------------------------------------------------------------------
// Prompt conversion
// ---------------------------------------------------------------------------

function promptToMessages(
  prompt: Prompt.Prompt,
  tools: ReadonlyArray<Tool.Any>,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
  }> = []

  for (const msg of prompt.content) {
    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content })
    } else if (msg.role === "user") {
      const textParts: string[] = []
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text)
        }
      }
      if (textParts.length > 0) {
        messages.push({ role: "user", content: textParts.join("") })
      }
    } else if (msg.role === "assistant") {
      const textParts: string[] = []
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text)
        }
      }
      if (textParts.length > 0) {
        messages.push({ role: "assistant", content: textParts.join("") })
      }
    }
  }

  return messages
}

// ---------------------------------------------------------------------------
// OpenAI tools conversion
// ---------------------------------------------------------------------------

function toolsToOpenAI(
  tools: ReadonlyArray<Tool.Any>,
): Array<{
  type: "function"
  function: { name: string; description?: string; parameters: unknown }
}> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: Tool.getJsonSchemaFromSchemaAst(tool.parametersSchema.ast),
    },
  }))
}

// ---------------------------------------------------------------------------
// LanguageModel implementation
// ---------------------------------------------------------------------------

/**
 * Create a LanguageModel.Service backed by direct fetch to /chat/completions.
 */
const makeChatCompletionsLM = (
  config: ChatCompletionsConfig,
): Effect.Effect<LanguageModel.Service, never, never> => {
  const apiKeyStr =
    typeof config.apiKey === "string"
      ? config.apiKey
      : Redacted.value(config.apiKey)

  let callIdCounter = 0

  return LanguageModel.make({
    generateText: (
      options: LanguageModel.ProviderOptions,
    ): Effect.Effect<Array<Response.PartEncoded>, AiError.AiError> => {
      const messages = promptToMessages(options.prompt, options.tools)
      const callId = `cc-${++callIdCounter}`

      return Effect.tryPromise({
        try: async () => {
          const body: Record<string, unknown> = {
            model: config.model,
            messages,
            temperature: config.temperature ?? 0.7,
            max_tokens: config.maxTokens ?? 1024,
          }

          if (options.tools.length > 0) {
            body.tools = toolsToOpenAI(options.tools)
            body.tool_choice = "auto"
          }

          const response = await fetch(
            `${config.baseURL}/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKeyStr}`,
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(300_000),
            },
          )

          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(
              `API error ${response.status}: ${errorText.slice(0, 500)}`,
            )
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
            console.warn(
              "[Provider] Response truncated (finish_reason: length) — tool calls may be incomplete",
            )
          }

          const parts: Array<Response.PartEncoded> = []
          const text = choice.message.content ?? ""

          if (text) {
            parts.push({ type: "text", text })
          }

          const rawToolCalls = choice.message.tool_calls ?? []
          let tcIndex = 0
          for (const tc of rawToolCalls) {
            if (!tc.function) continue
            try {
              const params = JSON.parse(tc.function.arguments)
              parts.push({
                type: "tool-call",
                id: `${callId}-tc-${tcIndex++}`,
                name: tc.function.name,
                params,
                providerExecuted: false,
              })
            } catch {
              console.warn(
                `[Provider] Malformed tool call arguments for "${tc.function.name}"`,
              )
            }
          }

          parts.push({
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          })

          return parts
        },
        catch: (error) =>
          new AiError.UnknownError({
            module: "ChatCompletions",
            method: "generateText",
            description: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
      })
    },

    streamText: (
      options: LanguageModel.ProviderOptions,
    ): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> => {
      // Stub: collect full response then emit as stream
      const messages = promptToMessages(options.prompt, options.tools)
      const chunkId = `cc-stream-${++callIdCounter}`

      return Stream.fromEffect(
        Effect.tryPromise({
          try: async () => {
            const body: Record<string, unknown> = {
              model: config.model,
              messages,
              temperature: config.temperature ?? 0.7,
              max_tokens: config.maxTokens ?? 1024,
            }

            if (options.tools.length > 0) {
              body.tools = toolsToOpenAI(options.tools)
              body.tool_choice = "auto"
            }

            const response = await fetch(
              `${config.baseURL}/chat/completions`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKeyStr}`,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(300_000),
              },
            )

            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(`API error ${response.status}: ${errorText.slice(0, 500)}`)
            }

            const json = (await response.json()) as {
              choices: Array<{
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
            const text = choice.message.content ?? ""

            const parts: Array<Response.StreamPartEncoded> = [
              { type: "text-start", id: chunkId },
            ]
            if (text) {
              parts.push({ type: "text-delta", id: chunkId, delta: text })
            }
            parts.push({ type: "text-end", id: chunkId })
            parts.push({
              type: "finish",
              reason: "stop",
              usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
              },
            })
            return parts
          },
          catch: (error) =>
            new AiError.UnknownError({
              module: "ChatCompletions",
              method: "streamText",
              description: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
            }),
        }),
      ).pipe(Stream.flatMap((parts) => Stream.fromIterable(parts)))
    },
  })
}

// ---------------------------------------------------------------------------
// Layer and Model constructors
// ---------------------------------------------------------------------------

/**
 * Create an AiModel from a ChatCompletionsConfig.
 * This is the primary way to create a LanguageModel for non-E2EE providers.
 */
export const model = (
  config: ChatCompletionsConfig,
): AiModel.Model<"chat-completions", LanguageModel.LanguageModel, never> => {
  const lmLayer = Layer.effect(LanguageModel.LanguageModel, makeChatCompletionsLM(config))
  return AiModel.make("chat-completions", Layer.orDie(lmLayer))
}

/**
 * Venice model — reads VENICE_API_KEY from env.
 * Defaults to deepseek-v3.2 (non-E2EE). For E2EE, use @mnemo/venice directly.
 */
export const VeniceModel = (
  overrides?: Partial<ChatCompletionsConfig>,
): AiModel.Model<"chat-completions", LanguageModel.LanguageModel, never> => {
  const apiKey = process.env.VENICE_API_KEY
  if (!apiKey) throw new Error("VENICE_API_KEY not set in environment")
  return model({
    apiKey,
    baseURL: "https://api.venice.ai/api/v1",
    model: "llama-3.3-70b",
    temperature: 0.3,
    maxTokens: 4096,
    ...overrides,
  })
}

/**
 * OpenRouter model — reads OPENROUTER_API_KEY from env.
 */
export const OpenRouterModel = (
  overrides?: Partial<ChatCompletionsConfig>,
): AiModel.Model<"chat-completions", LanguageModel.LanguageModel, never> => {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set in environment")
  return model({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    temperature: 0.7,
    maxTokens: 1024,
    ...overrides,
  })
}

/**
 * Mock model for testing — returns fixed responses.
 * Takes a respond function that maps messages to { text, toolCalls? }.
 * Returns a Layer<LanguageModel.LanguageModel>.
 */
export const mockModel = (
  respond: (
    messages: ReadonlyArray<{ role: string; content: string }>,
  ) => {
    text: string
    toolCalls?: ReadonlyArray<{
      name: string
      args: Record<string, unknown>
    }>
  },
): Layer.Layer<LanguageModel.LanguageModel> => {
  let callIdCounter = 0

  return Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (
        options: LanguageModel.ProviderOptions,
      ): Effect.Effect<Array<Response.PartEncoded>, AiError.AiError> =>
        Effect.sync(() => {
          const messages = promptToMessages(options.prompt, options.tools)
          const result = respond(messages)
          const callId = `mock-${++callIdCounter}`
          const parts: Array<Response.PartEncoded> = []

          if (result.text) {
            parts.push({ type: "text", text: result.text })
          }

          if (result.toolCalls) {
            let tcIndex = 0
            for (const tc of result.toolCalls) {
              parts.push({
                type: "tool-call",
                id: `${callId}-tc-${tcIndex++}`,
                name: tc.name,
                params: tc.args,
                providerExecuted: false,
              })
            }
          }

          parts.push({
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          })

          return parts
        }),

      streamText: (
        _options: LanguageModel.ProviderOptions,
      ): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> =>
        Stream.fromIterable([
          { type: "text-start" as const, id: "mock-stream" },
          { type: "text-delta" as const, id: "mock-stream", delta: "mock" },
          { type: "text-end" as const, id: "mock-stream" },
          {
            type: "finish" as const,
            reason: "stop" as const,
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          },
        ]),
    }),
  )
}
