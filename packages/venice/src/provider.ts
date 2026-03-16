/**
 * provider.ts -- @effect/ai LanguageModel provider for Venice E2EE.
 *
 * Provides an Effect Layer satisfying @effect/ai's LanguageModel interface.
 * Handles: attestation -> session -> encrypt messages -> stream -> decrypt chunks.
 *
 * Tool calling: Venice E2EE does not natively support function calling. When
 * @effect/ai passes tools via ProviderOptions, this provider:
 *   1. Serializes Tool definitions into the system prompt (XML format)
 *   2. Parses <tool_call> blocks from the model response
 *   3. Returns them as ToolCallPartEncoded so @effect/ai's framework handles
 *      resolution via Toolkit.WithHandler.handle()
 *
 * Encryption: Controlled by VeniceConfig.encryption ("encrypted" | "plaintext").
 * No silent degradation. If "encrypted" and attestation fails, the provider
 * fails loudly.
 *
 * Streaming: Venice only supports streaming for E2EE. The provider's
 * generateText falls back to collecting a stream internally, but will fail
 * with VeniceE2EEStreamingRequired if that contract is violated.
 */

import * as AiError from "@effect/ai/AiError";
import * as LanguageModel from "@effect/ai/LanguageModel";
import * as AiModel from "@effect/ai/Model";
import type * as Prompt from "@effect/ai/Prompt";
import type * as Response from "@effect/ai/Response";
import * as Tool from "@effect/ai/Tool";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  type E2EESession,
  VeniceClient,
  VeniceClientFull,
  type VeniceConfigShape,
  VeniceConfig,
} from "./client.js";

// ---------------------------------------------------------------------------
// Tool serialization (internal)
// ---------------------------------------------------------------------------

/**
 * Serialize @effect/ai Tool.Any definitions into a system prompt section.
 */
function formatToolsForPrompt(tools: ReadonlyArray<Tool.Any>): string {
  if (tools.length === 0) return "";

  const toolDescriptions = tools
    .map((tool) => {
      const jsonSchema = Tool.getJsonSchemaFromSchemaAst(tool.parametersSchema.ast);
      const params = JSON.stringify(jsonSchema, null, 2);
      return `### ${tool.name}
${tool.description ?? "No description"}

Parameters (JSON Schema):
\`\`\`json
${params}
\`\`\``;
    })
    .join("\n\n");

  return `You have access to the following tools. To call a tool, emit a <tool_call> XML block containing a JSON object with "name" and "arguments" fields. You may call multiple tools by emitting multiple <tool_call> blocks.

Format:
<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1"}}
</tool_call>

Available tools:

${toolDescriptions}

Important:
- Only call tools when they are relevant to the user's request.
- Always provide the required parameters.
- If you do not need to call a tool, respond normally without any <tool_call> blocks.
- After a tool call, wait for the result before continuing.`;
}

/**
 * Parse <tool_call> blocks from model response text.
 */
function parseToolCalls(
  responseText: string,
  idPrefix: string,
): {
  text: string;
  toolCalls: Array<Response.ToolCallPartEncoded>;
} {
  const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const toolCalls: Array<Response.ToolCallPartEncoded> = [];
  let match: RegExpExecArray | null;
  let callIndex = 0;

  while ((match = TOOL_CALL_REGEX.exec(responseText)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (
        typeof parsed.name === "string" &&
        typeof parsed.arguments === "object" &&
        parsed.arguments !== null
      ) {
        toolCalls.push({
          type: "tool-call",
          id: `${idPrefix}-tc-${callIndex++}`,
          name: parsed.name,
          params: parsed.arguments,
          providerExecuted: false,
        });
      }
    } catch {
      // Malformed JSON -- skip
    }
  }

  const text = responseText.replace(TOOL_CALL_REGEX, "").trim();
  return { text, toolCalls };
}

// ---------------------------------------------------------------------------
// Prompt conversion
// ---------------------------------------------------------------------------

/**
 * Convert @effect/ai Prompt messages into Venice chat messages.
 * When tools are present, injects tool definitions into the system prompt.
 */
function promptToMessages(
  prompt: Prompt.Prompt,
  tools: ReadonlyArray<Tool.Any>,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  const toolPrompt = formatToolsForPrompt(tools);

  for (const msg of prompt.content) {
    if (msg.role === "system") {
      const content = toolPrompt
        ? `${msg.content}\n\n${toolPrompt}`
        : msg.content;
      messages.push({ role: "system", content });
    } else if (msg.role === "user") {
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        }
      }
      if (textParts.length > 0) {
        messages.push({ role: "user", content: textParts.join("") });
      }
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        }
      }
      if (textParts.length > 0) {
        messages.push({ role: "assistant", content: textParts.join("") });
      }
    }
  }

  // If there are tools but no system message was present, inject one
  if (toolPrompt && !messages.some((m) => m.role === "system")) {
    messages.unshift({ role: "system", content: toolPrompt });
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/**
 * Create the LanguageModel service backed by Venice E2EE.
 *
 * Requires VeniceConfig and VeniceClient in the environment.
 */
export const make: Effect.Effect<
  LanguageModel.Service,
  AiError.AiError,
  VeniceConfig | VeniceClient
> = Effect.gen(function* () {
  const config = yield* VeniceConfig;
  const client = yield* VeniceClient;

  const encryption = config.encryption ?? "encrypted";

  // Resolve session based on explicit encryption mode
  let session: E2EESession | null = null;
  if (encryption === "encrypted") {
    const sessionResult = yield* client
      .createSession(config.model)
      .pipe(
        Effect.mapError(
          (err) =>
            new AiError.UnknownError({
              module: "VeniceE2EE",
              method: "make",
              description: `E2EE session creation failed (encryption mode is "encrypted"): ${err.message}`,
            }),
        ),
      );
    session = sessionResult;
  }
  // encryption === "plaintext" → session stays null, no attestation attempt

  let callIdCounter = 0;

  return yield* LanguageModel.make({
    generateText: (
      options: LanguageModel.ProviderOptions,
    ): Effect.Effect<Array<Response.PartEncoded>, AiError.AiError> => {
      // Venice only supports streaming for E2EE. generateText collects a
      // stream internally, which is fine. But we document this constraint.
      const messages = promptToMessages(options.prompt, options.tools);
      const callId = `venice-${++callIdCounter}`;

      return client
        .chat(
          {
            model: config.model,
            messages,
            max_tokens: config.maxTokens ?? 2048,
            temperature: config.temperature,
          },
          session,
        )
        .pipe(
          Effect.map(({ text: rawText }) => {
            const parts: Array<Response.PartEncoded> = [];

            if (options.tools.length > 0) {
              const { text, toolCalls } = parseToolCalls(rawText, callId);

              if (text) {
                parts.push({ type: "text", text });
              }

              for (const tc of toolCalls) {
                parts.push(tc);
              }
            } else {
              parts.push({ type: "text", text: rawText });
            }

            parts.push({
              type: "finish",
              reason: "stop",
              usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
              },
            });

            return parts;
          }),
          Effect.mapError(
            (err) =>
              new AiError.UnknownError({
                module: "VeniceE2EE",
                method: "generateText",
                description: `${err.message}`,
              }),
          ),
        );
    },

    streamText: (
      options: LanguageModel.ProviderOptions,
    ): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> => {
      const messages = promptToMessages(options.prompt, options.tools);
      const chunkId = `venice-e2ee-${++callIdCounter}`;

      const startEvent: Response.StreamPartEncoded = {
        type: "text-start" as const,
        id: chunkId,
      };

      const endEvents: Response.StreamPartEncoded[] = [
        { type: "text-end" as const, id: chunkId },
        {
          type: "finish" as const,
          reason: "stop" as const,
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
          },
        },
      ];

      // With tools: collect full response then parse tool calls
      if (options.tools.length > 0) {
        return Stream.fromEffect(
          client
            .chat(
              {
                model: config.model,
                messages,
                max_tokens: config.maxTokens ?? 2048,
                temperature: config.temperature,
              },
              session,
            )
            .pipe(
              Effect.map(({ text: rawText }) => {
                const { text, toolCalls } = parseToolCalls(rawText, chunkId);
                const parts: Response.StreamPartEncoded[] = [startEvent];

                if (text) {
                  parts.push({
                    type: "text-delta" as const,
                    id: chunkId,
                    delta: text,
                  });
                }

                parts.push({ type: "text-end" as const, id: chunkId });

                for (const tc of toolCalls) {
                  parts.push(tc);
                }

                parts.push({
                  type: "finish" as const,
                  reason: "stop" as const,
                  usage: {
                    inputTokens: undefined,
                    outputTokens: undefined,
                    totalTokens: undefined,
                  },
                });

                return parts;
              }),
              Effect.mapError(
                (err) =>
                  new AiError.UnknownError({
                    module: "VeniceE2EE",
                    method: "streamText",
                    description: `${err.message}`,
                  }),
              ),
            ),
        ).pipe(Stream.flatMap((parts) => Stream.fromIterable(parts)));
      }

      // No tools -- true streaming
      const deltaStream: Stream.Stream<
        Response.StreamPartEncoded,
        AiError.AiError
      > = client
        .streamChat(
          {
            model: config.model,
            messages,
            max_tokens: config.maxTokens ?? 2048,
            temperature: config.temperature,
          },
          session,
        )
        .pipe(
          Stream.filterMap((chunk) => {
            if (chunk.text) {
              const part: Response.StreamPartEncoded = {
                type: "text-delta" as const,
                id: chunkId,
                delta: chunk.text,
              };
              return Option.some(part);
            }
            return Option.none();
          }),
          Stream.mapError(
            (err) =>
              new AiError.UnknownError({
                module: "VeniceE2EE",
                method: "streamText",
                description: `${err.message}`,
              }),
          ),
        );

      return Stream.concat(
        Stream.succeed(startEvent),
        Stream.concat(deltaStream, Stream.fromIterable(endEvents)),
      );
    },
  });
});

// ---------------------------------------------------------------------------
// Layer and Model
// ---------------------------------------------------------------------------

/**
 * Layer that provides LanguageModel from VeniceConfig + VeniceClient.
 */
export const layer: Layer.Layer<
  LanguageModel.LanguageModel,
  AiError.AiError,
  VeniceConfig | VeniceClient
> = Layer.effect(LanguageModel.LanguageModel, make);

/**
 * Self-contained layer: VeniceConfig -> VeniceClient + LanguageModel.
 */
export const layerFull: Layer.Layer<
  LanguageModel.LanguageModel,
  AiError.AiError,
  VeniceConfig
> = Layer.provide(layer, VeniceClientFull);

/**
 * Create an AiModel for Venice E2EE.
 *
 * @example
 * ```ts
 * import { VeniceProvider } from "@mnemo/venice"
 * import { LanguageModel, Tool, Toolkit } from "@effect/ai"
 * import { Effect, Schema } from "effect"
 *
 * const GetWeather = Tool.make("GetWeather", {
 *   description: "Get weather for a city",
 *   parameters: { city: Schema.String },
 *   success: Schema.Struct({ temp: Schema.Number, condition: Schema.String }),
 * })
 *
 * const toolkit = Toolkit.make(GetWeather)
 *
 * const veniceModel = VeniceProvider.model({
 *   apiKey: "your-key",
 *   model: "e2ee-qwen3-30b-a3b",
 *   encryption: "encrypted", // explicit -- no silent degradation
 * })
 *
 * const program = LanguageModel.generateText({
 *   prompt: "What's the weather in SF?",
 *   toolkit,
 * })
 *
 * Effect.provide(program, veniceModel)
 * ```
 */
export const model = (
  config: VeniceConfigShape,
): AiModel.Model<"venice-e2ee", LanguageModel.LanguageModel, never> => {
  const fullLayer = Layer.provide(
    layerFull,
    Layer.succeed(VeniceConfig, config),
  );
  // AiModel.make requires error=never. Ordie is acceptable here because
  // session creation errors (attestation unavailable) are unrecoverable
  // at the model level — the user chose "encrypted" and it's not available.
  const infallibleLayer = Layer.orDie(fullLayer);
  return AiModel.make("venice-e2ee", infallibleLayer);
};
