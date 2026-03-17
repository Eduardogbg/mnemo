/**
 * @module errors
 *
 * Tagged error types for the verity verification toolkit.
 * All errors extend Effect's Data.TaggedError for structural pattern matching.
 */

import * as Data from "effect/Data"

/**
 * Error during invariant checking (RPC failure, decode failure, etc.)
 */
export class InvariantError extends Data.TaggedError("InvariantError")<{
  readonly invariantId: string
  readonly reason: string
  readonly cause?: unknown
}> {}

/**
 * Error during PoC script execution.
 */
export class PoCError extends Data.TaggedError("PoCError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

/**
 * Error during challenge setup (deploy, fund, configure).
 */
export class SetupError extends Data.TaggedError("SetupError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

/**
 * Error from devnet cheatcode calls.
 */
export class CheatcodeError extends Data.TaggedError("CheatcodeError")<{
  readonly method: string
  readonly reason: string
  readonly cause?: unknown
}> {}
