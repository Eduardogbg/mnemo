/**
 * Unstoppable challenge definition.
 *
 * Vulnerability: direct token transfer (bypassing deposit()) breaks the
 * convertToShares(totalSupply) == totalAssets() check in flashLoan(),
 * permanently bricking all flash loans.
 */
import { Effect } from "effect"
import type { ChallengeDefinition, InvariantDef } from "../Challenge.js"
import type { Devnet, DevnetError } from "../Devnet.js"
import type { ChallengeContext } from "../Challenge.js"
import type { InvariantResult } from "../Challenge.js"

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * us:shares-assets-consistency — convertToShares(totalSupply) == totalAssets().
 *
 * This is the core ERC4626 accounting invariant that the exploit breaks.
 * We check it by making three eth_call requests:
 *   1. vault.totalAssets()         — selector 0x01e1d114
 *   2. vault.totalSupply()         — selector 0x18160ddd
 *   3. vault.convertToShares(supply) — selector 0xc6e6f592
 */
const sharesAssetsConsistency: InvariantDef = {
  id: "us:shares-assets-consistency",
  description: "convertToShares(totalSupply) == totalAssets()",
  severity: "medium",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const vaultAddress = ctx.addresses["vault"]!

      // totalAssets()
      const totalAssetsHex = yield* devnet.ethCall(
        vaultAddress,
        "0x01e1d114",
      )
      const totalAssets = BigInt(totalAssetsHex)

      // totalSupply()
      const totalSupplyHex = yield* devnet.ethCall(
        vaultAddress,
        "0x18160ddd",
      )
      const totalSupply = BigInt(totalSupplyHex)

      // convertToShares(totalSupply)
      const supplyHex = totalSupply.toString(16).padStart(64, "0")
      const convertedHex = yield* devnet.ethCall(
        vaultAddress,
        `0xc6e6f592${supplyHex}`,
      )
      const convertedShares = BigInt(convertedHex)

      const holds = convertedShares === totalAssets
      return {
        invariantId: "us:shares-assets-consistency",
        holds,
        actual: `convertToShares(${totalSupply}) = ${convertedShares}`,
        expected: `totalAssets() = ${totalAssets}`,
        evidence: !holds
          ? `Accounting desync: shares=${convertedShares}, assets=${totalAssets}, ` +
            `delta=${totalAssets - convertedShares}. Flash loan will revert with InvalidBalance().`
          : undefined,
      }
    }),
}

/**
 * us:flash-loan-callable — Flash loan is callable (not bricked, not paused).
 *
 * Checks two conditions:
 *   1. ERC4626 accounting is consistent (shares == assets)
 *   2. Vault is not paused (paused() == false, selector 0x5c975abb)
 */
const flashLoanCallable: InvariantDef = {
  id: "us:flash-loan-callable",
  description: "Flash loan does not revert under normal conditions",
  severity: "medium",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const vaultAddress = ctx.addresses["vault"]!

      // Check paused state
      const pausedHex = yield* devnet.ethCall(vaultAddress, "0x5c975abb")
      const isPaused = BigInt(pausedHex) !== 0n

      // Check accounting consistency (reuse the same logic)
      const totalAssetsHex = yield* devnet.ethCall(vaultAddress, "0x01e1d114")
      const totalAssets = BigInt(totalAssetsHex)
      const totalSupplyHex = yield* devnet.ethCall(vaultAddress, "0x18160ddd")
      const totalSupply = BigInt(totalSupplyHex)
      const supplyHex = totalSupply.toString(16).padStart(64, "0")
      const convertedHex = yield* devnet.ethCall(
        vaultAddress,
        `0xc6e6f592${supplyHex}`,
      )
      const convertedShares = BigInt(convertedHex)
      const isConsistent = convertedShares === totalAssets

      const callable = isConsistent && !isPaused
      const reasons: string[] = []
      if (!isConsistent) reasons.push("accounting desync")
      if (isPaused) reasons.push("vault paused")

      return {
        invariantId: "us:flash-loan-callable",
        holds: callable,
        actual: `consistent=${isConsistent}, paused=${isPaused}`,
        expected: "consistent=true, paused=false",
        evidence: !callable
          ? `Flash loan bricked: ${reasons.join(", ")}`
          : undefined,
      }
    }),
}

/**
 * us:vault-not-paused — Vault is not paused.
 * Simple standalone check (selector 0x5c975abb).
 */
const vaultNotPaused: InvariantDef = {
  id: "us:vault-not-paused",
  description: "Vault is not paused",
  severity: "medium",
  check: (
    devnet: Devnet,
    ctx: ChallengeContext,
  ): Effect.Effect<InvariantResult, DevnetError> =>
    Effect.gen(function* () {
      const vaultAddress = ctx.addresses["vault"]!
      const pausedHex = yield* devnet.ethCall(vaultAddress, "0x5c975abb")
      const isPaused = BigInt(pausedHex) !== 0n

      return {
        invariantId: "us:vault-not-paused",
        holds: !isPaused,
        actual: `paused=${isPaused}`,
        expected: "paused=false",
        evidence: isPaused ? "Vault has been paused (DoS condition)" : undefined,
      }
    }),
}

// ---------------------------------------------------------------------------
// Challenge definition
// ---------------------------------------------------------------------------

export const Unstoppable: ChallengeDefinition = {
  id: "unstoppable",
  name: "Unstoppable",
  description:
    "ERC4626 vault with flash loans. Direct token transfer (bypassing deposit()) " +
    "breaks the convertToShares(totalSupply) == totalAssets() check, permanently " +
    "bricking flash loans. The monitor then pauses the vault.",
  difficulty: "low",

  contracts: {
    vulnerable: [
      "src/unstoppable/UnstoppableVault.sol",
      "src/unstoppable/UnstoppableMonitor.sol",
      "src/DamnValuableToken.sol",
    ],
    patched: [
      "src/unstoppable/UnstoppableVaultPatched.sol",
      "src/unstoppable/UnstoppableMonitor.sol",
      "src/DamnValuableToken.sol",
    ],
  },

  tests: {
    exploit: "test/unstoppable/Unstoppable.t.sol",
    exploitFunction: "test_unstoppable",
    patched: "test/unstoppable/UnstoppablePatched.t.sol",
    patchedFunction: "test_unstoppablePatched",
  },

  invariants: [sharesAssetsConsistency, flashLoanCallable, vaultNotPaused],
}
