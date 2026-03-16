/**
 * errors.ts -- Typed errors for the Venice E2EE client.
 *
 * These are plain tagged classes following the Effect convention.
 * The provider layer maps them into @effect/ai AiError types.
 */

import { Data } from "effect";

/** Attestation endpoint returned an error or was unreachable. */
export class VeniceAttestationError extends Data.TaggedError(
  "VeniceAttestationError",
)<{
  readonly message: string;
  readonly status?: number;
}> {}

/** Encryption or decryption failure. */
export class VeniceCryptoError extends Data.TaggedError("VeniceCryptoError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Chat completions API returned an HTTP error. */
export class VeniceApiError extends Data.TaggedError("VeniceApiError")<{
  readonly message: string;
  readonly status: number;
  readonly body?: string;
}> {}

/** General Venice error (no body, missing reader, etc.). */
export class VeniceStreamError extends Data.TaggedError("VeniceStreamError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Attempted non-streaming (buffered) generation with E2EE enabled.
 *  Venice only supports streaming for E2EE models. */
export class VeniceE2EEStreamingRequired extends Data.TaggedError(
  "VeniceE2EEStreamingRequired",
)<{
  readonly message: string;
}> {}
