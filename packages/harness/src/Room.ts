/**
 * Negotiation Room — orchestrates a turn-based conversation between two agents.
 *
 * The Room manages turn alternation, message logging, and the negotiation loop.
 * It uses LanguageModel.LanguageModel from @effect/ai (not a custom Provider).
 *
 * After each turn, the room checks for tool calls:
 *   - accept_severity -> ACCEPTED outcome, severity agreed
 *   - reject_severity -> ABORTED outcome, prover walks away
 *   - No tool calls after maxTurns -> EXHAUSTED outcome
 */
import { Context, Effect, Layer } from "effect"
import * as LanguageModel from "@effect/ai/LanguageModel"
import { type AgentService, makeAgent, type AgentConfig, type AgentRunResult } from "@mnemo/core"
import { State } from "@mnemo/core"
import { RoomError } from "./Errors.js"
import type { Severity } from "@mnemo/verity"
import { isValidSeverity } from "./tools.js"
import { verifierHandlersLayer, proverHandlersLayer } from "./tools.js"

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
  readonly toolCalls: ReadonlyArray<{
    readonly name: string
    readonly params: Record<string, unknown>
  }>
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
  readonly negotiate: () => Effect.Effect<NegotiationResult, RoomError, LanguageModel.LanguageModel | State>
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
 * The room internally creates AgentService instances. It requires
 * LanguageModel.LanguageModel and State in the Effect environment.
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

  /**
   * Get the handler layer for an agent based on its role.
   * Handler layers are needed so the Toolkit Effect resolves (extracting
   * tool definitions), but handlers won't be called because
   * disableToolCallResolution is true.
   */
  const getHandlerLayer = (agent: AgentService): Layer.Layer<any> => {
    if (agent.config.role === "protocol") return verifierHandlersLayer
    return proverHandlersLayer
  }

  return {
    negotiate: () =>
      Effect.gen(function* () {
        const state = yield* State
        const turns: Array<Turn> = []

        const opening = roomConfig.openingMessage ?? "Let's begin the negotiation."

        let currentAgent: AgentService = agentA
        let otherAgent: AgentService = agentB
        let currentMessage = opening
        let outcome: NegotiationOutcome = "EXHAUSTED"
        let assignedSeverity: Severity | undefined
        let agreedSeverity: Severity | undefined

        for (let i = 0; i < roomConfig.maxTurns; i++) {
          const history = yield* state.getMessages().pipe(
            Effect.mapError(
              (e) => new RoomError({ message: `State read failed: ${e.message}`, cause: e })
            )
          )

          // Run the current agent's turn, providing the appropriate handler layer
          const result: AgentRunResult = yield* (currentAgent
            .runWithHistory(history, currentMessage) as Effect.Effect<AgentRunResult, any, any>)
            .pipe(
              Effect.provide(getHandlerLayer(currentAgent)),
              Effect.mapError(
                (e: any) => new RoomError({ message: `Agent ${currentAgent.config.id} failed: ${e.message ?? String(e)}`, cause: e })
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

          // Check for tool calls
          for (const tc of result.toolCalls) {
            if (tc.name === "approve_bug") {
              const sev = tc.params.severity
              if (isValidSeverity(sev)) {
                assignedSeverity = sev
              } else {
                yield* Effect.log(
                  `[Room] Warning: approve_bug called with invalid severity: ${String(tc.params.severity)}`
                )
              }
            } else if (tc.name === "reject_bug") {
              if (outcome !== "EXHAUSTED") {
                yield* Effect.log(`[Room] Warning: conflicting tool call reject_bug ignored (outcome already ${outcome})`)
              } else {
                outcome = "REJECTED"
              }
            } else if (tc.name === "accept_severity") {
              const sev = tc.params.severity
              if (outcome !== "EXHAUSTED") {
                yield* Effect.log(`[Room] Warning: conflicting tool call accept_severity ignored (outcome already ${outcome})`)
              } else if (isValidSeverity(sev)) {
                outcome = "ACCEPTED"
                agreedSeverity = sev
              } else {
                yield* Effect.log(
                  `[Room] Warning: accept_severity called with invalid severity: ${String(tc.params.severity)}`
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

          if (outcome !== "EXHAUSTED") {
            yield* Effect.log(
              `[Room] Negotiation ended: ${outcome}${agreedSeverity ? ` (severity: ${agreedSeverity})` : ""}`
            )
            break
          }

          currentMessage = result.response

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

export const layer = (
  agentAConfig: AgentConfig,
  agentBConfig: AgentConfig,
  roomConfig: RoomConfig
): Layer.Layer<Room> =>
  Layer.succeed(Room, makeRoom(agentAConfig, agentBConfig, roomConfig))
