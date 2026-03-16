/**
 * Integration test: full E2EE round-trip with Venice API.
 * Requires VENICE_API_KEY in environment.
 *
 * Run: bun test test/integration/e2ee-roundtrip.test.ts
 */

import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
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

describe.skipIf(!API_KEY)("E2EE round-trip", () => {
  test(
    "encrypts prompt and decrypts streaming response",
    async () => {
      await runTest(
        Effect.gen(function* () {
          const client = yield* VeniceClient;
          const session = yield* client.createSession(MODEL);

          let fullText = "";
          let encryptedChunks = 0;

          yield* Stream.runForEach(
            client.streamChat(
              {
                model: MODEL,
                messages: [
                  { role: "user", content: "Say exactly: Hello from E2EE" },
                ],
                max_tokens: 50,
                temperature: 0,
              },
              session,
            ),
            (chunk) =>
              Effect.sync(() => {
                if (chunk.text) {
                  fullText += chunk.text;
                  if (chunk.encrypted) encryptedChunks++;
                }
              }),
          );

          console.log("Decrypted response: %s", fullText);
          console.log("Encrypted chunks: %d", encryptedChunks);

          expect(fullText.length).toBeGreaterThan(0);
          expect(encryptedChunks).toBeGreaterThan(0);
        }),
      );
    },
    30_000,
  );

  test(
    "chat() convenience collects full response",
    async () => {
      await runTest(
        Effect.gen(function* () {
          const client = yield* VeniceClient;
          const session = yield* client.createSession(MODEL);

          const { text, chunks } = yield* client.chat(
            {
              model: MODEL,
              messages: [
                {
                  role: "user",
                  content: "What is 2+2? Just the number.",
                },
              ],
              max_tokens: 20,
              temperature: 0,
            },
            session,
          );

          console.log("Response: %s (%d chunks)", text, chunks);
          expect(text.length).toBeGreaterThan(0);
          expect(chunks).toBeGreaterThan(0);
        }),
      );
    },
    30_000,
  );
});
