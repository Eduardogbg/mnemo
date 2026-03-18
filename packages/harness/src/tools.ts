/**
 * Tool definitions for structured tool-calling in negotiation rooms.
 *
 * Uses OpenAI function-calling format (name, description, parameters JSON schema)
 * so tools work with any OpenAI-compatible provider.
 */
import type { Severity } from "@mnemo/verity"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Verifier tools — approve or reject the bug claim
// ---------------------------------------------------------------------------

export const verifierTools: ReadonlyArray<ToolDefinition> = [
  {
    name: "approve_bug",
    description:
      "Approve the researcher's bug report as valid. Assigns a severity level based on the evidence and the researcher's description.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "The severity level assigned to the confirmed vulnerability",
        },
        reason: {
          type: "string",
          description: "Brief justification for the verdict and severity",
        },
      },
      required: ["severity", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "reject_bug",
    description:
      "Reject the researcher's bug report as invalid. The evidence does not support the claim.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why the bug report is being rejected",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
] as const

// ---------------------------------------------------------------------------
// Prover tools — accept or reject the assigned severity
// ---------------------------------------------------------------------------

export const proverTools: ReadonlyArray<ToolDefinition> = [
  {
    name: "accept_severity",
    description:
      "Accept the severity level assigned by the verifier. This finalizes the negotiation with an ACCEPTED outcome.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "The severity level being accepted",
        },
      },
      required: ["severity"],
      additionalProperties: false,
    },
  },
  {
    name: "reject_severity",
    description:
      "Reject the severity level assigned by the verifier. This aborts the negotiation — the prover walks away.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "The severity level being rejected",
        },
        reason: {
          type: "string",
          description: "Why the prover disagrees with the assigned severity",
        },
      },
      required: ["severity", "reason"],
      additionalProperties: false,
    },
  },
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const isValidSeverity = (s: unknown): s is Severity =>
  typeof s === "string" && ["critical", "high", "medium", "low"].includes(s)
