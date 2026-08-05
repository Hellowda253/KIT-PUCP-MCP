import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildInstallConfig,
  renderInstallConfig,
  writeInstallConfig
} from "../scripts/lib/installation-config.js";

const repositoryRoot = path.resolve("C:/PUCP MCP");

test("buildInstallConfig emits three deterministic absolute secret-free stdio servers", () => {
  const config = buildInstallConfig({
    repositoryRoot,
    nodePath: process.execPath
  });

  assert.deepEqual(Object.keys(config.mcpServers), [
    "campus_virtual_pucp",
    "paideia",
    "pucp_academic_overview"
  ]);
  for (const server of Object.values(config.mcpServers)) {
    assert.equal(path.isAbsolute(server.command), true);
    assert.equal(path.isAbsolute(server.args[0]), true);
    assert.equal("env" in server, false);
  }
  assert.doesNotMatch(
    JSON.stringify(config),
    /PASS|PASSWORD|student-secret-sentinel/iu
  );
});

test("buildInstallConfig rejects relative roots and node paths", () => {
  assert.throws(
    () => buildInstallConfig({ repositoryRoot: "PUCP-MCP" }),
    /repositoryRoot must be absolute/
  );
  assert.throws(
    () => buildInstallConfig({ repositoryRoot, nodePath: "node" }),
    /nodePath must be absolute/
  );
});

test("renderInstallConfig supports Codex, Antigravity, and both Claude clients", () => {
  const codex = renderInstallConfig({
    client: "codex",
    repositoryRoot,
    nodePath: process.execPath
  });
  assert.match(codex, /\[mcp_servers\.paideia\]/u);
  assert.match(codex, /\[mcp_servers\.campus_virtual_pucp\]/u);
  assert.match(codex, /\[mcp_servers\.pucp_academic_overview\]/u);

  for (const client of [
    "antigravity",
    "claude-code",
    "claude-desktop",
    "generic"
  ]) {
    const rendered = renderInstallConfig({
      client,
      repositoryRoot,
      nodePath: process.execPath
    });
    const parsed = JSON.parse(rendered);
    assert.equal(parsed.mcpServers.paideia.args.length, 1);
    assert.equal(
      path.isAbsolute(parsed.mcpServers.campus_virtual_pucp.args[0]),
      true
    );
  }
});

test("renderInstallConfig rejects unknown clients", () => {
  assert.throws(
    () => renderInstallConfig({ client: "unknown", repositoryRoot }),
    /Unsupported client/
  );
});

test("writeInstallConfig writes only to an explicit path", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pucp-install-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, "claude.json");

  await writeInstallConfig(outputPath, {
    client: "claude-desktop",
    repositoryRoot,
    nodePath: process.execPath
  });

  assert.deepEqual(
    JSON.parse(await readFile(outputPath, "utf8")),
    buildInstallConfig({ repositoryRoot, nodePath: process.execPath })
  );
  await assert.rejects(
    writeInstallConfig("", { client: "generic", repositoryRoot }),
    /outputPath must be explicit/
  );
});
