/**
 * RoomManager — manages active negotiation rooms.
 *
 * Each room gets an Effect PubSub for real-time event streaming (consumed by
 * the WebSocket handler) and a forked Fiber running the negotiation loop.
 *
 * Wires together:
 *   - @mnemo/verifier (forge verification pipeline)
 *   - @mnemo/chain (escrow simulation + IPFS archival)
 *   - @mnemo/harness (negotiation turn loop)
 */
import * as path from "node:path"
import { Context, Effect, Layer, PubSub, Fiber, Option } from "effect"
import {
  makeRoom,
  type Turn,
  type NegotiationResult,
  InMemoryLayer,
  model,
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
  Escrow,
  EscrowMockLayer,
  type EscrowStatus,
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
// Implementation
// ---------------------------------------------------------------------------

const rooms = new Map<string, RoomEntry>()
let roomCounter = 0

const makeProverConfig = (challenge: HybridChallenge): AgentConfig => ({
  id: "prover",
  role: "researcher",
  systemPrompt: `You are a security researcher who discovered a vulnerability in a DeFi protocol.

CHALLENGE: ${challenge.name}
DESCRIPTION: ${challenge.description}

YOUR TASK:
Present the vulnerability to the verifier. Explain the mechanism precisely and concisely.
When the verifier assigns a severity, use the accept_severity tool to accept it, or reject_severity if you disagree.
Be concise — 3-5 sentences per turn. Stay technical.`,
  toolkit: proverToolkit,
})

const makeVerifierConfig = (evidence: string): AgentConfig => ({
  id: "verifier",
  role: "protocol",
  systemPrompt: `${VERIFIER_SYSTEM_PROMPT}

You have already run the verification pipeline. Here are the results:

${evidence}

IMPORTANT: You MUST use one of your tools (approve_bug or reject_bug) to issue your verdict. Do not just write text — call the tool.`,
  toolkit: verifierToolkit,
})

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

/**
 * Upload evidence to IPFS via Kubo-compatible API.
 */
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

/**
 * Run forge verification for a challenge.
 */
const runVerification = (
  challenge: HybridChallenge,
  pubsub: PubSub.PubSub<RoomEvent>,
): Effect.Effect<HybridResult | null, never, never> =>
  Effect.gen(function* () {
    yield* PubSub.publish(pubsub, {
      type: "verification",
      data: { status: "running" },
    })

    const result = yield* verifyForgeOnly(challenge, DVDEFI_ROOT).pipe(
      Effect.provide(FoundryLive),
    )

    const event: VerificationEvent = {
      status: result.verdict === "VALID_BUG" ? "passed" : "failed",
      verdict: result.verdict,
      evidence: result.evidence,
      executionTimeMs: result.executionTimeMs,
    }
    yield* PubSub.publish(pubsub, { type: "verification", data: event })

    return result
  }).pipe(
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

/**
 * Run escrow lifecycle: create -> fund -> release/refund.
 */
const runEscrow = (
  roomId: string,
  pubsub: PubSub.PubSub<RoomEvent>,
  accepted: boolean,
): Effect.Effect<EscrowEvent | null, never, never> =>
  Effect.gen(function* () {
    const escrow = yield* Escrow

    const { escrowId, txHash: createTx } = yield* escrow.create({
      funder: "0x" + "F".repeat(40),
      payee: "0x" + "A".repeat(40),
      amount: 1000000000000000000n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
      commitHash: "0x" + roomId.replace(/[^a-f0-9]/gi, "").padEnd(64, "0").slice(0, 64),
    })

    const escrowIdStr = escrowId.toString()
    yield* PubSub.publish(pubsub, {
      type: "escrow",
      data: { escrowId: escrowIdStr, status: "Created", txHash: createTx },
    })

    const fundTx = yield* escrow.fund(escrowId, 1000000000000000000n)
    yield* PubSub.publish(pubsub, {
      type: "escrow",
      data: { escrowId: escrowIdStr, status: "Funded", txHash: fundTx },
    })

    if (accepted) {
      const releaseTx = yield* escrow.release(escrowId)
      const event: EscrowEvent = { escrowId: escrowIdStr, status: "Released", txHash: releaseTx }
      yield* PubSub.publish(pubsub, { type: "escrow", data: event })
      return event
    } else {
      const refundTx = yield* escrow.refund(escrowId)
      const event: EscrowEvent = { escrowId: escrowIdStr, status: "Refunded", txHash: refundTx }
      yield* PubSub.publish(pubsub, { type: "escrow", data: event })
      return event
    }
  }).pipe(
    Effect.provide(EscrowMockLayer()),
    Effect.catchAll((error) => {
      console.error("[RoomManager] Escrow failed:", error)
      return Effect.succeed(null as EscrowEvent | null)
    }),
  )

export const RoomManagerLive: Layer.Layer<RoomManager> = Layer.succeed(
  RoomManager,
  {
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
        }
        rooms.set(roomId, entry)

        const fiber = yield* Effect.gen(function* () {
          // Step 1: Run forge verification
          const forgeResult = yield* runVerification(challenge, pubsub)

          // Build evidence string
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

          // Step 2: Run negotiation with real evidence
          const proverConfig = makeProverConfig(challenge)
          const verifierConfig = makeVerifierConfig(evidence)

          const room = makeRoom(proverConfig, verifierConfig, {
            maxTurns: 6,
            openingMessage: `Security researcher requesting verification of a vulnerability in ${challenge.name}. Please evaluate my findings.`,
            onTurn: (turn) => {
              entry.turns.push(turn)
              Effect.runFork(PubSub.publish(pubsub, { type: "turn", data: turn }))
            },
          })

          const apiKey = process.env.OPENROUTER_API_KEY
          if (!apiKey) {
            return yield* Effect.fail(new Error("OPENROUTER_API_KEY not set"))
          }

          const providerLayer = model({
            apiKey,
            baseURL: "https://openrouter.ai/api/v1",
            model: "deepseek/deepseek-chat",
            temperature: 0.7,
            maxTokens: 1024,
          })

          const result: NegotiationResult = yield* room
            .negotiate()
            .pipe(
              Effect.provide(providerLayer),
              Effect.provide(InMemoryLayer),
            )

          entry.result = result

          // Step 3: Run escrow lifecycle
          const accepted = result.outcome === "ACCEPTED"
          const escrowResult = yield* runEscrow(roomId, pubsub, accepted)
          entry.escrow = escrowResult

          // Step 4: Archive evidence to IPFS
          const ipfsPayload = {
            roomId,
            challengeId,
            outcome: result.outcome,
            verdict: forgeResult?.verdict ?? null,
            severity: result.agreedSeverity ?? result.assignedSeverity ?? null,
            evidence: forgeResult?.evidence ?? evidence,
            totalTurns: result.totalTurns,
            escrowId: escrowResult?.escrowId ?? null,
            timestamp: new Date().toISOString(),
          }

          const ipfsResult = yield* Effect.promise(() => uploadToIpfs(ipfsPayload))
          entry.ipfs = ipfsResult
          yield* PubSub.publish(pubsub, { type: "ipfs", data: ipfsResult })

          return result
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
      })
    },

    subscribe: (roomId: string) =>
      Effect.succeed(rooms.get(roomId)?.pubsub ?? null),

    listChallenges: () => listChallenges(),
  },
)
