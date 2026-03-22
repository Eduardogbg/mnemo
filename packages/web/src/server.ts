/**
 * Mnemo demo server — Effect HttpApi with Bun platform layer.
 *
 * - REST endpoints via Effect HttpApi (POST /api/rooms, GET /api/rooms/:id, GET /api/challenges)
 * - WebSocket via Bun-native upgrade
 * - Frontend: Bun HTML imports (auto-bundles TSX/CSS)
 *
 * Provides the full layer stack for the 10-step pipeline:
 *   Erc8004 | Registry | Escrow | LanguageModel
 */
// Load .env from project root (Bun only auto-loads from cwd)
import * as path from "node:path"
import * as fs from "node:fs"
const rootEnv = path.resolve(import.meta.dir, "../../../.env")
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match && !process.env[match[1]!.trim()]) {
      process.env[match[1]!.trim()] = match[2]!.trim()
    }
  }
}

import { HttpApiBuilder } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer, PubSub, Queue } from "effect"
import { MnemoApi } from "./api.js"
import { RoomsApiLive, AgentApiLive } from "./handlers.js"
import { RoomManager, RoomManagerLive, type RoomEvent, type AgentEvent } from "./RoomManager.js"
import { model } from "@mnemo/harness"
import {
  Erc8004MockLayer,
  Erc8004LiveLayer,
  RegistryMockLayer,
  RegistryLiveLayer,
  EscrowMockLayer,
  EscrowLiveLayer,
} from "@mnemo/chain"

// Bun HTML import — triggers the built-in bundler for TSX/CSS
import index from "../ui/index.html"

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545"
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const VENICE_API_KEY = process.env.VENICE_API_KEY ?? ""
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ""

// ---------------------------------------------------------------------------
// Chain layers — live if contract addresses set, otherwise mock
// ---------------------------------------------------------------------------

const erc8004Layer = process.env.ERC8004_ADDRESS
  ? Erc8004LiveLayer(PRIVATE_KEY, RPC_URL)
  : Erc8004MockLayer()

const registryLayer = process.env.REGISTRY_ADDRESS
  ? RegistryLiveLayer(PRIVATE_KEY, process.env.REGISTRY_ADDRESS, RPC_URL)
  : RegistryMockLayer()

const escrowLayer = process.env.ESCROW_ADDRESS
  ? EscrowLiveLayer(PRIVATE_KEY, process.env.ESCROW_ADDRESS, RPC_URL)
  : EscrowMockLayer()

// ---------------------------------------------------------------------------
// LLM layer — Venice primary, OpenRouter fallback
// ---------------------------------------------------------------------------

const apiKey = VENICE_API_KEY || OPENROUTER_API_KEY
const useVenice = !!VENICE_API_KEY

const llmLayer = model({
  apiKey: apiKey || "missing-api-key",
  baseURL: useVenice ? "https://api.venice.ai/api/v1" : "https://openrouter.ai/api/v1",
  model: useVenice ? "deepseek-v3.2" : "deepseek/deepseek-chat",
  temperature: 0.3,
  maxTokens: 4096,
})

// ---------------------------------------------------------------------------
// Compose RoomManager with all dependencies
// ---------------------------------------------------------------------------

const chainLayers = Layer.mergeAll(erc8004Layer, registryLayer, escrowLayer)

// RoomManagerLive requires Erc8004 | Registry | Escrow | LanguageModel
// model() provides LanguageModel when used with Effect.provide
const RoomManagerWithDeps = RoomManagerLive.pipe(
  Layer.provide(chainLayers),
  Layer.provide(llmLayer),
)

// ---------------------------------------------------------------------------
// Effect HttpApi layer stack
// ---------------------------------------------------------------------------

const MnemoApiLive = HttpApiBuilder.api(MnemoApi)

// Wire: RoomManagerWithDeps → RoomsApiLive + AgentApiLive → MnemoApiLive
const RoomsApiWithDeps = Layer.provide(RoomsApiLive, RoomManagerWithDeps)
const AgentApiWithDeps = Layer.provide(AgentApiLive, RoomManagerWithDeps)
const ApiLive = Layer.provide(MnemoApiLive, Layer.mergeAll(RoomsApiWithDeps, AgentApiWithDeps))

// Build a web handler from the Effect API
const { handler: apiHandler, dispose } = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(
    ApiLive,
    BunHttpServer.layerContext,
  ) as any,
)

// ---------------------------------------------------------------------------
// Bun.serve — routes + API handler + WebSocket
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Start the autonomous agent on boot
// ---------------------------------------------------------------------------

Effect.runFork(
  Effect.gen(function* () {
    const mgr = yield* RoomManager
    yield* mgr.startAgent()
  }).pipe(Effect.provide(RoomManagerWithDeps as any)) as any,
)

const server = Bun.serve<{ roomId: string; isAgent?: boolean }>({
  port: Number(process.env.PORT ?? 3000),

  // Bun HTML imports: "/" serves the bundled index.html with auto-bundled TSX/CSS
  routes: {
    "/": index,
  },

  development: {
    hmr: true,
    console: true,
  },

  async fetch(req, server) {
    const url = new URL(req.url)

    // WebSocket upgrade — agent events stream
    if (url.pathname === "/ws/agent") {
      const upgraded = server.upgrade(req, { data: { roomId: "__agent__", isAgent: true } })
      if (upgraded) return undefined as unknown as Response
      return new Response("WebSocket upgrade failed", { status: 400 })
    }

    // WebSocket upgrade — room events stream
    if (url.pathname.startsWith("/ws/")) {
      const roomId = url.pathname.slice(4)
      const upgraded = server.upgrade(req, { data: { roomId } })
      if (upgraded) return undefined as unknown as Response
      return new Response("WebSocket upgrade failed", { status: 400 })
    }

    // API routes — delegate to Effect handler
    if (url.pathname.startsWith("/api/")) {
      return apiHandler(req)
    }

    // Let Bun's internal dev server handle /_bun/* routes (bundled assets)
    // Returning undefined falls through to Bun's built-in handler
    return undefined as unknown as Response
  },

  websocket: {
    open(ws) {
      const { roomId, isAgent } = ws.data

      // --- Agent WebSocket: subscribe to agent events ---
      if (isAgent) {
        const agentProgram = Effect.scoped(
          Effect.gen(function* () {
            const mgr = yield* RoomManager
            const agentPubsub = yield* mgr.subscribeAgent()

            // Send current status immediately
            const status = mgr.getAgentStatus()
            ws.send(JSON.stringify({
              type: "agent_status",
              data: { status: status.status, protocolId: status.currentProtocol },
            }))

            // Subscribe and stream
            const queue = yield* PubSub.subscribe(agentPubsub)
            while (true) {
              const event = yield* Queue.take(queue)
              ws.send(JSON.stringify(event))
            }
          }),
        )

        Effect.runFork(agentProgram.pipe(Effect.provide(RoomManagerWithDeps as any)) as any)
        return
      }

      // --- Room WebSocket: subscribe to room events ---
      const program = Effect.scoped(
        Effect.gen(function* () {
          const mgr = yield* RoomManager
          const pubsub = yield* mgr.subscribe(roomId)
          if (!pubsub) {
            ws.send(JSON.stringify({ error: "Room not found" }))
            ws.close()
            return
          }

          // Send existing state first
          const status = mgr.getStatus(roomId)
          if (status._tag === "Some") {
            // Send phase state
            if (status.value.currentPhase) {
              ws.send(JSON.stringify({ type: "phase", data: status.value.currentPhase }))
            }
            // Send identity
            if (status.value.identity) {
              ws.send(JSON.stringify({ type: "identity", data: status.value.identity }))
            }
            // Send attestation
            if (status.value.attestation) {
              ws.send(JSON.stringify({ type: "attestation", data: status.value.attestation }))
            }
            // Send registry
            if (status.value.registry) {
              ws.send(JSON.stringify({ type: "registry", data: status.value.registry }))
            }
            // Send discovery
            if (status.value.discovery) {
              ws.send(JSON.stringify({ type: "discovery", data: status.value.discovery }))
            }
            // Send audit — full text if done, or partial text if still streaming
            if (status.value.audit) {
              ws.send(JSON.stringify({
                type: "audit",
                data: {
                  status: "done",
                  model: status.value.audit.model,
                  text: status.value.audit.text,
                  latencyMs: status.value.audit.latencyMs,
                },
              }))
            } else if (status.value.auditPartial) {
              // Audit is in progress — send accumulated text so far as a "start" + single delta
              ws.send(JSON.stringify({
                type: "audit",
                data: {
                  status: "start",
                  model: status.value.auditPartial.model,
                },
              }))
              if (status.value.auditPartial.text) {
                ws.send(JSON.stringify({
                  type: "audit",
                  data: {
                    status: "delta",
                    model: status.value.auditPartial.model,
                    text: status.value.auditPartial.text,
                  },
                }))
              }
            }
            // Send turns
            for (const turn of status.value.turns) {
              ws.send(JSON.stringify({ type: "turn", data: turn }))
            }
            if (status.value.verification) {
              ws.send(JSON.stringify({ type: "verification", data: status.value.verification }))
            }
            if (status.value.escrow) {
              ws.send(JSON.stringify({ type: "escrow", data: status.value.escrow }))
            }
            // Send reputation events
            for (const rep of status.value.reputation) {
              ws.send(JSON.stringify({ type: "reputation", data: rep }))
            }
            if (status.value.ipfs) {
              ws.send(JSON.stringify({ type: "ipfs", data: status.value.ipfs }))
            }
            if (status.value.result) {
              ws.send(JSON.stringify({
                type: "outcome",
                data: {
                  ...status.value.result,
                  evidence: status.value.evidence,
                  verification: status.value.verification,
                  escrow: status.value.escrow,
                  ipfs: status.value.ipfs,
                },
              }))
              ws.close()
              return
            }
          }

          // Subscribe to events (PubSub.subscribe is scoped — the outer Effect.scoped handles it)
          const queue = yield* PubSub.subscribe(pubsub)

          // Consume events from the queue — close on outcome
          while (true) {
            const event = yield* Queue.take(queue)
            ws.send(JSON.stringify(event))

            if (event.type === "outcome") {
              ws.close()
              return
            }
          }
        }),
      )

      Effect.runFork(program.pipe(Effect.provide(RoomManagerWithDeps as any)) as any)
    },
    message() { /* client doesn't send messages */ },
    close() { /* cleanup handled by fiber scope */ },
  },
})

console.log(`Mnemo demo server running at http://localhost:${server.port}`)
if (!apiKey) {
  console.warn("  WARNING: No LLM API key set. Set VENICE_API_KEY or OPENROUTER_API_KEY in .env")
}
console.log(`  Chain layers: ERC-8004=${process.env.ERC8004_ADDRESS ? "live" : "mock"}, Registry=${process.env.REGISTRY_ADDRESS ? "live" : "mock"}, Escrow=${process.env.ESCROW_ADDRESS ? "live" : "mock"}`)
console.log(`  LLM provider: ${useVenice ? "Venice" : "OpenRouter"} (${useVenice ? "deepseek-v3.2" : "deepseek/deepseek-chat"})`)
console.log(`  Autonomous agent: ACTIVE — polling registry every 5s`)
console.log(`  Agent WebSocket: ws://localhost:${server.port}/ws/agent`)
console.log(`  Agent REST: http://localhost:${server.port}/api/agent/status`)

// Graceful shutdown
process.on("SIGINT", async () => {
  await dispose()
  process.exit(0)
})
