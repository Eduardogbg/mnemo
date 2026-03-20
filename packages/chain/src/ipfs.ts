/**
 * IPFS upload utility — simple HTTP upload to web3.storage or Pinata.
 *
 * Returns CIDs for on-chain reference via ERC-8004 metadata.
 */
import { Effect, Data } from "effect"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class IpfsError extends Data.TaggedError("IpfsError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpfsUploadResult {
  readonly cid: string
  readonly url: string
  readonly size: number
}

export interface IpfsConfig {
  /** Provider: "web3storage" or "pinata". */
  readonly provider: "web3storage" | "pinata"
  /** API token for the selected provider. */
  readonly token: string
}

// ---------------------------------------------------------------------------
// Upload functions
// ---------------------------------------------------------------------------

/**
 * Upload JSON data to IPFS. Returns CID and gateway URL.
 */
export const uploadJson = (
  config: IpfsConfig,
  data: unknown,
  filename?: string,
): Effect.Effect<IpfsUploadResult, IpfsError> =>
  Effect.gen(function* () {
    const json = JSON.stringify(data, null, 2)
    const bytes = new TextEncoder().encode(json)

    if (config.provider === "web3storage") {
      return yield* uploadToWeb3Storage(config.token, bytes, filename ?? "data.json")
    } else {
      return yield* uploadToPinata(config.token, bytes, filename ?? "data.json")
    }
  })

/**
 * Upload raw bytes to IPFS.
 */
export const uploadBytes = (
  config: IpfsConfig,
  data: Uint8Array,
  filename: string,
): Effect.Effect<IpfsUploadResult, IpfsError> =>
  Effect.gen(function* () {
    if (config.provider === "web3storage") {
      return yield* uploadToWeb3Storage(config.token, data, filename)
    } else {
      return yield* uploadToPinata(config.token, data, filename)
    }
  })

// ---------------------------------------------------------------------------
// web3.storage implementation
// ---------------------------------------------------------------------------

const uploadToWeb3Storage = (
  token: string,
  data: Uint8Array,
  filename: string,
): Effect.Effect<IpfsUploadResult, IpfsError> =>
  Effect.tryPromise({
    try: async () => {
      // web3.storage API v2 uses w3up protocol
      // For the hackathon, use the simple HTTP API
      const blob = new Blob([data as BlobPart])
      const response = await fetch("https://api.web3.storage/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Name": filename,
        },
        body: blob,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`web3.storage upload failed: ${response.status} ${text.slice(0, 200)}`)
      }

      const result = (await response.json()) as { cid: string }
      return {
        cid: result.cid,
        url: `https://w3s.link/ipfs/${result.cid}`,
        size: data.length,
      } satisfies IpfsUploadResult
    },
    catch: (e) =>
      new IpfsError({
        message: `web3.storage upload failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })

// ---------------------------------------------------------------------------
// Pinata implementation
// ---------------------------------------------------------------------------

const uploadToPinata = (
  token: string,
  data: Uint8Array,
  filename: string,
): Effect.Effect<IpfsUploadResult, IpfsError> =>
  Effect.tryPromise({
    try: async () => {
      const formData = new FormData()
      formData.append("file", new Blob([data as BlobPart]), filename)
      formData.append(
        "pinataMetadata",
        JSON.stringify({ name: filename }),
      )

      const response = await fetch(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Pinata upload failed: ${response.status} ${text.slice(0, 200)}`)
      }

      const result = (await response.json()) as {
        IpfsHash: string
        PinSize: number
      }

      return {
        cid: result.IpfsHash,
        url: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
        size: result.PinSize,
      } satisfies IpfsUploadResult
    },
    catch: (e) =>
      new IpfsError({
        message: `Pinata upload failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      }),
  })

// ---------------------------------------------------------------------------
// Convenience: upload agent.json and protocol metadata
// ---------------------------------------------------------------------------

/**
 * Upload the agent.json manifest to IPFS.
 */
export const uploadAgentManifest = (
  config: IpfsConfig,
  manifest: unknown,
): Effect.Effect<IpfsUploadResult, IpfsError> =>
  uploadJson(config, manifest, "agent.json")

/**
 * Upload protocol metadata (contract addresses, source hashes, etc.) to IPFS.
 */
export const uploadProtocolMetadata = (
  config: IpfsConfig,
  metadata: {
    escrowAddress: string
    reputationAddress: string
    sourceHashes: Record<string, string>
    invariants: string[]
    bountyTerms: Record<string, unknown>
  },
): Effect.Effect<IpfsUploadResult, IpfsError> =>
  uploadJson(config, metadata, "protocol-metadata.json")
