/**
 * Unit tests for crypto primitives.
 * These are fully offline -- no API key or network needed.
 */

import { describe, expect, test } from "bun:test";
import {
  genKeyPair,
  deriveKey,
  encryptMessage,
  decryptChunk,
  isEncryptedChunk,
  normalizeServerKey,
} from "../../src/crypto.js";
import crypto from "node:crypto";

describe("genKeyPair", () => {
  test("produces valid keypair with correct sizes", () => {
    const kp = genKeyPair();
    expect(kp.priv).toBeInstanceOf(Uint8Array);
    expect(kp.priv.length).toBe(32);
    expect(kp.pub).toBeInstanceOf(Uint8Array);
    expect(kp.pub.length).toBe(65); // uncompressed secp256k1
    expect(kp.pub[0]).toBe(0x04); // uncompressed prefix
    expect(kp.pubHex).toHaveLength(130); // 65 bytes * 2
  });

  test("generates unique keypairs", () => {
    const a = genKeyPair();
    const b = genKeyPair();
    expect(a.pubHex).not.toBe(b.pubHex);
  });
});

describe("deriveKey", () => {
  test("derives deterministic 32-byte key from same inputs", () => {
    const a = genKeyPair();
    const b = genKeyPair();
    const key1 = deriveKey(a.priv, b.pubHex);
    const key2 = deriveKey(a.priv, b.pubHex);
    expect(key1).toEqual(key2);
    expect(key1.length).toBe(32);
  });

  test("ECDH is symmetric: A->B == B->A", () => {
    const a = genKeyPair();
    const b = genKeyPair();
    const keyAB = deriveKey(a.priv, b.pubHex);
    const keyBA = deriveKey(b.priv, a.pubHex);
    expect(keyAB).toEqual(keyBA);
  });

  test("different keypairs produce different keys", () => {
    const a = genKeyPair();
    const b = genKeyPair();
    const c = genKeyPair();
    const keyAB = deriveKey(a.priv, b.pubHex);
    const keyAC = deriveKey(a.priv, c.pubHex);
    expect(keyAB).not.toEqual(keyAC);
  });
});

describe("encryptMessage + decryptChunk round-trip", () => {
  test("encrypts and decrypts a simple message", () => {
    // Simulate server: server has a keypair, client encrypts to server's pubkey
    const server = genKeyPair();
    const headerKey = genKeyPair();

    // To do a full round-trip locally, we need to simulate what the server does:
    // 1. Client encrypts with encryptMessage (uses ephemeral -> server pub)
    // 2. Server decrypts (we won't test this -- it's server-side)
    // 3. Server encrypts response to headerKey (we simulate this)

    // Simulate server encrypting a response chunk to the header key:
    const plaintext = "Hello from server!";
    const serverEphemeral = genKeyPair();
    const aesKey = deriveKey(serverEphemeral.priv, headerKey.pubHex);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const hexChunk = Buffer.concat([
      Buffer.from(serverEphemeral.pub),
      nonce,
      encrypted,
      tag,
    ]).toString("hex");

    // Client decrypts using header key
    const decrypted = decryptChunk(hexChunk, headerKey.priv);
    expect(decrypted).toBe(plaintext);
  });

  test("encryptMessage produces correct wire format", () => {
    const server = genKeyPair();
    const ciphertext = encryptMessage("test", server.pubHex);

    // Verify hex string
    expect(/^[0-9a-f]+$/i.test(ciphertext)).toBe(true);

    // Decode and check structure
    const data = Buffer.from(ciphertext, "hex");
    // At least: 65 (pub) + 12 (nonce) + 4 (min "test" encrypted) + 16 (tag)
    expect(data.length).toBeGreaterThanOrEqual(93);
    // First byte should be 0x04 (uncompressed pubkey prefix)
    expect(data[0]).toBe(0x04);
  });

  test("encryptMessage: server can decrypt with its private key", () => {
    const server = genKeyPair();
    const hex = encryptMessage("secret payload", server.pubHex);

    // Server-side decryption: extract ephemeral pub, derive key, decrypt
    const data = Buffer.from(hex, "hex");
    const ephPub = data.subarray(0, 65);
    const nonce = data.subarray(65, 77);
    const ct = data.subarray(77, data.length - 16);
    const tag = data.subarray(data.length - 16);

    const aesKey = deriveKey(server.priv, Buffer.from(ephPub).toString("hex"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, nonce);
    decipher.setAuthTag(tag);
    const result = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    expect(result).toBe("secret payload");
  });

  test("decryption with wrong key fails", () => {
    const server = genKeyPair();
    const wrongKey = genKeyPair();
    const headerKey = genKeyPair();

    // Encrypt a chunk to headerKey
    const serverEph = genKeyPair();
    const aesKey = deriveKey(serverEph.priv, headerKey.pubHex);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);
    const encrypted = Buffer.concat([
      cipher.update("test", "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const hexChunk = Buffer.concat([
      Buffer.from(serverEph.pub),
      nonce,
      encrypted,
      tag,
    ]).toString("hex");

    // Try to decrypt with wrong key -- should throw
    expect(() => decryptChunk(hexChunk, wrongKey.priv)).toThrow();
  });

  test("round-trip with unicode content", () => {
    const headerKey = genKeyPair();
    const serverEph = genKeyPair();

    const plaintext = "Hello \u{1F30D} \u00E9\u00E0\u00FC \u4F60\u597D \u0410\u0411\u0412";
    const aesKey = deriveKey(serverEph.priv, headerKey.pubHex);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const hexChunk = Buffer.concat([
      Buffer.from(serverEph.pub),
      nonce,
      encrypted,
      tag,
    ]).toString("hex");

    expect(decryptChunk(hexChunk, headerKey.priv)).toBe(plaintext);
  });
});

describe("isEncryptedChunk", () => {
  test("returns true for hex string >= 186 chars", () => {
    // 93 bytes = 186 hex chars
    const hex = "a".repeat(186);
    expect(isEncryptedChunk(hex)).toBe(true);
  });

  test("returns false for short strings", () => {
    expect(isEncryptedChunk("abcdef")).toBe(false);
    expect(isEncryptedChunk("")).toBe(false);
  });

  test("returns false for non-hex strings", () => {
    expect(isEncryptedChunk("g".repeat(200))).toBe(false);
    expect(isEncryptedChunk("Hello World! ".repeat(20))).toBe(false);
  });

  test("returns false for odd-length hex", () => {
    expect(isEncryptedChunk("a".repeat(187))).toBe(false);
  });
});

describe("normalizeServerKey", () => {
  test("adds 04 prefix to 128-char key", () => {
    const key128 = "a".repeat(128);
    expect(normalizeServerKey(key128)).toBe("04" + key128);
  });

  test("strips 0x prefix", () => {
    const key = "04" + "b".repeat(128);
    expect(normalizeServerKey("0x" + key)).toBe(key);
  });

  test("leaves 130-char key unchanged", () => {
    const key = "04" + "c".repeat(128);
    expect(normalizeServerKey(key)).toBe(key);
  });

  test("handles 0x prefix + missing 04", () => {
    const raw = "d".repeat(128);
    expect(normalizeServerKey("0x" + raw)).toBe("04" + raw);
  });
});
