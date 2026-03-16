# Research: @effect/ai

**Date:** 2026-03-12
**Purpose:** Evaluate @effect/ai as the foundation for a standalone TypeScript agent harness (negotiation protocol inside Phala TEE).

---

## 1. What Is @effect/ai?

@effect/ai is the AI integration layer of the [Effect](https://github.com/Effect-TS/effect) TypeScript ecosystem (13.5k GitHub stars). It provides a **provider-agnostic abstraction** for working with LLMs, structured as a set of packages inside the Effect monorepo:

| Package | Purpose |
|---------|---------|
| `@effect/ai` | Core abstractions: `LanguageModel`, `Chat`, `Toolkit`, `Tool`, `EmbeddingModel`, `Prompt`, `Response` |
| `@effect/ai-openai` | OpenAI provider (LanguageModel + EmbeddingModel) |
| `@effect/ai-anthropic` | Anthropic provider (LanguageModel) |
| `@effect/ai-amazon-bedrock` | Amazon Bedrock provider |
| `@effect/ai-google` | Google Generative AI provider |
| `@effect/ai-openrouter` | OpenRouter provider (300+ models) |

### Core Abstractions

- **`LanguageModel`** -- service interface with three methods:
  - `generateText` -- non-streaming text generation with optional tool resolution
  - `generateObject` -- structured output using an Effect `Schema`
  - `streamText` -- streaming text generation; emits incremental content parts
- **`Chat`** -- stateful conversation management backed by `Ref<Prompt>`:
  - `history` -- direct access to conversation history
  - `generateText(options)` -- send message, update history, return response
  - `streamText(options)` -- streaming variant with auto-history updates
  - `generateObject(options)` -- structured output with history
  - `Chat.layerPersisted` -- persistence via `@effect/experimental` `BackingPersistence`
- **`Toolkit`** / **`Tool`** -- type-safe tool definitions with schema validation
- **`EmbeddingModel`** -- `embed` / `embedMany` for vector embeddings
- **`Prompt`** -- ordered array of typed messages (`system`, `user`, `assistant`, `tool`)
- **`Response`** -- union of response parts (text, reasoning, tool calls, tool results, finish)
- **`ExecutionPlan`** -- multi-provider strategies with retry + fallback
- **`AiError`** -- tagged error union for typed error handling

---

## 2. Provider Support

### First-Party Providers

| Provider | LanguageModel | EmbeddingModel | Package |
|----------|:---:|:---:|---------|
| OpenAI | yes | yes | `@effect/ai-openai` |
| Anthropic | yes | -- | `@effect/ai-anthropic` |
| Amazon Bedrock | yes | -- | `@effect/ai-amazon-bedrock` |
| Google (Gemini) | yes | -- | `@effect/ai-google` |
| OpenRouter | yes | -- | `@effect/ai-openrouter` |

### OpenAI-Compatible Providers (Venice, Ollama, etc.)

`@effect/ai-openai` supports custom base URLs via `OpenAiClient.layerConfig`:

```typescript
OpenAiClient.layerConfig({
  apiKey: Config.redacted("VENICE_API_KEY"),
  apiUrl: Config.succeed("https://api.venice.ai/api/v1"),
  // transformClient also available for custom HTTP transforms
})
```

This was added via [PR #4316](https://github.com/Effect-TS/effect/pull/4316) (resolved [issue #3923](https://github.com/Effect-TS/effect/issues/3923)). Any OpenAI-compatible endpoint (Venice, Ollama, LM Studio, vLLM, etc.) should work by setting `apiUrl`.

**For our use case:** Venice (official hackathon partner) exposes an OpenAI-compatible API at `https://api.venice.ai/api/v1`. We can use `@effect/ai-openai` with a custom `apiUrl` -- no separate provider package needed.

---

## 3. Tool Use / Function Calling

Tools are defined with Effect `Schema` for parameters, success, and failure types:

```typescript
import { Tool, Toolkit } from "@effect/ai"
import { Schema } from "effect"

// 1. Define a tool with typed parameters
const ProposeOffer = Tool.make("ProposeOffer", {
  description: "Propose a trade offer to the counterparty",
  parameters: {
    give: Schema.String.annotations({ description: "Asset to give" }),
    receive: Schema.String.annotations({ description: "Asset to receive" }),
    price: Schema.Number.annotations({ description: "Proposed price" })
  },
  success: Schema.Struct({
    accepted: Schema.Boolean,
    counterOffer: Schema.optional(Schema.Number)
  }),
  failure: Schema.Never
})

// 2. Group tools into a Toolkit
const NegotiationTools = Toolkit.make(ProposeOffer, /* ...more tools */)

// 3. Implement handlers via .toLayer()
const NegotiationHandlers = NegotiationTools.toLayer(
  Effect.gen(function*() {
    const protocol = yield* ProtocolState  // inject dependencies
    return {
      ProposeOffer: ({ give, receive, price }) =>
        protocol.handleProposal({ give, receive, price })
    }
  })
)

// 4. Pass toolkit to the model
const step = LanguageModel.generateText({
  prompt: "You are a negotiation agent. Propose an offer.",
  toolkit: NegotiationTools
})
```

### Agent Loop (Automatic Tool Resolution)

When a toolkit is supplied, the framework implements an **internal tool resolution loop**:

1. Model receives toolkit definitions
2. Model decides to call tool(s) with parameters
3. Framework validates parameters against schemas
4. Handler executes the tool logic
5. Result appended to prompt, new request sent
6. Loop continues until the model emits a `finish` part with no pending tool calls

`ToolChoice` controls behavior: `"auto"`, `"none"`, `"required"`, or specific tool references.

---

## 4. Structured Output / Schema Validation

`LanguageModel.generateObject` forces the model to output a value conforming to an Effect `Schema`:

```typescript
const NegotiationAction = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("propose"),
    give: Schema.String,
    receive: Schema.String,
    price: Schema.Number
  }),
  Schema.Struct({
    _tag: Schema.Literal("accept")
  }),
  Schema.Struct({
    _tag: Schema.Literal("reject"),
    reason: Schema.String
  })
)

const action = yield* LanguageModel.generateObject({
  prompt: currentPrompt,
  schema: NegotiationAction
})
// action is fully typed as the union -- no manual parsing
```

Effect `Schema` is more powerful than Zod for our use case:
- **Bidirectional:** encode + decode (useful for serialization to/from TEE storage)
- **Transformations:** built-in transforms, branded types, template literals
- **Effect integration:** errors are typed, composable, and traceable
- **JSON Schema derivation:** schemas automatically convert to JSON Schema for the LLM

---

## 5. What the Effect Ecosystem Gives Us

Effect is a comprehensive runtime for TypeScript. Relevant capabilities for the harness:

### Error Handling
- **Typed errors:** Every `Effect<A, E, R>` tracks success (`A`), error (`E`), and requirements (`R`) at the type level
- **Tagged errors:** `AiError` includes `HttpRequestError`, `HttpResponseError`, `MalformedInput`, `MalformedOutput`, `UnknownError` -- all pattern-matchable via `Effect.catchTag`
- **No `try/catch` spaghetti:** errors compose and propagate cleanly

### Dependency Injection
- **Service pattern:** `LanguageModel`, `Chat`, toolkits, protocol state -- all injected via `Layer`
- **Testability:** swap real LLM calls for deterministic mocks without changing business logic
- **Provider swapping:** switch from Venice to OpenAI by changing one `Layer`

### Concurrency
- **Structured concurrency:** `Effect.all([agentA, agentB], { concurrency: 2 })` for parallel agent steps
- **Fibers:** lightweight, cancellable -- useful for timeouts on LLM calls
- **Scoped resources:** automatic cleanup of connections, subscriptions

### Streams
- **`Stream` type:** first-class streaming for `streamText` -- useful if we want real-time output in the TEE

### Observability
- **OpenTelemetry integration:** every `generateText`/`streamText` call auto-creates a span with model name, token counts, latency
- **Structured logging:** via `Effect.log` with automatic context propagation

### Retry / Resilience
- **`Schedule`:** exponential backoff, jitter, capped retries -- composable with any Effect
- **`ExecutionPlan`:** multi-provider fallback chains (e.g., try Venice 3x, fall back to OpenAI)

```typescript
const ResilientPlan = ExecutionPlan.make(
  {
    provide: OpenAiLanguageModel.model("venice-model"),
    attempts: 3,
    schedule: Schedule.exponential("100 millis"),
    while: (error) => error._tag === "HttpRequestError"
  },
  {
    provide: OpenAiLanguageModel.model("gpt-4o")  // fallback
  }
)
```

---

## 6. Maturity Assessment

| Metric | Value |
|--------|-------|
| **@effect/ai version** | 0.33.2 (latest, ~Jan 2026) |
| **@effect/ai-openai version** | 0.37.2 |
| **Effect core version** | 3.19.19 (Feb 2026) |
| **Effect monorepo stars** | 13,500+ |
| **@effect/ai-openai weekly downloads** | ~1,120 |
| **License** | MIT |
| **Status** | Officially **experimental/alpha** |
| **API stability** | Frequent breaking changes (0.x semver) |

### Honest Assessment

**Strengths:**
- Effect core is mature and battle-tested (3.x, 13.5k stars, used in production by multiple companies)
- The AI abstraction design is clean and well-thought-out
- Provider-agnostic + typed errors + DI is genuinely useful
- Active development with regular releases
- Built-in agent loop (tool resolution) saves boilerplate

**Weaknesses:**
- `@effect/ai` is alpha (0.x) -- API **will** break
- Very low adoption (~1k weekly downloads) -- community support is thin
- Effect has a steep learning curve (generators, Layers, Services, Fibers)
- Documentation is sparse -- mostly blog posts and API reference, few real-world examples
- No production references specifically for `@effect/ai`
- The "Effect tax" -- anyone reading/maintaining the code needs to understand Effect

---

## 7. Code Example: Negotiation Agent Loop

Here is a sketch of how our two-agent negotiation harness would look with @effect/ai:

```typescript
import { Effect, Layer, Schema, Ref, pipe } from "effect"
import { LanguageModel, Chat, Tool, Toolkit } from "@effect/ai"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"

// --- Protocol Actions ---
const Action = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("propose"), price: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("accept") }),
  Schema.Struct({ _tag: Schema.Literal("reject"), reason: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("counter"), price: Schema.Number })
)
type Action = typeof Action.Type

// --- Agent Step ---
const agentStep = (chat: Chat.Chat, role: string) =>
  Effect.gen(function*() {
    const response = yield* chat.generateObject({
      prompt: `You are ${role}. Decide your next action.`,
      schema: Action
    })
    return response  // fully typed Action
  })

// --- Main Loop ---
const negotiation = Effect.gen(function*() {
  const buyerChat = yield* Chat.empty
  const sellerChat = yield* Chat.empty

  let round = 0
  let settled = false

  while (!settled && round < 10) {
    const buyerAction = yield* agentStep(buyerChat, "buyer")
    yield* Effect.log(`Buyer: ${JSON.stringify(buyerAction)}`)

    if (buyerAction._tag === "accept") { settled = true; break }

    const sellerAction = yield* agentStep(sellerChat, "seller")
    yield* Effect.log(`Seller: ${JSON.stringify(sellerAction)}`)

    if (sellerAction._tag === "accept") { settled = true; break }
    round++
  }

  return { settled, rounds: round }
})

// --- Wiring (Venice via OpenAI-compatible) ---
const VeniceClient = OpenAiClient.layerConfig({
  apiKey: Config.redacted("VENICE_API_KEY"),
  apiUrl: Config.succeed("https://api.venice.ai/api/v1")
})

const VeniceModel = OpenAiLanguageModel.model("llama-3.3-70b")

const main = negotiation.pipe(
  Effect.provide(VeniceModel),
  Effect.provide(VeniceClient)
)

// Run
Effect.runPromise(main).then(console.log)
```

---

## 8. Comparison: @effect/ai vs. Raw `openai` npm Package

| Concern | Raw `openai` package | @effect/ai |
|---------|---------------------|------------|
| **LLM call** | `openai.chat.completions.create(...)` | `LanguageModel.generateText(...)` |
| **Structured output** | Manual JSON parse + Zod validate | `generateObject({ schema })` -- built-in |
| **Tool calling** | Manual: define functions, parse tool_calls, dispatch, re-send | `Toolkit` + automatic agent loop |
| **Error handling** | `try/catch`, untyped errors | Typed `AiError` union, `Effect.catchTag` |
| **Retry / fallback** | Manual retry loop or `p-retry` | `Schedule` + `ExecutionPlan` |
| **Provider swap** | Rewrite client code | Change one `Layer` |
| **DI / testing** | Manual mocking | `Layer`-based injection, trivial mocks |
| **Streaming** | Async iterator over chunks | `Stream` type with typed parts |
| **Multi-turn state** | Manual message array management | `Chat` service with `Ref<Prompt>` |
| **Observability** | Manual logging | Auto OpenTelemetry spans |
| **Learning curve** | Minimal | **Steep** (Effect ecosystem) |
| **Bundle size** | ~50kb | ~200kb+ (Effect runtime) |
| **Community/examples** | Massive | Tiny |
| **API stability** | Stable (v4+) | Alpha (0.x, breaking changes) |

---

## 9. Recommendation for Mnemo

### Should we use @effect/ai?

**If the team already knows Effect: YES.** The abstractions are genuinely useful -- typed errors, DI, automatic tool loops, provider-agnostic design, and `ExecutionPlan` for resilience are all things we would otherwise build by hand.

**If the team does NOT know Effect: PROBABLY NOT for a hackathon.**

The honest trade-off:
- Effect's learning curve is real. Generators, Layers, Services, and the `Effect<A, E, R>` type take time to internalize.
- For a 9-day hackathon, the overhead of learning Effect while building is high.
- The `@effect/ai` package is alpha with sparse documentation -- debugging issues means reading source code.
- The negotiation harness is relatively simple (turn loop + structured output + state machine). We can build it in ~200 lines with the raw `openai` package.

### Pragmatic Middle Ground

Use the raw `openai` npm package (or Venice SDK) for the hackathon with a clean abstraction layer:

```typescript
// Simple abstraction we can build in 30 minutes
interface AgentHarness {
  step(agent: AgentConfig, history: Message[]): Promise<Action>
}
```

This gives us:
- Zero learning curve
- Full control over the agent loop
- Easy debugging
- Can always migrate to @effect/ai later if we adopt Effect post-hackathon

### When @effect/ai Would Be Worth It

- Post-hackathon, if Mnemo becomes a real product
- If we need multi-provider fallback (Venice -> OpenAI -> Anthropic)
- If we need production-grade observability and error handling
- If the team commits to learning Effect

---

## Sources

- [Effect AI Introduction](https://effect.website/docs/ai/introduction/)
- [Effect AI Blog Post](https://effect.website/blog/effect-ai/)
- [Effect AI Tool Use Docs](https://effect.website/docs/ai/tool-use/)
- [Effect-TS/effect GitHub](https://github.com/Effect-TS/effect)
- [@effect/ai on npm](https://www.npmjs.com/package/@effect/ai)
- [@effect/ai-openai on npm](https://www.npmjs.com/package/@effect/ai-openai)
- [OpenAiClient base URL issue #3923](https://github.com/Effect-TS/effect/issues/3923)
- [DeepWiki: AI Integration Architecture](https://deepwiki.com/Effect-TS/effect/10.1-ai-integration-architecture)
- [OpenRouter Effect AI SDK Guide](https://openrouter.ai/docs/guides/community/effect-ai-sdk)
