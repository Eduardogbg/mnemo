/**
 * Negotiation Room — orchestrates a turn-based conversation between two agents.
 *
 * The Room manages turn alternation, message logging, and the negotiation loop.
 * It does not know about the LLM provider directly — it goes through Agent,
 * which goes through Provider. This layered composition is key to testability.
 *
 * After each turn, the room checks for tool calls:
 *   - accept_severity → ACCEPTED outcome, severity agreed
 *   - reject_severity → ABORTED outcome, prover walks away
 *   - No tool calls after maxTurns → EXHAUSTED outcome
 *
 * For now this is a simple turn loop. It will later incorporate the full
 * protocol state machine (scopes, consent, promotes) from the Quint spec.
 */
import { Context, Effect, Layer } from "effect"
import { type AgentService, makeAgent, type AgentConfig } from "@mnemo/core"
import { Provider } from "@mnemo/core"
import { State, type Message } from "@mnemo/core"
import { RoomError } from "./Errors.js"
import type { Severity } from "@mnemo/verity"
import { isValidSeverity, type ToolCall } from "./tools.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomConfig {
  /** Maximum number of turns (one turn = one agent speaks). */
  readonly maxTurns: number
  /** Optional opening message to kick off the negotiation. */
  readonly openingMessage?: string
  /** Optional callback invoked after each turn (e.g. for real-time streaming). */
  readonly onTurn?: (turn: Turn) => void
}

export interface Turn {
  readonly turnNumber: number
  readonly agentId: string
  readonly message: string
  readonly toolCalls: ReadonlyArray<ToolCall>
}

export type NegotiationOutcome = "ACCEPTED" | "REJECTED" | "EXHAUSTED"

export interface NegotiationResult {
  readonly turns: ReadonlyArray<Turn>
  readonly totalTurns: number
  readonly agentA: string
  readonly agentB: string
  readonly outcome: NegotiationOutcome
  /** Severity assigned by verifier (set on approve_bug) */
  readonly assignedSeverity?: Severity
  /** Severity agreed by prover (set on accept_severity) */
  readonly agreedSeverity?: Severity
}

export interface RoomService {
  /** Run the negotiation loop until maxTurns or a natural stop. */
  readonly negotiate: () => Effect.Effect<NegotiationResult, RoomError, Provider | State>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class Room extends Context.Tag("@mnemo/harness/Room")<
  Room,
  RoomService
>() {}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create a Room with two agents and a config.
 *
 * The room internally creates AgentService instances. It requires Provider
 * and State in the Effect environment (injected via layers).
 */
export const makeRoom = (
  agentAConfig: AgentConfig,
  agentBConfig: AgentConfig,
  roomConfig: RoomConfig
): RoomService => {
  if (agentAConfig.id === agentBConfig.id) {
    throw new RoomError({ message: `Agent IDs must be unique, both are "${agentAConfig.id}"` })
  }
  const agentA = makeAgent(agentAConfig)
  const agentB = makeAgent(agentBConfig)

  return {
    negotiate: () =>
      Effect.gen(function* () {
        const state = yield* State
        const turns: Array<Turn> = []

        // Determine the opening message
        const opening = roomConfig.openingMessage ?? "Let's begin the negotiation."

        // Agent A goes first with the opening prompt
        let currentAgent: AgentService = agentA
        let otherAgent: AgentService = agentB
        let currentMessage = opening
        let outcome: NegotiationOutcome = "EXHAUSTED"
        let assignedSeverity: Severity | undefined
        let agreedSeverity: Severity | undefined

        for (let i = 0; i < roomConfig.maxTurns; i++) {
          // Get full history for context
          const history = yield* state.getMessages().pipe(
            Effect.mapError(
              (e) => new RoomError({ message: `State read failed: ${e.message}`, cause: e })
            )
          )

          // Run the current agent's turn with the full history
          const result = yield* currentAgent
            .runWithHistory(history, currentMessage)
            .pipe(
              Effect.mapError(
                (e) => new RoomError({ message: `Agent ${currentAgent.config.id} failed: ${e.message}`, cause: e })
              )
            )

          // Log the exchange in state
          yield* state
            .appendMessage(
              i === 0 ? "system" : otherAgent.config.id,
              i === 0 ? "system" : "assistant",
              currentMessage
            )
            .pipe(
              Effect.mapError(
                (e) => new RoomError({ message: `State write failed: ${e.message}`, cause: e })
              )
            )

          yield* state
            .appendMessage(currentAgent.config.id, "assistant", result.response)
            .pipe(
              Effect.mapError(
                (e) => new RoomError({ message: `State write failed: ${e.message}`, cause: e })
              )
            )

          const turn: Turn = {
            turnNumber: i + 1,
            agentId: currentAgent.config.id,
            message: result.response,
            toolCalls: result.toolCalls,
          }
          turns.push(turn)
          roomConfig.onTurn?.(turn)

          yield* Effect.log(
            `[Turn ${turn.turnNumber}] ${turn.agentId}: ${turn.message.slice(0, 100)}...`
          )

          // Check for tool calls — these determine the negotiation outcome.
          // Only the first outcome-determining tool call per turn is honoured;
          // subsequent conflicting calls are logged and ignored.
          for (const tc of result.toolCalls) {
            if (tc.name === "approve_bug") {
              const sev = tc.args.severity
              if (isValidSeverity(sev)) {
                assignedSeverity = sev
              } else {
                yield* Effect.log(
                  `[Room] Warning: approve_bug called with invalid severity: ${String(tc.args.severity)}`
                )
              }
            } else if (tc.name === "reject_bug") {
              if (outcome !== "EXHAUSTED") {
                yield* Effect.log(`[Room] Warning: conflicting tool call reject_bug ignored (outcome already ${outcome})`)
              } else {
                outcome = "REJECTED"
              }
            } else if (tc.name === "accept_severity") {
              const sev = tc.args.severity
              if (outcome !== "EXHAUSTED") {
                yield* Effect.log(`[Room] Warning: conflicting tool call accept_severity ignored (outcome already ${outcome})`)
              } else if (isValidSeverity(sev)) {
                outcome = "ACCEPTED"
                agreedSeverity = sev
              } else {
                yield* Effect.log(
                  `[Room] Warning: accept_severity called with invalid severity: ${String(tc.args.severity)}`
                )
              }
            } else if (tc.name === "reject_severity") {
              if (outcome !== "EXHAUSTED") {
                yield* Effect.log(`[Room] Warning: conflicting tool call reject_severity ignored (outcome already ${outcome})`)
              } else {
                outcome = "REJECTED"
              }
            }
          }

          // If a tool call resolved the outcome, stop the loop
          if (outcome !== "EXHAUSTED") {
            yield* Effect.log(
              `[Room] Negotiation ended: ${outcome}${agreedSeverity ? ` (severity: ${agreedSeverity})` : ""}`
            )
            break
          }

          // The current agent's response becomes the next agent's input
          currentMessage = result.response

          // Swap agents
          const tmp = currentAgent
          currentAgent = otherAgent
          otherAgent = tmp
        }

        return {
          turns,
          totalTurns: turns.length,
          agentA: agentAConfig.id,
          agentB: agentBConfig.id,
          outcome,
          assignedSeverity,
          agreedSeverity,
        } satisfies NegotiationResult
      }),
  }
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

/**
 * Create a Room layer from agent configs and room config.
 */
export const layer = (
  agentAConfig: AgentConfig,
  agentBConfig: AgentConfig,
  roomConfig: RoomConfig
): Layer.Layer<Room> =>
  Layer.succeed(Room, makeRoom(agentAConfig, agentBConfig, roomConfig))
