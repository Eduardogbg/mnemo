/**
 * api.ts -- Typed Venice REST client using @effect/platform HttpClient.
 *
 * Pure HTTP layer with Schema-validated responses. No encryption, no session
 * management. The E2EE layer (client.ts) builds on top of this.
 *
 * Endpoints:
 *   - GET  /models              -> ModelList
 *   - GET  /tee/attestation     -> Attestation
 *   - POST /chat/completions    -> SSE stream of ChatCompletionChunk
 */

import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { VeniceApiError } from "./errors.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** A single model entry returned by GET /models */
export class Model extends Schema.Class<Model>("@mnemo/venice/Model")({
  id: Schema.String,
  object: Schema.optionalWith(Schema.String, { default: () => "model" }),
  owned_by: Schema.optionalWith(Schema.String, { default: () => "unknown" }),
}) {}

/** Response shape for GET /models */
export class ModelList extends Schema.Class<ModelList>(
  "@mnemo/venice/ModelList",
)({
  object: Schema.optionalWith(Schema.String, { default: () => "list" }),
  data: Schema.Array(Model),
}) {}

/** Response shape for GET /tee/attestation */
export class Attestation extends Schema.Class<Attestation>(
  "@mnemo/venice/Attestation",
)({
  verified: Schema.Boolean,
  signing_key: Schema.optional(Schema.String),
  signing_public_key: Schema.optional(Schema.String),
  signing_address: Schema.optional(Schema.String),
  signing_algo: Schema.optional(Schema.String),
  tee_provider: Schema.optional(Schema.String),
  tee_hardware: Schema.optional(Schema.String),
  nonce: Schema.optional(Schema.String),
  nonce_source: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  model_name: Schema.optional(Schema.String),
  upstream_model: Schema.optional(Schema.String),
  server_verification: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
}) {}

/** A single choice delta in a streaming chat completion chunk */
export class ChatCompletionDelta extends Schema.Class<ChatCompletionDelta>(
  "@mnemo/venice/ChatCompletionDelta",
)({
  content: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
}) {}

export class ChatCompletionChoice extends Schema.Class<ChatCompletionChoice>(
  "@mnemo/venice/ChatCompletionChoice",
)({
  index: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  delta: ChatCompletionDelta,
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/** A single SSE chunk for POST /chat/completions (streaming) */
export class ChatCompletionChunk extends Schema.Class<ChatCompletionChunk>(
  "@mnemo/venice/ChatCompletionChunk",
)({
  id: Schema.optional(Schema.String),
  object: Schema.optional(Schema.String),
  created: Schema.optional(Schema.Number),
  model: Schema.optional(Schema.String),
  choices: Schema.optionalWith(Schema.Array(ChatCompletionChoice), {
    default: () => [],
  }),
}) {}

/** Shape for the chat completion request body */
export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly content: string;
  }>;
  readonly stream: true;
  readonly max_tokens?: number;
  readonly temperature?: number;
}

// ---------------------------------------------------------------------------
// VeniceApi service
// ---------------------------------------------------------------------------

export interface VeniceApiService {
  /** GET /models -- list available models */
  readonly listModels: () => Effect.Effect<ModelList, VeniceApiError>;

  /** GET /tee/attestation?model=X -- fetch TEE attestation */
  readonly getAttestation: (
    model: string,
  ) => Effect.Effect<Attestation, VeniceApiError>;

  /**
   * POST /chat/completions -- streaming chat completion.
   *
   * Returns the raw SSE byte stream from the response body. The caller
   * (client.ts) is responsible for SSE parsing and decryption.
   *
   * Extra headers can be passed for E2EE key exchange.
   */
  readonly streamChatCompletion: (
    request: ChatCompletionRequest,
    extraHeaders?: Record<string, string>,
  ) => Effect.Effect<
    ReadableStream<Uint8Array>,
    VeniceApiError,
    Scope.Scope
  >;
}

export class VeniceApi extends Context.Tag("@mnemo/venice/VeniceApi")<
  VeniceApi,
  VeniceApiService
>() {}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create a VeniceApi service given config and an HttpClient.
 *
 * The HttpClient is expected to be provided externally (e.g.
 * FetchHttpClient.layer). The constructor configures base URL and auth.
 */
export const make = (options: {
  readonly apiKey: string;
  readonly baseUrl?: string;
}): Effect.Effect<VeniceApiService, never, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const baseUrl = options.baseUrl ?? "https://api.venice.ai/api/v1";

    const httpClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((request) =>
        request.pipe(
          HttpClientRequest.prependUrl(baseUrl),
          HttpClientRequest.bearerToken(options.apiKey),
          HttpClientRequest.acceptJson,
        ),
      ),
    );

    const httpClientOk = HttpClient.filterStatusOk(httpClient);

    // -- helpers --

    const toApiError = (method: string, err: unknown): VeniceApiError => {
      const e = err as any;
      // ResponseError from @effect/platform has a response property
      if (e._tag === "ResponseError") {
        return new VeniceApiError({
          message: `${method} response error (${e.response?.status ?? "unknown"}): ${e.message ?? e}`,
          status: e.response?.status ?? 0,
          body: e.message,
        });
      }
      if (e._tag === "RequestError") {
        return new VeniceApiError({
          message: `${method} request error: ${e.message ?? e}`,
          status: 0,
          body: String(e),
        });
      }
      // ParseError
      return new VeniceApiError({
        message: `${method} error: ${e.message ?? e}`,
        status: 0,
        body: String(e),
      });
    };

    // -- endpoints --

    const listModels = (): Effect.Effect<ModelList, VeniceApiError> =>
      httpClientOk.get("/models").pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelList)),
        Effect.scoped,
        Effect.mapError((err) => toApiError("listModels", err)),
      );

    const getAttestation = (
      model: string,
    ): Effect.Effect<Attestation, VeniceApiError> =>
      httpClientOk
        .get("/tee/attestation", {
          urlParams: { model },
        })
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Attestation)),
          Effect.scoped,
          Effect.mapError((err) => toApiError("getAttestation", err)),
        );

    const streamChatCompletion = (
      request: ChatCompletionRequest,
      extraHeaders?: Record<string, string>,
    ): Effect.Effect<
      ReadableStream<Uint8Array>,
      VeniceApiError,
      Scope.Scope
    > => {
      const bodyPayload = {
        model: request.model,
        messages: request.messages,
        stream: true as const,
        ...(request.max_tokens !== undefined && {
          max_tokens: request.max_tokens,
        }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
      };

      const req = HttpClientRequest.post("/chat/completions", {
        body: HttpBody.unsafeJson(bodyPayload),
        headers: extraHeaders ?? {},
      });

      return httpClientOk.execute(req).pipe(
        Effect.map((response) => response.stream),
        // Convert the Effect Stream<Uint8Array> to a ReadableStream
        Effect.flatMap((effectStream) =>
          Effect.sync(() => {
            return new ReadableStream<Uint8Array>({
              start(controller) {
                const fiber = Effect.runFork(
                  Stream.runForEach(effectStream, (chunk) =>
                    Effect.sync(() => {
                      controller.enqueue(chunk);
                    }),
                  ).pipe(
                    Effect.tap(() => Effect.sync(() => controller.close())),
                    Effect.catchAll((err) =>
                      Effect.sync(() => controller.error(err)),
                    ),
                  ),
                );
                void fiber;
              },
            });
          }),
        ),
        Effect.mapError((err) => toApiError("streamChatCompletion", err)),
      );
    };

    return VeniceApi.of({
      listModels,
      getAttestation,
      streamChatCompletion,
    });
  });

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * Layer providing VeniceApi from VeniceConfig + HttpClient.
 *
 * Import VeniceConfig from client.ts for the configuration shape.
 */
export const layer = (options: {
  readonly apiKey: string;
  readonly baseUrl?: string;
}): Layer.Layer<VeniceApi, never, HttpClient.HttpClient> =>
  Layer.scoped(VeniceApi, make(options));
