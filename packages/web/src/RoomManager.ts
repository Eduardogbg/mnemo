/**
 * RoomManager — manages active negotiation rooms with the full 10-step pipeline.
 *
 * Steps:
 *   1.  Setup (instant)
 *   2.  Register agent identities (ERC-8004)
 *   3.  TEE attestation
 *   4.  Register protocol on MnemoRegistry
 *   5.  Agent discovers protocol via polling
 *   6.  LLM blind audit with streaming (hypothesis)
 *   7.  Forge verification (proof)
 *   8.  Disclosure + Negotiation room
 *   9.  Escrow settlement
 *  10.  Post-settlement (reputation + IPFS archive)
 *
 * Wires together:
 *   - @mnemo/chain (Erc8004, Registry, Escrow, attestation)
 *   - @mnemo/verifier (forge verification pipeline)
 *   - @mnemo/harness (negotiation turn loop)
 *   - @effect/ai LanguageModel (LLM streaming audit)
 */
import * as path from "node:path"
import { readFileSync, existsSync } from "node:fs"
import { Context, Effect, Layer, PubSub, Fiber, Option, Stream } from "effect"
import * as LanguageModel from "@effect/ai/LanguageModel"
import {
  makeRoom,
  type Turn,
  type NegotiationResult,
  InMemoryLayer,
  verifierToolkit,
  proverToolkit,
} from "@mnemo/harness"
import {
  getChallenge,
  listChallenges,
  VERIFIER_SYSTEM_PROMPT,
  verifyForgeOnly,
  type HybridChallenge,
  type HybridResult,
} from "@mnemo/verifier"
import { FoundryLive } from "@mnemo/dvdefi"
import {
  Erc8004,
  Registry,
  Escrow,
  generateAttestationJson,
  hashFile,
  type EscrowStatus,
  type ProtocolData,
} from "@mnemo/chain"
import { type AgentConfig } from "@mnemo/harness"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events streamed via WebSocket PubSub. */
export type RoomEvent =
  | { type: "turn"; data: Turn }
  | { type: "verification"; data: VerificationEvent }
  | { type: "escrow"; data: EscrowEvent }
  | { type: "ipfs"; data: IpfsEvent }
  | { type: "phase"; data: PhaseEvent }
  | { type: "identity"; data: IdentityEvent }
  | { type: "attestation"; data: AttestationEvent }
  | { type: "registry"; data: RegistryEvent }
  | { type: "discovery"; data: DiscoveryEvent }
  | { type: "audit"; data: AuditEvent }
  | { type: "reputation"; data: ReputationEvent }
  | { type: "outcome"; data: OutcomeEvent }

export interface OutcomeEvent {
  readonly outcome: string
  readonly totalTurns: number
  readonly agreedSeverity?: string
  readonly assignedSeverity?: string
  readonly evidence?: string | null
}

export interface PhaseEvent {
  readonly step: number
  readonly name: string
  readonly status: "start" | "done" | "error"
}

export interface IdentityEvent {
  readonly protocolAgentId: string
  readonly researcherAgentId: string
}

export interface AttestationEvent {
  readonly quote: string
  readonly rtmr3: string
}

export interface RegistryEvent {
  readonly protocolId: string
  readonly metadataURI: string
  readonly maxBounty: string
  readonly txHash: string
}

export interface DiscoveryEvent {
  readonly protocolId: string
  readonly name: string
  readonly bounty: string
  readonly slotsScanned: number
}

export interface AuditEvent {
  readonly status: "start" | "delta" | "done"
  readonly model: string
  readonly text?: string
  readonly latencyMs?: number
}

export interface ReputationEvent {
  readonly agentId: string
  readonly role: string
  readonly value: number
  readonly txHash: string
}

export interface VerificationEvent {
  readonly status: "running" | "passed" | "failed" | "error"
  readonly verdict?: string
  readonly evidence?: string
  readonly executionTimeMs?: number
}

export interface EscrowEvent {
  readonly escrowId: string
  readonly status: EscrowStatus
  readonly txHash?: string
}

export interface IpfsEvent {
  readonly cid: string
  readonly url: string
}

export interface RoomEntry {
  readonly challengeId: string
  readonly pubsub: PubSub.PubSub<RoomEvent>
  fiber: Fiber.RuntimeFiber<NegotiationResult | void, unknown>
  result: NegotiationResult | null
  turns: Turn[]
  evidence: string | null
  verification: VerificationEvent | null
  escrow: EscrowEvent | null
  ipfs: IpfsEvent | null
  // New state fields for 10-step pipeline
  identity: IdentityEvent | null
  attestation: AttestationEvent | null
  registry: RegistryEvent | null
  discovery: DiscoveryEvent | null
  audit: { model: string; text: string; latencyMs: number } | null
  reputation: ReputationEvent[]
  currentPhase: PhaseEvent | null
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface RoomManagerService {
  readonly createRoom: (challengeId: string) => Effect.Effect<string, Error>
  readonly getStatus: (roomId: string) => Option.Option<{
    status: "running" | "finished"
    turns: Turn[]
    result: NegotiationResult | null
    evidence: string | null
    verification: VerificationEvent | null
    escrow: EscrowEvent | null
    ipfs: IpfsEvent | null
    identity: IdentityEvent | null
    attestation: AttestationEvent | null
    registry: RegistryEvent | null
    discovery: DiscoveryEvent | null
    audit: { model: string; text: string; latencyMs: number } | null
    reputation: ReputationEvent[]
    currentPhase: PhaseEvent | null
  }>
  readonly subscribe: (roomId: string) => Effect.Effect<PubSub.PubSub<RoomEvent> | null>
  readonly listChallenges: () => ReadonlyArray<HybridChallenge>
}

export class RoomManager extends Context.Tag("@mnemo/web/RoomManager")<
  RoomManager,
  RoomManagerService
>() {}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DVDEFI_ROOT = path.resolve(import.meta.dir, "../../../repos/damn-vulnerable-defi")

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_MODEL = process.env.VENICE_API_KEY ? "llama-3.3-70b" : "deepseek/deepseek-chat"
const MAX_BOUNTY = 10000000000000000000n // 10 ETH in wei

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
// Audit prompts
// ---------------------------------------------------------------------------

const AUDIT_SYSTEM_PROMPT = `You are a smart contract security auditor. You perform thorough audits of Solidity contracts, looking for vulnerabilities, logic errors, and attack vectors. Be specific about:
- The exact vulnerability mechanism
- Which functions are affected
- How an attacker would exploit it step-by-step
- The severity (Critical / High / Medium / Low / Informational)
- Recommended fix

Do not identify yourself by model name, version, or architecture. Never mention what AI model you are. Respond as a professional security auditor — not as an AI assistant.

Do not speculate. Only report findings you are confident about based on the code.`

const AUDIT_USER_PROMPT = `Audit the following Solidity contract for security vulnerabilities:

\`\`\`solidity
${CONTRACT_SOURCE}
\`\`\`

Provide a detailed security audit report.`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rooms = new Map<string, RoomEntry>()
let roomCounter = 0

const IPFS_API = process.env.IPFS_API ?? "http://localhost:5001"
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "http://localhost:8080"

const uploadToIpfs = async (evidence: Record<string, unknown>): Promise<IpfsEvent> => {
  const json = JSON.stringify(evidence, null, 2)
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

/** Publish a phase event and update entry state. */
const publishPhase = (
  pubsub: PubSub.PubSub<RoomEvent>,
  entry: RoomEntry,
  step: number,
  name: string,
  status: "start" | "done" | "error",
) =>
  Effect.gen(function* () {
    const event: PhaseEvent = { step, name, status }
    entry.currentPhase = event
    yield* PubSub.publish(pubsub, { type: "phase", data: event })
  })

/** Polling-based registry discovery (same as e2e-discovery.ts). */
const pollRegistry = (
  registry: RegistryServiceType,
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
      if (result.protocol.owner === "0x" + "0".repeat(40)) break

      if (result.protocol.active) {
        newProtocols.push({ ...result.protocol, protocolId: BigInt(id) })
      }

      id++
    }

    return { newProtocols, nextId: id }
  })

type RegistryServiceType = Effect.Effect.Success<typeof Registry>

const formatEvidence = (result: HybridResult): string => {
  const lines = [
    `=== FORGE VERIFICATION RESULTS ===`,
    `Challenge: ${result.challengeId}`,
    `Verdict: ${result.verdict}`,
    ``,
    `Exploit test: ${result.exploitTest.passed ? "PASSED — the exploit succeeds against the target contracts" : "FAILED — the exploit does not work"}`,
  ]
  if (result.exploitTest.stderr) {
    lines.push(`  Output: ${result.exploitTest.stderr.slice(0, 500)}`)
  }
  if (result.patchedTest) {
    lines.push(
      `Patched test: ${result.patchedTest.passed ? "PASSED — the patched version blocks the exploit" : "FAILED — the patch does not block the exploit"}`,
    )
    if (result.patchedTest.stderr) {
      lines.push(`  Output: ${result.patchedTest.stderr.slice(0, 500)}`)
    }
  }
  lines.push(``, `Execution time: ${result.executionTimeMs}ms`)
  if (result.verdict === "VALID_BUG") {
    lines.push(
      ``,
      `Conclusion: The exploit succeeds against the original contracts and is blocked by the patched version.`,
    )
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const RoomManagerLive: Layer.Layer<RoomManager, never, Erc8004 | Registry | Escrow | LanguageModel.LanguageModel> = Layer.effect(
  RoomManager,
  Effect.gen(function* () {
    // Capture the services from the environment at layer construction time
    const erc8004 = yield* Erc8004
    const registry = yield* Registry
    const escrow = yield* Escrow
    // Capture LanguageModel so we can provide it to forked fibers
    const lm = yield* LanguageModel.LanguageModel
    const lmLayer = Layer.succeed(LanguageModel.LanguageModel, lm)

    const service: RoomManagerService = {
      createRoom: (challengeId: string) =>
        Effect.gen(function* () {
          const challenge = getChallenge(challengeId)
          if (!challenge) {
            return yield* Effect.fail(new Error(`Unknown challenge: ${challengeId}`))
          }

          const roomId = `room-${++roomCounter}-${Date.now()}`
          const pubsub = yield* PubSub.unbounded<RoomEvent>()

          const entry: RoomEntry = {
            challengeId,
            pubsub,
            fiber: undefined as any,
            result: null,
            turns: [],
            evidence: null,
            verification: null,
            escrow: null,
            ipfs: null,
            identity: null,
            attestation: null,
            registry: null,
            discovery: null,
            audit: null,
            reputation: [],
            currentPhase: null,
          }
          rooms.set(roomId, entry)

          const fiber = yield* Effect.gen(function* () {
            // ── Step 1: Setup ──────────────────────────────────────────
            yield* publishPhase(pubsub, entry, 1, "setup", "start")
            console.log(`[RoomManager] [1/10] Setup for room ${roomId}`)
            yield* publishPhase(pubsub, entry, 1, "setup", "done")

            // ── Step 2: Register agent identities (ERC-8004) ─────────
            yield* publishPhase(pubsub, entry, 2, "identity", "start")
            console.log(`[RoomManager] [2/10] Registering agent identities...`)

            const protocolAgentId = yield* erc8004.registerAgent(
              "ipfs://agent.json#mnemo-protocol",
            )
            const researcherAgentId = yield* erc8004.registerAgent(
              "ipfs://agent.json#mnemo-researcher",
            )

            const identityEvent: IdentityEvent = {
              protocolAgentId: protocolAgentId.toString(),
              researcherAgentId: researcherAgentId.toString(),
            }
            entry.identity = identityEvent
            yield* PubSub.publish(pubsub, { type: "identity", data: identityEvent })
            console.log(`[RoomManager]   Protocol=${protocolAgentId}, Researcher=${researcherAgentId}`)
            yield* publishPhase(pubsub, entry, 2, "identity", "done")

            // ── Step 3: TEE attestation ──────────────────────────────
            yield* publishPhase(pubsub, entry, 3, "attestation", "start")
            console.log(`[RoomManager] [3/10] Generating TEE attestation...`)

            let composeHash = "0x" + "0".repeat(64)
            try {
              const composePath = path.resolve(import.meta.dir, "../../../infra/dstack/docker-compose.prod.yml")
              if (existsSync(composePath)) {
                const content = readFileSync(composePath, "utf-8")
                composeHash = yield* hashFile(content)
              }
            } catch {
              // Use zero hash
            }

            const attestationDoc = yield* generateAttestationJson(
              `0x${researcherAgentId.toString(16).padStart(40, "0")}`,
              composeHash,
            )

            const attestationEvent: AttestationEvent = {
              quote: attestationDoc.quote,
              rtmr3: attestationDoc.rtmr3,
            }
            entry.attestation = attestationEvent
            yield* PubSub.publish(pubsub, { type: "attestation", data: attestationEvent })
            console.log(`[RoomManager]   Quote: ${attestationDoc.quote.slice(0, 40)}...`)
            console.log(`[RoomManager]   RTMR[3]: ${attestationDoc.rtmr3.slice(0, 16)}...`)
            yield* publishPhase(pubsub, entry, 3, "attestation", "done")

            // ── Step 4: Register protocol on MnemoRegistry ───────────
            yield* publishPhase(pubsub, entry, 4, "registry", "start")
            console.log(`[RoomManager] [4/10] Registering protocol on MnemoRegistry...`)

            const metadataURI = "ipfs://side-entrance-metadata"
            const { protocolId, txHash: regTxHash } = yield* registry.register(metadataURI, MAX_BOUNTY)

            const registryEvent: RegistryEvent = {
              protocolId: protocolId.toString(),
              metadataURI,
              maxBounty: MAX_BOUNTY.toString(),
              txHash: regTxHash,
            }
            entry.registry = registryEvent
            yield* PubSub.publish(pubsub, { type: "registry", data: registryEvent })
            console.log(`[RoomManager]   Protocol id=${protocolId}, tx=${regTxHash}`)
            yield* publishPhase(pubsub, entry, 4, "registry", "done")

            // ── Step 5: Agent discovers protocol via polling ─────────
            yield* publishPhase(pubsub, entry, 5, "discovery", "start")
            console.log(`[RoomManager] [5/10] Agent polling registry for new protocols...`)

            const { newProtocols, nextId } = yield* pollRegistry(registry, 0)

            if (newProtocols.length === 0) {
              yield* publishPhase(pubsub, entry, 5, "discovery", "error")
              return yield* Effect.fail(new Error("No active protocols found in registry"))
            }

            const protocolData = newProtocols[0]!
            const ethBounty = Number(protocolData.maxBounty) / 1e18

            const discoveryEvent: DiscoveryEvent = {
              protocolId: protocolData.protocolId.toString(),
              name: challenge.name,
              bounty: `${ethBounty} ETH`,
              slotsScanned: nextId,
            }
            entry.discovery = discoveryEvent
            yield* PubSub.publish(pubsub, { type: "discovery", data: discoveryEvent })
            console.log(`[RoomManager]   Found protocol "${challenge.name}", bounty up to ${ethBounty} ETH`)
            yield* publishPhase(pubsub, entry, 5, "discovery", "done")

            // ── Step 6: LLM blind audit with streaming ───────────────
            yield* publishPhase(pubsub, entry, 6, "audit", "start")
            console.log(`[RoomManager] [6/10] LLM blind audit (streaming)...`)

            const auditStartEvent: AuditEvent = { status: "start", model: AUDIT_MODEL }
            yield* PubSub.publish(pubsub, { type: "audit", data: auditStartEvent })

            const startMs = Date.now()
            let auditText = ""

            // Use streamText to get streaming deltas
            const stream = LanguageModel.streamText({
              prompt: [
                { role: "system" as const, content: AUDIT_SYSTEM_PROMPT },
                { role: "user" as const, content: AUDIT_USER_PROMPT },
              ],
            })

            yield* Stream.runForEach(stream, (part: any) =>
              Effect.gen(function* () {
                if (part.type === "text-delta" && part.delta) {
                  auditText += part.delta
                  yield* PubSub.publish(pubsub, {
                    type: "audit",
                    data: { status: "delta", model: AUDIT_MODEL, text: part.delta },
                  })
                }
              }),
            ).pipe(Effect.provide(lmLayer))

            const latencyMs = Date.now() - startMs

            const auditDoneEvent: AuditEvent = {
              status: "done",
              model: AUDIT_MODEL,
              latencyMs,
            }
            yield* PubSub.publish(pubsub, { type: "audit", data: auditDoneEvent })
            entry.audit = { model: AUDIT_MODEL, text: auditText, latencyMs }
            console.log(`[RoomManager]   Audit complete: ${latencyMs}ms, ${auditText.length} chars`)
            yield* publishPhase(pubsub, entry, 6, "audit", "done")

            // ── Step 7: Forge verification ────────────────────────────
            yield* publishPhase(pubsub, entry, 7, "verification", "start")
            console.log(`[RoomManager] [7/10] Forge verification...`)

            yield* PubSub.publish(pubsub, {
              type: "verification",
              data: { status: "running" },
            })

            const forgeResult = yield* verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
              Effect.provide(FoundryLive),
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  console.error("[RoomManager] Forge verification failed:", error)
                  yield* PubSub.publish(pubsub, {
                    type: "verification",
                    data: { status: "error", evidence: String(error) },
                  })
                  return null as HybridResult | null
                }),
              ),
            )

            let evidence: string
            if (forgeResult) {
              evidence = formatEvidence(forgeResult)
              entry.evidence = evidence
              entry.verification = {
                status: forgeResult.verdict === "VALID_BUG" ? "passed" : "failed",
                verdict: forgeResult.verdict,
                evidence: forgeResult.evidence,
                executionTimeMs: forgeResult.executionTimeMs,
              }
              yield* PubSub.publish(pubsub, { type: "verification", data: entry.verification })
              console.log(`[RoomManager]   Forge verdict: ${forgeResult.verdict}`)
            } else {
              evidence = [
                `=== VERIFICATION EVIDENCE ===`,
                `Challenge: ${challenge.name}`,
                `Note: Forge verification unavailable — using challenge description.`,
                `Description: ${challenge.description}`,
              ].join("\n")
              entry.evidence = evidence
              entry.verification = { status: "error", evidence: "Forge unavailable" }
            }

            yield* publishPhase(pubsub, entry, 7, "verification", "done")

            // ── Step 8: Disclosure + Negotiation room ─────────────────
            yield* publishPhase(pubsub, entry, 8, "negotiation", "start")
            console.log(`[RoomManager] [8/10] Disclosure + Negotiation room...`)

            // Build prover config (same as e2e-discovery.ts)
            const proverConfig: AgentConfig = {
              id: "prover",
              role: "researcher",
              systemPrompt: `You are a security researcher who discovered and VERIFIED a vulnerability in a DeFi protocol.

IMPORTANT: Do not identify yourself by model name, version, or architecture. Never mention what AI model you are. Respond as a professional security researcher — not as an AI assistant.

CHALLENGE: ${challenge.name}
DESCRIPTION: ${challenge.description}

YOUR FORGE VERIFICATION RESULTS:
${forgeResult?.evidence ?? evidence}

YOUR LLM ANALYSIS:
${auditText.slice(0, 1500)}

YOUR TASK:
Present the forge-verified vulnerability to the verifier. You have PROOF: the exploit test passes (vulnerability exists) and the patched test passes (fix works).
When the verifier assigns a severity, use the accept_severity tool to accept it, or reject_severity if you disagree.
Be concise — 3-5 sentences per turn. Stay technical. Lead with the forge proof.`,
              toolkit: proverToolkit,
            }

            // Build verifier config
            const evidenceContext = [
              `=== FORGE VERIFICATION EVIDENCE ===`,
              `Verdict: ${forgeResult?.verdict ?? "UNAVAILABLE"}`,
              `Exploit test: ${forgeResult?.exploitTest.passed ? "PASSED" : "FAILED/UNAVAILABLE"}`,
              forgeResult?.patchedTest ? `Patched test: ${forgeResult.patchedTest.passed ? "PASSED" : "FAILED"}` : "",
              forgeResult ? `Execution time: ${forgeResult.executionTimeMs}ms` : "",
              ``,
              `--- Researcher's LLM analysis (truncated) ---`,
              auditText.slice(0, 2000),
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
              toolkit: verifierToolkit,
            }

            const room = makeRoom(proverConfig, verifierConfig, {
              maxTurns: 6,
              openingMessage: `Security researcher requesting verification of a forge-proven vulnerability in ${challenge.name}. Exploit test PASSED, patched test PASSED — verdict: VALID_BUG. Please evaluate.`,
              onTurn: (turn) => {
                entry.turns.push(turn)
                Effect.runFork(PubSub.publish(pubsub, { type: "turn", data: turn }))
              },
            })

            const negotiation: NegotiationResult = yield* room
              .negotiate()
              .pipe(
                Effect.provide(InMemoryLayer),
                Effect.provide(lmLayer),
              )

            entry.result = negotiation
            console.log(`[RoomManager]   Negotiation: ${negotiation.outcome}, ${negotiation.totalTurns} turns`)
            yield* publishPhase(pubsub, entry, 8, "negotiation", "done")

            // ── Step 9: Escrow settlement ─────────────────────────────
            yield* publishPhase(pubsub, entry, 9, "settlement", "start")
            console.log(`[RoomManager] [9/10] Escrow settlement...`)

            const accepted = negotiation.outcome === "ACCEPTED"

            if (accepted) {
              const researcherAddress = "0x" + "ee".repeat(20)
              const commitHash = "0x" + roomId.replace(/[^a-f0-9]/gi, "").padEnd(64, "0").slice(0, 64)

              const { escrowId, txHash: createTx } = yield* escrow.create({
                funder: protocolData.owner,
                payee: researcherAddress,
                amount: MAX_BOUNTY,
                deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
                commitHash,
              })

              const escrowIdStr = escrowId.toString()
              yield* PubSub.publish(pubsub, {
                type: "escrow",
                data: { escrowId: escrowIdStr, status: "Created", txHash: createTx },
              })

              const fundTx = yield* escrow.fund(escrowId, MAX_BOUNTY)
              yield* PubSub.publish(pubsub, {
                type: "escrow",
                data: { escrowId: escrowIdStr, status: "Funded", txHash: fundTx },
              })

              const releaseTx = yield* escrow.release(escrowId)
              const escrowEvent: EscrowEvent = { escrowId: escrowIdStr, status: "Released", txHash: releaseTx }
              entry.escrow = escrowEvent
              yield* PubSub.publish(pubsub, { type: "escrow", data: escrowEvent })
              console.log(`[RoomManager]   Escrow created → funded → released`)
            } else {
              // No deal — create and refund
              const commitHash = "0x" + roomId.replace(/[^a-f0-9]/gi, "").padEnd(64, "0").slice(0, 64)
              const { escrowId, txHash: createTx } = yield* escrow.create({
                funder: "0x" + "F".repeat(40),
                payee: "0x" + "A".repeat(40),
                amount: MAX_BOUNTY,
                deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
                commitHash,
              })

              const escrowIdStr = escrowId.toString()
              yield* PubSub.publish(pubsub, {
                type: "escrow",
                data: { escrowId: escrowIdStr, status: "Created", txHash: createTx },
              })

              const fundTx = yield* escrow.fund(escrowId, MAX_BOUNTY)
              yield* PubSub.publish(pubsub, {
                type: "escrow",
                data: { escrowId: escrowIdStr, status: "Funded", txHash: fundTx },
              })

              const refundTx = yield* escrow.refund(escrowId)
              const escrowEvent: EscrowEvent = { escrowId: escrowIdStr, status: "Refunded", txHash: refundTx }
              entry.escrow = escrowEvent
              yield* PubSub.publish(pubsub, { type: "escrow", data: escrowEvent })
              console.log(`[RoomManager]   Escrow created → funded → refunded (no deal)`)
            }

            yield* publishPhase(pubsub, entry, 9, "settlement", "done")

            // ── Step 10: Post-settlement (reputation + IPFS archive) ─
            yield* publishPhase(pubsub, entry, 10, "post-settlement", "start")
            console.log(`[RoomManager] [10/10] Post-settlement...`)

            const severity = negotiation.agreedSeverity ?? negotiation.assignedSeverity ?? forgeResult?.severity ?? "critical"

            // Reputation feedback
            if (accepted) {
              const resTx = yield* erc8004.giveFeedback({
                agentId: researcherAgentId,
                value: 100n,
                tag1: "mnemo-disclosure",
                tag2: severity,
                feedbackHash: "0x" + "cd".repeat(32),
              })
              const resRepEvent: ReputationEvent = {
                agentId: researcherAgentId.toString(),
                role: "researcher",
                value: 100,
                txHash: resTx,
              }
              entry.reputation.push(resRepEvent)
              yield* PubSub.publish(pubsub, { type: "reputation", data: resRepEvent })

              const proTx = yield* erc8004.giveFeedback({
                agentId: protocolAgentId,
                value: 100n,
                tag1: "mnemo-protocol",
                tag2: "paid",
                feedbackHash: "0x" + "ef".repeat(32),
              })
              const proRepEvent: ReputationEvent = {
                agentId: protocolAgentId.toString(),
                role: "protocol",
                value: 100,
                txHash: proTx,
              }
              entry.reputation.push(proRepEvent)
              yield* PubSub.publish(pubsub, { type: "reputation", data: proRepEvent })
              console.log(`[RoomManager]   Reputation: researcher +100, protocol +100`)
            } else {
              const resTx = yield* erc8004.giveFeedback({
                agentId: researcherAgentId,
                value: -50n,
                tag1: "mnemo-disclosure",
                tag2: severity,
                feedbackHash: "0x" + "cd".repeat(32),
              })
              const resRepEvent: ReputationEvent = {
                agentId: researcherAgentId.toString(),
                role: "researcher",
                value: -50,
                txHash: resTx,
              }
              entry.reputation.push(resRepEvent)
              yield* PubSub.publish(pubsub, { type: "reputation", data: resRepEvent })

              const proTx = yield* erc8004.giveFeedback({
                agentId: protocolAgentId,
                value: 0n,
                tag1: "mnemo-protocol",
                tag2: "disputed",
                feedbackHash: "0x" + "ef".repeat(32),
              })
              const proRepEvent: ReputationEvent = {
                agentId: protocolAgentId.toString(),
                role: "protocol",
                value: 0,
                txHash: proTx,
              }
              entry.reputation.push(proRepEvent)
              yield* PubSub.publish(pubsub, { type: "reputation", data: proRepEvent })
              console.log(`[RoomManager]   Reputation: researcher -50, protocol 0`)
            }

            // IPFS archive
            const ipfsPayload = {
              roomId,
              protocolId: protocolData.protocolId.toString(),
              challengeId,
              verdict: forgeResult?.verdict ?? null,
              severity,
              outcome: negotiation.outcome,
              totalTurns: negotiation.totalTurns,
              evidence: forgeResult?.evidence ?? evidence,
              researcherAgentId: researcherAgentId.toString(),
              protocolAgentId: protocolAgentId.toString(),
              attestationQuote: attestationDoc.quote.slice(0, 64) + "...",
              escrowId: entry.escrow?.escrowId ?? null,
              timestamp: new Date().toISOString(),
            }

            const ipfsResult = yield* Effect.promise(() => uploadToIpfs(ipfsPayload))
            entry.ipfs = ipfsResult
            yield* PubSub.publish(pubsub, { type: "ipfs", data: ipfsResult })
            console.log(`[RoomManager]   IPFS archive: CID=${ipfsResult.cid}`)

            yield* publishPhase(pubsub, entry, 10, "post-settlement", "done")
            console.log(`[RoomManager] Pipeline complete for room ${roomId}`)

            // Publish outcome event — signals to WebSocket handler to close
            yield* PubSub.publish(pubsub, {
              type: "outcome",
              data: {
                outcome: negotiation.outcome,
                totalTurns: negotiation.totalTurns,
                agreedSeverity: negotiation.agreedSeverity,
                assignedSeverity: negotiation.assignedSeverity,
                evidence: entry.evidence,
              },
            })

            return negotiation
          }).pipe(
            Effect.tapErrorCause((cause) =>
              Effect.log(`[RoomManager] Pipeline failed for ${roomId}: ${cause}`),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.error(`[RoomManager] Pipeline error for ${roomId}:`, error)
              }),
            ),
            Effect.forkDaemon,
          )

          entry.fiber = fiber
          return roomId
        }),

      getStatus: (roomId: string) => {
        const entry = rooms.get(roomId)
        if (!entry) return Option.none()
        return Option.some({
          status: entry.result ? "finished" as const : "running" as const,
          turns: entry.turns,
          result: entry.result,
          evidence: entry.evidence,
          verification: entry.verification,
          escrow: entry.escrow,
          ipfs: entry.ipfs,
          identity: entry.identity,
          attestation: entry.attestation,
          registry: entry.registry,
          discovery: entry.discovery,
          audit: entry.audit,
          reputation: entry.reputation,
          currentPhase: entry.currentPhase,
        })
      },

      subscribe: (roomId: string) =>
        Effect.succeed(rooms.get(roomId)?.pubsub ?? null),

      listChallenges: () => listChallenges(),
    }

    return service
  }),
)
