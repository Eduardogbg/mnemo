/**
 * Negotiation tool definitions — verifier and prover tools.
 */
import type { ToolDefinition } from "@mnemo/core"
export type { ToolDefinition, ToolCall, GenerateTextResult } from "@mnemo/core"
export { isValidSeverity } from "@mnemo/core"

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
