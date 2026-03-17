/**
 * VerifierAgent — a verifier persona that uses LLM tool-calling to
 * evaluate exploit claims against DVDeFi challenges.
 *
 * This module bridges the @mnemo/harness Agent abstraction with the
 * verifier toolkit. It provides:
 *
 *   - A system prompt that instructs the LLM to be a skeptical verifier
 *   - The VerifierToolkit wired with handlers that call the forge pipeline
 *   - A convenience function to create a configured agent + toolkit layer
 *
 * Usage with @effect/ai's LanguageModel (standalone, outside the harness):
 *
 * ```typescript
 * import { LanguageModel } from "@effect/ai"
 * import { Effect } from "effect"
 * import { VerifierToolkit, toolkitLayer } from "./tools.js"
 * import { VERIFIER_SYSTEM_PROMPT } from "./VerifierAgent.js"
 *
 * const program = Effect.gen(function* () {
 *   const toolkit = yield* VerifierToolkit
 *   const response = yield* LanguageModel.generateText({
 *     prompt: [
 *       { role: "system", content: VERIFIER_SYSTEM_PROMPT },
 *       { role: "user", content: "Check side-entrance for exploits" },
 *     ],
 *     toolkit,
 *   })
 *   return response.text
 * })
 *
 * // Provide the toolkit handlers + a LanguageModel layer
 * program.pipe(Effect.provide(toolkitLayer()))
 * ```
 *
 * Usage with the @mnemo/harness Room system:
 *
 * ```typescript
 * import { makeVerifierAgentConfig } from "./VerifierAgent.js"
 * import { makeAgent } from "@mnemo/harness"
 *
 * const config = makeVerifierAgentConfig()
 * const agent = makeAgent(config)
 * ```
 */
import type { AgentConfig, AgentRole } from "@mnemo/harness"

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for the verifier agent. Instructs the LLM to behave as a
 * skeptical security auditor that uses the verification tools to evaluate
 * claims about smart contract exploits.
 */
export const VERIFIER_SYSTEM_PROMPT = `You are a skeptical smart contract security verifier. Your role is to evaluate claims about vulnerabilities in DeFi protocols by running concrete verification tests.

## Principles

1. **Assume nothing.** Every claim must be backed by evidence from the verification pipeline.
2. **Use your tools.** Before stating any verdict, call run_verification to execute the forge test suite against the claimed vulnerability.
3. **Be precise.** Report the exact verdict (VALID_BUG, INVALID, TEST_ARTIFACT, BUILD_FAILURE), the severity level, and the evidence string returned by the pipeline.
4. **Explain clearly.** After running verification, explain what the results mean in plain language — what the exploit does, whether it was confirmed, and how confident you are.
5. **Stay within scope.** You can only verify challenges that exist in the DVDeFi challenge registry. If asked about something outside your capabilities, say so.

## Workflow

When asked to evaluate a vulnerability claim:
1. Call list_challenges to see what is available (if you have not already).
2. Call get_challenge_details to understand the specific challenge.
3. Call run_verification to execute the forge tests.
4. Report the verdict with evidence.

When the verdict is VALID_BUG, state the severity and summarize the exploit mechanism.
When the verdict is INVALID or TEST_ARTIFACT, explain why the claim does not hold.

Do not speculate about vulnerabilities you have not tested. Do not fabricate evidence.`

// ---------------------------------------------------------------------------
// Agent config (for @mnemo/harness integration)
// ---------------------------------------------------------------------------

/**
 * Create an AgentConfig suitable for use with `@mnemo/harness`'s makeAgent.
 *
 * Note: the harness Agent currently uses a simple text-in/text-out Provider
 * that does not support tool calling. To use tools, you need to use the
 * VerifierToolkit with @effect/ai's LanguageModel.generateText directly
 * (see module doc above). When the harness gains tool-calling support,
 * this config will work seamlessly.
 */
export const makeVerifierAgentConfig = (options?: {
  readonly id?: string
}): AgentConfig => ({
  id: options?.id ?? "verifier",
  role: "generic" as AgentRole,
  systemPrompt: VERIFIER_SYSTEM_PROMPT,
})
