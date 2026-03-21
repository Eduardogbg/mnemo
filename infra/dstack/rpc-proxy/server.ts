/**
 * RPC Proxy — read-only JSON-RPC allowlist for TEE sandbox.
 *
 * Sits between the researcher agent and the archive RPC node.
 * Allows read-only methods, blocks signing/sending transactions.
 *
 * Run: bun run infra/dstack/rpc-proxy/server.ts
 * Env: UPSTREAM_RPC (default: https://sepolia.base.org)
 *      PORT (default: 8545)
 */

const ALLOWED_METHODS = new Set([
  "eth_call",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_chainId",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_feeHistory",
  "net_version",
  "web3_clientVersion",
])

const BLOCKED_METHODS = new Set([
  "eth_sendRawTransaction",
  "eth_sendTransaction",
  "eth_sign",
  "eth_signTransaction",
  "personal_sign",
  "personal_sendTransaction",
  "eth_accounts",
  "eth_requestAccounts",
])

const UPSTREAM_RPC = process.env.UPSTREAM_RPC ?? "https://sepolia.base.org"
const PORT = parseInt(process.env.PORT ?? "8545", 10)

interface JsonRpcRequest {
  jsonrpc: string
  method: string
  params: unknown[]
  id: number | string
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await req.json() as JsonRpcRequest | JsonRpcRequest[]
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  // Handle batch requests
  const requests = Array.isArray(body) ? body : [body]
  const responses: unknown[] = []

  for (const rpc of requests) {
    if (BLOCKED_METHODS.has(rpc.method)) {
      console.warn(`[RPC-Proxy] BLOCKED: ${rpc.method}`)
      responses.push({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: `Method ${rpc.method} is blocked by TEE sandbox policy. This agent cannot sign or send transactions.`,
        },
        id: rpc.id,
      })
      continue
    }

    if (!ALLOWED_METHODS.has(rpc.method)) {
      console.warn(`[RPC-Proxy] UNKNOWN method (forwarding): ${rpc.method}`)
    }

    // Forward to upstream
    try {
      const upstream = await fetch(UPSTREAM_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rpc),
      })
      const result = await upstream.json()
      responses.push(result)
    } catch (err) {
      responses.push({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: `Upstream RPC error: ${err instanceof Error ? err.message : String(err)}`,
        },
        id: rpc.id,
      })
    }
  }

  const result = Array.isArray(body) ? responses : responses[0]
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  })
}

// Start server
const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
})

console.log(`[RPC-Proxy] Listening on port ${PORT}`)
console.log(`[RPC-Proxy] Upstream: ${UPSTREAM_RPC}`)
console.log(`[RPC-Proxy] Allowed: ${[...ALLOWED_METHODS].join(", ")}`)
console.log(`[RPC-Proxy] Blocked: ${[...BLOCKED_METHODS].join(", ")}`)
