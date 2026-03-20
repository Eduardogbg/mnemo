/**
 * ExecutionLog — structured logging service for autonomous agent execution.
 *
 * Captures LLM calls, tool invocations, decisions, errors, and on-chain
 * transactions. Accumulates entries in an Effect.Ref and flushes to
 * agent_log.json at session end.
 *
 * Pattern: Effect service with Ref<Array<LogEntry>> accumulator.
 */
import { Context, Effect, Layer, Ref } from "effect"
import { writeFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogEntryType =
  | "llm_call"
  | "tool_call"
  | "decision"
  | "error"
  | "retry"
  | "on_chain_tx"
  | "phase_start"
  | "phase_end"
  | "finding"

export interface LogEntry {
  readonly timestamp: string
  readonly type: LogEntryType
  readonly phase?: string
  readonly data: Record<string, unknown>
}

export interface LlmCallData {
  readonly model: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly latencyMs: number
  readonly system?: string
  readonly messageCount: number
  readonly toolCount: number
  readonly finishReason?: string
}

export interface ToolCallData {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly result?: unknown
  readonly durationMs: number
  readonly success: boolean
}

export interface DecisionData {
  readonly action: string
  readonly reason: string
  readonly context?: Record<string, unknown>
}

export interface OnChainTxData {
  readonly method: string
  readonly contract: string
  readonly txHash?: string
  readonly chain: string
  readonly success: boolean
  readonly gasUsed?: string
}

export interface FindingData {
  readonly severity: string
  readonly description: string
  readonly challengeId?: string
  readonly verdict?: string
}

export interface ExecutionLogService {
  /** Log an LLM call. */
  readonly logLlmCall: (phase: string, data: LlmCallData) => Effect.Effect<void>
  /** Log a tool invocation. */
  readonly logToolCall: (phase: string, data: ToolCallData) => Effect.Effect<void>
  /** Log an autonomous decision. */
  readonly logDecision: (phase: string, data: DecisionData) => Effect.Effect<void>
  /** Log an error or retry. */
  readonly logError: (phase: string, message: string, cause?: unknown) => Effect.Effect<void>
  /** Log an on-chain transaction. */
  readonly logOnChainTx: (phase: string, data: OnChainTxData) => Effect.Effect<void>
  /** Log a phase transition. */
  readonly logPhase: (phase: string, action: "start" | "end") => Effect.Effect<void>
  /** Log a security finding. */
  readonly logFinding: (phase: string, data: FindingData) => Effect.Effect<void>
  /** Get all accumulated entries. */
  readonly getEntries: () => Effect.Effect<ReadonlyArray<LogEntry>>
  /** Flush all entries to a JSON file. */
  readonly flush: (path: string) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class ExecutionLog extends Context.Tag("@mnemo/researcher/ExecutionLog")<
  ExecutionLog,
  ExecutionLogService
>() {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const makeExecutionLog = Effect.gen(function* () {
  const entriesRef = yield* Ref.make<Array<LogEntry>>([])

  const append = (entry: LogEntry) =>
    Ref.update(entriesRef, (entries) => [...entries, entry])

  const now = () => new Date().toISOString()

  const service: ExecutionLogService = {
    logLlmCall: (phase, data) =>
      append({
        timestamp: now(),
        type: "llm_call",
        phase,
        data: data as unknown as Record<string, unknown>,
      }),

    logToolCall: (phase, data) =>
      append({
        timestamp: now(),
        type: "tool_call",
        phase,
        data: data as unknown as Record<string, unknown>,
      }),

    logDecision: (phase, data) =>
      append({
        timestamp: now(),
        type: "decision",
        phase,
        data: data as unknown as Record<string, unknown>,
      }),

    logError: (phase, message, cause) =>
      append({
        timestamp: now(),
        type: "error",
        phase,
        data: {
          message,
          cause: cause instanceof Error ? cause.message : String(cause ?? ""),
        },
      }),

    logOnChainTx: (phase, data) =>
      append({
        timestamp: now(),
        type: "on_chain_tx",
        phase,
        data: data as unknown as Record<string, unknown>,
      }),

    logPhase: (phase, action) =>
      append({
        timestamp: now(),
        type: action === "start" ? "phase_start" : "phase_end",
        phase,
        data: { action },
      }),

    logFinding: (phase, data) =>
      append({
        timestamp: now(),
        type: "finding",
        phase,
        data: data as unknown as Record<string, unknown>,
      }),

    getEntries: () => Ref.get(entriesRef),

    flush: (path) =>
      Effect.gen(function* () {
        const entries = yield* Ref.get(entriesRef)
        const output = {
          agent: "mnemo-ethical-hacker",
          version: "0.1.0",
          generatedAt: now(),
          totalEntries: entries.length,
          phases: summarizePhases(entries),
          entries,
        }
        writeFileSync(path, JSON.stringify(output, null, 2))
        yield* Effect.log(`[ExecutionLog] Flushed ${entries.length} entries to ${path}`)
      }),
  }

  return service
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizePhases(entries: ReadonlyArray<LogEntry>): Record<string, unknown> {
  const phases: Record<string, { started?: string; ended?: string; entryCount: number }> = {}
  for (const entry of entries) {
    if (!entry.phase) continue
    if (!phases[entry.phase]) {
      phases[entry.phase] = { entryCount: 0 }
    }
    phases[entry.phase].entryCount++
    if (entry.type === "phase_start") phases[entry.phase].started = entry.timestamp
    if (entry.type === "phase_end") phases[entry.phase].ended = entry.timestamp
  }
  return phases
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const ExecutionLogLive: Layer.Layer<ExecutionLog> = Layer.effect(
  ExecutionLog,
  makeExecutionLog,
)
