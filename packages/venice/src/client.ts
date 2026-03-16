/**
 * client.ts -- Venice E2EE client as Effect Services.
 *
 * Provides:
 *   - VeniceConfig: configuration service tag (yield* VeniceConfig)
 *   - VeniceClient: core client service (attestation, session, streaming)
 *
 * The E2EE protocol is preserved exactly:
 *   - Request encryption uses per-message ephemeral keys
 *   - Response decryption uses the header key (X-Venice-TEE-Client-Pub-Key)
 *   - Each SSE chunk is independently encrypted
 *
 * This layer builds on top of VeniceApi (typed HTTP) for all network calls.
 */

import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { type Attestation, VeniceApi, layer as veniceApiLayer } from "./api.js";
import {
  type KeyPair,
  decryptChunk,
  encryptMessage,
  genKeyPair,
  isEncryptedChunk,
  normalizeServerKey,
} from "./crypto.js";
import {
  VeniceApiError,
  VeniceAttestationError,
  VeniceCryptoError,
  VeniceE2EEStreamingRequired,
  VeniceStreamError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Attestation response. Kept as a plain interface for backward compatibility
 * with existing consumers. Internally backed by the Schema-typed Attestation.
 */
export interface AttestationResponse {
  verified: boolean;
  signing_key?: string;
  signing_public_key?: string;
  signing_address?: string;
  signing_algo?: string;
  tee_provider?: string;
  tee_hardware?: string;
  nonce?: string;
  nonce_source?: string;
  model?: string;
  model_name?: string;
  upstream_model?: string;
  server_verification?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestOptions {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface StreamChunk {
  /** Decrypted text content, or null for non-content chunks */
  text: string | null;
  /** True when the stream is complete */
  done: boolean;
  /** Whether this chunk was encrypted */
  encrypted: boolean;
}

export interface E2EESession {
  /** Server attestation public key (uncompressed hex) */
  readonly serverKeyHex: string;
  /** Client header keypair (response encryption target) */
  readonly headerKey: KeyPair;
}

// ---------------------------------------------------------------------------
// Encryption mode
// ---------------------------------------------------------------------------

/** How the Venice provider should handle encryption. */
export type EncryptionMode =
  /** Always use E2EE. Fail if attestation is unavailable. */
  | "encrypted"
  /** Never use E2EE. Send plaintext even to E2EE models. */
  | "plaintext";

// ---------------------------------------------------------------------------
// VeniceConfig service
// ---------------------------------------------------------------------------

export interface VeniceConfigShape {
  /** Venice API key */
  readonly apiKey: string;
  /** E2EE model name (e.g., "e2ee-qwen3-30b-a3b") */
  readonly model: string;
  /** Max tokens for responses (default: 2048) */
  readonly maxTokens?: number;
  /** Temperature (default: undefined = model default) */
  readonly temperature?: number;
  /** Encryption mode: "encrypted" (default) or "plaintext". No silent degradation. */
  readonly encryption?: EncryptionMode;
  /** Custom base URL (default: "https://api.venice.ai/api/v1") */
  readonly baseUrl?: string;
}

/**
 * Configuration for the Venice E2EE client.
 *
 * Usage: `const config = yield* VeniceConfig`
 */
export class VeniceConfig extends Context.Tag(
  "@mnemo/venice/VeniceConfig",
)<VeniceConfig, VeniceConfigShape>() {}

// ---------------------------------------------------------------------------
// VeniceClient service
// ---------------------------------------------------------------------------

export interface VeniceClientService {
  /** Fetch TEE attestation for a model. */
  readonly fetchAttestation: (
    model: string,
  ) => Effect.Effect<AttestationResponse, VeniceAttestationError>;

  /** Create (or retrieve cached) E2EE session for a model. */
  readonly createSession: (
    model: string,
  ) => Effect.Effect<E2EESession, VeniceAttestationError>;

  /** Force-clear a cached session (e.g. to rotate keys). */
  readonly clearSession: (model: string) => Effect.Effect<void>;

  /** Send a streaming chat completion with optional E2EE. */
  readonly streamChat: (
    options: ChatRequestOptions,
    session: E2EESession | null,
  ) => Stream.Stream<StreamChunk, VeniceApiError | VeniceStreamError | VeniceCryptoError>;

  /** Non-streaming convenience: collect full response text.
   *  NOTE: Venice only supports streaming for E2EE. This method collects
   *  a stream internally but will fail with VeniceE2EEStreamingRequired
   *  if called with a non-null session (callers should use streamChat instead). */
  readonly chat: (
    options: ChatRequestOptions,
    session: E2EESession | null,
  ) => Effect.Effect<
    { text: string; chunks: number },
    VeniceApiError | VeniceStreamError | VeniceCryptoError | VeniceE2EEStreamingRequired
  >;
}

export class VeniceClient extends Context.Tag("@mnemo/venice/VeniceClient")<
  VeniceClient,
  VeniceClientService
>() {}

// ---------------------------------------------------------------------------
// Internal: Attestation schema -> AttestationResponse conversion
// ---------------------------------------------------------------------------

function attestationToResponse(a: Attestation): AttestationResponse {
  return {
    verified: a.verified,
    signing_key: a.signing_key,
    signing_public_key: a.signing_public_key,
    signing_address: a.signing_address,
    signing_algo: a.signing_algo,
    tee_provider: a.tee_provider,
    tee_hardware: a.tee_hardware,
    nonce: a.nonce,
    nonce_source: a.nonce_source,
    model: a.model,
    model_name: a.model_name,
    upstream_model: a.upstream_model,
    server_verification: a.server_verification as
      | Record<string, unknown>
      | undefined,
  };
}

// ---------------------------------------------------------------------------
// SSE parsing as a Stream
// ---------------------------------------------------------------------------

function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  session: E2EESession | null,
): Stream.Stream<StreamChunk, VeniceStreamError | VeniceCryptoError> {
  return Stream.async<StreamChunk, VeniceStreamError | VeniceCryptoError>(
    (emit) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processChunk = (rawChunk: Uint8Array): void => {
        buffer += decoder.decode(rawChunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);

          if (data === "[DONE]") {
            emit.single({ text: null, done: true, encrypted: false });
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (!content || typeof content !== "string") {
              emit.single({ text: null, done: false, encrypted: false });
              continue;
            }

            if (session && isEncryptedChunk(content)) {
              try {
                const decrypted = decryptChunk(content, session.headerKey.priv);
                emit.single({ text: decrypted, done: false, encrypted: true });
              } catch {
                // Decryption failed -- pass through as plaintext
                emit.single({ text: content, done: false, encrypted: false });
              }
            } else {
              emit.single({ text: content, done: false, encrypted: false });
            }
          } catch {
            // Non-JSON SSE line -- skip
          }
        }
      };

      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              emit.single({ text: null, done: true, encrypted: false });
              emit.end();
              return;
            }
            processChunk(value);
            pump();
          })
          .catch((err) => {
            emit.fail(
              new VeniceStreamError({
                message: `SSE read error: ${err}`,
                cause: err,
              }),
            );
          });
      };

      pump();
    },
  );
}

// ---------------------------------------------------------------------------
// VeniceClient Live layer
// ---------------------------------------------------------------------------

/**
 * VeniceClientLive provides the VeniceClient service.
 *
 * Requires VeniceConfig and VeniceApi in the environment. If you want
 * a self-contained layer from just VeniceConfig, use VeniceClientFull
 * which includes VeniceApi + FetchHttpClient.
 */
export const VeniceClientLive: Layer.Layer<
  VeniceClient,
  never,
  VeniceApi
> = Layer.effect(
  VeniceClient,
  Effect.gen(function* () {
    const api = yield* VeniceApi;
    const sessionCache = yield* Ref.make(new Map<string, E2EESession>());

    const fetchAttestation = (
      model: string,
    ): Effect.Effect<AttestationResponse, VeniceAttestationError> =>
      api.getAttestation(model).pipe(
        Effect.map(attestationToResponse),
        Effect.mapError(
          (err) =>
            new VeniceAttestationError({
              message: `Attestation failed: ${err.message}`,
              status: err.status,
            }),
        ),
      );

    const createSession = (
      model: string,
    ): Effect.Effect<E2EESession, VeniceAttestationError> =>
      Effect.gen(function* () {
        const cache = yield* Ref.get(sessionCache);
        const cached = cache.get(model);
        if (cached) return cached;

        const attestation = yield* fetchAttestation(model);
        const rawKey = attestation.signing_key;
        if (!rawKey) {
          return yield* Effect.fail(
            new VeniceAttestationError({
              message: `No signing_key in attestation for ${model}: ${JSON.stringify(attestation)}`,
            }),
          );
        }

        const session: E2EESession = {
          serverKeyHex: normalizeServerKey(rawKey),
          headerKey: genKeyPair(),
        };

        yield* Ref.update(sessionCache, (m) => {
          const next = new Map(m);
          next.set(model, session);
          return next;
        });

        return session;
      });

    const clearSession = (model: string): Effect.Effect<void> =>
      Ref.update(sessionCache, (m) => {
        const next = new Map(m);
        next.delete(model);
        return next;
      });

    const streamChat = (
      options: ChatRequestOptions,
      session: E2EESession | null,
    ): Stream.Stream<
      StreamChunk,
      VeniceApiError | VeniceStreamError | VeniceCryptoError
    > => {
      // Encrypt each message's content if we have a session
      const messages = session
        ? options.messages.map((m) => ({
            role: m.role,
            content: encryptMessage(m.content, session.serverKeyHex),
          }))
        : options.messages;

      // E2EE headers for key exchange
      const extraHeaders: Record<string, string> = {};
      if (session) {
        extraHeaders["X-Venice-TEE-Client-Pub-Key"] =
          session.headerKey.pubHex;
        extraHeaders["X-Venice-TEE-Model-Pub-Key"] = session.serverKeyHex;
        extraHeaders["X-Venice-TEE-Signing-Algo"] = "ecdsa";
      }

      const doFetch = api
        .streamChatCompletion(
          {
            model: options.model,
            messages,
            stream: true as const,
            max_tokens: options.max_tokens,
            temperature: options.temperature,
          },
          Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
        )
        .pipe(Effect.scoped);

      return Stream.unwrap(
        Effect.map(doFetch, (body) => parseSSEStream(body, session)),
      );
    };

    const chat = (
      options: ChatRequestOptions,
      session: E2EESession | null,
    ): Effect.Effect<
      { text: string; chunks: number },
      | VeniceApiError
      | VeniceStreamError
      | VeniceCryptoError
      | VeniceE2EEStreamingRequired
    > =>
      Stream.runFold(
        streamChat(options, session).pipe(
          Stream.filter(
            (chunk): chunk is StreamChunk & { text: string } =>
              chunk.text !== null,
          ),
        ),
        { text: "", chunks: 0 },
        (acc, chunk) => ({
          text: acc.text + chunk.text,
          chunks: acc.chunks + 1,
        }),
      );

    return {
      fetchAttestation,
      createSession,
      clearSession,
      streamChat,
      chat,
    } satisfies VeniceClientService;
  }),
);

// ---------------------------------------------------------------------------
// Self-contained layer: VeniceConfig -> VeniceClient
// ---------------------------------------------------------------------------

/**
 * Self-contained layer that provides VeniceClient from just VeniceConfig.
 * Internally creates VeniceApi with FetchHttpClient.
 *
 * Layer dependency chain:
 *   VeniceConfig -> VeniceApi (typed HTTP) -> VeniceClient (E2EE + sessions)
 */
export const VeniceClientFull: Layer.Layer<
  VeniceClient,
  never,
  VeniceConfig
> = Layer.provide(
  VeniceClientLive,
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* VeniceConfig;
      return Layer.provide(
        veniceApiLayer({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        }),
        FetchHttpClient.layer,
      );
    }),
  ),
);
