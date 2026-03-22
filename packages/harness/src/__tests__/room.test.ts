/**
 * Room tests — verifies turn-based negotiation between two agents.
 *
 * Requires VENICE_API_KEY for integration tests. Skips gracefully if missing.
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  makeRoom,
  InMemoryLayer,
  mockModel,
  VeniceModel,
  State,
  verifierToolkit,
  proverToolkit,
  type AgentConfig,
} from "../index.js"

const hasApiKey = !!process.env.VENICE_API_KEY

const buyerConfig: AgentConfig = {
  id: "buyer",
  role: "generic",
  systemPrompt:
    "You are a buyer negotiating a deal. Be concise — respond in 1-2 sentences. You want a low price.",
}

const sellerConfig: AgentConfig = {
  id: "seller",
  role: "generic",
  systemPrompt:
    "You are a seller negotiating a deal. Be concise — respond in 1-2 sentences. You want a high price.",
}

describe("Room", () => {
  test("mock room runs 3 turns with alternating agents", async () => {
    let callCount = 0

    const room = makeRoom(buyerConfig, sellerConfig, {
      maxTurns: 3,
      openingMessage: "I want to buy your widget.",
    })

    const program = Effect.gen(function* () {
      return yield* room.negotiate()
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockModel(() => {
            callCount++
            return { text: `Response ${callCount}` }
          })
        ),
        Effect.provide(InMemoryLayer)
      )
    )

    expect(result.totalTurns).toBe(3)
    expect(result.agentA).toBe("buyer")
    expect(result.agentB).toBe("seller")
    expect(result.outcome).toBe("EXHAUSTED")

    // Verify alternation: buyer, seller, buyer
    expect(result.turns[0]!.agentId).toBe("buyer")
    expect(result.turns[1]!.agentId).toBe("seller")
    expect(result.turns[2]!.agentId).toBe("buyer")

    expect(result.turns[0]!.message).toBe("Response 1")
    expect(result.turns[1]!.message).toBe("Response 2")
    expect(result.turns[2]!.message).toBe("Response 3")
  })

  test("mock room respects maxTurns", async () => {
    const room = makeRoom(buyerConfig, sellerConfig, { maxTurns: 1 })

    const program = room.negotiate()

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(mockModel(() => ({ text: "single turn" }))),
        Effect.provide(InMemoryLayer)
      )
    )

    expect(result.totalTurns).toBe(1)
    expect(result.turns[0]!.agentId).toBe("buyer")
  })

  test("room stores all messages in state", async () => {
    let callCount = 0

    const room = makeRoom(buyerConfig, sellerConfig, {
      maxTurns: 2,
      openingMessage: "Start",
    })

    const program = Effect.gen(function* () {
      const result = yield* room.negotiate()
      const state = yield* State
      const messages = yield* state.getMessages()
      return { result, messages }
    })

    const { messages } = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          mockModel(() => {
            callCount++
            return { text: `Turn ${callCount}` }
          })
        ),
        Effect.provide(InMemoryLayer)
      )
    )

    // Each turn logs: the input message + the agent's response = 2 messages per turn
    expect(messages.length).toBe(4)
  })

  test.skipIf(!hasApiKey)(
    "real negotiation between two agents for 3 turns",
    async () => {
      const room = makeRoom(buyerConfig, sellerConfig, {
        maxTurns: 3,
        openingMessage:
          "I am interested in buying your dataset of financial derivatives. What is your asking price?",
      })

      const program = room.negotiate()

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(VeniceModel()),
          Effect.provide(InMemoryLayer)
        )
      )

      expect(result.totalTurns).toBe(3)
      expect(result.agentA).toBe("buyer")
      expect(result.agentB).toBe("seller")
      expect(result.outcome).toBe("EXHAUSTED")

      expect(result.turns[0]!.agentId).toBe("buyer")
      expect(result.turns[1]!.agentId).toBe("seller")
      expect(result.turns[2]!.agentId).toBe("buyer")

      for (const turn of result.turns) {
        expect(turn.message.length).toBeGreaterThan(0)
      }

      console.log("\n=== Negotiation Transcript ===")
      for (const turn of result.turns) {
        console.log(`[Turn ${turn.turnNumber}] ${turn.agentId}: ${turn.message}`)
        console.log("---")
      }
    },
    { timeout: 90_000 }
  )
})
