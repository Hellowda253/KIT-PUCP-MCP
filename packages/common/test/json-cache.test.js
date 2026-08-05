import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readJsonCache, writeJsonAtomic } from "../src/json-cache.js";

test("writeJsonAtomic persists replaceable JSON without temp-file residue", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pucp-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cachePath = path.join(directory, "academic.json");

  await writeJsonAtomic(cachePath, { version: 1 });
  await writeJsonAtomic(cachePath, { version: 2, courses: ["IND101"] });

  assert.deepEqual(await readJsonCache(cachePath), {
    version: 2,
    courses: ["IND101"]
  });
  assert.deepEqual(await readdir(directory), ["academic.json"]);
});

test("readJsonCache returns an explicit fallback only for a missing file", async () => {
  assert.deepEqual(
    await readJsonCache(path.join(tmpdir(), "definitely-missing-pucp-cache.json"), {
      fallback: { empty: true }
    }),
    { empty: true }
  );
});

test("writeJsonAtomic rejects undefined JSON before creating any file", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pucp-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cachePath = path.join(directory, "invalid.json");

  await assert.rejects(
    writeJsonAtomic(cachePath, undefined),
    (error) => error.code === "JSON_NOT_SERIALIZABLE"
  );
  assert.deepEqual(await readdir(directory), []);
});
