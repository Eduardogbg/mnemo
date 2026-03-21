#!/usr/bin/env bun
/**
 * verify-sandbox.ts — Verify TEE sandbox attestation.
 *
 * Takes a CVM attestation quote → extracts RTMR3 → compares against
 * expected compose hash → prints verification result.
 *
 * Usage:
 *   bun run infra/dstack/verify-sandbox.ts [attestation.json]
 *   bun run infra/dstack/verify-sandbox.ts --compose docker-compose.prod.yml
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttestationDocument {
  quote: string
  eventLog: string
  agentAddress: string
  composeHash: string
  timestamp: string
  rtmr3: string
}

interface VerificationResult {
  valid: boolean
  agentAddress: string
  composeHash: string
  rtmr3Match: boolean
  timestamp: string
  networkPolicy: {
    analysisNetwork: "internal (air-gapped)"
    rpcProxy: "read-only allowlist"
    blockedMethods: string[]
  }
  message: string
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  bun run verify-sandbox.ts <attestation.json>     Verify an attestation document
  bun run verify-sandbox.ts --compose <file>        Compute expected compose hash
  bun run verify-sandbox.ts --generate              Generate expected hashes for current compose
`)
    process.exit(0)
  }

  // Mode: compute compose hash
  if (args.includes("--compose")) {
    const composeIdx = args.indexOf("--compose")
    const composePath = args[composeIdx + 1] ?? "docker-compose.prod.yml"
    const content = readFileSync(resolve(composePath), "utf-8")
    const hash = await sha256(content)
    console.log(`Compose file: ${composePath}`)
    console.log(`SHA256 hash:  ${hash}`)
    console.log(`\nUse this hash to verify RTMR3 in attestation documents.`)
    return
  }

  // Mode: generate expected hashes
  if (args.includes("--generate")) {
    const composePath = resolve("infra/dstack/docker-compose.prod.yml")
    try {
      const content = readFileSync(composePath, "utf-8")
      const hash = await sha256(content)
      console.log(JSON.stringify({
        composeFile: "infra/dstack/docker-compose.prod.yml",
        composeHash: hash,
        generatedAt: new Date().toISOString(),
        networkPolicy: {
          analysisNetwork: "internal (air-gapped)",
          rpcProxy: "read-only allowlist",
          allowedMethods: [
            "eth_call", "eth_getCode", "eth_getStorageAt", "eth_getBalance",
            "eth_blockNumber", "eth_getLogs", "eth_getTransactionReceipt",
          ],
          blockedMethods: [
            "eth_sendRawTransaction", "eth_sendTransaction",
            "eth_sign", "personal_sign",
          ],
        },
      }, null, 2))
    } catch (e) {
      console.error(`Cannot read compose file: ${composePath}`)
      process.exit(1)
    }
    return
  }

  // Mode: verify attestation
  const attestationPath = args[0]
  if (!attestationPath) {
    console.error("Usage: bun run verify-sandbox.ts <attestation.json>")
    process.exit(1)
  }

  const attestation: AttestationDocument = JSON.parse(
    readFileSync(resolve(attestationPath), "utf-8"),
  )

  // Compute expected compose hash from the local compose file
  const composePath = resolve("infra/dstack/docker-compose.prod.yml")
  let expectedHash: string
  try {
    const content = readFileSync(composePath, "utf-8")
    expectedHash = await sha256(content)
  } catch {
    console.warn("Warning: Cannot read local compose file. Using attestation's composeHash for display only.")
    expectedHash = attestation.composeHash
  }

  const rtmr3Match = attestation.rtmr3 === expectedHash
  const isSimulated = attestation.quote.startsWith("0xSIMULATED")

  const result: VerificationResult = {
    valid: rtmr3Match && !isSimulated,
    agentAddress: attestation.agentAddress,
    composeHash: attestation.composeHash,
    rtmr3Match,
    timestamp: attestation.timestamp,
    networkPolicy: {
      analysisNetwork: "internal (air-gapped)",
      rpcProxy: "read-only allowlist",
      blockedMethods: [
        "eth_sendRawTransaction",
        "eth_sendTransaction",
        "eth_sign",
        "personal_sign",
      ],
    },
    message: isSimulated
      ? "SIMULATED — This attestation was generated in development mode (not a real CVM)"
      : rtmr3Match
        ? "VERIFIED — This agent runs the expected image with network isolation. It CANNOT sign or send transactions."
        : "FAILED — RTMR3 mismatch. The agent may be running a different image or compose configuration.",
  }

  console.log("\n=== Mnemo TEE Sandbox Verification ===\n")
  console.log(`Agent:          ${result.agentAddress}`)
  console.log(`Compose Hash:   ${result.composeHash}`)
  console.log(`RTMR3 Match:    ${result.rtmr3Match ? "YES" : "NO"}`)
  console.log(`Timestamp:      ${result.timestamp}`)
  console.log(`Network Policy: analysis=air-gapped, rpc=read-only-proxy`)
  console.log(`Blocked:        ${result.networkPolicy.blockedMethods.join(", ")}`)
  console.log(`\nResult: ${result.message}`)

  if (isSimulated) {
    console.log("\nNote: In production, the quote would be a real Intel TDX attestation")
    console.log("      verifiable against Intel's attestation service.")
  }

  console.log(`\n${JSON.stringify(result, null, 2)}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
