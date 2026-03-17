/**
 * Devnet — Effect service that manages an Anvil instance.
 *
 * Provides lifecycle (start/stop), JSON-RPC helpers, snapshot/revert for
 * test isolation, and account funding.
 */
import { Context, Data, Effect, Layer, Schedule, Scope } from "effect"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DevnetError extends Data.TaggedError("DevnetError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  readonly method: string
  readonly params?: readonly unknown[]
}

export interface JsonRpcResponse<T = unknown> {
  readonly jsonrpc: "2.0"
  readonly id: number
  readonly result?: T
  readonly error?: { code: number; message: string; data?: unknown }
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Devnet {
  /** The HTTP RPC URL of the running anvil node. */
  readonly rpcUrl: string

  /** Send a raw JSON-RPC call to the devnet. */
  readonly rpc: <T = unknown>(
    req: JsonRpcRequest,
  ) => Effect.Effect<T, DevnetError>

  /** Take an EVM snapshot, returns the snapshot id. */
  readonly snapshot: () => Effect.Effect<string, DevnetError>

  /** Revert to a previous snapshot. */
  readonly revert: (snapshotId: string) => Effect.Effect<boolean, DevnetError>

  /** Get ETH balance (in wei as bigint). */
  readonly getBalance: (
    address: string,
    block?: string,
  ) => Effect.Effect<bigint, DevnetError>

  /** eth_call — returns raw hex result. */
  readonly ethCall: (
    to: string,
    data: string,
    block?: string,
  ) => Effect.Effect<string, DevnetError>

  /** eth_getStorageAt — returns raw hex result. */
  readonly getStorageAt: (
    address: string,
    slot: string,
    block?: string,
  ) => Effect.Effect<string, DevnetError>

  /** eth_getLogs */
  readonly getLogs: (filter: {
    address?: string
    topics?: ReadonlyArray<string | null>
    fromBlock?: string
    toBlock?: string
  }) => Effect.Effect<ReadonlyArray<LogEntry>, DevnetError>

  /** Get latest block number. */
  readonly getBlockNumber: () => Effect.Effect<bigint, DevnetError>

  /** Fund an address with ETH (anvil_setBalance). */
  readonly fundAccount: (
    address: string,
    weiAmount: bigint,
  ) => Effect.Effect<void, DevnetError>

  /** Mine a single block. */
  readonly mine: (blocks?: number) => Effect.Effect<void, DevnetError>
}

export interface LogEntry {
  readonly address: string
  readonly topics: readonly string[]
  readonly data: string
  readonly blockNumber: string
  readonly transactionHash: string
  readonly logIndex: string
}

export const Devnet = Context.GenericTag<Devnet>("@mnemo/dvdefi/Devnet")

// ---------------------------------------------------------------------------
// Implementation — spawns anvil as a child process
// ---------------------------------------------------------------------------

let rpcIdCounter = 0

const makeRpc = (rpcUrl: string) => {
  return <T = unknown>(req: JsonRpcRequest): Effect.Effect<T, DevnetError> =>
    Effect.tryPromise({
      try: async () => {
        const id = ++rpcIdCounter
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: req.method,
            params: req.params ?? [],
          }),
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        }
        const json = (await res.json()) as JsonRpcResponse<T>
        if (json.error) {
          throw new Error(
            `RPC error ${json.error.code}: ${json.error.message}`,
          )
        }
        return json.result as T
      },
      catch: (e) =>
        new DevnetError({
          reason: `RPC call ${req.method} failed`,
          cause: e,
        }),
    })
}

/**
 * Start an anvil process on the given port (default 8545) and return a
 * scoped Devnet service. The anvil process is killed when the scope closes.
 */
export const makeDevnet = (
  opts: { port?: number; blockTime?: number } = {},
): Effect.Effect<Devnet, DevnetError, Scope.Scope> =>
  Effect.gen(function* () {
    const port = opts.port ?? 8545
    const rpcUrl = `http://127.0.0.1:${port}`

    // Spawn anvil
    const args = ["--port", String(port), "--silent"]
    if (opts.blockTime !== undefined) {
      args.push("--block-time", String(opts.blockTime))
    }

    const proc = Bun.spawn(["anvil", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    // Wait for anvil to be ready by polling the RPC endpoint
    const rpc = makeRpc(rpcUrl)

    // Poll until anvil responds — retry up to 30 times with 200ms between
    const waitForReady = Effect.retry(
      rpc({ method: "eth_chainId" }),
      Schedule.recurs(30).pipe(Schedule.addDelay(() => "200 millis")),
    ).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchAll(() =>
        Effect.fail(
          new DevnetError({ reason: "Anvil failed to start within 15s" }),
        ),
      ),
    )

    yield* Effect.acquireRelease(
      waitForReady,
      // Release: kill anvil
      () =>
        Effect.sync(() => {
          try {
            proc.kill()
          } catch {
            // already dead
          }
        }),
    )

    // Build the service
    const devnet: Devnet = {
      rpcUrl,
      rpc,

      snapshot: () => rpc<string>({ method: "evm_snapshot", params: [] }),

      revert: (snapshotId: string) =>
        rpc<boolean>({ method: "evm_revert", params: [snapshotId] }),

      getBalance: (address: string, block = "latest") =>
        rpc<string>({ method: "eth_getBalance", params: [address, block] }).pipe(
          Effect.map((hex) => BigInt(hex)),
        ),

      ethCall: (to: string, data: string, block = "latest") =>
        rpc<string>({
          method: "eth_call",
          params: [{ to, data }, block],
        }),

      getStorageAt: (address: string, slot: string, block = "latest") =>
        rpc<string>({
          method: "eth_getStorageAt",
          params: [address, slot, block],
        }),

      getLogs: (filter) =>
        rpc<ReadonlyArray<LogEntry>>({
          method: "eth_getLogs",
          params: [
            {
              address: filter.address,
              topics: filter.topics,
              fromBlock: filter.fromBlock ?? "0x0",
              toBlock: filter.toBlock ?? "latest",
            },
          ],
        }),

      getBlockNumber: () =>
        rpc<string>({ method: "eth_blockNumber" }).pipe(
          Effect.map((hex) => BigInt(hex)),
        ),

      fundAccount: (address: string, weiAmount: bigint) =>
        rpc<void>({
          method: "anvil_setBalance",
          params: [address, `0x${weiAmount.toString(16)}`],
        }).pipe(Effect.asVoid),

      mine: (blocks = 1) =>
        rpc<void>({
          method: "evm_mine",
          params: blocks > 1 ? [`0x${blocks.toString(16)}`] : [],
        }).pipe(Effect.asVoid),
    }

    return devnet
  })

/**
 * A Layer that provides Devnet — starts anvil, yields the service, kills
 * anvil when the layer is closed.
 */
export const DevnetLive = (
  opts: { port?: number; blockTime?: number } = {},
): Layer.Layer<Devnet, DevnetError> =>
  Layer.scoped(
    Devnet,
    makeDevnet(opts),
  )
