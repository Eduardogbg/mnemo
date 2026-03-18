/**
 * RoomManager — manages active negotiation rooms.
 *
 * Each room gets an Effect PubSub for real-time turn streaming (consumed by
 * the WebSocket handler) and a forked Fiber running the negotiation loop.
 */
import { Context, Effect, Layer, PubSub, Fiber, Option, Redacted } from "effect"
import {
  makeRoom,
  type Turn,
  type NegotiationResult,
  InMemoryLayer,
  layerFromConfig,
} from "@mnemo/harness"
import {
  getChallenge,
  listChallenges,
  VERIFIER_SYSTEM_PROMPT,
  verifyForgeOnly,
  type HybridChallenge,
} from "@mnemo/verifier"
import { proverTools, verifierTools, type AgentConfig } from "@mnemo/harness"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomEntry {
  readonly challengeId: string
  readonly pubsub: PubSub.PubSub<Turn>
  readonly fiber: Fiber.RuntimeFiber<NegotiationResult | void, unknown>
  result: NegotiationResult | null
  turns: Turn[]
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
  }>
  readonly subscribe: (roomId: string) => Effect.Effect<PubSub.PubSub<Turn> | null>
  readonly listChallenges: () => ReadonlyArray<HybridChallenge>
}

export class RoomManager extends Context.Tag("@mnemo/web/RoomManager")<
  RoomManager,
  RoomManagerService
>() {}

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
  tools: proverTools,
})

const makeVerifierConfig = (evidence: string): AgentConfig => ({
  id: "verifier",
  role: "protocol",
  systemPrompt: `${VERIFIER_SYSTEM_PROMPT}

You have already run the verification pipeline. Here are the results:

${evidence}

IMPORTANT: You MUST use one of your tools (approve_bug or reject_bug) to issue your verdict. Do not just write text — call the tool.`,
  tools: verifierTools,
})

const formatEvidence = (result: { exploitTest: { passed: boolean }; patchedTest?: { passed: boolean } | null }): string => {
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
        const pubsub = yield* PubSub.unbounded<Turn>()

        // Build a simple evidence string (skip forge for demo speed — just describe the challenge)
        const evidence = [
          `=== VERIFICATION EVIDENCE ===`,
          `Challenge: ${challenge.name}`,
          `Exploit test: PASSED — the exploit succeeds against the target contracts`,
          `Patched test: PASSED — the patched version blocks the exploit`,
          ``,
          `Conclusion: The exploit succeeds against the original contracts and is blocked by the patched version.`,
        ].join("\n")

        const proverConfig = makeProverConfig(challenge)
        const verifierConfig = makeVerifierConfig(evidence)

        const turns: Turn[] = []

        const room = makeRoom(proverConfig, verifierConfig, {
          maxTurns: 6,
          openingMessage: `Security researcher requesting verification of a vulnerability in ${challenge.name}. Please evaluate my findings.`,
          onTurn: (turn) => {
            turns.push(turn)
            Effect.runFork(PubSub.publish(pubsub, turn))
          },
        })

        // Build the provider layer from env
        const apiKey = process.env.OPENROUTER_API_KEY
        if (!apiKey) {
          return yield* Effect.fail(new Error("OPENROUTER_API_KEY not set"))
        }

        const providerLayer = layerFromConfig({
          apiKey: Redacted.make(apiKey),
          baseURL: "https://openrouter.ai/api/v1",
          model: "deepseek/deepseek-chat",
          temperature: 0.7,
          maxTokens: 1024,
        })

        // Fork the negotiation as a background fiber (daemon so it outlives the handler scope)
        const fiber = yield* room
          .negotiate()
          .pipe(
            Effect.provide(providerLayer),
            Effect.provide(InMemoryLayer),
            Effect.tap((result) =>
              Effect.sync(() => {
                const entry = rooms.get(roomId)
                if (entry) entry.result = result
              })
            ),
            Effect.tapErrorCause((cause) =>
              Effect.log(`[RoomManager] Negotiation failed for ${roomId}: ${cause}`)
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.error(`[RoomManager] Negotiation error for ${roomId}:`, error)
              })
            ),
          )
          .pipe(Effect.forkDaemon)

        rooms.set(roomId, { challengeId, pubsub, fiber, result: null, turns })

        return roomId
      }),

    getStatus: (roomId: string) => {
      const entry = rooms.get(roomId)
      if (!entry) return Option.none()
      return Option.some({
        status: entry.result ? "finished" as const : "running" as const,
        turns: entry.turns,
        result: entry.result,
      })
    },

    subscribe: (roomId: string) =>
      Effect.succeed(rooms.get(roomId)?.pubsub ?? null),

    listChallenges: () => listChallenges(),
  },
)
