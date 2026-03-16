/**
 * Integration test: list Venice models via typed VeniceApi.
 * Requires VENICE_API_KEY in environment.
 *
 * Run: bun test test/integration/models.test.ts
 */

import { describe, expect, test } from "bun:test";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { VeniceApi, layer as veniceApiLayer } from "../../src/api.js";

const API_KEY = process.env.VENICE_API_KEY;
const BASE_URL = "https://api.venice.ai/api/v1";

const testLayer = Layer.provide(
  veniceApiLayer({ apiKey: API_KEY!, baseUrl: BASE_URL }),
  FetchHttpClient.layer,
);

const runTest = <A, E>(effect: Effect.Effect<A, E, VeniceApi>) =>
  Effect.runPromise(Effect.provide(effect, testLayer));

describe.skipIf(!API_KEY)("Model listing", () => {
  test(
    "lists available models including e2ee variants",
    async () => {
      await runTest(
        Effect.gen(function* () {
          const api = yield* VeniceApi;
          const result = yield* api.listModels();

          expect(result.data.length).toBeGreaterThan(0);

          const e2eeModels = result.data.filter((m) =>
            m.id.startsWith("e2ee-"),
          );
          console.log(
            "E2EE models: %s",
            e2eeModels.map((m) => m.id).join(", "),
          );
          expect(e2eeModels.length).toBeGreaterThan(0);
        }),
      );
    },
    15_000,
  );
});
