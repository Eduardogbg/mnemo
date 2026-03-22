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
      const messages = promptToMessages(options.prompt, options.tools)
      const streamId = `cc-stream-${++callIdCounter}`

      return Stream.asyncPush<Response.StreamPartEncoded, AiError.AiError>(
        (emit) =>
          Effect.tryPromise({
            try: async () => {
              const body: Record<string, unknown> = {
                model: config.model,
                messages,
                temperature: config.temperature ?? 0.7,
                max_tokens: config.maxTokens ?? 1024,
                stream: true,
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

              if (!response.body) {
                throw new Error("Response body is null — streaming not supported")
              }

              // Track state for streaming
              let textStarted = false
              let finishReason: string | undefined
              let inputTokens: number | undefined
              let outputTokens: number | undefined

              // Tool call accumulation: index -> { id, name, arguments }
              const toolCalls = new Map<
                number,
                { id: string; name: string; arguments: string; started: boolean }
              >()

              // SSE parsing state — handle partial lines across chunks
              let buffer = ""
              const decoder = new TextDecoder()
              const reader = response.body.getReader()

              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break

                  buffer += decoder.decode(value, { stream: true })
                  const lines = buffer.split("\n")
                  // Keep the last (potentially incomplete) line in the buffer
                  buffer = lines.pop() ?? ""

                  for (const line of lines) {
                    const trimmed = line.trim()
                    if (trimmed === "") continue // empty line (chunk separator)
                    if (!trimmed.startsWith("data: ")) continue // skip comments, etc.

                    const data = trimmed.slice(6) // strip "data: "
                    if (data === "[DONE]") {
                      // Finalize any open tool calls
                      for (const [, tc] of toolCalls) {
                        if (tc.started) {
                          emit.single({
                            type: "tool-params-end",
                            id: tc.id,
                          })
                        }
                        // Emit the complete tool-call part
                        try {
                          const params = JSON.parse(tc.arguments || "{}")
                          emit.single({
                            type: "tool-call",
                            id: tc.id,
                            name: tc.name,
                            params,
                            providerExecuted: false,
                          })
                        } catch {
                          console.warn(
                            `[Provider] Malformed tool call arguments for "${tc.name}"`,
                          )
                        }
                      }

                      // Close text stream if it was opened
                      if (textStarted) {
                        emit.single({ type: "text-end", id: streamId })
                      }

                      emit.single({
                        type: "finish",
                        reason: (finishReason ?? "stop") as "stop",
                        usage: {
                          inputTokens,
                          outputTokens,
                          totalTokens:
                            inputTokens !== undefined && outputTokens !== undefined
                              ? inputTokens + outputTokens
                              : undefined,
                        },
                      })
                      emit.end()
                      return
                    }

                    // Parse the JSON chunk
                    let chunk: {
                      choices?: Array<{
                        delta?: {
                          content?: string | null
                          tool_calls?: Array<{
                            index: number
                            id?: string
                            function?: {
                              name?: string
                              arguments?: string
                            }
                          }>
                        }
                        finish_reason?: string | null
                      }>
                      usage?: {
                        prompt_tokens?: number
                        completion_tokens?: number
                      }
                    }

                    try {
                      chunk = JSON.parse(data)
                    } catch {
                      continue // skip malformed JSON
                    }

                    // Extract usage if present (some providers send it in the last chunk)
                    if (chunk.usage) {
                      inputTokens = chunk.usage.prompt_tokens
                      outputTokens = chunk.usage.completion_tokens
                    }

                    const choice = chunk.choices?.[0]
                    if (!choice) continue

                    // Track finish reason
                    if (choice.finish_reason) {
                      finishReason = choice.finish_reason
                    }

                    const delta = choice.delta
                    if (!delta) continue

                    // Handle text content deltas
                    if (delta.content) {
                      if (!textStarted) {
                        emit.single({ type: "text-start", id: streamId })
                        textStarted = true
                      }
                      emit.single({
                        type: "text-delta",
                        id: streamId,
                        delta: delta.content,
                      })
                    }

                    // Handle tool call deltas
                    if (delta.tool_calls) {
                      for (const tcDelta of delta.tool_calls) {
                        const idx = tcDelta.index
                        let tc = toolCalls.get(idx)

                        if (!tc) {
                          // New tool call
                          const tcId =
                            tcDelta.id ?? `${streamId}-tc-${idx}`
                          tc = {
                            id: tcId,
                            name: tcDelta.function?.name ?? "",
                            arguments: "",
                            started: false,
                          }
                          toolCalls.set(idx, tc)
                        }

                        // Update name if provided (usually in first chunk)
                        if (tcDelta.function?.name) {
                          tc.name = tcDelta.function.name
                          if (!tc.started) {
                            // Close text stream before tool params if needed
                            if (textStarted) {
                              emit.single({ type: "text-end", id: streamId })
                              textStarted = false
                            }
                            emit.single({
                              type: "tool-params-start",
                              id: tc.id,
                              name: tc.name,
                              providerExecuted: false,
                            })
                            tc.started = true
                          }
                        }

                        // Accumulate arguments
                        if (tcDelta.function?.arguments) {
                          tc.arguments += tcDelta.function.arguments
                          if (!tc.started) {
                            // Edge case: arguments before name (shouldn't happen but be safe)
                            if (textStarted) {
                              emit.single({ type: "text-end", id: streamId })
                              textStarted = false
                            }
                            emit.single({
                              type: "tool-params-start",
                              id: tc.id,
                              name: tc.name,
                              providerExecuted: false,
                            })
                            tc.started = true
                          }
                          emit.single({
                            type: "tool-params-delta",
                            id: tc.id,
                            delta: tcDelta.function.arguments,
                          })
                        }
                      }
                    }
                  }
                }

                // Stream ended without [DONE] — finalize anyway
                for (const [, tc] of toolCalls) {
                  if (tc.started) {
                    emit.single({ type: "tool-params-end", id: tc.id })
                  }
                  try {
                    const params = JSON.parse(tc.arguments || "{}")
                    emit.single({
                      type: "tool-call",
                      id: tc.id,
                      name: tc.name,
                      params,
                      providerExecuted: false,
                    })
                  } catch {
                    console.warn(
                      `[Provider] Malformed tool call arguments for "${tc.name}"`,
                    )
                  }
                }

                if (textStarted) {
                  emit.single({ type: "text-end", id: streamId })
                }

                emit.single({
                  type: "finish",
                  reason: (finishReason ?? "stop") as "stop",
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens:
                      inputTokens !== undefined && outputTokens !== undefined
                        ? inputTokens + outputTokens
                        : undefined,
                  },
                })
                emit.end()
              } catch (err) {
                reader.cancel().catch(() => {})
                throw err
              }
            },
            catch: (error) =>
              new AiError.UnknownError({
                module: "ChatCompletions",
                method: "streamText",
                description: `SSE stream failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
          }),
        { bufferSize: "unbounded" },
      )
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
        options: LanguageModel.ProviderOptions,
      ): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> => {
        const messages = promptToMessages(options.prompt, options.tools)
        const result = respond(messages)
        const mockStreamId = `mock-stream-${++callIdCounter}`

        const parts: Array<Response.StreamPartEncoded> = []

        // Emit text-start
        parts.push({ type: "text-start", id: mockStreamId })

        // Stream text word by word for realistic simulation
        if (result.text) {
          const words = result.text.split(/(\s+)/)
          for (const word of words) {
            if (word) {
              parts.push({ type: "text-delta", id: mockStreamId, delta: word })
            }
          }
        }

        parts.push({ type: "text-end", id: mockStreamId })

        // Emit tool calls if any
        if (result.toolCalls) {
          let tcIndex = 0
          for (const tc of result.toolCalls) {
            const tcId = `${mockStreamId}-tc-${tcIndex++}`
            const argsStr = JSON.stringify(tc.args)

            parts.push({
              type: "tool-params-start",
              id: tcId,
              name: tc.name,
              providerExecuted: false,
            })
            parts.push({
              type: "tool-params-delta",
              id: tcId,
              delta: argsStr,
            })
            parts.push({ type: "tool-params-end", id: tcId })
            parts.push({
              type: "tool-call",
              id: tcId,
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

        return Stream.fromIterable(parts)
      },
    }),
  )
}
