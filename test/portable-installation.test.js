import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCurrentPointer,
  buildIntegrationManifest,
  buildServerLaunch,
  detectInstalledBrowser,
  normalizeInstallerFailure,
  validateClientId
} from "../scripts/lib/portable-installation.js";

const installRoot = "C:\\Users\\Student\\AppData\\Local\\Programs\\PUCP-MCP";
const stateRoot = "C:\\Users\\Student\\AppData\\Local\\PUCP-MCP";

test("portable browser discovery accepts Chrome or Edge already installed", async () => {
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const result = await detectInstalledBrowser({
    env: { "PROGRAMFILES(X86)": "C:\\Program Files (x86)" },
    canAccess: async (candidate) => candidate === edge
  });
  assert.equal(result, edge);
});

test("portable client ids are stable path-safe identifiers", () => {
  assert.equal(validateClientId("codex"), "codex");
  assert.equal(validateClientId("claude-code_2"), "claude-code_2");
  for (const invalid of ["", "Codex", "../codex", "codex client", "a".repeat(33)]) {
    assert.throws(() => validateClientId(invalid), /client-id/u);
  }
});

test("portable launcher isolates Campus and Paideia state while Overview sees both", () => {
  const paideia = buildServerLaunch({
    server: "paideia",
    clientId: "codex",
    installRoot,
    stateRoot,
    version: "0.4.0"
  });
  const campus = buildServerLaunch({
    server: "campus_virtual_pucp",
    clientId: "codex",
    installRoot,
    stateRoot,
    version: "0.4.0"
  });
  const overview = buildServerLaunch({
    server: "pucp_academic_overview",
    clientId: "codex",
    installRoot,
    stateRoot,
    version: "0.4.0"
  });

  assert.match(paideia.entrypoint, /servers[\\/]paideia[\\/]src[\\/]server\.js$/u);
  assert.match(campus.entrypoint, /servers[\\/]campus-virtual-pucp[\\/]src[\\/]server\.js$/u);
  assert.match(overview.entrypoint, /servers[\\/]overview[\\/]src[\\/]server\.js$/u);
  assert.match(paideia.env.PUCP_DATA_DIR, /clients[\\/]codex[\\/]data[\\/]paideia$/u);
  assert.match(campus.env.PUCP_DATA_DIR, /clients[\\/]codex[\\/]data[\\/]campus-virtual-pucp$/u);
  assert.match(overview.env.PUCP_DATA_DIR, /clients[\\/]codex[\\/]data$/u);
  assert.equal(paideia.env.PUCP_PROFILE_DIR, campus.env.PUCP_PROFILE_DIR);
  assert.equal(paideia.env.PUCP_DOWNLOADS_DIR, overview.env.PUCP_DOWNLOADS_DIR);
});

test("integration manifest gives agents secret-free launcher and skill contracts", () => {
  const manifest = buildIntegrationManifest({
    version: "0.4.0",
    installRoot,
    stateRoot,
    launcherPath: `${installRoot}\\launcher.cmd`
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.skills.names, ["pucp-academic", "pucp-context", "profe-pucp"]);
  assert.match(manifest.assets.scheduleTemplate, /horario-pucp\.html$/u);
  assert.deepEqual(manifest.servers.map(({ name }) => name), [
    "paideia",
    "campus_virtual_pucp",
    "pucp_academic_overview"
  ]);
  assert.deepEqual(manifest.servers[0].args, ["paideia", "--client", "${CLIENT_ID}"]);
  assert.equal(manifest.clients.codex.mcp, "verified");
  assert.equal(manifest.clients.antigravity.skills, "verified");
  assert.equal(manifest.clients.cursor.skills, "conditional");
  assert.equal(manifest.clients.generic.skills, "conditional");
  assert.equal(/pass|password|cookie|student-secret|local-user-name/i.test(JSON.stringify(manifest)), false);
});

test("current pointer retains one rollback target and relative executable locations", () => {
  const pointer = buildCurrentPointer({
    version: "0.5.0",
    previousVersion: "0.4.0",
    runtimeDirectory: "node-v24.16.0-win-x64",
    stateRoot
  });

  assert.equal(pointer.activeVersion, "0.5.0");
  assert.equal(pointer.previousVersion, "0.4.0");
  assert.equal(pointer.runtimeRelativePath, "runtime/node-v24.16.0-win-x64/node.exe");
  assert.equal(pointer.launcherRelativePath, "versions/0.5.0/scripts/portable-launcher.mjs");
  assert.equal(pointer.stateRoot, stateRoot);
});

test("installer failures are structured and redact credentials", () => {
  const failure = normalizeInstallerFailure(
    new Error("login failed for password=secret Cookie=session-value"),
    { stage: "core_doctor", backupPath: "C:\\safe\\backup.json" }
  );

  assert.equal(failure.ok, false);
  assert.equal(failure.stage, "core_doctor");
  assert.equal(failure.backupPath, "C:\\safe\\backup.json");
  assert.equal(/secret|session-value/u.test(JSON.stringify(failure)), false);
  assert.ok(failure.code);
  assert.ok(failure.suggestedAction);
});
