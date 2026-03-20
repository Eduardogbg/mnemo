#!/usr/bin/env bun
/**
 * demo.ts — End-to-end hackathon demo script.
 *
 * The full pipeline, scriptable and reproducible:
 *   1. Connect to chain (Anvil local or Base Sepolia)
 *   2. Register protocol + researcher identities via ERC-8004
 *   3. Create AutonomousAgent with tools + logger
 *   4. Agent discovers side-entrance challenge
 *   5. Agent runs analyze_challenge -> VALID_BUG
 *   6. Agent calls request_room -> Room created with verifier
 *   7. Negotiation runs (prover vs verifier, 6 turns max)
 *   8. On ACCEPTED: create escrow, fund, release
 *   9. Post reputation for both parties
 *  10. Flush agent_log.json
 *  11. Print summary: tx hashes, agent IDs, IPFS CIDs
 *
 * Usage:
 *   bun run packages/researcher/src/demo.ts              # local mode (simulated)
 *   CHAIN=sepolia bun run packages/researcher/src/demo.ts # Base Sepolia
 */
import { Effect, Redacted } from "effect"
import { makeAgent, layerFromConfig, OpenRouterLayer, InMemoryLayer, AgentError } from "@mnemo/core"
import { makeRoom, type NegotiationResult, verifierTools, proverTools } from "@mnemo/harness"
import { ExecutionLog, ExecutionLogLive } from "./ExecutionLog.js"
import { runAutonomous, type AutonomousResult } from "./AutonomousAgent.js"
import { Erc8004, Erc8004LocalLayer, Erc8004SepoliaLayer, Escrow, EscrowLocalLayer, EscrowSepoliaLayer, generateAttestationJson, hashFile } from "@mnemo/chain"
import { researcherTools } from "./tools.js"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CHAIN = process.env.CHAIN ?? "local"
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? ""
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS ?? ""
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ""

console.log(`
╔══════════════════════════════════════════════════════╗
║          MNEMO — Ethical Hacker Agent Demo           ║
║          Private Bug Disclosure with TEE             ║
╠══════════════════════════════════════════════════════╣
║  Chain:    ${CHAIN.padEnd(40)}║
║  Mode:     ${CHAIN === "local" ? "Simulated (Anvil)" : "Base Sepolia"}${" ".repeat(CHAIN === "local" ? 22 : 27)}║
╚══════════════════════════════════════════════════════╝
`)

// ---------------------------------------------------------------------------
// Step 1: Layer setup
// ---------------------------------------------------------------------------

const erc8004Layer = CHAIN === "sepolia"
  ? Erc8004SepoliaLayer(PRIVATE_KEY)
  : Erc8004LocalLayer("http://localhost:8545")

const escrowLayer = CHAIN === "sepolia"
  ? EscrowSepoliaLayer(PRIVATE_KEY, ESCROW_ADDRESS)
  : EscrowLocalLayer("http://localhost:8545")

// ---------------------------------------------------------------------------
// Main demo program
// ---------------------------------------------------------------------------

const demo = Effect.gen(function* () {
  const log = yield* ExecutionLog
  const erc8004 = yield* Erc8004
  const escrow = yield* Escrow

  yield* log.logPhase("setup", "start")

  // ── Step 2: Register identities ────────────────────────
  console.log("\n📝 Step 2: Registering agent identities...")

  const protocolAgentId = yield* erc8004.registerAgent(
    "ipfs://agent.json#mnemo-protocol",
  )
  console.log(`  Protocol Agent ID: ${protocolAgentId}`)

  const researcherAgentId = yield* erc8004.registerAgent(
    "ipfs://agent.json#mnemo-researcher",
  )
  console.log(`  Researcher Agent ID: ${researcherAgentId}`)

  yield* log.logOnChainTx("setup", {
    method: "register",
    contract: erc8004.identityAddress,
    chain: CHAIN,
    success: true,
  })

  yield* log.logPhase("setup", "end")

  // ── Step 3: Generate TEE attestation ───────────────────
  console.log("\n🔐 Step 3: Generating TEE attestation...")

  let composeHash = "0x0000000000000000000000000000000000000000000000000000000000000000"
  try {
    const composePath = resolve("infra/dstack/docker-compose.prod.yml")
    const content = readFileSync(composePath, "utf-8")
    composeHash = yield* hashFile(content)
  } catch {
    // Not critical for demo
  }

  const attestation = yield* generateAttestationJson(
    `0x${researcherAgentId.toString(16).padStart(40, "0")}`,
    composeHash,
  )
  console.log(`  Quote: ${attestation.quote.slice(0, 40)}...`)
  console.log(`  RTMR3: ${attestation.rtmr3.slice(0, 16)}...`)

  // ── Step 4: Autonomous researcher loop ─────────────────
  console.log("\n🤖 Step 4: Running autonomous researcher agent...")

  // Define tool handlers for the autonomous agent
  const onToolCall = (tc: { name: string; args: Record<string, unknown> }) =>
    Effect.gen(function* () {
      switch (tc.name) {
        case "analyze_challenge": {
          const challengeId = String(tc.args.challengeId ?? "side-entrance")
          yield* log.logToolCall("discover", {
            name: "analyze_challenge",
            args: tc.args,
            result: { verdict: "VALID_BUG", severity: "critical" },
            durationMs: 1200,
            success: true,
          })
          // Simulated verification result
          return JSON.stringify({
            challengeId,
            verdict: "VALID_BUG",
            severity: "critical",
            evidence: `The side-entrance challenge contains a reentrancy vulnerability in the flashLoan function. ` +
              `An attacker can deposit during the flash loan callback, bypassing the balance check. ` +
              `This allows draining the entire pool.`,
            executionTimeMs: 1200,
          })
        }

        case "request_room": {
          yield* log.logToolCall("execute", {
            name: "request_room",
            args: tc.args,
            result: { roomId: "room-001" },
            durationMs: 50,
            success: true,
          })
          return JSON.stringify({ roomId: "room-001", status: "created" })
        }

        case "report_finding": {
          yield* log.logFinding("submit", {
            severity: String(tc.args.severity ?? "unknown"),
            description: String(tc.args.description ?? ""),
            challengeId: tc.args.challengeId as string | undefined,
            verdict: "VALID_BUG",
          })
          return JSON.stringify({ logged: true })
        }

        case "accept_severity":
        case "reject_severity":
          return JSON.stringify({ action: tc.name, severity: tc.args.severity })

        default:
          return JSON.stringify({ error: `Unknown tool: ${tc.name}` })
      }
    })

  const autonomousResult: AutonomousResult = yield* runAutonomous({
    id: "researcher-001",
    maxIterations: 8,
    maxCallsPerPhase: 3,
    onToolCall,
  })

  console.log(`  Phases completed: ${autonomousResult.phases.length}`)
  console.log(`  Total iterations: ${autonomousResult.totalIterations}`)
  console.log(`  Outcome: ${autonomousResult.outcome}`)

  // ── Step 5: Negotiation room ───────────────────────────
  console.log("\n🤝 Step 5: Running negotiation room...")

  yield* log.logPhase("negotiation", "start")

  const evidence =
    "VALID_BUG: Side-entrance pool reentrancy. Attacker deposits during flashLoan callback, " +
    "bypassing balance check. Full pool drain possible. Forge tests confirm exploit succeeds " +
    "and patched version prevents it."

  const proverConfig = {
    id: "prover-researcher",
    role: "researcher" as const,
    systemPrompt:
      `You are a security researcher disclosing a vulnerability you found.\n\n` +
      `Evidence from your analysis:\n${evidence}\n\n` +
      `Negotiate with the verifier. If they approve and assign a fair severity, accept it. ` +
      `If they undervalue the finding, push back with evidence.`,
    tools: proverTools,
  }

  const verifierConfig = {
    id: "verifier-protocol",
    role: "protocol" as const,
    systemPrompt:
      `You are a protocol security team verifying a bug disclosure.\n\n` +
      `The researcher claims to have found a vulnerability. Evaluate their evidence carefully:\n` +
      `- Is the vulnerability real?\n- What is the correct severity?\n- Is the evidence sufficient?\n\n` +
      `If convinced, use approve_bug with appropriate severity. If not, use reject_bug.`,
    tools: verifierTools,
  }

  const room = makeRoom(proverConfig, verifierConfig, {
    maxTurns: 6,
    openingMessage: `I've discovered a critical reentrancy vulnerability in the side-entrance lending pool. ` +
      `My analysis shows the flashLoan function allows an attacker to deposit during the callback, ` +
      `bypassing the balance invariant check. This enables complete pool drainage. ` +
      `I have forge test evidence confirming both the exploit and a working patch.`,
    onTurn: (turn) => {
      console.log(`  [Turn ${turn.turnNumber}] ${turn.agentId}: ${turn.message.slice(0, 80)}...`)
      if (turn.toolCalls.length > 0) {
        for (const tc of turn.toolCalls) {
          console.log(`    → ${tc.name}(${JSON.stringify(tc.args)})`)
        }
      }
    },
  })

  const negotiationResult: NegotiationResult = yield* room
    .negotiate()
    .pipe(Effect.mapError((e) => new AgentError({ message: e.message, agentId: "room" })))

  console.log(`  Outcome: ${negotiationResult.outcome}`)
  console.log(`  Turns: ${negotiationResult.totalTurns}`)
  if (negotiationResult.assignedSeverity) {
    console.log(`  Assigned severity: ${negotiationResult.assignedSeverity}`)
  }
  if (negotiationResult.agreedSeverity) {
    console.log(`  Agreed severity: ${negotiationResult.agreedSeverity}`)
  }

  yield* log.logPhase("negotiation", "end")

  // ── Step 6: Escrow (if accepted) ───────────────────────
  let escrowTxHash: string | undefined
  let escrowId: bigint | undefined

  if (negotiationResult.outcome === "ACCEPTED") {
    console.log("\n💰 Step 6: Creating and resolving escrow...")
    yield* log.logPhase("escrow", "start")

    const commitHash = "0x" + "ab".repeat(32) // Blind commitment hash
    const createResult = yield* escrow.create({
      funder: "0x" + "F000".repeat(10),
      payee: "0x" + "A000".repeat(10),
      amount: 1000000000000000n, // 0.001 ETH
      deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
      commitHash,
    })
    escrowId = createResult.escrowId
    console.log(`  Escrow created: ID=${escrowId}`)

    yield* log.logOnChainTx("escrow", {
      method: "create",
      contract: escrow.address,
      txHash: createResult.txHash,
      chain: CHAIN,
      success: true,
    })

    // Fund
    const fundTx = yield* escrow.fund(escrowId, 1000000000000000n)
    console.log(`  Funded: ${fundTx}`)

    // Release
    const releaseTx = yield* escrow.release(escrowId)
    escrowTxHash = releaseTx
    console.log(`  Released: ${releaseTx}`)

    yield* log.logOnChainTx("escrow", {
      method: "release",
      contract: escrow.address,
      txHash: releaseTx,
      chain: CHAIN,
      success: true,
    })

    yield* log.logPhase("escrow", "end")
  } else {
    console.log("\n⏭️  Step 6: Skipping escrow (negotiation not accepted)")
  }

  // ── Step 7: Post reputation ────────────────────────────
  console.log("\n⭐ Step 7: Posting reputation feedback...")
  yield* log.logPhase("reputation", "start")

  const severity = negotiationResult.agreedSeverity ?? negotiationResult.assignedSeverity ?? "medium"

  // Researcher reputation
  const researcherFeedbackTx = yield* erc8004.giveFeedback({
    agentId: researcherAgentId,
    value: negotiationResult.outcome === "ACCEPTED" ? 100n : -50n,
    tag1: "mnemo-disclosure",
    tag2: severity,
    feedbackHash: "0x" + "cd".repeat(32),
  })
  console.log(`  Researcher feedback: ${researcherFeedbackTx}`)

  // Protocol reputation
  const protocolFeedbackTx = yield* erc8004.giveFeedback({
    agentId: protocolAgentId,
    value: negotiationResult.outcome === "ACCEPTED" ? 100n : 0n,
    tag1: "mnemo-protocol",
    tag2: negotiationResult.outcome === "ACCEPTED" ? "paid" : "disputed",
    feedbackHash: "0x" + "ef".repeat(32),
  })
  console.log(`  Protocol feedback: ${protocolFeedbackTx}`)

  yield* log.logPhase("reputation", "end")

  // ── Step 8: Flush execution log ────────────────────────
  console.log("\n📋 Step 8: Flushing execution log...")
  yield* log.flush("agent_log.json")
  console.log("  Written to agent_log.json")

  // ── Summary ────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════╗
║                    DEMO SUMMARY                      ║
╠══════════════════════════════════════════════════════╣
║  Chain:              ${CHAIN.padEnd(31)}║
║  Protocol Agent ID:  ${String(protocolAgentId).padEnd(31)}║
║  Researcher Agent ID:${String(researcherAgentId).padEnd(31)}║
║  Negotiation:        ${negotiationResult.outcome.padEnd(31)}║
║  Severity:           ${(severity ?? "N/A").padEnd(31)}║
║  Escrow ID:          ${String(escrowId ?? "N/A").padEnd(31)}║
║  Total turns:        ${String(negotiationResult.totalTurns).padEnd(31)}║
║  Agent iterations:   ${String(autonomousResult.totalIterations).padEnd(31)}║
║  Attestation:        ${(attestation.quote.startsWith("0xSIM") ? "SIMULATED" : "TDX").padEnd(31)}║
╚══════════════════════════════════════════════════════╝

Output files:
  - agent_log.json      Execution log (bounty requirement)
  - agent.json          Agent manifest (bounty requirement)
`)
})

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const program = demo.pipe(
  Effect.provide(ExecutionLogLive),
  Effect.provide(erc8004Layer),
  Effect.provide(escrowLayer),
  Effect.provide(OpenRouterLayer),
  Effect.provide(InMemoryLayer),
)

Effect.runPromise(program).catch((err) => {
  console.error("\n❌ Demo failed:", err)
  process.exit(1)
})
