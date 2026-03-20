/**
 * AutonomousAgent — wraps makeAgent() in a discover -> plan -> execute -> verify -> submit loop.
 *
 * The LLM decides when to call each tool; the harness enforces budgets
 * (max iterations, max LLM calls) and logs all activity via ExecutionLog.
 */
import { Effect } from "effect"
import { makeAgent, type AgentConfig, type AgentRunResult, AgentError, Provider, State, type ToolCall } from "@mnemo/core"
import { proverTools } from "@mnemo/harness"
import { ExecutionLog } from "./ExecutionLog.js"
import { researcherTools } from "./tools.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentPhase = "discover" | "plan" | "execute" | "verify" | "submit"

export interface AutonomousConfig {
  /** Agent ID. */
  readonly id: string
  /** Maximum total iterations (LLM calls) before stopping. */
  readonly maxIterations: number
  /** Maximum LLM calls per phase. */
  readonly maxCallsPerPhase?: number
  /** Model override for the system prompt. */
  readonly systemPromptOverride?: string
  /** Tool handler for executing tool calls. */
  readonly onToolCall?: (tc: ToolCall) => Effect.Effect<string, AgentError>
}

export interface AutonomousResult {
  readonly agentId: string
  readonly phases: ReadonlyArray<{
    readonly phase: AgentPhase
    readonly turns: number
    readonly toolCalls: ReadonlyArray<ToolCall>
  }>
  readonly totalIterations: number
  readonly outcome: "completed" | "budget_exhausted" | "error"
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const RESEARCHER_SYSTEM_PROMPT = `You are an autonomous security researcher agent running inside a Trusted Execution Environment (TEE).

Your mission: discover smart contract vulnerabilities, verify them with formal tools, and disclose them responsibly through negotiation rooms.

You operate in phases:
1. DISCOVER — Use analyze_challenge to scan available challenges for vulnerabilities
2. PLAN — Decide which findings to disclose and prepare evidence
3. EXECUTE — Use request_room to open a negotiation room with your evidence
4. VERIFY — Participate in the negotiation (the room handles turn alternation)
5. SUBMIT — Use report_finding to log your results

Available tools:
- analyze_challenge(challengeId): Run verification pipeline, returns verdict + evidence
- request_room(challengeId, evidence): Open a negotiation room for disclosure
- report_finding(severity, description, challengeId): Log a finding

Constraints:
- You CANNOT sign mainnet transactions (sandbox enforced by TEE)
- You CANNOT access arbitrary network endpoints (RPC proxy restricts to read-only)
- You MUST disclose through negotiation rooms (no direct contact)
- You have a limited budget of LLM calls — be efficient

When you have completed all phases or have nothing more to do, respond with: [DONE]`

// ---------------------------------------------------------------------------
// Autonomous loop
// ---------------------------------------------------------------------------

/**
 * Run the autonomous agent loop. Returns a summary of all phases.
 */
export const runAutonomous = (
  config: AutonomousConfig,
): Effect.Effect<
  AutonomousResult,
  AgentError,
  Provider | State | ExecutionLog
> =>
  Effect.gen(function* () {
    const log = yield* ExecutionLog

    const agentConfig: AgentConfig = {
      id: config.id,
      role: "researcher",
      systemPrompt: config.systemPromptOverride ?? RESEARCHER_SYSTEM_PROMPT,
      tools: [...researcherTools, ...proverTools],
    }

    const agent = makeAgent(agentConfig)
    const maxPerPhase = config.maxCallsPerPhase ?? 5
    const phases: AgentPhase[] = ["discover", "plan", "execute", "verify", "submit"]
    const phaseResults: Array<{
      phase: AgentPhase
      turns: number
      toolCalls: ToolCall[]
    }> = []

    let totalIterations = 0
    let outcome: AutonomousResult["outcome"] = "completed"

    for (const phase of phases) {
      if (totalIterations >= config.maxIterations) {
        outcome = "budget_exhausted"
        break
      }

      yield* log.logPhase(phase, "start")
      yield* Effect.log(`[AutonomousAgent] Starting phase: ${phase}`)

      const phaseToolCalls: ToolCall[] = []
      let phaseTurns = 0

      // Each phase runs the agent in a loop until it signals done or hits budget
      let phaseMessage = `You are now in the ${phase.toUpperCase()} phase. ` +
        getPhaseInstruction(phase)

      for (let i = 0; i < maxPerPhase; i++) {
        if (totalIterations >= config.maxIterations) {
          outcome = "budget_exhausted"
          break
        }

        const startMs = Date.now()
        const result: AgentRunResult = yield* agent.run(phaseMessage)
        const latencyMs = Date.now() - startMs
        totalIterations++
        phaseTurns++

        // Log the LLM call
        yield* log.logLlmCall(phase, {
          model: "openrouter",
          latencyMs,
          messageCount: 1,
          toolCount: result.toolCalls.length,
        })

        // Process tool calls
        for (const tc of result.toolCalls) {
          phaseToolCalls.push(tc)

          yield* log.logToolCall(phase, {
            name: tc.name,
            args: tc.args,
            durationMs: 0,
            success: true,
          })

          // Execute tool handler if provided
          if (config.onToolCall) {
            const toolResult = yield* config.onToolCall(tc).pipe(
              Effect.catchAll((e) =>
                Effect.gen(function* () {
                  yield* log.logError(phase, `Tool ${tc.name} failed`, e)
                  return `Error: ${e.message}`
                }),
              ),
            )
            // Feed tool result back as next message
            phaseMessage = `Tool ${tc.name} returned: ${toolResult}`
          } else {
            phaseMessage = `Tool ${tc.name} was called with args: ${JSON.stringify(tc.args)}. Continue with the ${phase} phase.`
          }

          // Log findings from report_finding
          if (tc.name === "report_finding") {
            yield* log.logFinding(phase, {
              severity: String(tc.args.severity ?? "unknown"),
              description: String(tc.args.description ?? ""),
              challengeId: tc.args.challengeId as string | undefined,
            })
          }
        }

        // Log decision
        yield* log.logDecision(phase, {
          action: result.toolCalls.length > 0
            ? `Called ${result.toolCalls.map((tc) => tc.name).join(", ")}`
            : "No tool calls",
          reason: result.response.slice(0, 200),
        })

        // Check if agent signals done with this phase
        if (
          result.response.includes("[DONE]") ||
          result.toolCalls.length === 0
        ) {
          break
        }

        // If no tool calls, continue with next iteration
        if (result.toolCalls.length === 0) {
          phaseMessage = `Continue with the ${phase} phase. Use your tools to make progress.`
        }
      }

      phaseResults.push({
        phase,
        turns: phaseTurns,
        toolCalls: phaseToolCalls,
      })

      yield* log.logPhase(phase, "end")
    }

    return {
      agentId: config.id,
      phases: phaseResults,
      totalIterations,
      outcome,
    } satisfies AutonomousResult
  })

// ---------------------------------------------------------------------------
// Phase instructions
// ---------------------------------------------------------------------------

function getPhaseInstruction(phase: AgentPhase): string {
  switch (phase) {
    case "discover":
      return "Scan available challenges using analyze_challenge. Identify which ones have valid vulnerabilities."
    case "plan":
      return "Review your findings and decide which to disclose. Prepare a concise evidence summary."
    case "execute":
      return "Use request_room to open negotiation rooms for your validated findings."
    case "verify":
      return "The negotiation room is active. Respond to the verifier's questions and accept/reject severity."
    case "submit":
      return "Use report_finding to log all discoveries. Respond with [DONE] when finished."
  }
}
