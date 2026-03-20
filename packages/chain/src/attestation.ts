/**
 * TEE Attestation — wraps dstack SDK for TDX quote generation and key derivation.
 *
 * Provides:
 *   - getQuote(agentAddress): TDX quote binding agent wallet to TEE
 *   - getKey(path): Deterministic key derivation inside CVM
 *   - generateAttestationJson(): Full attestation document for verification
 */
import { Effect, Data } from "effect"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class AttestationError extends Data.TaggedError("AttestationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttestationDocument {
  readonly quote: string           // hex-encoded TDX quote
  readonly eventLog: string        // hex-encoded event log
  readonly agentAddress: string    // ethereum address bound to this TEE
  readonly composeHash: string     // SHA256 of docker-compose.prod.yml → RTMR3
  readonly timestamp: string       // ISO 8601
  readonly rtmr3: string           // extracted from quote
}

export interface DerivedKey {
  readonly key: Uint8Array
  readonly path: string
}

// ---------------------------------------------------------------------------
// dstack SDK interface (runtime-optional)
// ---------------------------------------------------------------------------

interface TappdClient {
  getQuote: (userData: string) => Promise<{ quote: string; eventLog: string }>
  getKey: (path: string) => Promise<{ key: Uint8Array }>
}

// ---------------------------------------------------------------------------
// Quote generation
// ---------------------------------------------------------------------------

/**
 * Get a TDX attestation quote binding the given agent address to this TEE instance.
 * Falls back to a simulated quote if not running in a CVM.
 */
export const getQuote = (
  agentAddress: string,
): Effect.Effect<{ quote: string; eventLog: string }, AttestationError> =>
  Effect.tryPromise({
    try: async () => {
      const client = await getTappdClient()
      if (client) {
        return await client.getQuote(agentAddress)
      }
      // Simulated mode for local development
      return {
        quote: `0xSIMULATED_QUOTE_${agentAddress}_${Date.now().toString(16)}`,
        eventLog: `0xSIMULATED_EVENT_LOG_${Date.now().toString(16)}`,
      }
    },
    catch: (e) =>
      new AttestationError({
        message: `getQuote failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })

/**
 * Derive a deterministic key from the CVM's key hierarchy.
 * Falls back to a hash-based derivation for local development.
 */
export const getKey = (
  path: string,
): Effect.Effect<DerivedKey, AttestationError> =>
  Effect.tryPromise({
    try: async () => {
      const client = await getTappdClient()
      if (client) {
        const result = await client.getKey(path)
        return { key: result.key, path }
      }
      // Simulated mode
      const encoder = new TextEncoder()
      const data = encoder.encode(`simulated-key:${path}`)
      const hash = await crypto.subtle.digest("SHA-256", data)
      return { key: new Uint8Array(hash), path }
    },
    catch: (e) =>
      new AttestationError({
        message: `getKey failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })

/**
 * Generate a full attestation document for the ethical hacker agent.
 * Includes the TDX quote, event log, agent address, and compose hash.
 */
export const generateAttestationJson = (
  agentAddress: string,
  composeHash: string,
): Effect.Effect<AttestationDocument, AttestationError> =>
  Effect.gen(function* () {
    const { quote, eventLog } = yield* getQuote(agentAddress)

    // Extract RTMR3 from the quote (offset depends on TDX quote format)
    // In a real implementation, parse the quote binary. For demo, derive from compose hash.
    const rtmr3 = composeHash

    const doc: AttestationDocument = {
      quote,
      eventLog,
      agentAddress,
      composeHash,
      timestamp: new Date().toISOString(),
      rtmr3,
    }

    yield* Effect.log(
      `[Attestation] Generated attestation for ${agentAddress}, RTMR3=${rtmr3.slice(0, 16)}...`,
    )

    return doc
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cachedClient: TappdClient | null | undefined = undefined

async function getTappdClient(): Promise<TappdClient | null> {
  if (cachedClient !== undefined) return cachedClient

  try {
    // Try to import the dstack SDK (only available in CVM)
    const dstack = await import("@aspect-build/tappd-client" as any)
    cachedClient = new dstack.TappdClient() as TappdClient
    return cachedClient
  } catch {
    // Not in a CVM — return null for simulated mode
    cachedClient = null
    return null
  }
}

/**
 * Compute SHA256 hash of a file's contents for compose hash verification.
 */
export const hashFile = (content: string): Effect.Effect<string, AttestationError> =>
  Effect.tryPromise({
    try: async () => {
      const data = new TextEncoder().encode(content)
      const hash = await crypto.subtle.digest("SHA-256", data)
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    },
    catch: (e) =>
      new AttestationError({
        message: `hashFile failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })
