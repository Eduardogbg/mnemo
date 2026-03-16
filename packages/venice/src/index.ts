/**
 * @mnemo/venice -- Venice E2EE client and @effect/ai provider.
 *
 * Fully Effect-native. Public API surface:
 *   - VeniceClient: Effect service for attestation, session, streaming
 *   - VeniceProvider: @effect/ai LanguageModel provider (layer + model)
 *   - VeniceConfig: configuration service tag (yield* VeniceConfig)
 *   - Crypto primitives for testing / advanced use
 *
 * Tool calling: Use @effect/ai's Tool.make() + Toolkit.make() + toolkit.toLayer().
 * The Venice provider handles prompt-based tool serialization internally.
 */

// -- Typed HTTP layer (Effect services)
export {
  VeniceApi,
  Attestation,
  ChatCompletionChunk,
  ChatCompletionChoice,
  ChatCompletionDelta,
  Model,
  ModelList,
} from "./api.js";
export type {
  VeniceApiService,
  ChatCompletionRequest,
} from "./api.js";

// -- Client (Effect services)
export {
  VeniceClient,
  VeniceClientLive,
  VeniceClientFull,
  VeniceConfig,
} from "./client.js";
export type {
  AttestationResponse,
  ChatMessage,
  ChatRequestOptions,
  E2EESession,
  EncryptionMode,
  StreamChunk,
  VeniceClientService,
  VeniceConfigShape,
} from "./client.js";

// -- Provider (Effect LanguageModel layer)
export * as VeniceProvider from "./provider.js";

// -- Crypto primitives
export {
  genKeyPair,
  deriveKey,
  encryptMessage,
  decryptChunk,
  isEncryptedChunk,
  normalizeServerKey,
} from "./crypto.js";
export type { KeyPair } from "./crypto.js";

// -- Errors
export {
  VeniceAttestationError,
  VeniceCryptoError,
  VeniceApiError,
  VeniceStreamError,
  VeniceE2EEStreamingRequired,
} from "./errors.js";
