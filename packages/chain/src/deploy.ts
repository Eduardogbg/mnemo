/**
 * Deploy Mnemo contracts to a local Anvil instance via forge script.
 */
import { Effect, Data } from "effect"

export class DeployError extends Data.TaggedError("DeployError")<{
  readonly reason: string
  readonly stdout?: string
  readonly stderr?: string
  readonly cause?: unknown
}> {}

export interface DeployResult {
  readonly escrowAddress: string
  readonly reputationAddress: string
}

/**
 * Deploy MnemoEscrow and MnemoReputation contracts to Anvil.
 * Shells out to `forge script` directly.
 */
export const deploy = (
  projectRoot: string,
  rpcUrl: string,
  privateKey: string,
  scriptPath = "script/Deploy.s.sol",
): Effect.Effect<DeployResult, DeployError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["forge", "script", scriptPath, "--rpc-url", rpcUrl, "--broadcast", "--private-key", privateKey],
        { cwd: projectRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env } },
      )
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        throw Object.assign(new Error("forge script failed"), { stdout, stderr })
      }

      const escrowMatch = stdout.match(/MnemoEscrow:\s*(0x[a-fA-F0-9]{40})/)
      const reputationMatch = stdout.match(/MnemoReputation:\s*(0x[a-fA-F0-9]{40})/)

      if (!escrowMatch || !reputationMatch) {
        throw Object.assign(
          new Error("Failed to parse deployed addresses from forge script output"),
          { stdout, stderr },
        )
      }

      return {
        escrowAddress: escrowMatch[1]!,
        reputationAddress: reputationMatch[1]!,
      } satisfies DeployResult
    },
    catch: (e: any) =>
      new DeployError({
        reason: e instanceof Error ? e.message : String(e),
        stdout: e.stdout,
        stderr: e.stderr,
        cause: e,
      }),
  })
