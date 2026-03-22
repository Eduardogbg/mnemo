/**
 * Provider integration test — verifies Venice connection via LanguageModel.
 *
 * Requires VENICE_API_KEY in env. Skips gracefully if missing.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import * as LanguageModel from "@effect/ai/LanguageModel"
import { mockModel, VeniceModel } from "../index.js"

const hasApiKey = !!process.env.VENICE_API_KEY

describe("Provider (LanguageModel)", () => {
  test("mock model returns fixed response", async () => {
    const program = Effect.gen(function* () {
      const result = yield* LanguageModel.generateText({
        prompt: [
          { role: "system" as const, content: "You are a test bot." },
          { role: "user" as const, content: "Hello" },
        ],
      }).pipe(Effect.scoped)
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(mockModel(() => ({ text: "mock response" })))
      )
    )

    expect(result.text).toBe("mock response")
  })

  test("mock model receives messages", async () => {
    let receivedMessages: Array<{ role: string; content: string }> = []

    const program = Effect.gen(function* () {
      return yield* LanguageModel.generateText({
        prompt: [
          { role: "system" as const, content: "system prompt" },
          { role: "user" as const, content: "first" },
          { role: "assistant" as const, content: "second" },
          { role: "user" as const, content: "third" },
        ],
      }).pipe(Effect.scoped)
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockModel((msgs: ReadonlyArray<{ role: string; content: string }>) => {
            receivedMessages = msgs as Array<{ role: string; content: string }>
            return { text: "ok" }
          })
        )
      )
    )

    // system + first + second + third = 4 messages
    expect(receivedMessages).toHaveLength(4)
    expect(receivedMessages[1]!.content).toBe("first")
    expect(receivedMessages[3]!.content).toBe("third")
  })

  test.skipIf(!hasApiKey)(
    "Venice sends a prompt and gets a response",
    async () => {
      const program = Effect.gen(function* () {
        return yield* LanguageModel.generateText({
          prompt: [
            { role: "system" as const, content: "You are a helpful assistant. Respond in one short sentence." },
            { role: "user" as const, content: "What is 2 + 2?" },
          ],
        }).pipe(Effect.scoped)
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(VeniceModel()))
      )

      expect(result.text).toBeTruthy()
      expect(typeof result.text).toBe("string")
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.text).toMatch(/4/)
    },
    { timeout: 30_000 }
  )
})
