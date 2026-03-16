# Venice E2EE + @effect/ai Integration Research

**Date:** 2026-03-15
**Status:** Research complete — integration is feasible but requires a custom provider, not a simple adapter.

## TL;DR

Venice E2EE **cannot** use @effect/ai's OpenAI provider directly. The E2EE protocol requires:
- Encrypting user message content client-side (AES-256-GCM)
- ECDH key exchange with the TEE enclave
- Custom HTTP headers on every request
- Streaming-only responses with client-side chunk decryption
- **No tool calling / function calling support**

The best integration path is a **custom `LanguageModel` provider** that implements
`LanguageModel.ConstructorParams` (`generateText` + `streamText`) directly, handling
all crypto internally. This bypasses the OpenAI client entirely.

---

## 1. Venice E2EE Protocol Flow

Source: [Venice TEE/E2EE Guide](https://docs.venice.ai/overview/guides/tee-e2ee-models)

### Step-by-step:

1. **Fetch attestation** — GET `/api/v1/tee/attestation?model=e2ee-<model>&nonce=<random>`
   - Returns `signing_key` (model's secp256k1 public key) + TEE attestation proof
   - Nonce is 16 random bytes, hex-encoded

2. **Generate ephemeral ECDH key pair** — secp256k1 curve
   - Client generates a fresh key pair per session
   - Public key is hex-encoded for transmission

3. **Derive shared secret** — ECDH + HKDF
   - ECDH between client private key and model public key
   - HKDF to stretch to 32-byte AES key
   - HKDF params: not fully documented; likely SHA-256, empty salt, empty info (standard ECIES pattern)

4. **Encrypt user message** — AES-256-GCM
   - 12-byte random nonce
   - Plaintext: UTF-8 encoded user message content (just the `content` field, not the full request)
   - No AAD (associated data is `None`)
   - Output format: `<nonce:12 bytes><ciphertext><tag:16 bytes>` — all hex-encoded
   - Only user message content is encrypted; model name, stream flag, etc. are plaintext

5. **Send request** — POST `/api/v1/chat/completions`
   - Standard OpenAI-compatible body with `stream: true` (required)
   - `messages[].content` contains hex-encoded ciphertext
   - Three custom headers:
     - `X-Venice-TEE-Client-Pub-Key`: client ephemeral public key (hex)
     - `X-Venice-TEE-Signing-Algo`: `ecdsa`
     - `X-Venice-TEE-Model-Pub-Key`: model's public key from attestation

6. **Decrypt streaming response** — SSE stream, each chunk's `delta.content` is hex-encoded ciphertext
   - Same format: `<nonce:12><ciphertext><tag:16>` hex
   - Decrypt each chunk independently with shared secret
   - Concatenate plaintext chunks for full response

### Critical constraints:
- **Streaming required** — non-streaming requests are not supported
- **No tool calling** — function/tool calling is explicitly unsupported with E2EE models
- **No web search, file uploads, or Venice system prompts** — all disabled due to encryption
- **Model prefix:** E2EE models use `e2ee-` prefix (e.g., `e2ee-qwen3-30b-a3b`)

---

## 2. @effect/ai Provider Architecture

Source: Reading the actual source at `repos/effect/packages/ai/`

### Core abstraction: `LanguageModel.ConstructorParams`

The `LanguageModel.make()` function accepts two methods:

```typescript
interface ConstructorParams {
  readonly generateText: (options: ProviderOptions) => Effect.Effect<
    Array<Response.PartEncoded>,
    AiError.AiError,
    IdGenerator
  >
  readonly streamText: (options: ProviderOptions) => Stream.Stream<
    Response.StreamPartEncoded,
    AiError.AiError,
    IdGenerator
  >
}
```

`ProviderOptions` provides:
- `prompt: Prompt.Prompt` — normalized prompt messages
- `tools: ReadonlyArray<Tool.Any>` — tool definitions
- `toolChoice: ToolChoice` — tool selection mode
- `responseFormat: { type: "text" } | { type: "json", objectName, schema }` — output format
- `span: Span` — tracing span

### How the OpenAI provider works

File: `packages/ai/openai/src/OpenAiLanguageModel.ts`

1. `OpenAiLanguageModel.make()` is called with `{ model, config? }`
2. It yields the `OpenAiClient` service from context
3. Constructs a `makeRequest` function that converts `ProviderOptions` -> OpenAI API request format
4. Passes `generateText` and `streamText` implementations to `LanguageModel.make()`
5. `generateText` calls `client.createResponse(request)` then `makeResponse()` to convert back
6. `streamText` calls `client.createResponseStream(request)` then `makeStreamResponse()` to decode SSE events

### How the OpenAI client handles HTTP

File: `packages/ai/openai/src/OpenAiClient.ts`

- Uses `@effect/platform/HttpClient` for HTTP
- `make()` accepts `transformClient?: (client: HttpClient) => HttpClient` — can intercept/modify the HTTP client
- Base URL is configurable via `apiUrl` parameter
- `streamRequest()` decodes SSE via `@effect/experimental/Sse.makeChannel()`

### The Model wrapper

File: `packages/ai/ai/src/Model.ts`

- `AiModel.make(provider, layer)` wraps a Layer into a Model that can be used as both Layer and Effect
- Provider name is tracked for telemetry

### Key observations:

- The `LanguageModel.make()` constructor handles **all** tool call resolution, structured output parsing, and tracing automatically
- Provider implementations only need to handle raw request/response conversion
- `generateText` returns `Array<Response.PartEncoded>` (text parts, tool-call parts, finish parts)
- `streamText` returns `Stream<Response.StreamPartEncoded>` (text-delta, tool-call-delta, finish, etc.)
- The framework handles schema decoding of response parts using Effect Schema

---

## 3. Compatibility Assessment

### What works:
- Venice E2EE uses `/api/v1/chat/completions` — same as OpenAI
- Response format is SSE with `delta.content` — same streaming protocol
- `@effect/ai` has a clean provider abstraction that doesn't assume OpenAI-specific behavior
- `@effect/platform/HttpClient` supports custom headers and request transforms

### What breaks:
| Issue | Severity | Detail |
|-------|----------|--------|
| **Encrypted request body** | Critical | Message content must be AES-256-GCM encrypted before serialization. The OpenAI client serializes messages as-is. |
| **Encrypted response chunks** | Critical | Each SSE chunk's `delta.content` is hex-encoded ciphertext. Must decrypt before the framework can parse it. |
| **No tool calling** | Blocking for agent use | E2EE models cannot use function calling. `@effect/ai`'s tool resolution loop would never trigger, but tool definitions would cause API errors if sent. |
| **Streaming-only** | Moderate | `generateText` must be implemented via streaming + collection. No non-streaming endpoint. |
| **Custom headers per-request** | Moderate | Need ECDH key material in headers. The `transformClient` hook on `OpenAiClient` can add static headers but the E2EE headers include per-session ephemeral keys. |
| **Attestation step** | Minor | Need a pre-request step to fetch model public key. Can be cached per model per session. |

### Verdict: **Cannot use @effect/ai-openai directly.**

The OpenAI provider converts prompts to OpenAI API messages, sends them as JSON, and parses the response. E2EE requires an encryption step between prompt conversion and HTTP send, and a decryption step between HTTP receive and response parsing. These are not available as hooks in the OpenAI provider.

The `transformClient` on `OpenAiClient` operates at the HTTP layer (modifying the `HttpClient`) but cannot encrypt/decrypt message content within the JSON body — it would need to parse the body, encrypt the content field, re-serialize, then reverse on response. This is possible but fragile and couples to internal body structure.

---

## 4. Recommended Integration Approach

### Approach: Custom `LanguageModel` provider (best option)

Build a `VeniceE2eeLanguageModel` that implements `LanguageModel.ConstructorParams` directly,
using `@effect/platform/HttpClient` for HTTP and Node.js `crypto` for ECDH/AES-GCM.

This is the same pattern used by `@effect/ai-anthropic` — it implements the provider interface
without reusing the OpenAI client at all.

### Architecture:

```
VeniceE2eeClient (Effect Service)
  ├── attestation cache (per model)
  ├── ECDH session key management
  ├── encrypt(plaintext) → hex ciphertext
  └── decrypt(hex ciphertext) → plaintext

VeniceE2eeLanguageModel
  ├── generateText (collects stream internally)
  ├── streamText (SSE → decrypt each chunk → emit StreamPartEncoded)
  └── uses VeniceE2eeClient for crypto + HTTP
```

### Why not other approaches:

- **Adapter wrapping OpenAI provider**: The encryption must happen inside the request pipeline,
  not before or after. Wrapping would require re-parsing and is more complex than a direct implementation.
- **Fork @effect/ai-openai**: Maintenance burden, diverges from upstream.
- **transformClient hack**: Would need to parse JSON body from the already-serialized HttpBody,
  find message content fields, encrypt them, re-serialize. On response, would need to intercept
  the SSE stream, parse each event, decrypt content fields, re-serialize. This is possible but
  extremely fragile and harder to maintain than a clean custom provider.

---

## 5. Code Sketch: Venice E2EE Provider

### VeniceE2eeClient (crypto + HTTP)

```typescript
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as HttpBody from "@effect/platform/HttpBody"
import * as Redacted from "effect/Redacted"
import * as crypto from "node:crypto"

// --- Crypto primitives ---

interface E2eeSession {
  readonly clientPrivateKey: crypto.KeyObject
  readonly clientPublicKeyHex: string
  readonly modelPublicKeyHex: string
  readonly sharedSecret: Uint8Array  // 32 bytes after HKDF
}

const generateEcdhKeyPair = Effect.sync(() => {
  const ecdh = crypto.createECDH("secp256k1")
  ecdh.generateKeys()
  return {
    privateKey: ecdh,
    publicKeyHex: ecdh.getPublicKey("hex")
  }
})

const deriveSharedSecret = (
  ecdh: crypto.ECDH,
  modelPubKeyHex: string
): Effect.Effect<Uint8Array> =>
  Effect.sync(() => {
    const rawSecret = ecdh.computeSecret(
      Buffer.from(modelPubKeyHex, "hex")
    )
    // HKDF stretch to 32 bytes for AES-256
    return crypto.hkdfSync("sha256", rawSecret, Buffer.alloc(0), Buffer.alloc(0), 32)
  }).pipe(Effect.map((ab) => new Uint8Array(ab)))

const encrypt = (plaintext: string, sharedSecret: Uint8Array): string => {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    sharedSecret,
    nonce
  )
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  // Format: nonce + ciphertext + tag, all hex
  return Buffer.concat([nonce, encrypted, tag]).toString("hex")
}

const decrypt = (hexCiphertext: string, sharedSecret: Uint8Array): string => {
  const data = Buffer.from(hexCiphertext, "hex")
  const nonce = data.subarray(0, 12)
  const tag = data.subarray(data.length - 16)
  const ciphertext = data.subarray(12, data.length - 16)
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    sharedSecret,
    nonce
  )
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8")
}

// --- Venice E2EE Client Service ---

interface VeniceE2eeClientService {
  readonly createE2eeSession: (
    model: string
  ) => Effect.Effect<E2eeSession, AiError.AiError>

  readonly streamChatCompletion: (
    session: E2eeSession,
    model: string,
    encryptedMessages: Array<{ role: string; content: string }>
  ) => Stream.Stream<string, AiError.AiError>  // yields decrypted text chunks
}

class VeniceE2eeClient extends Context.Tag("VeniceE2eeClient")<
  VeniceE2eeClient,
  VeniceE2eeClientService
>() {}
```

### VeniceE2eeLanguageModel (provider implementation)

```typescript
import * as LanguageModel from "@effect/ai/LanguageModel"
import * as Response from "@effect/ai/Response"
import * as AiModel from "@effect/ai/Model"
import * as AiError from "@effect/ai/AiError"

const make = Effect.gen(function*() {
  const e2eeClient = yield* VeniceE2eeClient

  // Cache sessions per model
  const sessions = new Map<string, E2eeSession>()

  const getSession = (model: string) =>
    sessions.has(model)
      ? Effect.succeed(sessions.get(model)!)
      : e2eeClient.createE2eeSession(model).pipe(
          Effect.tap((s) => Effect.sync(() => sessions.set(model, s)))
        )

  const modelId = "e2ee-qwen3-30b-a3b"  // or parameterize

  return yield* LanguageModel.make({
    generateText: (options) =>
      Effect.gen(function*() {
        const session = yield* getSession(modelId)

        // Convert prompt to messages, encrypt user content
        const messages = options.prompt.content.map((msg) => {
          if (msg.role === "user") {
            const text = msg.content
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("")
            return { role: "user", content: encrypt(text, session.sharedSecret) }
          }
          // System/assistant messages — encrypt too? TBD by Venice's spec
          return { role: msg.role, content: "..." }
        })

        // Collect stream into full response
        let fullText = ""
        const stream = e2eeClient.streamChatCompletion(session, modelId, messages)
        yield* Stream.runForEach(stream, (chunk) =>
          Effect.sync(() => { fullText += chunk })
        )

        const parts: Array<Response.PartEncoded> = [
          { type: "text", text: fullText },
          {
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
              reasoningTokens: undefined,
              cachedInputTokens: undefined
            }
          }
        ]
        return parts
      }),

    streamText: (options) =>
      Stream.unwrap(
        Effect.gen(function*() {
          const session = yield* getSession(modelId)

          const messages = options.prompt.content.map((msg) => {
            if (msg.role === "user") {
              const text = msg.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("")
              return { role: "user", content: encrypt(text, session.sharedSecret) }
            }
            return { role: msg.role, content: "..." }
          })

          return e2eeClient.streamChatCompletion(session, modelId, messages).pipe(
            Stream.map((chunk): Response.StreamPartEncoded => ({
              type: "text-delta",
              delta: chunk
            })),
            Stream.concat(Stream.make({
              type: "finish" as const,
              reason: "stop" as const,
              usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
                reasoningTokens: undefined,
                cachedInputTokens: undefined
              }
            }))
          )
        })
      )
  })
})

// Layer + Model
const VeniceE2eeLayer: Layer.Layer<LanguageModel.LanguageModel, never, VeniceE2eeClient> =
  Layer.effect(LanguageModel.LanguageModel, make)

const veniceE2eeModel = AiModel.make("venice-e2ee", VeniceE2eeLayer)
```

### Usage

```typescript
import { Effect, Stream } from "effect"
import { LanguageModel } from "@effect/ai"

const program = Effect.gen(function*() {
  // generateText works (collects stream internally)
  const response = yield* LanguageModel.generateText({
    prompt: "What is a TEE?"
    // No toolkit — tool calling not supported with E2EE
  })
  console.log(response.text)
})

// Provide the Venice E2EE model
const runnable = program.pipe(
  Effect.provide(veniceE2eeModel),
  Effect.provide(VeniceE2eeClientLive),  // provides VeniceE2eeClient
  Effect.provide(HttpClientLive)          // provides HttpClient
)
```

---

## 6. Key Questions Answered

### Can we use @effect/ai's provider abstraction with Venice E2EE?
**Yes, but not the OpenAI provider.** We must implement `LanguageModel.ConstructorParams` directly.
The abstraction is clean — just two functions (`generateText`, `streamText`) that map
`ProviderOptions` to response parts. The framework handles tool resolution, schema parsing,
and tracing automatically.

### What does the E2EE handshake look like?
1. Fetch `/api/v1/tee/attestation?model=e2ee-xxx&nonce=<random>` → get `signing_key` (model public key)
2. Generate ephemeral secp256k1 key pair
3. ECDH compute shared secret → HKDF → 32-byte AES key
4. Encrypt each user message with AES-256-GCM
5. Send with custom headers (`X-Venice-TEE-Client-Pub-Key`, `X-Venice-TEE-Signing-Algo`, `X-Venice-TEE-Model-Pub-Key`)

### Does E2EE work with tool calling?
**No.** Venice explicitly disables function calling for E2EE models. This means the Mnemo harness
cannot use Venice E2EE for agentic tool-calling workflows. E2EE is suitable for **simple
text generation** only.

### Does E2EE work with non-streaming?
**No.** Streaming is required. The `generateText` method must be implemented by collecting
the stream internally.

### Can we wrap Venice E2EE as an Effect Layer?
**Yes.** The code sketch above shows exactly how. `VeniceE2eeClient` is an Effect service
that handles crypto and HTTP. `VeniceE2eeLanguageModel` implements the `LanguageModel`
provider interface using that service. Both are exposed as Layers.

### How does @effect/ai handle custom HTTP headers?
The `OpenAiClient.make()` accepts `transformClient` which wraps the `HttpClient`. Custom
headers can be added via `HttpClient.mapRequest(HttpClientRequest.setHeader(...))`. However,
for E2EE we bypass the OpenAI client entirely, so we set headers directly on our HTTP requests.

---

## 7. Implications for Mnemo

### E2EE is not suitable for the Mnemo negotiation protocol.

The Mnemo harness requires:
- **Tool calling** — agents need to call protocol tools (openScope, reveal, closeScope, etc.)
- **Structured output** — `generateObject` for parsing agent decisions
- **Multi-turn conversations** — maintaining encrypted conversation state across turns is complex

Venice E2EE disables tool calling entirely, which is a dealbreaker for the agent runtime.

### Recommended approach for Mnemo:

| Use case | Provider |
|----------|----------|
| **Agent runtime (tool calling, structured output)** | Redpill (GPU-TEE, OpenAI-compatible, supports tools) |
| **Simple private text generation (no tools)** | Venice E2EE (if needed for specific sub-tasks) |
| **Dev/testing** | OpenRouter (Eduardo's preference) |

### If Venice E2EE is still desired for specific sub-tasks:

The custom provider above can coexist with the Redpill provider. @effect/ai's `Model` system
allows switching providers per-request:

```typescript
const redpillModel = OpenAiLanguageModel.model("gpt-4o", { /* ... */ })
const veniceModel = veniceE2eeModel

// Use redpill for tool-calling agent work
const agentResult = agentProgram.pipe(Effect.provide(redpillModel))

// Use venice E2EE for private text generation
const privateResult = LanguageModel.generateText({
  prompt: "Summarize this private data..."
}).pipe(Effect.provide(veniceModel))
```

---

## 8. Open Questions / Unknowns

1. **HKDF parameters**: Venice docs don't specify salt, info, or hash algorithm for HKDF.
   The code sketch assumes SHA-256 with empty salt/info (standard ECIES convention).
   Needs verification by testing against the actual API.

2. **Multi-turn encryption**: Do assistant messages need to be encrypted when sent back
   in conversation history? The docs only show user message encryption.

3. **System message encryption**: Are system prompts encrypted too, or sent in plaintext?
   Venice says "system prompts are disabled" for E2EE, suggesting they're simply not allowed.

4. **Session key rotation**: Should ECDH keys be rotated per-request or per-session?
   The docs say "ephemeral" which suggests per-request, but caching per-session is more practical.

5. **Attestation verification**: The attestation response includes a TEE proof. Should the
   client verify it? The test-tee.ts script in the codebase fetches but doesn't verify.
   For production use in Mnemo, verification is important.

6. **No official TypeScript/JavaScript SDK for E2EE** — Venice only provides Python examples.
   The community SDK (venice-dev-tools) does not implement E2EE. We would be the first
   TypeScript E2EE implementation.
