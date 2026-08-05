import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isPathAllowed,
  resolveAllowedPath
} from "../src/safe-path.js";

test("resolveAllowedPath resolves relative paths beneath the first allowlisted root", () => {
  const root = path.resolve("data");
  assert.equal(
    resolveAllowedPath("courses/cache.json", [root]),
    path.join(root, "courses", "cache.json")
  );
});

test("safe path checks reject traversal and sibling-prefix paths", () => {
  const root = path.resolve("data");
  assert.equal(isPathAllowed(path.join(root, "cache.json"), [root]), true);
  assert.equal(isPathAllowed(path.resolve("database/cache.json"), [root]), false);
  assert.throws(
    () => resolveAllowedPath("../auth/session.json", [root]),
    (error) => error.code === "PATH_NOT_ALLOWED"
  );
});

test("resolveAllowedPath rejects an existing junction or symlink escape", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pucp-path-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const allowedRoot = path.join(directory, "allowed");
  const outsideRoot = path.join(directory, "outside");
  const linkedDirectory = path.join(allowedRoot, "linked");
  await mkdir(allowedRoot);
  await mkdir(outsideRoot);

  try {
    await symlink(
      outsideRoot,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir"
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("platform does not permit creating a test link");
      return;
    }
    throw error;
  }

  assert.throws(
    () =>
      resolveAllowedPath(
        path.join(linkedDirectory, "not-created-yet", "cache.json"),
        [allowedRoot]
      ),
    (error) => error.code === "PATH_NOT_ALLOWED"
  );
});

test("resolveAllowedPath uses the nearest existing parent realpath", () => {
  const allowedRoot = path.resolve("virtual", "allowed");
  const linkedDirectory = path.join(allowedRoot, "linked");
  const outsideRoot = path.resolve("virtual", "outside");
  const candidate = path.join(linkedDirectory, "future", "cache.json");
  const existing = new Set([allowedRoot, linkedDirectory]);

  assert.throws(
    () =>
      resolveAllowedPath(candidate, [allowedRoot], {
        existsPath: (value) => existing.has(value),
        realpath: (value) =>
          value === linkedDirectory ? outsideRoot : allowedRoot
      }),
    (error) => error.code === "PATH_NOT_ALLOWED"
  );
});
