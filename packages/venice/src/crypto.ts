/**
 * crypto.ts -- Venice E2EE cryptographic primitives.
 *
 * Implements the verified Venice E2EE protocol:
 *
 *   REQUEST encryption:
 *     - Per-message ephemeral keypair (secp256k1, uncompressed)
 *     - ECDH(ephemeralPriv, serverAttestationPub) -> shared x-coordinate
 *     - HKDF-SHA256(ikm=x, salt=undefined, info="ecdsa_encryption", len=32) -> AES key
 *     - AES-256-GCM(key, random 12B nonce)
 *     - Wire format: ephemeralPubKey(65B) || nonce(12B) || ciphertext || tag(16B) -> hex
 *
 *   RESPONSE decryption (per SSE chunk):
 *     - Server encrypts to the X-Venice-TEE-Client-Pub-Key header key
 *     - Each chunk: serverEphPub(65B) || nonce(12B) || ciphertext || tag(16B) -> hex
 *     - ECDH(headerPriv, serverEphPub) -> shared x-coordinate
 *     - Same HKDF derivation -> AES key -> AES-256-GCM decrypt
 *
 * Uses @noble/curves for secp256k1 (Bun lacks native secp256k1 support)
 * and Node.js crypto for AES-256-GCM.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HKDF info parameter used by Venice's ecdsa_encryption protocol. */
const INFO = new TextEncoder().encode("ecdsa_encryption");

/**
 * Minimum hex length for a valid encrypted chunk:
 * 65 (ephemeral pub) + 12 (nonce) + 1 (min ciphertext) + 16 (tag) = 94 bytes = 188 hex chars.
 * We use 186 (93 bytes) as the floor since even an empty plaintext produces 93 bytes.
 */
const MIN_CIPHERTEXT_HEX_LEN = 186;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyPair {
  /** 32-byte secp256k1 private key */
  readonly priv: Uint8Array;
  /** 65-byte uncompressed public key */
  readonly pub: Uint8Array;
  /** Hex-encoded uncompressed public key (130 chars) */
  readonly pubHex: string;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a random secp256k1 keypair (uncompressed public key, 65 bytes).
 */
export function genKeyPair(): KeyPair {
  const priv = secp256k1.utils.randomSecretKey();
  const pub = secp256k1.getPublicKey(priv, false);
  return { priv, pub, pubHex: Buffer.from(pub).toString("hex") };
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte AES-256 key from an ECDH shared secret.
 *
 * Uses the Venice protocol: HKDF-SHA256 with info="ecdsa_encryption",
 * no salt, ikm = x-coordinate of the ECDH shared point.
 */
export function deriveKey(
  privateKey: Uint8Array,
  publicKeyHex: string,
): Buffer {
  const shared = secp256k1.getSharedSecret(
    privateKey,
    Buffer.from(publicKeyHex, "hex"),
    false, // uncompressed
  );
  // x-coordinate = bytes 1..33 of the uncompressed shared point
  const rawSecret = shared.slice(1, 33);
  return Buffer.from(hkdf(sha256, rawSecret, undefined, INFO, 32));
}

// ---------------------------------------------------------------------------
// Encrypt (for requests)
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext message for Venice E2EE request.
 *
 * Creates a fresh ephemeral keypair, derives a shared secret with the
 * server's attestation public key, and produces:
 *   ephemeralPub(65B) || nonce(12B) || ciphertext || tag(16B) -> hex string
 */
export function encryptMessage(
  plaintext: string,
  serverPubKeyHex: string,
): string {
  const ephemeral = genKeyPair();
  const aesKey = deriveKey(ephemeral.priv, serverPubKeyHex);
  const nonce = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from(ephemeral.pub),
    nonce,
    encrypted,
    tag,
  ]).toString("hex");
}

// ---------------------------------------------------------------------------
// Decrypt (for response chunks)
// ---------------------------------------------------------------------------

/**
 * Decrypt a single SSE response chunk from Venice E2EE.
 *
 * The chunk format is:
 *   serverEphPub(65B) || nonce(12B) || ciphertext || tag(16B), hex-encoded.
 *
 * The `headerPrivKey` is the private key corresponding to the public key
 * sent in the X-Venice-TEE-Client-Pub-Key request header.
 */
export function decryptChunk(
  hexChunk: string,
  headerPrivKey: Uint8Array,
): string {
  const data = Buffer.from(hexChunk, "hex");
  const serverEphPub = data.subarray(0, 65);
  const nonce = data.subarray(65, 77);
  const ct = data.subarray(77, data.length - 16);
  const tag = data.subarray(data.length - 16);

  const aesKey = deriveKey(headerPrivKey, Buffer.from(serverEphPub).toString("hex"));

  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(aesKey), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic check: does this string look like a hex-encoded E2EE ciphertext?
 * (even number of hex chars, at least 93 bytes = 186 hex chars)
 */
export function isEncryptedChunk(s: string): boolean {
  return (
    s.length >= MIN_CIPHERTEXT_HEX_LEN &&
    s.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(s)
  );
}

/**
 * Normalize a Venice attestation signing key to uncompressed hex (no 0x prefix).
 * Venice sometimes returns 128-char keys (missing the 04 prefix) or 0x-prefixed keys.
 */
export function normalizeServerKey(key: string): string {
  let k = key;
  if (k.startsWith("0x")) k = k.slice(2);
  if (k.length === 128) k = "04" + k;
  return k;
}
