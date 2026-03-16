/**
 * DualAgentTest.ts -- Dual-agent negotiation demo over Venice E2EE.
 *
 * Two Venice E2EE model instances (buyer + seller) negotiate a widget price
 * through shared in-memory state, proving:
 *   1. Tool calling works over E2EE (prompt-based, just text)
 *   2. Two agents can share state through tool calls
 *   3. The @effect/ai framework resolves tool calls automatically
 *
 * Architecture: Each turn, the harness reads the board state and injects it
 * into the user prompt. The model then decides which action tool to call
 * (post_message, propose_deal, accept_deal, reject_deal). This avoids the
 * read-only loop problem where the model calls read_messages repeatedly
 * without acting.
 *
 * Run: VENICE_API_KEY=... bun run src/DualAgentTest.ts
 *   or: bun run demo:negotiate (with VENICE_API_KEY in env)
 */

import * as LanguageModel from "@effect/ai/LanguageModel"
import type * as Prompt from "@effect/ai/Prompt"
import * as Tool from "@effect/ai/Tool"
import * as Toolkit from "@effect/ai/Toolkit"
import { VeniceProvider } from "@mnemo/venice"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_KEY = process.env.VENICE_API_KEY
if (!API_KEY) {
  console.error("VENICE_API_KEY is required. Set it in your environment.")
  process.exit(1)
}

const MODEL = "e2ee-qwen3-30b-a3b"
const MAX_ROUNDS = 5

// ---------------------------------------------------------------------------
// Shared state service
// ---------------------------------------------------------------------------

interface Message {
  readonly from: string
  readonly content: string
  readonly timestamp: number
}

interface Deal {
  readonly proposedBy: string
  readonly terms: string
  readonly status: "pending" | "accepted" | "rejected"
}

interface BoardState {
  readonly messages: Array<Message>
  readonly currentDeal: Deal | null
}

class SharedBoard extends Context.Tag("SharedBoard")<
  SharedBoard,
  Ref.Ref<BoardState>
>() {}

const makeSharedBoard = Effect.map(
  Ref.make<BoardState>({ messages: [], currentDeal: null }),
  (ref) => ref,
)

// ---------------------------------------------------------------------------
// Tool definitions (action tools only — board state is injected by harness)
// ---------------------------------------------------------------------------

const PostMessage = Tool.make("post_message", {
  description: "Post a message to the shared negotiation board. Use this to communicate with the other party.",
  parameters: {
    content: Schema.String,
  },
  success: Schema.String,
})

const ProposeDeal = Tool.make("propose_deal", {
  description: "Propose a deal with specific terms (e.g. a price). The other party can then accept or reject it.",
  parameters: {
    terms: Schema.String,
  },
  success: Schema.String,
})

const AcceptDeal = Tool.make("accept_deal", {
  description: "Accept the currently pending deal. Only use this if there is a pending deal and you agree to the terms.",
  success: Schema.String,
})

const RejectDeal = Tool.make("reject_deal", {
  description: "Reject the currently pending deal. Use this if the terms are not acceptable.",
  success: Schema.String,
})

const toolkit = Toolkit.make(PostMessage, ProposeDeal, AcceptDeal, RejectDeal)

// ---------------------------------------------------------------------------
// Tool handlers (parameterized by agent name)
// ---------------------------------------------------------------------------

function makeHandlersLayer(agentName: string) {
  return toolkit.toLayer(
    Effect.gen(function* () {
      const board = yield* SharedBoard
      return {
        post_message: ({ content }: { content: string }) =>
          Effect.gen(function* () {
            yield* Ref.update(board, (state) => ({
              ...state,
              messages: [
                ...state.messages,
                { from: agentName, content, timestamp: Date.now() },
              ],
            }))
            return `Message posted by ${agentName}.`
          }),

        propose_deal: ({ terms }: { terms: string }) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(board)
            if (state.currentDeal?.status === "pending") {
              return "There is already a pending deal. It must be accepted or rejected first."
            }
            yield* Ref.update(board, (s) => ({
              ...s,
              currentDeal: { proposedBy: agentName, terms, status: "pending" as const },
              messages: [
                ...s.messages,
                { from: agentName, content: `[DEAL PROPOSED] ${terms}`, timestamp: Date.now() },
              ],
            }))
            return `Deal proposed by ${agentName}: ${terms}`
          }),

        accept_deal: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(board)
            if (!state.currentDeal || state.currentDeal.status !== "pending") {
              return "No pending deal to accept."
            }
            if (state.currentDeal.proposedBy === agentName) {
              return "You cannot accept your own deal."
            }
            yield* Ref.update(board, (s) => ({
              ...s,
              currentDeal: { ...s.currentDeal!, status: "accepted" as const },
              messages: [
                ...s.messages,
                { from: agentName, content: "[DEAL ACCEPTED]", timestamp: Date.now() },
              ],
            }))
            return `Deal accepted by ${agentName}!`
          }),

        reject_deal: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(board)
            if (!state.currentDeal || state.currentDeal.status !== "pending") {
              return "No pending deal to reject."
            }
            if (state.currentDeal.proposedBy === agentName) {
              return "You cannot reject your own deal."
            }
            yield* Ref.update(board, (s) => ({
              ...s,
              currentDeal: { ...s.currentDeal!, status: "rejected" as const },
              messages: [
                ...s.messages,
                { from: agentName, content: "[DEAL REJECTED]", timestamp: Date.now() },
              ],
            }))
            return `Deal rejected by ${agentName}.`
          }),
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Agent system prompts
// ---------------------------------------------------------------------------

const BUYER_SYSTEM = `You are a BUYER agent in an automated negotiation. You are negotiating to purchase a widget.

GOAL: Buy the widget for UNDER $50. Your absolute maximum is $50.
STRATEGY: Start with an offer around $35, negotiate up reluctantly ($5 increments). Be firm but professional.

RULES:
- Each turn, you receive the current board state showing all messages and any pending deal.
- You MUST call exactly one or two action tools per turn. Available tools: post_message, propose_deal, accept_deal, reject_deal.
- If the seller proposed a deal at or below $50: call accept_deal immediately.
- If the seller proposed a deal above $50: call reject_deal, then call propose_deal with a counter-offer ($5 higher than your last offer).
- On your first turn with no messages: call post_message with a greeting, then call propose_deal with "$35".
- Keep messages to one short sentence.`

const SELLER_SYSTEM = `You are a SELLER agent in an automated negotiation. You are selling a widget.

GOAL: Sell the widget for at least $60. Retail price is $80. Below $60 you lose money.
STRATEGY: Start at $75, come down reluctantly ($10 decrements, floor at $60).

RULES:
- Each turn, you receive the current board state showing all messages and any pending deal.
- You MUST call exactly one or two action tools per turn. Available tools: post_message, propose_deal, accept_deal, reject_deal.
- If the buyer proposed a deal at or above $60: call accept_deal immediately.
- If the buyer proposed a deal below $60: call reject_deal, then call propose_deal with a counter-offer ($10 lower than your last offer, but never below $60).
- If there is no pending deal and no previous offers, call propose_deal with "$75".
- Keep messages to one short sentence.`

// ---------------------------------------------------------------------------
// Conversation history helpers
// ---------------------------------------------------------------------------

type MessageEncoded = Prompt.MessageEncoded

/**
 * Format the board state as a string for injection into the user prompt.
 */
function formatBoardState(state: BoardState): string {
  if (state.messages.length === 0) {
    return "BOARD STATE:\nNo messages yet.\nNo pending deal."
  }
  const formatted = state.messages
    .map((m) => `  [${m.from}]: ${m.content}`)
    .join("\n")
  const dealInfo = state.currentDeal
    ? `Current deal: "${state.currentDeal.terms}" proposed by ${state.currentDeal.proposedBy} — status: ${state.currentDeal.status}`
    : "No pending deal."
  return `BOARD STATE:\n${formatted}\n\n${dealInfo}`
}

/**
 * Extract assistant message and tool message from a generateText response,
 * suitable for appending to the conversation history.
 */
function responseToHistory(
  response: LanguageModel.GenerateTextResponse<any>,
): Array<MessageEncoded> {
  const messages: Array<MessageEncoded> = []

  const assistantContent: Array<Prompt.AssistantMessagePartEncoded> = []
  const toolResultContent: Array<Prompt.ToolResultPartEncoded> = []

  for (const part of response.content) {
    if (part.type === "text" && part.text.trim()) {
      assistantContent.push({ type: "text", text: part.text })
    } else if (part.type === "tool-call") {
      assistantContent.push({
        type: "tool-call",
        id: part.id,
        name: part.name,
        params: part.params,
      })
    } else if (part.type === "tool-result") {
      toolResultContent.push({
        type: "tool-result",
        id: part.id,
        name: part.name,
        result: part.result,
        isFailure: part.isFailure,
        providerExecuted: false,
      })
    }
  }

  if (assistantContent.length > 0) {
    messages.push({
      role: "assistant" as const,
      content: assistantContent,
    })
  }

  if (toolResultContent.length > 0) {
    messages.push({
      role: "tool" as const,
      content: toolResultContent,
    })
  }

  return messages
}

// ---------------------------------------------------------------------------
// Negotiation loop
// ---------------------------------------------------------------------------

const runNegotiation = Effect.gen(function* () {
  const board = yield* SharedBoard

  const buyerModel = VeniceProvider.model({
    apiKey: API_KEY!,
    model: MODEL,
    encryption: "encrypted",
    maxTokens: 512,
    temperature: 0.7,
  })

  const sellerModel = VeniceProvider.model({
    apiKey: API_KEY!,
    model: MODEL,
    encryption: "encrypted",
    maxTokens: 512,
    temperature: 0.7,
  })

  const buyerHandlers = makeHandlersLayer("Buyer")
  const sellerHandlers = makeHandlersLayer("Seller")

  console.log("=" .repeat(70))
  console.log("  DUAL-AGENT NEGOTIATION OVER VENICE E2EE")
  console.log("=" .repeat(70))
  console.log()

  // Conversation histories
  const buyerHistory: Array<MessageEncoded> = []
  const sellerHistory: Array<MessageEncoded> = []

  /**
   * Run a single agent turn. The harness reads the board state, injects it
   * into the prompt, and asks the model to choose action tools.
   */
  const runAgentTurn = (
    agentLabel: string,
    systemPrompt: string,
    history: Array<MessageEncoded>,
    instruction: string,
    modelLayer: Layer.Layer<LanguageModel.LanguageModel>,
    handlersLayer: ReturnType<typeof makeHandlersLayer>,
  ) =>
    Effect.gen(function* () {
      // Read the current board state
      const state = yield* Ref.get(board)
      const boardText = formatBoardState(state)

      // Build the user prompt with board state + instruction
      const userPrompt = `${boardText}\n\n${instruction}`

      // Add user prompt to history
      history.push({ role: "user" as const, content: userPrompt })

      const response = yield* LanguageModel.generateText({
        prompt: [
          { role: "system" as const, content: systemPrompt },
          ...history,
        ],
        toolkit,
      }).pipe(
        Effect.provide(handlersLayer),
        Effect.provide(modelLayer),
        Effect.scoped,
      )

      // Append to conversation history
      const historyMsgs = responseToHistory(response)
      history.push(...historyMsgs)

      // Log the turn
      console.log(`  Text: ${response.text || "(no text)"}`)
      if (response.toolCalls.length > 0) {
        console.log(`  Tool calls: ${response.toolCalls.map((tc) => tc.name).join(", ")}`)
      }
      if (response.toolResults.length > 0) {
        for (const tr of response.toolResults) {
          console.log(`  Tool result [${tr.name}]: ${JSON.stringify(tr.result)}`)
        }
      }
    })

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`--- Round ${round} ---`)
    console.log()

    // Check if deal is settled
    const stateBefore = yield* Ref.get(board)
    if (stateBefore.currentDeal?.status === "accepted") {
      console.log("[NEGOTIATION COMPLETE] Deal was accepted!")
      break
    }

    // Buyer's turn
    const buyerInstruction = round === 1
      ? "This is round 1. No messages exist yet. Post a greeting with post_message, then propose a deal at $35 with propose_deal."
      : "Review the board state above. Take action: if there is a pending deal from the seller, accept or reject it and counter-offer. Use the tools now."

    console.log("[BUYER TURN]")
    yield* runAgentTurn("Buyer", BUYER_SYSTEM, buyerHistory, buyerInstruction, buyerModel, buyerHandlers)
    console.log()

    // Check if deal is settled after buyer turn
    const stateAfterBuyer = yield* Ref.get(board)
    if (stateAfterBuyer.currentDeal?.status === "accepted") {
      console.log("[NEGOTIATION COMPLETE] Deal accepted after buyer's turn!")
      break
    }

    // Seller's turn
    const sellerInstruction = round === 1
      ? "Review the board state above. The buyer made an opening offer. If it is below $60, reject it with reject_deal and counter-offer at $75 with propose_deal."
      : "Review the board state above. Take action: if there is a pending deal from the buyer, accept or reject it and counter-offer. Use the tools now."

    console.log("[SELLER TURN]")
    yield* runAgentTurn("Seller", SELLER_SYSTEM, sellerHistory, sellerInstruction, sellerModel, sellerHandlers)
    console.log()

    // Check after seller turn
    const stateAfterSeller = yield* Ref.get(board)
    if (stateAfterSeller.currentDeal?.status === "accepted") {
      console.log("[NEGOTIATION COMPLETE] Deal accepted after seller's turn!")
      break
    }
  }

  // Final state
  const finalState = yield* Ref.get(board)
  console.log()
  console.log("=" .repeat(70))
  console.log("  FINAL STATE")
  console.log("=" .repeat(70))
  console.log()
  console.log("Messages:")
  for (const msg of finalState.messages) {
    console.log(`  [${msg.from}]: ${msg.content}`)
  }
  console.log()
  if (finalState.currentDeal) {
    console.log(`Deal: "${finalState.currentDeal.terms}"`)
    console.log(`  Proposed by: ${finalState.currentDeal.proposedBy}`)
    console.log(`  Status: ${finalState.currentDeal.status}`)
  } else {
    console.log("No deal was proposed.")
  }
  console.log()
  console.log("=" .repeat(70))
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SharedBoardLive = Layer.effect(SharedBoard, makeSharedBoard)

const program = runNegotiation.pipe(
  Effect.provide(SharedBoardLive),
)

console.log("Starting dual-agent negotiation demo...")
console.log(`Using model: ${MODEL} (encrypted)`)
console.log()

Effect.runPromise(program).then(
  () => {
    console.log("Demo completed successfully.")
    process.exit(0)
  },
  (error) => {
    console.error("Demo failed:", error)
    process.exit(1)
  },
)
