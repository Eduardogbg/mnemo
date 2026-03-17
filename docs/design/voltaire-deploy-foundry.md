# voltaire-effect: Contract Deployment & Foundry Integration

Based on source read of `repos/voltaire/packages/voltaire-effect/` (v1.1.0 alpha).

---

## 1. Current Deploy Support in voltaire-effect

### 1.1 `deployContract` — Already Exists

voltaire-effect ships a fully functional `deployContract` action at:

```
packages/voltaire-effect/src/services/Signer/actions/deployContract.ts
```

**Signature:**

```typescript
export const deployContract = <TAbi extends Abi>(
  params: DeployContractParams<TAbi>,
): Effect.Effect<
  DeployContractResult,
  SignerError,
  SignerService | ProviderService
>
```

**Params:**

```typescript
interface DeployContractParams<TAbi extends Abi> {
  readonly abi: TAbi;                          // Contract ABI (must include constructor if args provided)
  readonly bytecode: HexType | `0x${string}`;  // Init bytecode (hex with 0x prefix)
  readonly args?: readonly unknown[];           // Constructor arguments
  readonly value?: bigint;                      // For payable constructors
  readonly gas?: bigint;
  readonly gasPrice?: bigint;                   // Legacy tx
  readonly maxFeePerGas?: bigint;               // EIP-1559
  readonly maxPriorityFeePerGas?: bigint;       // EIP-1559
  readonly nonce?: bigint;
}
```

**Result:**

```typescript
interface DeployContractResult {
  readonly hash: HashType;  // Tx hash, available immediately
  readonly address: Effect.Effect<  // Lazy — resolves after confirmation
    AddressType,
    WaitForTransactionReceiptError,
    ProviderService
  >;
}
```

### 1.2 How It Works Internally

1. Finds the `constructor` item in the ABI
2. If `args` provided + constructor exists, uses `Constructor.encodeParams()` from `@tevm/voltaire/Abi` to ABI-encode constructor args
3. Concatenates: `bytecode + encodedArgs` into a single hex blob
4. Calls `signer.sendTransaction({ to: undefined, data: combined })` — the `to: undefined` triggers contract creation
5. Returns `hash` immediately
6. Returns `address` as a lazy Effect that calls `waitForTransactionReceipt()` and extracts `contractAddress` from the receipt

### 1.3 Required Service Dependencies

To use `deployContract`, you need to provide:

| Service | Purpose | How to provide |
|---------|---------|----------------|
| `SignerService` | Signs + broadcasts tx | `Signer.Live` (requires Account + Provider + Transport) |
| `ProviderService` | Gas estimation, nonce, receipt polling | `Provider` + `HttpTransport(url)` |
| `AccountService` | Private key for signing | `LocalAccount(privateKey)` |
| `TransportService` | HTTP/WS JSON-RPC transport | `HttpTransport(url)` |

### 1.4 What's NOT in voltaire-effect

- **No Foundry artifact loader** — no code to read `out/<Contract>.sol/<Contract>.json`
- **No `forge build` integration** — no compilation step
- **No higher-level "deploy from artifact path" helper**
- **No CREATE2 deploy helper** — only standard CREATE (nonce-based)

The `deployContract` function requires you to **already have** the ABI and bytecode as JavaScript values.

---

## 2. Foundry Skill Analysis

### 2.1 Skills Concept

Voltaire uses a "skills" model inspired by shadcn/ui: reference implementations you copy into your project and customize, rather than installing as dependencies.

From the docs site:
> "Skills are copyable reference implementations you can use as-is or customize."

Voltaire core deliberately stays minimal (primitives, crypto, encoding). Higher-level patterns like contract deployment, wallet management, and toolchain integration are implemented as Skills.

### 2.2 Foundry Skill Status: NOT IMPLEMENTED

The Foundry skill page at `https://voltaire.tevm.sh/skills/foundry` explicitly states:

> "This Skill needs implementation. If you're interested in building Foundry integration for Voltaire, open an issue or submit a PR."

It's aspirational documentation for a planned feature. The proposed scope includes:
- Forge test helpers (FFI-based)
- Anvil integration (connect voltaire providers to local Anvil)
- Cast compatibility (shared tx building)
- Script interop (off-chain logic in Forge scripts)
- ABI sync (auto-import from Foundry output dir)

### 2.3 What Does Exist: Anvil JSON-RPC Support

voltaire-effect **does** have Anvil RPC method support:

```
packages/voltaire-effect/src/jsonrpc/Anvil.ts
packages/voltaire-effect/src/jsonrpc/schemas/anvil/
```

This provides typed request builders for all `anvil_*` and `evm_*` methods:
- `MineRequest`, `SetBalanceRequest`, `SetCodeRequest`, `SetNonceRequest`
- `ImpersonateAccountRequest`, `SnapshotRequest`, `RevertRequest`
- `SetNextBlockTimestampRequest`, `DropTransactionRequest`, etc.

These are JSON-RPC request constructors, not high-level helpers. They need to be sent through a Provider/Transport manually.

### 2.4 The `skills/` Directory

The `skills/` directory at the repo root exists but is **empty**. No skills have been implemented yet. The skills concept is documentation-only at this point.

---

## 3. What We Need to Build

For the Mnemo verifier harness, we need to deploy Solidity contracts (escrow, commitment log) from TypeScript tests and integration flows. The gap is narrow:

1. **Foundry Artifact Loader** — reads `forge build` output JSON
2. **Deploy-from-Artifact helper** — combines loader + voltaire's `deployContract`
3. **Optional: forge build runner** — shells out to `forge build`

### 3.1 Foundry Artifact Format

After `forge build`, artifacts live at `out/<ContractName>.sol/<ContractName>.json`:

```json
{
  "abi": [...],
  "bytecode": {
    "object": "0x608060405234801...",
    "sourceMap": "...",
    "linkReferences": {}
  },
  "deployedBytecode": {
    "object": "0x608060405234801...",
    "sourceMap": "...",
    "linkReferences": {}
  },
  "methodIdentifiers": { ... },
  "metadata": { ... }
}
```

The key fields are `abi` and `bytecode.object`.

---

## 4. Minimal Implementation

### 4.1 Foundry Artifact Loader

```typescript
// src/foundry/ArtifactLoader.ts
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import { NodeFileSystem } from "@effect/platform-node";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "node:path";

export class ArtifactLoadError extends Data.TaggedError("ArtifactLoadError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface FoundryArtifact {
  readonly abi: readonly unknown[];
  readonly bytecode: `0x${string}`;
  readonly deployedBytecode: `0x${string}`;
}

/**
 * Load a Foundry artifact from the build output directory.
 *
 * @param outDir - Path to Foundry's `out/` directory (default: "out")
 * @param contractName - e.g. "MnemoEscrow"
 * @param fileName - e.g. "MnemoEscrow.sol" (defaults to `${contractName}.sol`)
 */
export const loadArtifact = (
  contractName: string,
  options?: {
    readonly outDir?: string;
    readonly fileName?: string;
  },
): Effect.Effect<FoundryArtifact, ArtifactLoadError> => {
  const outDir = options?.outDir ?? "out";
  const fileName = options?.fileName ?? `${contractName}.sol`;
  const artifactPath = Path.join(outDir, fileName, `${contractName}.json`);

  return Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () =>
        import("node:fs/promises").then((fs) =>
          fs.readFile(artifactPath, "utf-8"),
        ),
      catch: (e) =>
        new ArtifactLoadError({
          path: artifactPath,
          message: `Failed to read artifact: ${artifactPath}`,
          cause: e,
        }),
    });

    const json = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (e) =>
        new ArtifactLoadError({
          path: artifactPath,
          message: `Failed to parse artifact JSON`,
          cause: e,
        }),
    });

    if (!json.abi || !json.bytecode?.object) {
      return yield* Effect.fail(
        new ArtifactLoadError({
          path: artifactPath,
          message: `Invalid artifact: missing abi or bytecode.object`,
        }),
      );
    }

    const bytecode = json.bytecode.object as `0x${string}`;
    if (!bytecode.startsWith("0x")) {
      return yield* Effect.fail(
        new ArtifactLoadError({
          path: artifactPath,
          message: `Bytecode does not start with 0x`,
        }),
      );
    }

    // Check for unlinked library references
    if (bytecode.includes("__$")) {
      return yield* Effect.fail(
        new ArtifactLoadError({
          path: artifactPath,
          message: `Bytecode contains unlinked library references (__$...$__)`,
        }),
      );
    }

    return {
      abi: json.abi,
      bytecode,
      deployedBytecode: (json.deployedBytecode?.object ?? "0x") as `0x${string}`,
    } satisfies FoundryArtifact;
  });
};
```

### 4.2 Deploy-from-Artifact Helper

```typescript
// src/foundry/deployFromArtifact.ts
import * as Effect from "effect/Effect";
import type { BrandedAddress, BrandedHex } from "@tevm/voltaire";
import {
  deployContract,
  type DeployContractResult,
  type SignerError,
  SignerService,
} from "voltaire-effect/services/Signer";
import { ProviderService } from "voltaire-effect/services/Provider";
import { type FoundryArtifact, loadArtifact, type ArtifactLoadError } from "./ArtifactLoader.js";

type HexType = BrandedHex.HexType;

export interface DeployFromArtifactParams {
  /** Contract name (e.g. "MnemoEscrow") */
  readonly contractName: string;
  /** Constructor arguments */
  readonly args?: readonly unknown[];
  /** Value for payable constructors */
  readonly value?: bigint;
  /** Gas limit override */
  readonly gas?: bigint;
  /** Path to Foundry out/ directory */
  readonly outDir?: string;
  /** Source file name override (default: <contractName>.sol) */
  readonly fileName?: string;
  /** EIP-1559 gas params */
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
}

/**
 * Load a Foundry artifact and deploy the contract in one step.
 *
 * Usage:
 * ```typescript
 * const result = yield* deployFromArtifact({
 *   contractName: "MnemoEscrow",
 *   args: [ownerAddress, 3600n],
 *   outDir: "contracts/out",
 * });
 * const address = yield* result.address;
 * ```
 */
export const deployFromArtifact = (
  params: DeployFromArtifactParams,
): Effect.Effect<
  DeployContractResult,
  ArtifactLoadError | SignerError,
  SignerService | ProviderService
> =>
  Effect.gen(function* () {
    const artifact = yield* loadArtifact(params.contractName, {
      outDir: params.outDir,
      fileName: params.fileName,
    });

    return yield* deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode as HexType,
      args: params.args,
      value: params.value,
      gas: params.gas,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    });
  });
```

### 4.3 Forge Build Runner (Optional)

```typescript
// src/foundry/forgeBuild.ts
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import { execSync } from "node:child_process";

export class ForgeBuildError extends Data.TaggedError("ForgeBuildError")<{
  readonly message: string;
  readonly stderr?: string;
  readonly cause?: unknown;
}> {}

/**
 * Run `forge build` and return when compilation completes.
 *
 * @param projectRoot - Path to the Foundry project root (default: ".")
 */
export const forgeBuild = (
  projectRoot?: string,
): Effect.Effect<void, ForgeBuildError> =>
  Effect.try({
    try: () => {
      execSync("forge build", {
        cwd: projectRoot ?? ".",
        stdio: "pipe",
        encoding: "utf-8",
      });
    },
    catch: (e) => {
      const err = e as { stderr?: string; message?: string };
      return new ForgeBuildError({
        message: `forge build failed: ${err.message ?? "unknown error"}`,
        stderr: err.stderr,
        cause: e,
      });
    },
  });
```

### 4.4 Full End-to-End Example

```typescript
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "@effect/platform";
import { Signer, SignerService } from "voltaire-effect/services/Signer";
import { Provider, ProviderService } from "voltaire-effect/services/Provider";
import { HttpTransport } from "voltaire-effect/services/Transport";
import { LocalAccount } from "voltaire-effect/services/Account";
import * as Layer from "effect/Layer";

import { forgeBuild } from "./foundry/forgeBuild.js";
import { deployFromArtifact } from "./foundry/deployFromArtifact.js";

// 1. Compile contracts
const program = Effect.gen(function* () {
  // Optional: compile first
  yield* forgeBuild("./contracts");

  // 2. Deploy
  const result = yield* deployFromArtifact({
    contractName: "MnemoEscrow",
    args: [
      "0x1234567890abcdef1234567890abcdef12345678", // owner
      3600n, // timeout
    ],
    outDir: "./contracts/out",
  });

  // 3. Wait for address
  const address = yield* result.address;
  return { hash: result.hash, address };
});

// 4. Provide layers
const PRIVATE_KEY = "0x..." as `0x${string}`;
const RPC_URL = "http://127.0.0.1:8545"; // Anvil

const transport = HttpTransport(RPC_URL).pipe(
  Layer.provide(FetchHttpClient.layer),
);
const provider = Provider.pipe(Layer.provide(transport));
const account = LocalAccount(PRIVATE_KEY);
const signer = Signer.Live.pipe(
  Layer.provide(account),
  Layer.provide(provider),
  Layer.provide(transport),
);
const fullLayer = Layer.merge(signer, provider);

Effect.runPromise(Effect.provide(program, fullLayer)).then(
  ({ hash, address }) => {
    // deployed
  },
);
```

---

## 5. Summary: What Exists vs What We Build

| Capability | Status | Location / Plan |
|------------|--------|-----------------|
| ABI encoding for constructor args | Exists | `@tevm/voltaire/Abi` — `Constructor.encodeParams()` |
| `deployContract(abi, bytecode, args)` | Exists | `voltaire-effect/services/Signer/actions/deployContract.ts` |
| Receipt polling for contract address | Exists | `waitForTransactionReceipt()` in Provider |
| Anvil RPC methods | Exists | `voltaire-effect/jsonrpc/Anvil.ts` |
| Foundry artifact loader | **Build** | ~40 lines, reads `out/` JSON files |
| `deployFromArtifact()` helper | **Build** | ~20 lines, combines loader + deploy |
| `forge build` runner | **Build** | ~15 lines, shells out to forge |
| Foundry "skill" (full integration) | Does not exist | Planned by voltaire, not yet implemented |
| CREATE2 deploy | Does not exist | Not needed for MVP |

### Key Takeaway

voltaire-effect already has the hard part done: `deployContract` with proper ABI encoding, constructor arg handling, transaction signing, and receipt-based address extraction. The only gap is reading Foundry build artifacts, which is straightforward file I/O (~40 lines). We do **not** need to implement any low-level EVM transaction construction.
