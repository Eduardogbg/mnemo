#!/usr/bin/env bun
/**
 * e2e-discovery.ts — Unified end-to-end demo: identity -> attestation -> registry ->
 * discovery -> analysis -> disclosure -> negotiation -> settlement -> reputation -> archive.
 *
 * Exercises the full Mnemo flow:
 *   1.  Set up local layers (Registry, Escrow, ERC-8004, ExecutionLog)
 *   2.  Register agent identities via ERC-8004
 *   3.  Generate TEE attestation (composeHash -> RTMR[3])
 *   4.  Register a protocol (side-entrance challenge) on MnemoRegistry
 *   5.  Agent discovers the protocol by polling the registry
 *   6.  LLM blind audit (hypothesis)
 *   7.  Forge verification — exploit test + patched test (proof)
 *   8.  Disclosure + Negotiation room
 *   9.  Settlement (escrow create -> fund -> auto-release)
 *  10.  Post-settlement (reputation + IPFS archive + log flush)
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
  RegistryMockLayer,
  Escrow,
  EscrowMockLayer,
  Erc8004,
  Erc8004MockLayer,
  generateAttestationJson,
  hashFile,
  type ProtocolData,
} from "@mnemo/chain"
import { getChallenge, verifyForgeOnly, VERIFIER_SYSTEM_PROMPT, type HybridChallenge, type HybridResult } from "@mnemo/verifier"
import { FoundryLive } from "@mnemo/dvdefi"
import {
  makeRoom,
  proverTools,
  verifierTools,
  type AgentConfig,
  type NegotiationResult,
} from "@mnemo/harness"
import { ExecutionLog, ExecutionLogLive } from "../ExecutionLog.js"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Venice is primary, OpenRouter is fallback
const VENICE_API_KEY = process.env.VENICE_API_KEY ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""

const apiKey = VENICE_API_KEY || OPENROUTER_API_KEY
if (!apiKey) {
  console.error("No API key found. Set VENICE_API_KEY or OPENROUTER_API_KEY in .env")
  process.exit(1)
}

const useVenice = !!VENICE_API_KEY
const providerConfig: ProviderConfig = {
  apiKey: Redacted.make(apiKey),
  baseURL: useVenice ? "https://api.venice.ai/api/v1" : "https://openrouter.ai/api/v1",
  model: useVenice ? "llama-3.3-70b" : "deepseek/deepseek-chat",
  temperature: 0.3,
  maxTokens: 4096,
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
// DVDeFi repo root (for forge verification)
// ---------------------------------------------------------------------------

const DVDEFI_ROOT = resolve(import.meta.dir, "../../../../repos/damn-vulnerable-defi")

// ---------------------------------------------------------------------------
// Polling-based registry discovery
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// IPFS upload — Kubo-compatible API
// ---------------------------------------------------------------------------

const IPFS_API = process.env.IPFS_API ?? "http://localhost:5001"
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "http://localhost:8080"

const uploadToIpfs = async (payload: Record<string, unknown>): Promise<{ cid: string; url: string }> => {
  const json = JSON.stringify(payload, null, 2)
  const form = new FormData()
  form.append("file", new Blob([json], { type: "application/json" }))
  const res = await fetch(`${IPFS_API}/api/v0/add`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) throw new Error(`IPFS upload failed: ${res.status} ${res.statusText}`)
  const { Hash } = (await res.json()) as { Hash: string }
  return { cid: Hash, url: `${IPFS_GATEWAY}/ipfs/${Hash}` }
}

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const registry = yield* Registry
  const escrow = yield* Escrow
  const provider = yield* Provider
  const erc8004 = yield* Erc8004
  const log = yield* ExecutionLog

  console.log("=== MNEMO E2E: Discovery to Disclosure ===\n")

  // ── Step 1: Set up local environment ──────────────────────────────────

  console.log("[1/10] Setting up local environment...")
  yield* log.logPhase("setup", "start")
  console.log("  Registry: local layer ready")
  console.log("  Escrow: local layer ready")
  console.log("  ERC-8004: local layer ready")
  console.log("  ExecutionLog: ready")
  yield* log.logPhase("setup", "end")
  console.log()

  // ── Step 2: Register agent identities (ERC-8004) ─────────────────────

  console.log("[2/10] Registering agent identities (ERC-8004)...")
  yield* log.logPhase("identity", "start")

  const protocolAgentId = yield* erc8004.registerAgent(
    "ipfs://agent.json#mnemo-protocol",
  )
  console.log(`  Protocol Agent ID: ${protocolAgentId}`)

  const researcherAgentId = yield* erc8004.registerAgent(
    "ipfs://agent.json#mnemo-researcher",
  )
  console.log(`  Researcher Agent ID: ${researcherAgentId}`)

  yield* log.logOnChainTx("identity", {
    method: "registerAgent",
    contract: erc8004.identityAddress,
    chain: "local",
    success: true,
  })
  yield* log.logPhase("identity", "end")
  console.log()

  // ── Step 3: TEE attestation ───────────────────────────────────────────

  console.log("[3/10] Generating TEE attestation...")
  yield* log.logPhase("attestation", "start")

  let composeHash = "0x" + "0".repeat(64)
  try {
    const composePath = resolve("infra/dstack/docker-compose.prod.yml")
    const content = readFileSync(composePath, "utf-8")
    composeHash = yield* hashFile(content)
    console.log(`  composeHash: ${composeHash.slice(0, 20)}...`)
  } catch {
    console.log("  docker-compose.prod.yml not found — using zero hash")
  }

  const attestation = yield* generateAttestationJson(
    `0x${researcherAgentId.toString(16).padStart(40, "0")}`,
    composeHash,
  )
  console.log(`  Quote: ${attestation.quote.slice(0, 40)}...`)
  console.log(`  RTMR[3]: ${attestation.rtmr3.slice(0, 16)}... (binds to exact Docker image)`)

  yield* log.logPhase("attestation", "end")
  console.log()

  // ── Step 4: Register protocol on registry ─────────────────────────────

  console.log("[4/10] Registering protocol on MnemoRegistry...")
  yield* log.logPhase("registry", "start")

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

  yield* log.logOnChainTx("registry", {
    method: "register",
    contract: "MnemoRegistry",
    txHash,
    chain: "local",
    success: true,
  })
  yield* log.logPhase("registry", "end")
  console.log()

  // ── Step 5: Agent discovers protocol via polling ──────────────────────

  console.log("[5/10] Agent polling registry for new protocols...")
  yield* log.logPhase("discovery", "start")

  const lastSeenId = 0
  const { newProtocols, nextId } = yield* pollRegistry(registry, lastSeenId)

  if (newProtocols.length === 0) {
    console.error("  ERROR: No active protocols found in registry")
    return
  }

  console.log(`  Polled from ID ${lastSeenId}, scanned ${nextId - lastSeenId} slot(s): found ${newProtocols.length} new active protocol(s)`)
  console.log(`  Next poll starts at ID ${nextId}`)

  const protocolData = newProtocols[0]!

  const ethBounty = Number(protocolData.maxBounty) / 1e18
  console.log(`  Protocol ${protocolData.protocolId}: "${challenge.name}", bounty up to ${ethBounty} ETH`)
  console.log(`  MetadataURI: ${protocolData.metadataURI}`)
  console.log(`  Registered at: ${new Date(Number(protocolData.registeredAt) * 1000).toISOString()}`)

  yield* log.logPhase("discovery", "end")
  console.log()

  // ── Step 6: Analyze contract ──────────────────────────────────────────

  console.log("[6/10] LLM blind audit (hypothesis)...")
  yield* log.logPhase("analysis", "start")
  console.log(`  Sending ${challenge.name} source to LLM for audit...`)
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
  for (const line of result.text.split("\n")) {
    console.log(`  ${line}`)
  }
  console.log("  --- END RESPONSE ---")
  console.log(`  Latency: ${latencyMs}ms | Response length: ${result.text.length} chars`)

  yield* log.logLlmCall("analysis", {
    model: providerConfig.model,
    latencyMs,
    messageCount: 1,
    toolCount: 0,
  })
  yield* log.logPhase("analysis", "end")
  console.log()

  // ── Step 7: Verify with forge ─────────────────────────────────────────

  console.log("[7/10] Forge verification (proof)...")
  yield* log.logPhase("verification", "start")
  console.log(`  DVDeFi root: ${DVDEFI_ROOT}`)

  const forgeResult: HybridResult = yield* verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
    Effect.provide(FoundryLive),
  )

  console.log(`  Forge verdict: ${forgeResult.verdict}`)
  console.log(`  Exploit test: ${forgeResult.exploitTest.passed ? "PASSED" : "FAILED"}`)
  if (forgeResult.patchedTest) {
    console.log(`  Patched test: ${forgeResult.patchedTest.passed ? "PASSED" : "FAILED"}`)
  }
  console.log(`  Execution time: ${forgeResult.executionTimeMs}ms`)

  if (forgeResult.verdict !== "VALID_BUG") {
    console.log(`  Verdict: ${forgeResult.verdict} — no exploitable vulnerability proven.`)
    console.log("  Skipping disclosure (agent would continue scanning).")
    console.log()
    console.log("=== FLOW COMPLETE (no verified exploit) ===")
    yield* log.logPhase("verification", "end")
    return
  }

  console.log(`  VALID_BUG confirmed — exploit works AND patch blocks it`)
  console.log()
  console.log("  --- FORGE EVIDENCE ---")
  for (const line of forgeResult.evidence.split("\n")) {
    console.log(`  ${line}`)
  }
  console.log("  --- END EVIDENCE ---")

  yield* log.logFinding("verification", {
    severity: forgeResult.severity ?? "critical",
    description: `${challenge.name}: ${forgeResult.verdict}`,
    challengeId: "side-entrance",
    verdict: forgeResult.verdict,
  })
  yield* log.logPhase("verification", "end")
  console.log()

  // ── Step 8: Disclosure + Negotiation room ─────────────────────────────

  console.log("[8/10] Disclosure + Negotiation room...")
  yield* log.logPhase("negotiation", "start")

  const intent: DisclosureIntent = {
    researcherAgentId: Number(researcherAgentId),
    protocolId: protocolData.protocolId,
    timestamp: new Date().toISOString(),
  }

  console.log(`  DisclosureIntent {`)
  console.log(`    researcherAgentId: ${intent.researcherAgentId},`)
  console.log(`    protocolId: ${intent.protocolId},`)
  console.log(`    timestamp: "${intent.timestamp}"`)
  console.log(`  }`)
  console.log(`  Protocol notified: "An attested agent has a verified exploit for your contract"`)
  console.log(`  Protocol accepts — opening negotiation room...`)
  console.log()

  // Build prover config
  const proverConfig: AgentConfig = {
    id: "prover",
    role: "researcher",
    systemPrompt: `You are a security researcher who discovered and VERIFIED a vulnerability in a DeFi protocol.

CHALLENGE: ${challenge.name}
DESCRIPTION: ${challenge.description}

YOUR FORGE VERIFICATION RESULTS:
${forgeResult.evidence}

YOUR LLM ANALYSIS:
${result.text.slice(0, 1500)}

YOUR TASK:
Present the forge-verified vulnerability to the verifier. You have PROOF: the exploit test passes (vulnerability exists) and the patched test passes (fix works).
When the verifier assigns a severity, use the accept_severity tool to accept it, or reject_severity if you disagree.
Be concise — 3-5 sentences per turn. Stay technical. Lead with the forge proof.`,
    tools: proverTools,
  }

  // Build verifier config
  const evidenceContext = [
    `=== FORGE VERIFICATION EVIDENCE ===`,
    `Verdict: ${forgeResult.verdict}`,
    `Exploit test: ${forgeResult.exploitTest.passed ? "PASSED" : "FAILED"}`,
    forgeResult.patchedTest ? `Patched test: ${forgeResult.patchedTest.passed ? "PASSED" : "FAILED"}` : "",
    `Execution time: ${forgeResult.executionTimeMs}ms`,
    ``,
    `--- Researcher's LLM analysis (truncated) ---`,
    result.text.slice(0, 2000),
    `--- End analysis ---`,
  ].filter(Boolean).join("\n")

  const verifierConfig: AgentConfig = {
    id: "verifier",
    role: "protocol",
    systemPrompt: `${VERIFIER_SYSTEM_PROMPT}

You have the following forge-verified evidence from the researcher:

${evidenceContext}

The exploit has been verified by forge: exploit test PASSED (vulnerability exists) and patched test PASSED (fix works). This is cryptographic proof from the TEE.

IMPORTANT: You MUST use one of your tools (approve_bug or reject_bug) to issue your verdict. Do not just write text — call the tool.`,
    tools: verifierTools,
  }

  const room = makeRoom(proverConfig, verifierConfig, {
    maxTurns: 6,
    openingMessage: `Security researcher requesting verification of a forge-proven vulnerability in ${challenge.name}. Exploit test PASSED, patched test PASSED — verdict: VALID_BUG. Please evaluate.`,
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

  yield* log.logPhase("negotiation", "end")
  console.log()

  // ── Step 9: Settlement — escrow only if ACCEPTED ──────────────────────

  const severity = negotiation.agreedSeverity ?? negotiation.assignedSeverity ?? forgeResult.severity ?? "critical"

  if (negotiation.outcome === "ACCEPTED") {
    console.log("[9/10] Settlement: creating escrow (protocol funds)...")
    yield* log.logPhase("settlement", "start")

    const researcherAddress = "0x" + "ee".repeat(20)
    const commitHash = "0x" + "ab".repeat(32)

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

    const fundTx = yield* escrow.fund(escrowId, maxBounty)
    console.log(`  Escrow funded: ${ethBounty} ETH, tx=${fundTx}`)

    console.log(`  Forge verification: ${forgeResult.verdict} (already proven)`)
    console.log(`  TEE auto-releasing escrow — exploit verified at pinned block...`)
    const releaseTx = yield* escrow.release(escrowId)
    console.log(`  Escrow released to researcher: tx=${releaseTx}`)

    yield* log.logOnChainTx("settlement", {
      method: "escrow:create+fund+release",
      contract: "MnemoEscrow",
      txHash: releaseTx,
      chain: "local",
      success: true,
    })
    yield* log.logPhase("settlement", "end")
    console.log()

    // ── Step 10: Post-settlement ──────────────────────────────────────

    console.log("[10/10] Post-settlement (reputation + IPFS archive + log flush)...")
    yield* log.logPhase("post-settlement", "start")

    // Reputation feedback
    const researcherFeedbackTx = yield* erc8004.giveFeedback({
      agentId: researcherAgentId,
      value: 100n,
      tag1: "mnemo-disclosure",
      tag2: severity,
      feedbackHash: "0x" + "cd".repeat(32),
    })
    console.log(`  Researcher reputation: +100 (tx=${researcherFeedbackTx})`)

    const protocolFeedbackTx = yield* erc8004.giveFeedback({
      agentId: protocolAgentId,
      value: 100n,
      tag1: "mnemo-protocol",
      tag2: "paid",
      feedbackHash: "0x" + "ef".repeat(32),
    })
    console.log(`  Protocol reputation: +100 (tx=${protocolFeedbackTx})`)

    // IPFS archival
    const ipfsPayload = {
      protocolId: protocolData.protocolId.toString(),
      challengeId: "side-entrance",
      verdict: forgeResult.verdict,
      severity,
      outcome: negotiation.outcome,
      totalTurns: negotiation.totalTurns,
      evidence: forgeResult.evidence,
      researcherAgentId: researcherAgentId.toString(),
      protocolAgentId: protocolAgentId.toString(),
      attestationQuote: attestation.quote.slice(0, 64) + "...",
      timestamp: new Date().toISOString(),
    }

    const ipfsResult = yield* Effect.promise(() => uploadToIpfs(ipfsPayload))
    console.log(`  IPFS archive: CID=${ipfsResult.cid}`)
    console.log(`  Gateway: ${ipfsResult.url}`)

    // Flush execution log
    yield* log.flush("agent_log.json")
    console.log("  ExecutionLog flushed to agent_log.json")

    yield* log.logPhase("post-settlement", "end")
    console.log()

    // ── Summary ─────────────────────────────────────────────────────
    console.log("=== SUMMARY ===")
    console.log(`Identity:     Protocol=${protocolAgentId}, Researcher=${researcherAgentId}`)
    console.log(`Attestation:  RTMR[3]=${attestation.rtmr3.slice(0, 16)}...`)
    console.log(`Discovery:    Found protocol "${challenge.name}" (id=${protocolData.protocolId}, bounty up to ${ethBounty} ETH)`)
    console.log(`Analysis:     LLM audit -> forge verification -> ${forgeResult.verdict}`)
    console.log(`Verification: Exploit PASSED, Patched PASSED (${forgeResult.executionTimeMs}ms)`)
    console.log(`Negotiation:  ${negotiation.outcome} (${negotiation.totalTurns} turns), severity: ${severity}`)
    console.log(`Settlement:   Escrow created -> funded (${ethBounty} ETH) -> auto-released`)
    console.log(`Reputation:   Both agents +100`)
    console.log(`Archive:      IPFS CID=${ipfsResult.cid}`)
  } else {
    console.log("[9/10] No deal reached — no escrow created.")
    console.log(`  Outcome: ${negotiation.outcome}`)
    console.log(`  Note: forge verification was ${forgeResult.verdict} — the bug IS real.`)
    console.log(`  No payment.`)
    console.log()

    // Still do post-settlement logging
    console.log("[10/10] Post-settlement (reputation + log flush)...")
    yield* log.logPhase("post-settlement", "start")

    const researcherFeedbackTx = yield* erc8004.giveFeedback({
      agentId: researcherAgentId,
      value: -50n,
      tag1: "mnemo-disclosure",
      tag2: severity,
      feedbackHash: "0x" + "cd".repeat(32),
    })
    console.log(`  Researcher reputation: -50 (tx=${researcherFeedbackTx})`)

    const protocolFeedbackTx = yield* erc8004.giveFeedback({
      agentId: protocolAgentId,
      value: 0n,
      tag1: "mnemo-protocol",
      tag2: "disputed",
      feedbackHash: "0x" + "ef".repeat(32),
    })
    console.log(`  Protocol reputation: 0 (tx=${protocolFeedbackTx})`)

    yield* log.flush("agent_log.json")
    console.log("  ExecutionLog flushed to agent_log.json")

    yield* log.logPhase("post-settlement", "end")
    console.log()

    console.log("=== SUMMARY ===")
    console.log(`Identity:     Protocol=${protocolAgentId}, Researcher=${researcherAgentId}`)
    console.log(`Attestation:  RTMR[3]=${attestation.rtmr3.slice(0, 16)}...`)
    console.log(`Discovery:    Found protocol "${challenge.name}" (id=${protocolData.protocolId}, bounty up to ${ethBounty} ETH)`)
    console.log(`Analysis:     LLM audit -> forge verification -> ${forgeResult.verdict}`)
    console.log(`Verification: Exploit PASSED, Patched PASSED (${forgeResult.executionTimeMs}ms)`)
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
  Effect.provide(RegistryMockLayer()),
  Effect.provide(EscrowMockLayer()),
  Effect.provide(Erc8004MockLayer()),
  Effect.provide(ExecutionLogLive),
)

Effect.runPromise(layers).catch((err) => {
  console.error("\nE2E script failed:", err)
  process.exit(1)
})
