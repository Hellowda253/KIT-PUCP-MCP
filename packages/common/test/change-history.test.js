import assert from "node:assert/strict";
import test from "node:test";

import {
  appendChangeHistory,
  summarizeChanges
} from "../src/change-history.js";

test("summarizeChanges reports only added, removed, and changed fields", () => {
  assert.deepEqual(
    summarizeChanges(
      { course: "IND101", grade: 14, obsolete: true },
      { course: "IND101", grade: 16, section: "0801" }
    ),
    {
      changed: true,
      addedKeys: ["section"],
      removedKeys: ["obsolete"],
      changedKeys: ["grade"]
    }
  );
});

test("summarizeChanges treats reordered object keys as unchanged", () => {
  assert.deepEqual(
    summarizeChanges(
      { nested: { a: 1, b: 2 } },
      { nested: { b: 2, a: 1 } }
    ),
    {
      changed: false,
      addedKeys: [],
      removedKeys: [],
      changedKeys: []
    }
  );
});

test("summarizeChanges reports deterministic top-level array index changes", () => {
  const previous = [
    { id: "A", details: { course: "IND101", grade: 14 } },
    { id: "B", grade: 15 }
  ];
  const current = [
    { details: { grade: 14, course: "IND101" }, id: "A" },
    { id: "B", grade: 17 },
    { id: "C", grade: 16 }
  ];

  assert.deepEqual(summarizeChanges(previous, current), {
    changed: true,
    addedKeys: ["2"],
    removedKeys: [],
    changedKeys: ["1"]
  });
  assert.deepEqual(summarizeChanges(current, previous), {
    changed: true,
    addedKeys: [],
    removedKeys: ["2"],
    changedKeys: ["1"]
  });
});

test("appendChangeHistory skips no-op events and bounds retained history", () => {
  const prior = [{ detectedAt: "1", summary: { changed: true } }];
  const unchanged = appendChangeHistory(prior, {
    detectedAt: "2",
    summary: { changed: false }
  });
  const bounded = appendChangeHistory(
    unchanged,
    { detectedAt: "3", summary: { changed: true } },
    { maxEntries: 1 }
  );

  assert.notEqual(unchanged, prior);
  assert.deepEqual(unchanged, prior);
  assert.deepEqual(bounded, [
    { detectedAt: "3", summary: { changed: true } }
  ]);
});
