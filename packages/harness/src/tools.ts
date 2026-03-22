/**
 * Negotiation tool definitions — verifier and prover tools.
 *
 * Uses @effect/ai Tool.make() + Toolkit.make() for type-safe tool calling.
 * Signal tools: handlers just echo args back (Room inspects tool calls manually).
 */
import * as Tool from "@effect/ai/Tool"
import * as Toolkit from "@effect/ai/Toolkit"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
export { isValidSeverity } from "@mnemo/core"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const Severity = Schema.Literal("critical", "high", "medium", "low")

// ---------------------------------------------------------------------------
// Verifier tools
// ---------------------------------------------------------------------------

export const ApproveBug = Tool.make("approve_bug", {
  description:
    "Approve the researcher's bug report as valid. Assigns a severity level based on the evidence and the researcher's description.",
  parameters: {
    severity: Severity.annotations({ description: "The severity level assigned to the confirmed vulnerability" }),
    reason: Schema.String.annotations({ description: "Brief justification for the verdict and severity" }),
  },
  success: Schema.Struct({ severity: Severity, reason: Schema.String }),
})

export const RejectBug = Tool.make("reject_bug", {
  description:
    "Reject the researcher's bug report as invalid. The evidence does not support the claim.",
  parameters: {
    reason: Schema.String.annotations({ description: "Why the bug report is being rejected" }),
  },
  success: Schema.Struct({ reason: Schema.String }),
})

export const verifierToolkit = Toolkit.make(ApproveBug, RejectBug)

// ---------------------------------------------------------------------------
// Prover tools
// ---------------------------------------------------------------------------

export const AcceptSeverity = Tool.make("accept_severity", {
  description:
    "Accept the severity level assigned by the verifier. This finalizes the negotiation with an ACCEPTED outcome.",
  parameters: {
    severity: Severity.annotations({ description: "The severity level being accepted" }),
  },
  success: Schema.Struct({ severity: Severity }),
})

export const RejectSeverity = Tool.make("reject_severity", {
  description:
    "Reject the severity level assigned by the verifier. This aborts the negotiation — the prover walks away.",
  parameters: {
    severity: Severity.annotations({ description: "The severity level being rejected" }),
    reason: Schema.String.annotations({ description: "Why the prover disagrees with the assigned severity" }),
  },
  success: Schema.Struct({ severity: Severity, reason: Schema.String }),
})

export const proverToolkit = Toolkit.make(AcceptSeverity, RejectSeverity)

// ---------------------------------------------------------------------------
// Handler layers — signal tools just echo params back
// ---------------------------------------------------------------------------

export const verifierHandlersLayer = verifierToolkit.toLayer(
  Effect.succeed({
    approve_bug: ({ severity, reason }: { severity: string; reason: string }) =>
      Effect.succeed({ severity: severity as any, reason }),
    reject_bug: ({ reason }: { reason: string }) =>
      Effect.succeed({ reason }),
  }),
)

export const proverHandlersLayer = proverToolkit.toLayer(
  Effect.succeed({
    accept_severity: ({ severity }: { severity: string }) =>
      Effect.succeed({ severity: severity as any }),
    reject_severity: ({ severity, reason }: { severity: string; reason: string }) =>
      Effect.succeed({ severity: severity as any, reason }),
  }),
)
