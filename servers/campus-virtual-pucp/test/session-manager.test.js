import assert from "node:assert/strict";
import test from "node:test";

import { createReusableSessionManager } from "../src/session-manager.js";

function fixture() {
  let created = 0;
  let authenticated = 0;
  let closed = 0;
  const manager = createReusableSessionManager({
    create: async () => ({ id: ++created, async close() { closed += 1; } }),
    authenticate: async () => { authenticated += 1; },
    isAuthenticationError: (error) => error?.code === "authentication_required",
    nowMs: (() => { let value = 0; return () => ++value; })()
  });
  return { manager, counts: () => ({ created, authenticated, closed }) };
}

test("two consecutive reads reuse one browser session and authentication", async () => {
  const { manager, counts } = fixture();
  const first = await manager.run({ key: "account", descriptor: {} }, (session) => session.id);
  const second = await manager.run({ key: "account", descriptor: {} }, (session) => session.id);

  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.deepEqual(counts(), { created: 1, authenticated: 1, closed: 0 });
  assert.equal(manager.metrics().browserCreated, 1);
  assert.equal(manager.metrics().sessionReused, 1);
});

test("concurrent reads deduplicate lazy session creation", async () => {
  const { manager, counts } = fixture();
  const values = await Promise.all([
    manager.run({ key: "account", descriptor: {} }, (session) => session.id),
    manager.run({ key: "account", descriptor: {} }, (session) => session.id)
  ]);
  assert.deepEqual(values, [1, 1]);
  assert.deepEqual(counts(), { created: 1, authenticated: 1, closed: 0 });
});

test("an expired read session is renewed once and the read is retried", async () => {
  const { manager, counts } = fixture();
  let calls = 0;
  const value = await manager.run(
    { key: "account", descriptor: {}, idempotent: true },
    async (session) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("expired");
        error.code = "authentication_required";
        throw error;
      }
      return session.id;
    }
  );
  assert.equal(value, 2);
  assert.equal(calls, 2);
  assert.deepEqual(counts(), { created: 2, authenticated: 2, closed: 1 });
});

test("writes are never retried after an authentication or uncertain failure", async () => {
  const { manager, counts } = fixture();
  let calls = 0;
  await assert.rejects(
    manager.run({ key: "account", descriptor: {}, idempotent: false }, async () => {
      calls += 1;
      const error = new Error("expired");
      error.code = "authentication_required";
      throw error;
    }),
    { code: "authentication_required" }
  );
  assert.equal(calls, 1);
  assert.deepEqual(counts(), { created: 1, authenticated: 1, closed: 1 });
});

test("close disposes the retained session and future reads create a new one", async () => {
  const { manager, counts } = fixture();
  await manager.run({ key: "account", descriptor: {} }, () => "ok");
  await manager.close();
  await manager.run({ key: "account", descriptor: {} }, () => "ok");
  assert.deepEqual(counts(), { created: 2, authenticated: 2, closed: 1 });
});
