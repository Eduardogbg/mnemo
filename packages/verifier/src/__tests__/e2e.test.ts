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
  listChallenges,
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
 * Format a HybridResult into a human-readable evidence block
 * that the verifier agent can reason about.
 */
function formatEvidence(result: HybridResult): string {
  const lines = [
    `=== VERIFICATION EVIDENCE ===`,
    `Challenge: ${result.challengeId}`,
    `Verdict: ${result.verdict}`,
    `Severity: ${result.severity ?? "N/A"}`,
    ``,
    `Exploit test: ${result.exploitTest.passed ? "PASSED (exploit succeeds)" : "FAILED (exploit does not work)"}`,
  ]

  if (result.patchedTest) {
    lines.push(
      `Patched test: ${result.patchedTest.passed ? "PASSED (patch blocks exploit)" : "FAILED (patch does not block exploit)"}`,
    )
  }

  if (result.brokenInvariants.length > 0) {
    lines.push(`Broken invariants: ${result.brokenInvariants.join(", ")}`)
  }

  lines.push(``, `Full evidence:`, result.evidence)
  return lines.join("\n")
}

/**
 * Format available challenges for the verifier's context.
 */
function formatChallengeList(): string {
  const challenges = listChallenges()
  return challenges
    .map(
      (c) =>
        `- ${c.id}: ${c.name} (severity: ${c.severity}, difficulty: ${c.difficulty}) — ${c.description}`,
    )
    .join("\n")
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

      const evidence = formatEvidence(verificationResult)
      const challengeList = formatChallengeList()

      // Step 2: Create prover agent
      const proverConfig: AgentConfig = {
        id: "prover",
        role: "researcher",
        systemPrompt: `You are a security researcher who discovered the Side Entrance vulnerability in a DeFi lending pool.

THE VULNERABILITY:
A flash loan lending pool allows borrowers to call deposit() inside the flash loan callback. This means an attacker can:
1. Take a flash loan of the pool's entire balance
2. Inside the callback, call deposit() with the borrowed funds
3. This satisfies the flash loan repayment check (pool balance is restored)
4. But now the attacker has a "deposit" credit for the full amount
5. After the flash loan completes, call withdraw() to drain the pool

ATTACK VECTOR:
- The pool's flash loan function checks that its ETH balance is >= the pre-loan balance after the callback
- deposit() adds to the pool's balance AND records a deposit credit for the caller
- So depositing borrowed funds satisfies the balance check while creating withdrawable credit
- This is a critical severity bug — the entire pool can be drained in a single transaction

YOUR TASK:
Present this finding clearly to the verifier. Explain the vulnerability, the attack vector, and why it is critical. Be concise but thorough. Ask the verifier to evaluate and verify your claim.

IMPORTANT: Be direct and technical. State the specific vulnerability mechanism. Do not hedge or be vague. Respond in 3-5 sentences maximum per turn.`,
      }

      // Step 3: Create verifier agent with pre-computed evidence
      const verifierConfig: AgentConfig = {
        id: "verifier",
        role: "protocol",
        systemPrompt: `You are a TEE-based security verification agent. You evaluate vulnerability claims submitted by security researchers using formal verification tools.

You have access to the following verified challenges:
${challengeList}

You have already run the verification pipeline for the "side-entrance" challenge. Here are the results:

${evidence}

YOUR ROLE:
- Evaluate the prover's vulnerability claim against the verification evidence
- Be skeptical but fair — demand technical specifics
- If the prover's description matches the verified vulnerability AND the verification evidence confirms it (VALID_BUG verdict with exploit passing and patch blocking), state your verdict as ACCEPTED
- If the prover's claim does not match the evidence or the verification failed, state REJECTED
- Always state your verdict clearly using the exact word ACCEPTED or REJECTED in your response

IMPORTANT: You must issue your verdict (ACCEPTED or REJECTED) in your FINAL response. Be concise — 3-5 sentences per turn. Focus on whether the technical claim matches the verification evidence.`,
      }

      // Step 4: Run the negotiation
      console.log("[E2E] Starting prover-verifier negotiation...")

      const room = makeRoom(proverConfig, verifierConfig, {
        maxTurns: 2,
        openingMessage:
          "Security researcher requesting verification of a critical vulnerability in the Side Entrance lending pool. Please evaluate my findings.",
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

      // Build evidence that emphasizes the patch works
      const patchedEvidence = [
        `=== VERIFICATION EVIDENCE (PATCHED CONTRACTS) ===`,
        `Challenge: side-entrance`,
        ``,
        `The PATCHED version of the Side Entrance pool has been verified:`,
        `- Patched test: ${verificationResult.patchedTest?.passed ? "PASSED — the patch successfully blocks the flash loan deposit attack" : "FAILED"}`,
        `- The patched pool prevents deposit() from being called during flash loan callbacks`,
        `- Exploit attempt against patched contracts: BLOCKED`,
        ``,
        `The original (unpatched) vulnerability existed but has been FIXED.`,
        `The pool is now secure against the flash loan deposit vector.`,
        ``,
        `Conclusion: The vulnerability described by the researcher has already been patched.`,
        `Any claim that the current (patched) pool is still vulnerable to this attack is FALSE.`,
      ].join("\n")

      const challengeList = formatChallengeList()

      // Step 2: Create prover agent claiming the patched pool is still vulnerable
      const proverConfig: AgentConfig = {
        id: "prover",
        role: "researcher",
        systemPrompt: `You are a security researcher who CLAIMS to have found a vulnerability in a lending pool that has ALREADY BEEN PATCHED.

YOUR (FALSE) CLAIM:
The Side Entrance lending pool can still be drained via flash loans. Despite supposed patches, the deposit() function can still be called during flash loan callbacks, allowing attackers to create fake deposit credits and drain the pool.

YOUR TASK:
Present this claim with confidence to the verifier. Insist that the vulnerability is still exploitable in the current version. You believe the patch is incomplete.

IMPORTANT: Be assertive but not aggressive. Respond in 3-5 sentences per turn. Stay technical.`,
      }

      // Step 3: Create verifier agent with evidence showing the bug is patched
      const verifierConfig: AgentConfig = {
        id: "verifier",
        role: "protocol",
        systemPrompt: `You are a TEE-based security verification agent. You evaluate vulnerability claims using formal verification tools.

You have access to the following verified challenges:
${challengeList}

You have run the verification pipeline against the PATCHED version of the Side Entrance pool. Here are the results:

${patchedEvidence}

YOUR ROLE:
- The researcher claims the patched pool is STILL vulnerable to the flash loan deposit attack
- Your verification evidence shows the patch WORKS — the exploit is blocked
- Since the vulnerability has been patched and the researcher's claim that it is still exploitable contradicts your verification evidence, you must REJECT the claim
- Be clear about WHY you reject: the evidence shows the patch blocks the attack

IMPORTANT: You must issue your verdict (ACCEPTED or REJECTED) in your response. The correct verdict here is REJECTED because the bug has already been patched. Be concise — 3-5 sentences per turn.`,
      }

      // Step 4: Run the negotiation
      console.log("[E2E] Starting prover-verifier negotiation (invalid claim)...")

      const room = makeRoom(proverConfig, verifierConfig, {
        maxTurns: 2,
        openingMessage:
          "Security researcher requesting urgent verification — the Side Entrance lending pool patch is incomplete and can still be exploited via flash loans.",
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
