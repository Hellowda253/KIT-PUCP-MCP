import assert from "node:assert/strict";
import test from "node:test";

import {
  TTL_SECONDS,
  cacheFreshness,
  shouldRefresh
} from "../src/freshness.js";

test("TTL constants match the academic cache policy", () => {
  assert.deepEqual(TTL_SECONDS, {
    academic: 2 * 60 * 60,
    agenda: 12 * 60 * 60,
    materialAdmin: 48 * 60 * 60
  });
});

test("cacheFreshness computes a non-negative integer age", () => {
  assert.deepEqual(
    cacheFreshness({
      generatedAt: "2026-07-23T12:00:00.500Z",
      now: "2026-07-23T12:00:30.900Z",
      ttlSeconds: 60
    }),
    { ageSeconds: 30, stale: false }
  );
});

test("shouldRefresh honors forceRefresh and stale or missing cache state", () => {
  const fresh = {
    generatedAt: "2026-07-23T11:30:00.000Z",
    now: "2026-07-23T12:00:00.000Z",
    ttlSeconds: TTL_SECONDS.academic
  };

  assert.equal(shouldRefresh({ ...fresh, forceRefresh: true }), true);
  assert.equal(shouldRefresh({ ...fresh, forceRefresh: false }), false);
  assert.equal(shouldRefresh({ ...fresh, generatedAt: null }), true);
  assert.equal(
    shouldRefresh({
      ...fresh,
      generatedAt: "2026-07-23T10:00:00.000Z"
    }),
    true
  );
});
