import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEnv, parseEnv } from "../src/env.js";

test("parseEnv supports comments, export syntax, and quoted values", () => {
  assert.deepEqual(
    parseEnv(String.raw`
      # local fixture
      export PUCP_BROWSER=chromium
      PUCP_PROFILE_DIR="C:\PUCP Profile"
      EMPTY=
    `),
    {
      PUCP_BROWSER: "chromium",
      PUCP_PROFILE_DIR: "C:\\PUCP Profile",
      EMPTY: ""
    }
  );
});

test("parseEnv preserves single-backslash Windows paths in either quote style", () => {
  assert.deepEqual(
    parseEnv(String.raw`
      DOUBLE_PATH="C:\Users\student\PUCP Profile"
      SINGLE_PATH='D:\PUCP\Campus Virtual'
      QUOTED_TEXT="Student said \"hola\""
    `),
    {
      DOUBLE_PATH: String.raw`C:\Users\student\PUCP Profile`,
      SINGLE_PATH: String.raw`D:\PUCP\Campus Virtual`,
      QUOTED_TEXT: 'Student said "hola"'
    }
  );
});

test("parseEnv preserves quoted UNC and literal doubled backslashes exactly", () => {
  assert.deepEqual(
    parseEnv(String.raw`
      UNC_PATH="\\server\share\PUCP"
      LITERAL_SLASHES='C:\\PUCP\\archive'
    `),
    {
      UNC_PATH: String.raw`\\server\share\PUCP`,
      LITERAL_SLASHES: String.raw`C:\\PUCP\\archive`
    }
  );
});

test("loadEnv merges defaults, file values, and process values without mutation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pucp-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, ".env.local");
  await writeFile(filePath, "PUCP_BROWSER=firefox\nFROM_FILE=yes\n");
  const processValues = { PUCP_BROWSER: "chromium" };

  const loaded = await loadEnv({
    filePath,
    env: processValues,
    defaults: { PUCP_BROWSER: "webkit", DEFAULT_ONLY: "yes" },
    required: ["PUCP_BROWSER", "FROM_FILE"]
  });

  assert.deepEqual(loaded, {
    PUCP_BROWSER: "chromium",
    DEFAULT_ONLY: "yes",
    FROM_FILE: "yes"
  });
  assert.deepEqual(processValues, { PUCP_BROWSER: "chromium" });
});

test("loadEnv reports all missing required variables", async () => {
  await assert.rejects(
    loadEnv({ env: {}, required: ["PUCP_USER", "PUCP_PROFILE_DIR"] }),
    (error) =>
      error.code === "ENV_MISSING" &&
      error.missing.join(",") === "PUCP_USER,PUCP_PROFILE_DIR"
  );
});
