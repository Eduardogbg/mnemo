/**
 * Researcher tool definitions — autonomous discovery and disclosure.
 *
 * Uses @effect/ai Tool.make() for type-safe tool calling.
 */
import * as Tool from "@effect/ai/Tool"
import * as Toolkit from "@effect/ai/Toolkit"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"

export const AnalyzeChallenge = Tool.make("analyze_challenge", {
  description:
    "Run the forge-only verification pipeline against a DVDeFi challenge. " +
    "Returns a verdict (VALID_BUG, INVALID, TEST_ARTIFACT, or BUILD_FAILURE), severity, and evidence string.",
  parameters: {
    challengeId: Schema.String.annotations({
      description: "The challenge ID to analyze (e.g. 'side-entrance', 'truster', 'unstoppable')",
    }),
  },
  success: Schema.Struct({
    challengeId: Schema.String,
    result: Schema.String,
  }),
})

export const RequestRoom = Tool.make("request_room", {
  description:
    "Request a negotiation room for bug disclosure. Provides evidence from analysis to start the disclosure process.",
  parameters: {
    challengeId: Schema.String.annotations({
      description: "The challenge ID the finding relates to",
    }),
    evidence: Schema.String.annotations({
      description: "Summary of the vulnerability evidence from the analysis",
    }),
  },
  success: Schema.Struct({
    challengeId: Schema.String,
    evidence: Schema.String,
  }),
})

export const ReportFinding = Tool.make("report_finding", {
  description:
    "Log a security finding for the execution log. Use this to record discoveries during the research process.",
  parameters: {
    severity: Schema.Literal("critical", "high", "medium", "low", "informational").annotations({
      description: "The estimated severity of the finding",
    }),
    description: Schema.String.annotations({
      description: "Detailed description of the vulnerability and its impact",
    }),
    challengeId: Schema.optional(Schema.String).annotations({
      description: "The challenge ID this finding relates to",
    }),
  },
  success: Schema.Struct({
    severity: Schema.String,
    description: Schema.String,
  }),
})

export const researcherToolkit = Toolkit.make(AnalyzeChallenge, RequestRoom, ReportFinding)

/** Signal handlers — just echo params back (AutonomousAgent processes tool calls manually) */
export const researcherHandlersLayer = researcherToolkit.toLayer(
  Effect.succeed({
    analyze_challenge: ({ challengeId }: { challengeId: string }) =>
      Effect.succeed({ challengeId, result: "pending" }),
    request_room: ({ challengeId, evidence }: { challengeId: string; evidence: string }) =>
      Effect.succeed({ challengeId, evidence }),
    report_finding: ({ severity, description }: { severity: string; description: string }) =>
      Effect.succeed({ severity, description }),
  }),
)
