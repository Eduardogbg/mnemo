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
 *   4. The verifier evaluates the claim against the evidence and issues a verdict
 *
 * This avoids tool-calling complexity while still demonstrating the full flow:
 * claim -> evidence -> negotiation -> verdict.
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
  type AgentConfig,
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

/**
 * Extract the verifier's verdict from negotiation turns.
 * Looks for ACCEPTED or REJECTED in the verifier's messages.
 */
function extractVerdict(
  turns: ReadonlyArray<{ agentId: string; message: string }>,
  verifierAgentId: string,
): "ACCEPTED" | "REJECTED" | "INCONCLUSIVE" {
  // Check verifier messages in reverse order (latest verdict wins)
  const verifierTurns = [...turns]
    .reverse()
    .filter((t) => t.agentId === verifierAgentId)

  for (const turn of verifierTurns) {
    const upper = turn.message.toUpperCase()
    if (upper.includes("ACCEPTED")) return "ACCEPTED"
    if (upper.includes("REJECTED")) return "REJECTED"
  }
  return "INCONCLUSIVE"
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("E2E: Bug Disclosure Verification", () => {
  // ----- Scenario A: Valid Bug -----

  test.skipIf(!hasApiKey)(
    "valid bug: prover presents Side Entrance vulnerability -> verifier accepts",
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

      // Step 2: Create prover agent — describes the bug technically without naming the CTF
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
Present this finding to the verifier. Explain the mechanism precisely. Be concise — 3-5 sentences per turn.`,
      }

      // Step 3: Create verifier agent — only gets anonymized pass/fail evidence
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
- If the researcher's description is technically coherent AND the evidence confirms the exploit works, state ACCEPTED
- If the description is vague, incorrect, or contradicts the evidence, state REJECTED
- You do NOT know what the vulnerability is — you must judge purely from the researcher's description and the test results

IMPORTANT: Issue your verdict (ACCEPTED or REJECTED) in your response. Be concise — 3-5 sentences per turn.`,
      }

      // Step 4: Run the negotiation
      console.log("[E2E] Starting prover-verifier negotiation...")

      const room = makeRoom(proverConfig, verifierConfig, {
        maxTurns: 2,
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
      expect(result.totalTurns).toBeGreaterThanOrEqual(2)

      const verdict = extractVerdict(result.turns, "verifier")
      console.log(`\n[E2E] Extracted verdict: ${verdict}`)
      expect(verdict).toBe("ACCEPTED")
    },
    { timeout: 120_000 },
  )

  // ----- Scenario B: Invalid Bug (already patched) -----

  test.skipIf(!hasApiKey)(
    "invalid bug: prover claims patched pool is vulnerable -> verifier rejects",
    async () => {
      // Step 1: Run verification pipeline
      // We still run against side-entrance which produces VALID_BUG,
      // but we craft the evidence to show the patched version is secure.
      // The prover will claim the PATCHED pool is still vulnerable,
      // which contradicts the evidence.
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

      // Step 2: Create prover agent claiming a patched pool is still vulnerable
      const proverConfig: AgentConfig = {
        id: "prover",
        role: "researcher",
        systemPrompt: `You are a security researcher who CLAIMS to have found a vulnerability in an ETH lending pool that has already been patched.

YOUR (FALSE) CLAIM:
The lending pool can still be drained via flash loans. Despite patches, the deposit() function can still be called during flash loan callbacks, allowing attackers to create fake deposit credits and drain the pool.

YOUR TASK:
Present this claim with confidence. Insist the vulnerability is still exploitable. You believe the patch is incomplete.

IMPORTANT: Be assertive but not aggressive. 3-5 sentences per turn. Stay technical.`,
      }

      // Step 3: Create verifier agent — evidence shows exploit is blocked
      const verifierConfig: AgentConfig = {
        id: "verifier",
        role: "protocol",
        systemPrompt: `You are a security verification agent running inside a TEE. You evaluate vulnerability claims by comparing them against machine-verified evidence from a forge test pipeline.

You have run the verification pipeline against the submitted contracts. Here are the results:

${patchedEvidence}

YOUR ROLE:
- A researcher will claim a vulnerability still exists in the contracts
- Your test evidence shows the exploit FAILS against the current contracts — the patch blocks it
- Since the evidence contradicts the researcher's claim, you should REJECT
- You do NOT know what the original vulnerability was — judge purely from the test results

IMPORTANT: Issue your verdict (ACCEPTED or REJECTED) in your response. Be concise — 3-5 sentences per turn.`,
      }

      // Step 4: Run the negotiation
      console.log("[E2E] Starting prover-verifier negotiation (invalid claim)...")

      const room = makeRoom(proverConfig, verifierConfig, {
        maxTurns: 2,
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
      expect(result.totalTurns).toBeGreaterThanOrEqual(2)

      const verdict = extractVerdict(result.turns, "verifier")
      console.log(`\n[E2E] Extracted verdict: ${verdict}`)
      expect(verdict).toBe("REJECTED")
    },
    { timeout: 120_000 },
  )

  // ----- Scenario C: Mock-only smoke test (no API key needed) -----

  test("smoke test: negotiation structure with mock provider", async () => {
    // Validates the test wiring works without LLM calls
    const { mockLayer } = await import("@mnemo/harness")

    let callCount = 0
    const proverConfig: AgentConfig = {
      id: "prover",
      role: "researcher",
      systemPrompt: "You are a prover.",
    }

    const verifierConfig: AgentConfig = {
      id: "verifier",
      role: "protocol",
      systemPrompt: "You are a verifier.",
    }

    const room = makeRoom(proverConfig, verifierConfig, {
      maxTurns: 4,
      openingMessage: "I found a bug in the Side Entrance pool.",
    })

    const result = await Effect.runPromise(
      room.negotiate().pipe(
        Effect.provide(
          mockLayer((messages) => {
            callCount++
            // Prover turns (odd calls): describe the bug
            // Verifier turns (even calls): issue verdict
            if (callCount % 2 === 1) {
              return "The flash loan callback allows deposit() to be called, creating fake credit. This is a critical vulnerability."
            }
            return "I have reviewed your claim against the verification evidence. The exploit test passes and the patch blocks it. Verdict: ACCEPTED."
          }),
        ),
        Effect.provide(InMemoryLayer),
      ),
    )

    expect(result.totalTurns).toBe(4)
    expect(result.agentA).toBe("prover")
    expect(result.agentB).toBe("verifier")

    // Verify alternation
    expect(result.turns[0]!.agentId).toBe("prover")
    expect(result.turns[1]!.agentId).toBe("verifier")
    expect(result.turns[2]!.agentId).toBe("prover")
    expect(result.turns[3]!.agentId).toBe("verifier")

    // Verify verdict extraction works
    const verdict = extractVerdict(result.turns, "verifier")
    expect(verdict).toBe("ACCEPTED")
  })
})
