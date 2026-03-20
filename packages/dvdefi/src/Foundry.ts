/**
 * Foundry — Effect service for forge / cast operations.
 *
 * Shells out to `forge` for compilation and test execution.
 * Reads artifacts from the `out/` directory.
 */
import { Context, Data, Effect, Layer } from "effect"
import * as path from "node:path"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class FoundryError extends Data.TaggedError("FoundryError")<{
  readonly reason: string
  readonly stdout?: string
  readonly stderr?: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForgeTestResult {
  /** Whether the test suite passed. */
  readonly passed: boolean
  /** Raw stdout from forge test. */
  readonly stdout: string
  /** Raw stderr from forge test. */
  readonly stderr: string
  /** Exit code. */
  readonly exitCode: number
}

export interface ForgeBuildResult {
  readonly passed: boolean
  readonly stdout: string
  readonly stderr: string
}

export interface ForgeScriptResult {
  readonly passed: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface ContractArtifact {
  readonly abi: readonly unknown[]
  readonly bytecode: { readonly object: string }
  readonly deployedBytecode: { readonly object: string }
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Foundry {
  /** Compile all contracts in the project. */
  readonly build: (projectRoot: string) => Effect.Effect<ForgeBuildResult, FoundryError>

  /**
   * Run forge test with an optional match pattern.
   * @param projectRoot — path to the foundry project
   * @param testMatch — glob for `--match-path`, e.g. `test/side-entrance/SideEntrance.t.sol`
   * @param testFunction — specific test function name to match with `--match-test`
   */
  readonly test: (
    projectRoot: string,
    testMatch?: string,
    testFunction?: string,
  ) => Effect.Effect<ForgeTestResult, FoundryError>

  /**
   * Run a forge script with broadcasting.
   */
  readonly script: (
    projectRoot: string,
    scriptPath: string,
    rpcUrl: string,
    privateKey: string,
  ) => Effect.Effect<ForgeScriptResult, FoundryError>

  /**
   * Read a compiled artifact (ABI + bytecode) from the `out/` dir.
   * @param projectRoot — path to the foundry project
   * @param contractName — e.g. "SideEntranceLenderPool"
   * @param fileName — e.g. "SideEntranceLenderPool.sol" (the .sol file name)
   */
  readonly readArtifact: (
    projectRoot: string,
    contractName: string,
    fileName: string,
  ) => Effect.Effect<ContractArtifact, FoundryError>
}

export const Foundry = Context.GenericTag<Foundry>("@mnemo/dvdefi/Foundry")

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const runCommand = (
  cmd: string[],
  cwd: string,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, FoundryError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      })
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      return { stdout, stderr, exitCode }
    },
    catch: (e) =>
      new FoundryError({
        reason: `Failed to execute: ${cmd.join(" ")}`,
        cause: e,
      }),
  })

const makeFoundry = (): Foundry => ({
  build: (projectRoot: string) =>
    Effect.gen(function* () {
      const result = yield* runCommand(["forge", "build"], projectRoot)
      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new FoundryError({
            reason: "forge build failed",
            stdout: result.stdout,
            stderr: result.stderr,
          }),
        )
      }
      return {
        passed: true,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    }),

  test: (
    projectRoot: string,
    testMatch?: string,
    testFunction?: string,
  ) =>
    Effect.gen(function* () {
      const args = ["forge", "test", "-vvv"]
      if (testMatch) {
        args.push("--match-path", testMatch)
      }
      if (testFunction) {
        args.push("--match-test", testFunction)
      }
      const result = yield* runCommand(args, projectRoot)
      return {
        passed: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    }),

  script: (projectRoot, scriptPath, rpcUrl, privateKey) =>
    Effect.gen(function* () {
      const result = yield* runCommand(
        ["forge", "script", scriptPath, "--rpc-url", rpcUrl, "--broadcast", "--private-key", privateKey],
        projectRoot,
      )
      return {
        passed: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }
    }),

  readArtifact: (
    projectRoot: string,
    contractName: string,
    fileName: string,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const artifactPath = path.join(
          projectRoot,
          "out",
          fileName,
          `${contractName}.json`,
        )
        const file = Bun.file(artifactPath)
        if (!(await file.exists())) {
          throw new Error(`Artifact not found at ${artifactPath}`)
        }
        const json = await file.json()
        return {
          abi: json.abi as readonly unknown[],
          bytecode: json.bytecode as { object: string },
          deployedBytecode: json.deployedBytecode as { object: string },
        }
      },
      catch: (e) =>
        new FoundryError({
          reason: `Failed to read artifact ${contractName}/${fileName}`,
          cause: e,
        }),
    }),
})

export const FoundryLive: Layer.Layer<Foundry> = Layer.succeed(
  Foundry,
  makeFoundry(),
)
