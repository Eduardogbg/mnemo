/**
 * Shared tool types for structured tool-calling.
 */
import { SEVERITIES, type Severity } from "@mnemo/verity"

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export interface ToolCall {
  readonly name: string
  readonly args: Record<string, unknown>
}

export interface GenerateTextResult {
  readonly text: string
  readonly toolCalls: ReadonlyArray<ToolCall>
}

export const isValidSeverity = (s: unknown): s is Severity =>
  typeof s === "string" && SEVERITIES.includes(s as Severity)
