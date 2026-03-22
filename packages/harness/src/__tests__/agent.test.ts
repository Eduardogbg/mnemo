/**
 * Agent tests — verifies agent abstraction with mock and real providers.
 *
 * Requires VENICE_API_KEY for integration tests. Skips gracefully if missing.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  makeAgent,
  State,
  InMemoryLayer,
  mockModel,
  VeniceModel,
} from "../index.js"

const hasApiKey = !!process.env.VENICE_API_KEY

const testAgent = makeAgent({
  id: "agent-test",
  role: "generic",
  systemPrompt: "You are a concise test assistant. Always respond in one sentence.",
})

describe("Agent", () => {
  test("agent.run with mock model stores messages in state", async () => {
    const program = Effect.gen(function* () {
      const result = yield* testAgent.run("What is the capital of France?")
      const state = yield* State
      const messages = yield* state.getMessages()
      return { result, messages }
    })

    const { result, messages } = await Effect.runPromise(
      program.pipe(
        Effect.provide(mockModel(() => ({ text: "Paris is the capital of France." }))),
        Effect.provide(InMemoryLayer)
      )
    )

    expect(result.agentId).toBe("agent-test")
    expect(result.response).toBe("Paris is the capital of France.")
    // Should have stored user message + assistant response
    expect(messages.length).toBe(2)
    expect(messages[0]!.content).toBe("What is the capital of France?")
    expect(messages[1]!.content).toBe("Paris is the capital of France.")
  })

  test("agent.runWithHistory uses provided history", async () => {
    let sentMessages: Array<{ role: string; content: string }> = []

    const program = Effect.gen(function* () {
      return yield* testAgent.runWithHistory(
        [
          {
            id: 0,
            agentId: "other-agent",
            role: "user",
            content: "Previous context message",
            timestamp: Date.now(),
          },
        ],
        "Follow-up question"
      )
    })

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockModel((msgs: ReadonlyArray<{ role: string; content: string }>) => {
            sentMessages = msgs as Array<{ role: string; content: string }>
            return { text: "follow-up answer" }
          })
        )
      )
    )

    // system + History message + current message = 3
    expect(sentMessages).toHaveLength(3)
    expect(sentMessages[1]!.content).toBe("Previous context message")
    expect(sentMessages[1]!.role).toBe("user") // other agent's msg appears as "user"
    expect(sentMessages[2]!.content).toBe("Follow-up question")
  })

  test.skipIf(!hasApiKey)(
    "agent.run with Venice returns a real response",
    async () => {
      const program = Effect.gen(function* () {
        return yield* testAgent.run("Say the word 'hello' and nothing else.")
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(VeniceModel()),
          Effect.provide(InMemoryLayer)
        )
      )

      expect(result.agentId).toBe("agent-test")
      expect(result.response).toBeTruthy()
      expect(result.response.toLowerCase()).toContain("hello")
    },
    { timeout: 30_000 }
  )
})
