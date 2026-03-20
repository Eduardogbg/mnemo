/**
 * Local mock IPFS server for testing — stores content in memory.
 * POST /upload -> SHA-256 -> CID, GET /ipfs/:cid -> content
 */
import { Effect, Data } from "effect"

export class IpfsMockError extends Data.TaggedError("IpfsMockError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const store = new Map<string, Uint8Array>()

async function hashToCid(data: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(data.byteLength)
  new Uint8Array(buf).set(data)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `bafybei${hex.slice(0, 52)}`
}

export const startMockIpfs = (port = 9095) =>
  Effect.tryPromise({
    try: async () => {
      const server = Bun.serve({
        port,
        async fetch(req) {
          const url = new URL(req.url)

          if (req.method === "POST" && url.pathname === "/upload") {
            const body = new Uint8Array(await req.arrayBuffer())
            const cid = await hashToCid(body)
            store.set(cid, body)
            return Response.json({ cid, url: `http://localhost:${port}/ipfs/${cid}` })
          }

          if (req.method === "GET" && url.pathname.startsWith("/ipfs/")) {
            const cid = url.pathname.slice(6)
            const content = store.get(cid)
            if (!content) return new Response("Not found", { status: 404 })
            return new Response(content as BodyInit)
          }

          return new Response("Not found", { status: 404 })
        },
      })
      return server
    },
    catch: (e) =>
      new IpfsMockError({
        message: `Failed to start mock IPFS: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })
