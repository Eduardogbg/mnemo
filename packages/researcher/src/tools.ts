/**
 * Researcher tool definitions — autonomous discovery and disclosure.
 */
import type { ToolDefinition } from "@mnemo/core"

export const researcherTools: ReadonlyArray<ToolDefinition> = [
  {
    name: "analyze_challenge",
    description:
      "Run the forge-only verification pipeline against a DVDeFi challenge. " +
      "Returns a verdict (VALID_BUG, INVALID, TEST_ARTIFACT, or BUILD_FAILURE), severity, and evidence string.",
    parameters: {
      type: "object",
      properties: {
        challengeId: {
          type: "string",
          description: "The challenge ID to analyze (e.g. 'side-entrance', 'truster', 'unstoppable')",
        },
      },
      required: ["challengeId"],
      additionalProperties: false,
    },
  },
  {
    name: "request_room",
    description:
      "Request a negotiation room for bug disclosure. Provides evidence from analysis to start the disclosure process.",
    parameters: {
      type: "object",
      properties: {
        challengeId: {
          type: "string",
          description: "The challenge ID the finding relates to",
        },
        evidence: {
          type: "string",
          description: "Summary of the vulnerability evidence from the analysis",
        },
      },
      required: ["challengeId", "evidence"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Log a security finding for the execution log. Use this to record discoveries during the research process.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low", "informational"],
          description: "The estimated severity of the finding",
        },
        description: {
          type: "string",
          description: "Detailed description of the vulnerability and its impact",
        },
        challengeId: {
          type: "string",
          description: "The challenge ID this finding relates to",
        },
      },
      required: ["severity", "description"],
      additionalProperties: false,
    },
  },
] as const
