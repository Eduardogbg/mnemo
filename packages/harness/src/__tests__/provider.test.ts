/**
 * Provider integration test — verifies OpenRouter connection.
 *
 * Requires OPENROUTER_API_KEY in env. Skips gracefully if missing.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { Provider, OpenRouterLayer, mockLayer, type GenerateTextResult } from "../index.js"

const hasApiKey = !!process.env.OPENROUTER_API_KEY

describe("Provider", () => {
  test("mock provider returns fixed response", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider
      const result = yield* provider.generateText({
        system: "You are a test bot.",
        messages: [{ role: "user", content: "Hello" }],
      })
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(mockLayer(() => ({ text: "mock response", toolCalls: [] }))))
    )

    expect(result).toEqual({ text: "mock response", toolCalls: [] })
  })

  test("mock provider receives messages", async () => {
    let receivedMessages: Array<{ role: string; content: string }> = []

    const program = Effect.gen(function* () {
      const provider = yield* Provider
      return yield* provider.generateText({
        system: "system prompt",
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "second" },
          { role: "user", content: "third" },
        ],
      })
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockLayer((msgs) => {
            receivedMessages = msgs as Array<{ role: string; content: string }>
            return { text: "ok", toolCalls: [] }
          })
        )
      )
    )

    expect(receivedMessages).toHaveLength(3)
    expect(receivedMessages[0]!.content).toBe("first")
    expect(receivedMessages[2]!.content).toBe("third")
  })

  test.skipIf(!hasApiKey)(
    "OpenRouter sends a prompt and gets a response",
    async () => {
      const program = Effect.gen(function* () {
        const provider = yield* Provider
        const result = yield* provider.generateText({
          system: "You are a helpful assistant. Respond in one short sentence.",
          messages: [{ role: "user", content: "What is 2 + 2?" }],
        })
        return result
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(OpenRouterLayer))
      )

      expect(result.text).toBeTruthy()
      expect(typeof result.text).toBe("string")
      expect(result.text.length).toBeGreaterThan(0)
      // The response should mention "4" somewhere
      expect(result.text).toMatch(/4/)
    },
    { timeout: 30_000 }
  )
})
