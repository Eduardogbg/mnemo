#!/usr/bin/env bun
/**
 * Root-level wrapper for the Effect-based deployment script.
 *
 * Delegates to packages/chain/scripts/deploy-sepolia.ts which has access
 * to effect, voltaire-effect, and @effect/platform dependencies.
 *
 * Usage:
 *   bun run scripts/deploy-sepolia.ts
 *   bun run scripts/deploy-sepolia.ts --dry-run
 */

import * as path from "node:path"

const scriptPath = path.resolve(import.meta.dir, "..", "packages", "chain", "scripts", "deploy-sepolia.ts")
const args = process.argv.slice(2)

const chainDir = path.resolve(import.meta.dir, "..", "packages", "chain")

const proc = Bun.spawn(["bun", "run", scriptPath, ...args], {
  cwd: chainDir,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: { ...process.env },
})

const exitCode = await proc.exited
process.exit(exitCode)
