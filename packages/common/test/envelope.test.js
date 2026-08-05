import assert from "node:assert/strict";
import test from "node:test";

import { createEnvelope } from "../src/envelope.js";

test("createEnvelope returns the exact response shape", () => {
  const envelope = createEnvelope({
    source: "paideia",
    retrievedAt: "2026-07-23T12:00:00.000Z",
    generatedAt: "2026-07-23T11:59:30.000Z",
    ttlSeconds: 120,
    now: "2026-07-23T12:00:00.000Z",
    data: { courses: 4 },
    warnings: ["fixture"]
  });

  assert.deepEqual(Object.keys(envelope), [
    "source",
    "retrievedAt",
    "cache",
    "data",
    "warnings"
  ]);
  assert.deepEqual(envelope, {
    source: "paideia",
    retrievedAt: "2026-07-23T12:00:00.000Z",
    cache: {
      generatedAt: "2026-07-23T11:59:30.000Z",
      ageSeconds: 30,
      stale: false
    },
    data: { courses: 4 },
    warnings: ["fixture"]
  });
});

test("createEnvelope marks entries at the TTL boundary stale", () => {
  const envelope = createEnvelope({
    source: "campus-virtual-pucp",
    retrievedAt: "2026-07-23T12:00:00.000Z",
    generatedAt: "2026-07-23T10:00:00.000Z",
    ttlSeconds: 7_200,
    now: "2026-07-23T12:00:00.000Z",
    data: null
  });

  assert.equal(envelope.cache.ageSeconds, 7_200);
  assert.equal(envelope.cache.stale, true);
  assert.deepEqual(envelope.warnings, []);
});
