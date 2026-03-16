/**
 * Integration test: attestation endpoint.
 * Requires VENICE_API_KEY in environment.
 *
 * Run: bun test test/integration/attestation.test.ts
 */

import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  VeniceClient,
  VeniceClientFull,
  VeniceConfig,
} from "../../src/client.js";

const API_KEY = process.env.VENICE_API_KEY;
const MODEL = "e2ee-qwen3-30b-a3b";

const testLayer = Layer.provide(
  VeniceClientFull,
  Layer.succeed(VeniceConfig, {
    apiKey: API_KEY!,
    model: MODEL,
  }),
);

const runTest = <A, E>(effect: Effect.Effect<A, E, VeniceClient>) =>
  Effect.runPromise(Effect.provide(effect, testLayer));

describe.skipIf(!API_KEY)("Attestation", () => {
  test(
    "fetches attestation with signing key",
    async () => {
      await runTest(
        Effect.gen(function* () {
          const client = yield* VeniceClient;
          const att = yield* client.fetchAttestation(MODEL);

          console.log("Verified: %s", att.verified);
          console.log("Signing key: %s...", att.signing_key?.slice(0, 20));
          console.log("TEE provider: %s", att.tee_provider);

          expect(att.signing_key).toBeDefined();
          expect(typeof att.signing_key).toBe("string");
          expect(att.signing_key!.length).toBeGreaterThanOrEqual(128);
        }),
      );
    },
    15_000,
  );

  test(
    "createSession caches sessions",
    async () => {
      await runTest(
        Effect.gen(function* () {
          const client = yield* VeniceClient;
          const s1 = yield* client.createSession(MODEL);
          const s2 = yield* client.createSession(MODEL);

          // Same object reference (cached)
          expect(s1).toBe(s2);
          expect(s1.serverKeyHex).toBe(s2.serverKeyHex);
          expect(s1.headerKey.pubHex).toBe(s2.headerKey.pubHex);

          // Clear and re-create
          yield* client.clearSession(MODEL);
          const s3 = yield* client.createSession(MODEL);
          expect(s3).not.toBe(s1);
          // Server key should be the same (same model), but header key is fresh
          expect(s3.headerKey.pubHex).not.toBe(s1.headerKey.pubHex);
        }),
      );
    },
    15_000,
  );
});
