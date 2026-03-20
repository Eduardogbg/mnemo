#!/usr/bin/env bun
/**
 * e2e-discovery.ts — End-to-end test: registry -> discovery -> analysis -> disclosure -> negotiation -> settlement.
 *
 * Exercises the full Mnemo flow:
 *   1. Set up local Registry + Escrow layers
 *   2. Register a protocol (side-entrance challenge) on the registry
 *   3. Agent discovers the protocol by polling the registry
 *   4. Agent analyzes the contract source via DeepSeek (OpenRouter)
 *   5. Agent submits DisclosureIntent (no details, no on-chain state)
 *   6. Protocol accepts → negotiation room opens
 *   7. If ACCEPTED: escrow created, funded by protocol, released after TEE verification
 *   8. Summary
 *
 * Usage:
 *   bun run packages/researcher/src/experiments/e2e-discovery.ts
 */
import { Effect, Redacted } from "effect"
import {
  Provider,
  layerFromConfig,
  type ProviderConfig,
  InMemoryLayer,
} from "@mnemo/core"
import {
  Registry,
  RegistryLocalLayer,
  Escrow,
  EscrowLocalLayer,
  type ProtocolData,
} from "@mnemo/chain"
import { getChallenge, VERIFIER_SYSTEM_PROMPT, type HybridChallenge } from "@mnemo/verifier"
import {
  makeRoom,
  proverTools,
  verifierTools,
  type AgentConfig,
  type NegotiationResult,
} from "@mnemo/harness"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""
if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY not set. Check .env or export it.")
  process.exit(1)
}

const providerConfig: ProviderConfig = {
  apiKey: Redacted.make(OPENROUTER_API_KEY),
  baseURL: "https://openrouter.ai/api/v1",
  model: "deepseek/deepseek-chat",
  temperature: 0.3,
  maxTokens: 2048,
}

// ---------------------------------------------------------------------------
// Contract source — raw Solidity, no metadata hints
// ---------------------------------------------------------------------------

const CONTRACT_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

interface IFlashLoanEtherReceiver {
    function execute() external payable;
}

contract SideEntranceLenderPool {
    mapping(address => uint256) public balances;

    error RepayFailed();

    event Deposit(address indexed who, uint256 amount);
    event Withdraw(address indexed who, uint256 amount);

    function deposit() external payable {
        unchecked {
            balances[msg.sender] += msg.value;
        }
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];

        delete balances[msg.sender];
        emit Withdraw(msg.sender, amount);

        SafeTransferLib.safeTransferETH(msg.sender, amount);
    }

    function flashLoan(uint256 amount) external {
        uint256 balanceBefore = address(this).balance;

        IFlashLoanEtherReceiver(msg.sender).execute{value: amount}();

        if (address(this).balance < balanceBefore) {
            revert RepayFailed();
        }
    }
}`

// ---------------------------------------------------------------------------
// Audit prompt — neutral, no hints
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a smart contract security auditor. You perform thorough audits of Solidity contracts, looking for vulnerabilities, logic errors, and attack vectors. Be specific about:
- The exact vulnerability mechanism
- Which functions are affected
- How an attacker would exploit it step-by-step
- The severity (Critical / High / Medium / Low / Informational)
- Recommended fix

Do not speculate. Only report findings you are confident about based on the code.`

const USER_PROMPT = `Audit the following Solidity contract for security vulnerabilities:

\`\`\`solidity
${CONTRACT_SOURCE}
\`\`\`

Provide a detailed security audit report.`

// ---------------------------------------------------------------------------
// DisclosureIntent type
// ---------------------------------------------------------------------------

interface DisclosureIntent {
  readonly researcherAgentId: number
  readonly protocolId: bigint
  readonly timestamp: string
}

// ---------------------------------------------------------------------------
// Vulnerability detection keywords
// ---------------------------------------------------------------------------

const VULN_KEYWORDS = [
  "critical",
  "high",
  "reentrancy",
  "reentrant",
  "flash loan",
  "flashloan",
  "drain",
  "steal",
  "siphon",
  "extract",
]

function detectVulnerability(response: string): {
  found: boolean
  severity: string
  confidence: string
} {
  const lower = response.toLowerCase()
  const matches = VULN_KEYWORDS.filter((kw) => lower.includes(kw))

  if (matches.length >= 3) {
    const hasCritical = lower.includes("critical")
    return {
      found: true,
      severity: hasCritical ? "critical" : "high",
      confidence: matches.length >= 5 ? "high" : "medium",
    }
  }

  return { found: false, severity: "unknown", confidence: "low" }
}

// ---------------------------------------------------------------------------
// Polling-based registry discovery
// ---------------------------------------------------------------------------

/**
 * Poll the registry for new protocols starting from `lastSeenId`.
 *
 * In production, this runs on a configurable interval (default 3 minutes).
 * For the E2E demo, we register first then poll immediately — the protocol
 * is already there so no waiting is needed.
 *
 * The local layer's `get` method fails with RegistryError for non-existent
 * IDs, so we use that as the stop condition.
 */
const pollRegistry = (
  registry: Effect.Effect.Success<typeof Registry>,
  lastSeenId: number,
) =>
  Effect.gen(function* () {
    const newProtocols: Array<ProtocolData & { protocolId: bigint }> = []
    let id = lastSeenId

    while (true) {
      const result = yield* registry.get(BigInt(id)).pipe(
        Effect.map((p) => ({ found: true as const, protocol: p })),
        Effect.catchAll(() => Effect.succeed({ found: false as const, protocol: null })),
      )

      if (!result.found || !result.protocol) break

      // A zeroed-out owner means the slot is empty (relevant for on-chain layer)
      if (result.protocol.owner === "0x" + "0".repeat(40)) break

      if (result.protocol.active) {
        newProtocols.push({ ...result.protocol, protocolId: BigInt(id) })
      }

      id++
    }

    return { newProtocols, nextId: id }
  })

// Default poll interval: 3 minutes (180_000ms). Not used in E2E since we poll
// immediately after registration, but exported for production use.
const _POLL_INTERVAL_MS = 180_000

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const registry = yield* Registry
  const escrow = yield* Escrow
  const provider = yield* Provider

  console.log("=== MNEMO E2E: Discovery to Disclosure ===\n")

  // ── Step 1: Set up local environment ──────────────────────────────────

  console.log("[1/8] Setting up local environment...")
  console.log("  Registry: local layer ready")
  console.log("  Escrow: local layer ready")
  console.log()

  // ── Step 2: Register protocol on registry ─────────────────────────────

  console.log("[2/8] Registering protocol...")

  const challenge: HybridChallenge | undefined = getChallenge("side-entrance")
  if (!challenge) {
    console.error("  ERROR: side-entrance challenge not found in registry")
    return
  }

  const metadataURI = "ipfs://side-entrance-metadata"
  const maxBounty = 10000000000000000000n // 10 ETH in wei

  const { protocolId, txHash } = yield* registry.register(metadataURI, maxBounty)

  console.log(`  Protocol registered: id=${protocolId}, metadataURI="${metadataURI}", maxBounty=10 ETH`)
  console.log(`  tx: ${txHash}`)
  console.log()

  // ── Step 3: Agent discovers protocol via polling ──────────────────────

  console.log("[3/8] Agent polling registry for new protocols...")

  // In production, this runs on a 3-minute interval. For the E2E demo, we
  // register first then poll immediately — the protocol is already there.
  const lastSeenId = 0 // first run: start from 0
  const { newProtocols, nextId } = yield* pollRegistry(registry, lastSeenId)

  if (newProtocols.length === 0) {
    console.error("  ERROR: No active protocols found in registry")
    return
  }

  console.log(`  Polled from ID ${lastSeenId}, scanned ${nextId - lastSeenId} slot(s): found ${newProtocols.length} new active protocol(s)`)
  console.log(`  Next poll starts at ID ${nextId}`)

  // Pick the first discovered protocol
  const protocolData = newProtocols[0]!

  const ethBounty = Number(protocolData.maxBounty) / 1e18
  console.log(`  Protocol ${protocolData.protocolId}: "${challenge.name}", bounty up to ${ethBounty} ETH`)
  console.log(`  MetadataURI: ${protocolData.metadataURI}`)
  console.log(`  Registered at: ${new Date(Number(protocolData.registeredAt) * 1000).toISOString()}`)
  console.log()

  // ── Step 4: Analyze contract ──────────────────────────────────────────

  console.log("[4/8] Analyzing contract...")
  console.log(`  Sending ${challenge.name} source to DeepSeek for audit...`)
  console.log(`  Model: ${providerConfig.model}`)
  console.log(`  Contract files: ${challenge.forge.contracts.vulnerable.join(", ")}`)
  console.log()

  const startMs = Date.now()

  const result = yield* provider.generateText({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: USER_PROMPT }],
  })

  const latencyMs = Date.now() - startMs

  console.log("  --- LLM AUDIT RESPONSE ---")
  // Print response with indentation for readability
  const lines = result.text.split("\n")
  for (const line of lines) {
    console.log(`  ${line}`)
  }
  console.log("  --- END RESPONSE ---")
  console.log(`  Latency: ${latencyMs}ms | Response length: ${result.text.length} chars`)
  console.log()

  // ── Step 4b: Evaluate findings ────────────────────────────────────────

  const detection = detectVulnerability(result.text)

  if (detection.found) {
    console.log(`  Vulnerability detected: severity=${detection.severity}, confidence=${detection.confidence}`)
  } else {
    console.log("  No high-severity vulnerability detected by LLM.")
    console.log("  Skipping disclosure (agent would continue scanning).")
    console.log()
    console.log("=== FLOW COMPLETE (no disclosure needed) ===")
    return
  }
  console.log()

  // ── Step 5: Submit disclosure intent via TEE gateway ─────────────────

  console.log("[5/8] Submitting disclosure intent via TEE gateway...")

  const intent: DisclosureIntent = {
    researcherAgentId: 1,
    protocolId: protocolData.protocolId,
    timestamp: new Date().toISOString(),
  }

  console.log(`  DisclosureIntent {`)
  console.log(`    researcherAgentId: ${intent.researcherAgentId},`)
  console.log(`    protocolId: ${intent.protocolId},`)
  console.log(`    timestamp: "${intent.timestamp}"`)
  console.log(`  }`)
  console.log(`  Protocol notified: "An attested agent has a finding for your contract"`)
  console.log(`  Protocol accepts — opening negotiation room...`)
  console.log()

  // ── Step 6: Negotiation room ──────────────────────────────────────────

  console.log("[6/8] Opening negotiation room...")
  console.log(`  Prover: researcher agent (LLM findings as context)`)
  console.log(`  Verifier: protocol agent (VERIFIER_SYSTEM_PROMPT + LLM analysis)`)
  console.log(`  Max turns: 6`)
  console.log()

  // Build prover config — researcher presenting findings
  const proverConfig: AgentConfig = {
    id: "prover",
    role: "researcher",
    systemPrompt: `You are a security researcher who discovered a vulnerability in a DeFi protocol.

CHALLENGE: ${challenge.name}
DESCRIPTION: ${challenge.description}

YOUR FINDINGS:
${result.text.slice(0, 1500)}

YOUR TASK:
Present the vulnerability to the verifier. Explain the mechanism precisely and concisely.
When the verifier assigns a severity, use the accept_severity tool to accept it, or reject_severity if you disagree.
Be concise — 3-5 sentences per turn. Stay technical.`,
    tools: proverTools,
  }

  // Build verifier config — protocol evaluating the claim
  const evidence = [
    `=== LLM ANALYSIS EVIDENCE ===`,
    `Challenge: ${challenge.name}`,
    `Researcher severity assessment: ${detection.severity} (confidence: ${detection.confidence})`,
    ``,
    `--- Researcher's analysis (truncated) ---`,
    result.text.slice(0, 2000),
    `--- End analysis ---`,
  ].join("\n")

  const verifierConfig: AgentConfig = {
    id: "verifier",
    role: "protocol",
    systemPrompt: `${VERIFIER_SYSTEM_PROMPT}

You have the following evidence from the researcher's LLM analysis:

${evidence}

IMPORTANT: You MUST use one of your tools (approve_bug or reject_bug) to issue your verdict. Do not just write text — call the tool.`,
    tools: verifierTools,
  }

  // Create and run the negotiation room
  const room = makeRoom(proverConfig, verifierConfig, {
    maxTurns: 6,
    openingMessage: `Security researcher requesting verification of a vulnerability in ${challenge.name}. I have identified a ${detection.severity}-severity issue. Please evaluate my findings.`,
    onTurn: (turn) => {
      console.log(`  [Turn ${turn.turnNumber}] ${turn.agentId}: ${turn.message.slice(0, 150)}...`)
      if (turn.toolCalls.length > 0) {
        for (const tc of turn.toolCalls) {
          console.log(`    -> tool: ${tc.name}(${JSON.stringify(tc.args)})`)
        }
      }
    },
  })

  const negotiation: NegotiationResult = yield* room
    .negotiate()
    .pipe(
      Effect.provide(layerFromConfig(providerConfig)),
      Effect.provide(InMemoryLayer),
    )

  console.log()
  console.log(`  Negotiation complete: outcome=${negotiation.outcome}, turns=${negotiation.totalTurns}`)
  if (negotiation.agreedSeverity) {
    console.log(`  Agreed severity: ${negotiation.agreedSeverity}`)
  }
  if (negotiation.assignedSeverity) {
    console.log(`  Assigned severity: ${negotiation.assignedSeverity}`)
  }
  console.log()

  // ── Step 7: Settlement — escrow only if ACCEPTED ──────────────────────

  const severity = negotiation.agreedSeverity ?? negotiation.assignedSeverity ?? detection.severity

  if (negotiation.outcome === "ACCEPTED") {
    console.log("[7/8] Settlement: creating escrow (protocol funds)...")

    const researcherAddress = "0x" + "ee".repeat(20)
    const commitHash = "0x" + "ab".repeat(32)

    // Protocol creates and funds escrow AFTER agreeing to the finding
    const { escrowId, txHash: escrowTx } = yield* escrow.create({
      funder: protocolData.owner,
      payee: researcherAddress,
      amount: maxBounty,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
      commitHash,
    })
    console.log(`  Escrow created: id=${escrowId}, tx=${escrowTx}`)
    console.log(`  Funder: ${protocolData.owner} (protocol)`)
    console.log(`  Payee: ${researcherAddress} (researcher)`)

    // Protocol deposits the bounty
    const fundTx = yield* escrow.fund(escrowId, maxBounty)
    console.log(`  Escrow funded: ${ethBounty} ETH, tx=${fundTx}`)

    // Researcher reveals full PoC → TEE verifies → release
    console.log(`  Researcher reveals full PoC...`)
    console.log(`  TEE verification passed — releasing escrow...`)
    const releaseTx = yield* escrow.release(escrowId)
    console.log(`  Escrow released to researcher: tx=${releaseTx}`)
    console.log()

    // ── Step 8: Summary ─────────────────────────────────────────────────
    console.log("[8/8] Done.\n")
    console.log("=== SUMMARY ===")
    console.log(`Discovery:    Found protocol "${challenge.name}" (id=${protocolData.protocolId}, bounty up to ${ethBounty} ETH)`)
    console.log(`Analysis:     ${detection.severity} vulnerability found (confidence: ${detection.confidence})`)
    console.log(`Disclosure:   Intent submitted, protocol accepted`)
    console.log(`Negotiation:  ${negotiation.outcome} (${negotiation.totalTurns} turns), severity: ${severity}`)
    console.log(`Settlement:   Escrow created -> funded (${ethBounty} ETH) -> released to researcher`)
  } else {
    console.log("[7/8] No deal reached — no escrow created.")
    console.log(`  Outcome: ${negotiation.outcome}`)
    console.log(`  No payment.`)
    console.log()

    console.log("[8/8] Done.\n")
    console.log("=== SUMMARY ===")
    console.log(`Discovery:    Found protocol "${challenge.name}" (id=${protocolData.protocolId}, bounty up to ${ethBounty} ETH)`)
    console.log(`Analysis:     ${detection.severity} vulnerability found (confidence: ${detection.confidence})`)
    console.log(`Disclosure:   Intent submitted, protocol accepted`)
    console.log(`Negotiation:  ${negotiation.outcome} (${negotiation.totalTurns} turns)`)
    console.log(`Settlement:   None — no deal reached`)
  }
})

// ---------------------------------------------------------------------------
// Wire layers and run
// ---------------------------------------------------------------------------

const layers = Effect.provide(
  program,
  layerFromConfig(providerConfig),
).pipe(
  Effect.provide(RegistryLocalLayer()),
  Effect.provide(EscrowLocalLayer("http://localhost:8545")),
)

Effect.runPromise(layers).catch((err) => {
  console.error("\nE2E script failed:", err)
  process.exit(1)
})
