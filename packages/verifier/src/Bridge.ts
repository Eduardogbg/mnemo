/**
 * Bridge — connects dvdefi's Devnet (anvil lifecycle) to verity's
 * ProviderService (voltaire-effect typed chain access).
 *
 * The key insight: dvdefi spawns anvil and gives us an rpcUrl.
 * We feed that URL into verity's HttpProviderFetch to create
 * a voltaire-effect ProviderService layer. Both systems then
 * talk to the same anvil instance.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Devnet } from "@mnemo/dvdefi"
import {
  HttpProviderFetch,
  DevnetCheatcodes,
  DevnetCheatcodesLive,
} from "@mnemo/verity"
import { ProviderService } from "voltaire-effect"

/**
 * Create a verity ProviderService layer from a dvdefi Devnet.
 * Uses Layer.unwrapEffect to dynamically create the provider
 * layer from the Devnet's rpcUrl at construction time.
 */
export const providerFromDevnet: Layer.Layer<
  ProviderService,
  never,
  Devnet
> = Layer.unwrapEffect(
  Effect.map(Devnet, (devnet) => HttpProviderFetch(devnet.rpcUrl)),
)

/**
 * Create a verity DevnetCheatcodes layer from a dvdefi Devnet.
 * Requires a ProviderService already in context (use providerFromDevnet).
 */
export const cheatcodesFromDevnet: Layer.Layer<
  DevnetCheatcodes,
  never,
  ProviderService
> = DevnetCheatcodesLive

/**
 * Create the full verity layer stack from a dvdefi Devnet.
 * Provides both ProviderService and DevnetCheatcodes.
 */
export const verityLayerFromDevnet: Layer.Layer<
  ProviderService | DevnetCheatcodes,
  never,
  Devnet
> = Layer.provideMerge(cheatcodesFromDevnet, providerFromDevnet)
