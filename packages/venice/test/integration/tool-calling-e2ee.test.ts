/**
 * Integration test: prompt-based tool calling over Venice E2EE.
 *
 * Proves that Venice's "no tool calling on E2EE" limitation does NOT apply
 * to prompt-engineered tool calling — it's just text in, text out.
 *
 * Requires VENICE_API_KEY in environment.
 * Run: VENICE_API_KEY=... bun test test/integration/tool-calling-e2ee.test.ts
 */

import { describe, expect, test } from "bun:test"
import * as LanguageModel from "@effect/ai/LanguageModel"
import * as Tool from "@effect/ai/Tool"
import * as Toolkit from "@effect/ai/Toolkit"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { VeniceProvider } from "../../src/index.js"

const API_KEY = process.env.VENICE_API_KEY
const MODEL = "e2ee-qwen3-30b-a3b"

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const Calculator = Tool.make("calculator", {
  description: "Performs basic arithmetic. Use this tool when asked to compute a math expression.",
  parameters: {
    operation: Schema.Literal("add", "subtract", "multiply", "divide"),
    a: Schema.Number,
    b: Schema.Number,
  },
  success: Schema.Number,
})

const StoreNote = Tool.make("store_note", {
  description: "Stores a note in memory. Use this when asked to remember something.",
  parameters: {
    key: Schema.String,
    value: Schema.String,
  },
  success: Schema.String,
})

const toolkit = Toolkit.make(Calculator, StoreNote)

// ---------------------------------------------------------------------------
// Tool handler layer
// ---------------------------------------------------------------------------

const handlersLayer = toolkit.toLayer({
  calculator: ({ operation, a, b }) =>
    Effect.succeed(
      operation === "add" ? a + b
        : operation === "subtract" ? a - b
        : operation === "multiply" ? a * b
        : a / b
    ),
  store_note: ({ key, value }) =>
    Effect.succeed(`Stored "${key}" = "${value}"`),
})

// ---------------------------------------------------------------------------
// Venice model
// ---------------------------------------------------------------------------

const veniceModel = VeniceProvider.model({
  apiKey: API_KEY!,
  model: MODEL,
  encryption: "encrypted",
  maxTokens: 512,
  temperature: 0,
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!API_KEY)("Tool calling over E2EE", () => {
  test(
    "calculator tool is called and resolved",
    async () => {
      const program = Effect.gen(function* () {
        const response = yield* LanguageModel.generateText({
          prompt: "What is 7 multiplied by 6? Use the calculator tool to compute it.",
          toolkit,
        })

        console.log("Response text:", response.text)
        console.log("Tool calls:", JSON.stringify(response.toolCalls, null, 2))
        console.log("Tool results:", JSON.stringify(response.toolResults, null, 2))
        console.log("All content:", JSON.stringify(response.content, null, 2))

        // The model should have called the calculator tool
        expect(response.toolCalls.length).toBeGreaterThan(0)
        expect(response.toolResults.length).toBeGreaterThan(0)

        // Verify the tool was called with correct arguments
        const call = response.toolCalls[0]
        expect(call.name).toBe("calculator")

        // Verify the result is 42
        const result = response.toolResults[0]
        expect(result.result).toBe(42)

        return response
      }).pipe(
        Effect.provide(handlersLayer),
        Effect.provide(veniceModel),
        Effect.scoped,
      )

      await Effect.runPromise(program)
    },
    60_000,
  )

  test(
    "store_note tool is called and resolved",
    async () => {
      const program = Effect.gen(function* () {
        const response = yield* LanguageModel.generateText({
          prompt: 'Please store a note with key "greeting" and value "hello world". Use the store_note tool.',
          toolkit,
        })

        console.log("Response text:", response.text)
        console.log("Tool calls:", JSON.stringify(response.toolCalls, null, 2))
        console.log("Tool results:", JSON.stringify(response.toolResults, null, 2))

        expect(response.toolCalls.length).toBeGreaterThan(0)

        const call = response.toolCalls[0]
        expect(call.name).toBe("store_note")

        expect(response.toolResults.length).toBeGreaterThan(0)

        return response
      }).pipe(
        Effect.provide(handlersLayer),
        Effect.provide(veniceModel),
        Effect.scoped,
      )

      await Effect.runPromise(program)
    },
    60_000,
  )

  test(
    "model responds normally when no tool is needed",
    async () => {
      const program = Effect.gen(function* () {
        const response = yield* LanguageModel.generateText({
          prompt: "Say exactly: 'No tools needed here'",
          toolkit,
        })

        console.log("Response text:", response.text)
        console.log("Tool calls:", response.toolCalls.length)

        // Should have text but no tool calls
        expect(response.text.length).toBeGreaterThan(0)
        expect(response.toolCalls.length).toBe(0)

        return response
      }).pipe(
        Effect.provide(handlersLayer),
        Effect.provide(veniceModel),
        Effect.scoped,
      )

      await Effect.runPromise(program)
    },
    60_000,
  )
})
