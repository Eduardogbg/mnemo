#!/usr/bin/env bun
/**
 * e2e-discovery.ts — End-to-end test: registry -> discovery -> analysis -> disclosure.
 *
 * Exercises the full Mnemo flow:
 *   1. Set up local Registry + Escrow layers
 *   2. Register a protocol (side-entrance challenge) on the registry
 *   3. Agent discovers the protocol by querying the registry
 *   4. Agent analyzes the contract source via DeepSeek (OpenRouter)
 *   5. Agent evaluates findings and decides to disclose
 *   6. Agent creates a DisclosureIntent
 *
 * Usage:
 *   bun run packages/researcher/src/experiments/e2e-discovery.ts
 */
import { Effect, Redacted } from "effect"
import {
  Provider,
  layerFromConfig,
  type ProviderConfig,
} from "@mnemo/core"
import {
  Registry,
  RegistryLocalLayer,
  Escrow,
  EscrowLocalLayer,
  type ProtocolData,
} from "@mnemo/chain"
import { getChallenge, type HybridChallenge } from "@mnemo/verifier"

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
  readonly severity: string
  readonly summary: string
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
// Main program
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const registry = yield* Registry
  const escrow = yield* Escrow
  const provider = yield* Provider

  console.log("=== MNEMO E2E: Discovery to Disclosure ===\n")

  // ── Step 1: Set up local environment ──────────────────────────────────

  console.log("[1/6] Setting up local environment...")
  console.log("  Registry: local layer ready")
  console.log("  Escrow: local layer ready")
  console.log()

  // ── Step 2: Register protocol on registry ─────────────────────────────

  console.log("[2/6] Registering protocol...")

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

  // ── Step 3: Agent discovers protocol ──────────────────────────────────

  console.log("[3/6] Agent discovering protocols...")

  const protocolData: ProtocolData = yield* registry.get(protocolId)

  if (!protocolData.active) {
    console.error("  ERROR: Protocol is not active")
    return
  }

  const ethBounty = Number(protocolData.maxBounty) / 1e18
  console.log("  Found 1 active protocol")
  console.log(`  Protocol ${protocolData.protocolId}: "${challenge.name}", bounty up to ${ethBounty} ETH`)
  console.log(`  MetadataURI: ${protocolData.metadataURI}`)
  console.log(`  Registered at: ${new Date(Number(protocolData.registeredAt) * 1000).toISOString()}`)
  console.log()

  // ── Step 4: Analyze contract ──────────────────────────────────────────

  console.log("[4/6] Analyzing contract...")
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

  // ── Step 5: Evaluate findings ─────────────────────────────────────────

  console.log("[5/6] Evaluating findings...")

  const detection = detectVulnerability(result.text)

  if (detection.found) {
    console.log(`  Vulnerability detected: severity=${detection.severity}, confidence=${detection.confidence}`)
    console.log("  Initiating disclosure...")
  } else {
    console.log("  No high-severity vulnerability detected by LLM.")
    console.log("  Skipping disclosure (agent would continue scanning).")
    console.log()
    console.log("=== FLOW COMPLETE (no disclosure needed) ===")
    return
  }
  console.log()

  // ── Step 6: Create disclosure intent ──────────────────────────────────

  console.log("[6/6] Creating disclosure intent...")

  const intent: DisclosureIntent = {
    researcherAgentId: 1,
    protocolId: protocolData.protocolId,
    severity: detection.severity,
    summary: result.text.slice(0, 500),
    timestamp: new Date().toISOString(),
  }

  console.log(`  DisclosureIntent {`)
  console.log(`    researcherAgentId: ${intent.researcherAgentId},`)
  console.log(`    protocolId: ${intent.protocolId},`)
  console.log(`    severity: "${intent.severity}",`)
  console.log(`    summary: "${intent.summary.slice(0, 120)}...",`)
  console.log(`    timestamp: "${intent.timestamp}"`)
  console.log(`  }`)

  // Create escrow for the bounty
  console.log()
  console.log("  Creating escrow for bounty deposit...")
  const commitHash = "0x" + "ab".repeat(32)
  const { escrowId, txHash: escrowTx } = yield* escrow.create({
    funder: protocolData.owner,
    payee: "0x" + "R".repeat(40).replace(/R/g, "e"), // researcher address
    amount: maxBounty,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
    commitHash,
  })
  console.log(`  Escrow created: id=${escrowId}, tx=${escrowTx}`)

  console.log()
  console.log("=== FLOW COMPLETE ===")
  console.log()
  console.log("Summary:")
  console.log(`  Protocol:     ${challenge.name} (id=${protocolData.protocolId})`)
  console.log(`  Max bounty:   ${ethBounty} ETH`)
  console.log(`  Vulnerability: ${detection.severity} severity (confidence: ${detection.confidence})`)
  console.log(`  Escrow:       id=${escrowId}`)
  console.log(`  Next step:    Open negotiation room for disclosure`)
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
