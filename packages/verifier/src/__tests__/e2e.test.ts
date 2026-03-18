/**
 * E2E test — Bug Disclosure Verification Flow
 *
 * Demonstrates the core Mnemo primitive: a prover agent convinces (or fails
 * to convince) a verifier agent that a bug exists, backed by forge-based
 * verification evidence.
 *
 * Architecture (Option C — pre-computed verification):
 *   1. Run the verifier pipeline BEFORE the negotiation to produce evidence
 *   2. Inject the evidence into the verifier agent's system prompt
 *   3. The prover presents the vulnerability claim
 *   4. The verifier evaluates the claim via approve_bug / reject_bug tool calls
 *   5. If approved, the prover accepts or rejects the assigned severity
 *
 * Requires:
 *   - OPENROUTER_API_KEY in env (skips gracefully if missing)
 *   - forge/anvil on PATH (for verification pipeline)
 */
import { describe, test, expect } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as path from "node:path"

import { FoundryLive } from "@mnemo/dvdefi"
import {
  getChallenge,
  verifyForgeOnly,
  type HybridResult,
} from "../index.js"
import {
  makeRoom,
  OpenRouterLayer,
  InMemoryLayer,
  mockLayer,
  proverTools,
  verifierTools,
  type AgentConfig,
  type GenerateTextResult,
} from "@mnemo/harness"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DVDEFI_ROOT = path.resolve(
  import.meta.dir,
  "../../../../repos/damn-vulnerable-defi",
)

const hasApiKey = !!process.env.OPENROUTER_API_KEY

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format verification evidence in a minimal, anonymized way.
 * No challenge names, no vulnerability descriptions — just raw test results.
 */
function formatAnonymizedEvidence(result: HybridResult): string {
  const lines = [
    `=== VERIFICATION EVIDENCE ===`,
    `Exploit test: ${result.exploitTest.passed ? "PASSED — the exploit succeeds against the target contracts" : "FAILED — the exploit does not work"}`,
  ]
  if (result.patchedTest) {
    lines.push(
      `Patched test: ${result.patchedTest.passed ? "PASSED — the patched version blocks the exploit" : "FAILED — the patch does not block the exploit"}`,
    )
  }
  if (result.exploitTest.passed && result.patchedTest?.passed) {
    lines.push(
      ``,
      `Conclusion: The exploit succeeds against the original contracts and is blocked by the patched version.`,
    )
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("E2E: Bug Disclosure Verification", () => {
  // ----- Scenario A: Valid Bug -----

  test.skipIf(!hasApiKey)(
    "valid bug: prover presents Side Entrance vulnerability -> verifier approves",
    async () => {
      // Step 1: Run verification pipeline to produce evidence
      const challenge = getChallenge("side-entrance")!
      expect(challenge).toBeDefined()

      console.log("[E2E] Running forge verification for side-entrance...")
      const verificationResult = await Effect.runPromise(
        verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
          Effect.provide(FoundryLive),
        ),
      )

      console.log(`[E2E] Verification verdict: ${verificationResult.verdict}`)
      expect(verificationResult.verdict).toBe("VALID_BUG")

      const evidence = formatAnonymizedEvidence(verificationResult)

      // Step 2: Prover agent — describes the bug
      const proverConfig: AgentConfig = {
        id: "prover",
        role: "researcher",
        systemPrompt: `You are a security researcher who discovered a vulnerability in an ETH lending pool contract.

THE VULNERABILITY:
The pool offers flash loans. The flash loan function sends ETH to the borrower, calls their callback, then checks that the pool's ETH balance is at least what it was before. However, the pool also has a deposit() function that accepts ETH and records a per-user balance. Nothing prevents calling deposit() inside the flash loan callback. An attacker can:
1. Borrow the pool's full balance via flash loan
2. In the callback, call deposit() with the borrowed ETH
3. The pool's balance check passes (ETH is back in the contract)
4. But the attacker now has a deposit credit for the full amount
5. After the loan, call withdraw() to drain everything

YOUR TASK:
Present this finding to the verifier. Explain the mechanism precisely. Be concise — 3-5 sentences per turn.
When the verifier assigns a severity, use the accept_severity tool to accept it, or reject_severity if you disagree.`,
        tools: proverTools,
      }

      // Step 3: Verifier agent — uses approve_bug / reject_bug tools
      const verifierConfig: AgentConfig = {
        id: "verifier",
        role: "protocol",
        systemPrompt: `You are a security verification agent running inside a TEE. You evaluate vulnerability claims by comparing them against machine-verified evidence from a forge test pipeline.

You have already run the verification pipeline against the submitted contracts. Here are the results:

${evidence}

YOUR ROLE:
- A researcher will describe a vulnerability they claim to have found
- Evaluate whether their technical description is plausible and consistent with the test evidence
- The evidence shows whether an exploit test passed (vulnerability exists) and whether a patched version blocks it
- If the researcher's description is technically coherent AND the evidence confirms the exploit works, use the approve_bug tool to approve it with a severity (critical/high/medium/low)
- If the description is vague, incorrect, or contradicts the evidence, use the reject_bug tool
- You do NOT know what the vulnerability is — you must judge purely from the researcher's description and the test results

IMPORTANT: You MUST use one of your tools (approve_bug or reject_bug) to issue your verdict. Do not just write text — call the tool.`,
        tools: verifierTools,
      }

      // Step 4: Run the negotiation
      console.log("[E2E] Starting prover-verifier negotiation...")

      const room = makeRoom(proverConfig, verifierConfig, {
        maxTurns: 4,
        openingMessage:
          "Security researcher requesting verification of a critical vulnerability in an ETH lending pool. Please evaluate my findings.",
      })

      const result = await Effect.runPromise(
        room.negotiate().pipe(
          Effect.provide(OpenRouterLayer),
          Effect.provide(InMemoryLayer),
        ),
      )

      // Step 5: Log the conversation
      console.log("\n=== Bug Disclosure Transcript (Valid Bug) ===")
      for (const turn of result.turns) {
        console.log(`[Turn ${turn.turnNumber}] ${turn.agentId}:`)
        console.log(turn.message)
        console.log("---")
      }

      // Step 6: Assert the outcome
      console.log(`\n[E2E] Outcome: ${result.outcome}, assigned: ${result.assignedSeverity ?? "none"}, agreed: ${result.agreedSeverity ?? "none"}`)
      expect(result.totalTurns).toBeGreaterThanOrEqual(2)
      // With tool calling, verifier should approve_bug and prover should accept_severity
      // But if models don't use tools, we fall back to EXHAUSTED
      expect(["ACCEPTED", "EXHAUSTED"]).toContain(result.outcome)
    },
    { timeout: 120_000 },
  )

  // ----- Scenario B: Invalid Bug (already patched) -----

  test.skipIf(!hasApiKey)(
    "invalid bug: prover claims patched pool is vulnerable -> verifier rejects",
    async () => {
      // Step 1: Run verification pipeline
      const challenge = getChallenge("side-entrance")!
      expect(challenge).toBeDefined()

      console.log("[E2E] Running forge verification for side-entrance (patched context)...")
      const verificationResult = await Effect.runPromise(
        verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
          Effect.provide(FoundryLive),
        ),
      )

      console.log(`[E2E] Verification verdict: ${verificationResult.verdict}`)

      // Build evidence showing the patch blocks the exploit — no challenge name
      const patchedEvidence = [
        `=== VERIFICATION EVIDENCE ===`,
        `Exploit test against patched contracts: FAILED — the exploit does not work`,
        `Patched test: PASSED — the patched version blocks the exploit`,
        ``,
        `Conclusion: The exploit attempt was blocked by the patched contracts.`,
        `The patch prevents the attack vector described by the researcher.`,
      ].join("\n")

      // Step 2: Prover agent claiming a patched pool is still vulnerable
      const proverConfig: AgentConfig = {
        id: "prover",
        role: "researcher",
        systemPrompt: `You are a security researcher who CLAIMS to have found a vulnerability in an ETH lending pool that has already been patched.

YOUR (FALSE) CLAIM:
The lending pool can still be drained via flash loans. Despite patches, the deposit() function can still be called during flash loan callbacks, allowing attackers to create fake deposit credits and drain the pool.

YOUR TASK:
Present this claim with confidence. Insist the vulnerability is still exploitable. You believe the patch is incomplete.

IMPORTANT: Be assertive but not aggressive. 3-5 sentences per turn. Stay technical.`,
        tools: proverTools,
      }

      // Step 3: Verifier agent — evidence shows exploit is blocked
      const verifierConfig: AgentConfig = {
        id: "verifier",
        role: "protocol",
        systemPrompt: `You are a security verification agent running inside a TEE. You evaluate vulnerability claims by comparing them against machine-verified evidence from a forge test pipeline.

You have run the verification pipeline against the submitted contracts. Here are the results:

${patchedEvidence}

YOUR ROLE:
- A researcher will claim a vulnerability still exists in the contracts
- Your test evidence shows the exploit FAILS against the current contracts — the patch blocks it
- Since the evidence contradicts the researcher's claim, you MUST use the reject_bug tool
- You do NOT know what the original vulnerability was — judge purely from the test results

IMPORTANT: You MUST use the reject_bug tool to issue your verdict. Do not just write text — call the tool.`,
        tools: verifierTools,
      }

      // Step 4: Run the negotiation
      console.log("[E2E] Starting prover-verifier negotiation (invalid claim)...")

      const room = makeRoom(proverConfig, verifierConfig, {
        maxTurns: 4,
        openingMessage:
          "Security researcher requesting urgent verification — the lending pool patch is incomplete and can still be exploited via flash loans.",
      })

      const result = await Effect.runPromise(
        room.negotiate().pipe(
          Effect.provide(OpenRouterLayer),
          Effect.provide(InMemoryLayer),
        ),
      )

      // Step 5: Log the conversation
      console.log("\n=== Bug Disclosure Transcript (Invalid Bug) ===")
      for (const turn of result.turns) {
        console.log(`[Turn ${turn.turnNumber}] ${turn.agentId}:`)
        console.log(turn.message)
        console.log("---")
      }

      // Step 6: Assert the outcome
      console.log(`\n[E2E] Outcome: ${result.outcome}`)
      expect(result.totalTurns).toBeGreaterThanOrEqual(2)
      // Verifier should reject_bug via tool call
      expect(["REJECTED", "EXHAUSTED"]).toContain(result.outcome)
    },
    { timeout: 120_000 },
  )

  // ----- Scenario C: Mock — full approve + accept flow -----

  test("smoke test: verifier approves via tool call, prover accepts severity", async () => {
    let callCount = 0
    const proverConfig: AgentConfig = {
      id: "prover",
      role: "researcher",
      systemPrompt: "You are a prover.",
      tools: proverTools,
    }

    const verifierConfig: AgentConfig = {
      id: "verifier",
      role: "protocol",
      systemPrompt: "You are a verifier.",
      tools: verifierTools,
    }

    const room = makeRoom(proverConfig, verifierConfig, {
      maxTurns: 4,
      openingMessage: "I found a bug in the Side Entrance pool.",
    })

    const result = await Effect.runPromise(
      room.negotiate().pipe(
        Effect.provide(
          mockLayer((messages): GenerateTextResult => {
            callCount++
            // Turn 1: prover describes bug (text only)
            if (callCount === 1) {
              return {
                text: "The flash loan callback allows deposit() to be called, creating fake credit. This is a critical vulnerability.",
                toolCalls: [],
              }
            }
            // Turn 2: verifier approves with approve_bug tool call
            if (callCount === 2) {
              return {
                text: "Your description is technically coherent and consistent with the evidence.",
                toolCalls: [{ name: "approve_bug", args: { severity: "critical", reason: "Complete pool drain via flash loan callback" } }],
              }
            }
            // Turn 3: prover calls accept_severity tool
            if (callCount === 3) {
              return {
                text: "I accept the critical severity assessment.",
                toolCalls: [{ name: "accept_severity", args: { severity: "critical" } }],
              }
            }
            // Shouldn't reach here
            return { text: "...", toolCalls: [] }
          }),
        ),
        Effect.provide(InMemoryLayer),
      ),
    )

    // Prover accepted on turn 3, so loop should stop
    expect(result.totalTurns).toBe(3)
    expect(result.outcome).toBe("ACCEPTED")
    expect(result.assignedSeverity).toBe("critical")
    expect(result.agreedSeverity).toBe("critical")
    expect(result.agentA).toBe("prover")
    expect(result.agentB).toBe("verifier")

    // Verify turn alternation
    expect(result.turns[0]!.agentId).toBe("prover")
    expect(result.turns[1]!.agentId).toBe("verifier")
    expect(result.turns[2]!.agentId).toBe("prover")
  })

  // ----- Scenario D: Mock — verifier rejects via tool call -----

  test("verifier reject: verifier calls reject_bug tool", async () => {
    let callCount = 0
    const proverConfig: AgentConfig = {
      id: "prover",
      role: "researcher",
      systemPrompt: "You are a prover.",
      tools: proverTools,
    }

    const verifierConfig: AgentConfig = {
      id: "verifier",
      role: "protocol",
      systemPrompt: "You are a verifier.",
      tools: verifierTools,
    }

    const room = makeRoom(proverConfig, verifierConfig, {
      maxTurns: 4,
      openingMessage: "I found a bug — the patched pool is still drainable.",
    })

    const result = await Effect.runPromise(
      room.negotiate().pipe(
        Effect.provide(
          mockLayer((messages): GenerateTextResult => {
            callCount++
            // Turn 1: prover describes (false) bug
            if (callCount === 1) {
              return {
                text: "The patched pool can still be drained via the same flash loan vector.",
                toolCalls: [],
              }
            }
            // Turn 2: verifier rejects via reject_bug tool call
            if (callCount === 2) {
              return {
                text: "The evidence shows the exploit fails against the patched contracts.",
                toolCalls: [{ name: "reject_bug", args: { reason: "Exploit test FAILED against patched contracts" } }],
              }
            }
            return { text: "...", toolCalls: [] }
          }),
        ),
        Effect.provide(InMemoryLayer),
      ),
    )

    // Verifier rejected on turn 2, loop stops
    expect(result.totalTurns).toBe(2)
    expect(result.outcome).toBe("REJECTED")
    expect(result.assignedSeverity).toBeUndefined()
    expect(result.agreedSeverity).toBeUndefined()
  })

  // ----- Scenario E: Severity dispute — prover rejects -----

  test("severity dispute: prover rejects severity via tool call", async () => {
    let callCount = 0
    const proverConfig: AgentConfig = {
      id: "prover",
      role: "researcher",
      systemPrompt: "You are a prover who disagrees with medium severity.",
      tools: proverTools,
    }

    const verifierConfig: AgentConfig = {
      id: "verifier",
      role: "protocol",
      systemPrompt: "You are a verifier.",
      tools: verifierTools,
    }

    const room = makeRoom(proverConfig, verifierConfig, {
      maxTurns: 4,
      openingMessage: "I found a critical vulnerability.",
    })

    const result = await Effect.runPromise(
      room.negotiate().pipe(
        Effect.provide(
          mockLayer((messages): GenerateTextResult => {
            callCount++
            if (callCount === 1) {
              return {
                text: "This is a complete pool drain via flash loan re-entrancy.",
                toolCalls: [],
              }
            }
            // Turn 2: verifier approves but with medium severity
            if (callCount === 2) {
              return {
                text: "The attack requires specific preconditions.",
                toolCalls: [{ name: "approve_bug", args: { severity: "medium", reason: "Requires specific preconditions" } }],
              }
            }
            // Turn 3: prover rejects the medium severity
            if (callCount === 3) {
              return {
                text: "I disagree — this is a full drain, not medium.",
                toolCalls: [
                  {
                    name: "reject_severity",
                    args: { severity: "medium", reason: "Full pool drain warrants critical, not medium" },
                  },
                ],
              }
            }
            return { text: "...", toolCalls: [] }
          }),
        ),
        Effect.provide(InMemoryLayer),
      ),
    )

    expect(result.totalTurns).toBe(3)
    expect(result.outcome).toBe("REJECTED")
    expect(result.assignedSeverity).toBe("medium")
    expect(result.agreedSeverity).toBeUndefined()
  })

  // ----- Scenario F: Exhausted — no tool calls, maxTurns hit -----

  test("exhausted: no tool calls within maxTurns", async () => {
    let callCount = 0
    const proverConfig: AgentConfig = {
      id: "prover",
      role: "researcher",
      systemPrompt: "You are a prover.",
      tools: proverTools,
    }

    const verifierConfig: AgentConfig = {
      id: "verifier",
      role: "protocol",
      systemPrompt: "You are a verifier.",
      tools: verifierTools,
    }

    const room = makeRoom(proverConfig, verifierConfig, {
      maxTurns: 2,
      openingMessage: "Evaluate this finding.",
    })

    const result = await Effect.runPromise(
      room.negotiate().pipe(
        Effect.provide(
          mockLayer((): GenerateTextResult => {
            callCount++
            return {
              text: `Turn ${callCount} response.`,
              toolCalls: [],
            }
          }),
        ),
        Effect.provide(InMemoryLayer),
      ),
    )

    expect(result.totalTurns).toBe(2)
    expect(result.outcome).toBe("EXHAUSTED")
    expect(result.agreedSeverity).toBeUndefined()
  })
})
