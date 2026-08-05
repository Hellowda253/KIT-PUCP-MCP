import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runDoctor } from "../scripts/lib/doctor.js";
import { renderInstallConfig } from "../scripts/lib/installation-config.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

test("agent-directed setup renders every client and verifies all MCP entrypoints", async () => {
  const rootWithSpaces = path.resolve("C:/Student Tools/PUCP MCP");
  const sentinel = "secret-sentinel";

  for (const client of [
    "codex",
    "antigravity",
    "claude-code",
    "claude-desktop"
  ]) {
    const rendered = renderInstallConfig({
      client,
      repositoryRoot: rootWithSpaces,
      nodePath: process.execPath
    });
    assert.match(rendered, /paideia/u);
    assert.match(rendered, /campus_virtual_pucp/u);
    assert.match(rendered, /pucp_academic_overview/u);
    assert.match(rendered, /Student Tools/u);
    assert.doesNotMatch(rendered, new RegExp(sentinel));
  }

  const report = await runDoctor({
    repositoryRoot,
    envText: `PAIDEIA_PASS=${sentinel}\n`
  });
  const mcpChecks = report.checks.filter(({ id }) => id.startsWith("mcp:"));
  assert.equal(mcpChecks.length, 3);
  assert.equal(mcpChecks.every(({ status }) => status === "pass"), true);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
});
