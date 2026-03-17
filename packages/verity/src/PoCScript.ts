/**
 * @module PoCScript
 *
 * Types for exploit proof-of-concept scripts.
 * A PoC script gets full devnet access: read + write + cheatcodes.
 * This is expressed in the Effect R channel.
 */

import type * as Effect from "effect/Effect"
import type { ProviderService } from "voltaire-effect"
import type { DevnetCheatcodes } from "./DevnetCheatcodes.js"
import type { PoCError } from "./errors.js"

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PoCResult {
  /** Whether the exploit succeeded */
  readonly success: boolean
  /** Human-readable description of what happened */
  readonly description: string
  /** Transaction hashes executed during the exploit */
  readonly txHashes?: ReadonlyArray<string>
}

// ---------------------------------------------------------------------------
// PoC script type
// ---------------------------------------------------------------------------

/**
 * A PoC script is an Effect that gets full devnet access.
 * The R channel includes both ProviderService (read/write via unlocked accounts)
 * and DevnetCheatcodes (snapshot, setBalance, impersonate, etc.).
 */
export type PoCScript = Effect.Effect<PoCResult, PoCError, ProviderService | DevnetCheatcodes>
