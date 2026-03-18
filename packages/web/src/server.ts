/**
 * Mnemo demo server — Effect HttpApi with Bun platform layer.
 *
 * - REST endpoints via Effect HttpApi (POST /api/rooms, GET /api/rooms/:id, GET /api/challenges)
 * - WebSocket via Bun-native upgrade
 * - Frontend: Bun HTML imports (auto-bundles TSX/CSS)
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
import { RoomsApiLive } from "./handlers.js"
import { RoomManager, RoomManagerLive } from "./RoomManager.js"

// Bun HTML import — triggers the built-in bundler for TSX/CSS
import index from "../ui/index.html"

// ---------------------------------------------------------------------------
// Effect HttpApi layer stack
// ---------------------------------------------------------------------------

const MnemoApiLive = HttpApiBuilder.api(MnemoApi)

// Wire: RoomManagerLive → RoomsApiLive → MnemoApiLive
const RoomsApiWithDeps = Layer.provide(RoomsApiLive, RoomManagerLive)
const ApiLive = Layer.provide(MnemoApiLive, RoomsApiWithDeps)

// Build a web handler from the Effect API
const { handler: apiHandler, dispose } = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(
    ApiLive,
    BunHttpServer.layerContext,
  ),
)

// ---------------------------------------------------------------------------
// Bun.serve — routes + API handler + WebSocket
// ---------------------------------------------------------------------------

const server = Bun.serve<{ roomId: string }>({
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

    // WebSocket upgrade
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
      const { roomId } = ws.data

      // Subscribe to room's PubSub and stream turns to the client.
      const program = Effect.scoped(
        Effect.gen(function* () {
          const mgr = yield* RoomManager
          const pubsub = yield* mgr.subscribe(roomId)
          if (!pubsub) {
            ws.send(JSON.stringify({ error: "Room not found" }))
            ws.close()
            return
          }

          // Send existing turns first
          const status = mgr.getStatus(roomId)
          if (status._tag === "Some") {
            for (const turn of status.value.turns) {
              ws.send(JSON.stringify({ type: "turn", data: turn }))
            }
            if (status.value.result) {
              ws.send(JSON.stringify({ type: "outcome", data: status.value.result }))
              ws.close()
              return
            }
          }

          // Subscribe to new turns (PubSub.subscribe is scoped — the outer Effect.scoped handles it)
          const queue = yield* PubSub.subscribe(pubsub)

          // Consume turns from the queue
          while (true) {
            const turn = yield* Queue.take(queue)
            ws.send(JSON.stringify({ type: "turn", data: turn }))

            // Check if room finished after this turn
            const s = mgr.getStatus(roomId)
            if (s._tag === "Some" && s.value.result) {
              ws.send(JSON.stringify({ type: "outcome", data: s.value.result }))
              ws.close()
              return
            }
          }
        }),
      )

      Effect.runFork(program.pipe(Effect.provide(RoomManagerLive)))
    },
    message() { /* client doesn't send messages */ },
    close() { /* cleanup handled by fiber scope */ },
  },
})

console.log(`Mnemo demo server running at http://localhost:${server.port}`)

// Graceful shutdown
process.on("SIGINT", async () => {
  await dispose()
  process.exit(0)
})
