import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey } from "../src/lib/cache-key.ts";

const base = { provider: "elevenlabs", endpoint: "https://api.elevenlabs.io", model: "m1", voice: "v1", text: "Hello" };

test("cache key is a stable sha256 hex digest", () => {
  const k = cacheKey(base);
  assert.match(k, /^[a-f0-9]{64}$/);
  assert.equal(cacheKey({ ...base }), k);
});

test("cache key changes with text, provider, voice, model and endpoint", () => {
  const k = cacheKey(base);
  for (const change of [
    { text: "Hello!" },
    { provider: "openai-compatible" },
    { voice: "v2" },
    { model: "m2" },
    { endpoint: "https://other.example" },
  ]) {
    assert.notEqual(cacheKey({ ...base, ...change }), k, JSON.stringify(change));
  }
});

test("trailing slashes in the endpoint do not split the cache", () => {
  assert.equal(cacheKey({ ...base, endpoint: "https://api.elevenlabs.io/" }), cacheKey(base));
});
