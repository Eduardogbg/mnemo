/**
 * @module abi
 *
 * Minimal ABI encoding/decoding helpers for eth_call calldata construction.
 * These handle the simple cases we need: address and uint256 arguments,
 * single uint256 return values.
 *
 * For complex ABI interactions, use voltaire-effect's Contract system instead.
 */

/**
 * Pad an address (0x-prefixed, 20 bytes) to a 32-byte ABI word.
 */
export const padAddress = (address: string): string =>
  address.slice(2).padStart(64, "0")

/**
 * Pad a uint256 value to a 32-byte ABI word (hex, no 0x prefix).
 */
export const padUint256 = (value: bigint): string =>
  value.toString(16).padStart(64, "0")

/**
 * Encode a function call: 4-byte selector + ABI-encoded arguments.
 * Each arg is either an address (0x-prefixed string) or will be treated as
 * a raw 32-byte hex word (already padded, no 0x prefix).
 *
 * @param selector - 4-byte function selector with 0x prefix (e.g. "0x70a08231")
 * @param args - Array of addresses (0x-prefixed) or pre-padded hex words
 * @returns Calldata as 0x-prefixed hex string
 */
export const encodeCall = (
  selector: string,
  args: string[] = [],
): `0x${string}` => {
  let calldata = selector
  for (const arg of args) {
    if (arg.startsWith("0x")) {
      // Address -- pad to 32 bytes
      calldata += padAddress(arg)
    } else {
      // Already a raw hex word (no 0x prefix)
      calldata += arg.padStart(64, "0")
    }
  }
  return calldata as `0x${string}`
}

/**
 * Encode a function call with a uint256 argument.
 */
export const encodeCallWithUint256 = (
  selector: string,
  value: bigint,
): `0x${string}` => {
  return `${selector}${padUint256(value)}` as `0x${string}`
}

/**
 * Decode a single uint256 from an eth_call return value.
 * The return data is a 0x-prefixed hex string of a 32-byte ABI word.
 */
export const decodeUint256 = (hex: string): bigint => {
  if (hex === "0x" || hex === "0x0" || hex.length === 0) return 0n
  return BigInt(hex)
}

/**
 * Decode a boolean from an eth_call return value.
 * In ABI encoding, booleans are uint256 where 0 = false, nonzero = true.
 */
export const decodeBool = (hex: string): boolean => {
  return decodeUint256(hex) !== 0n
}
