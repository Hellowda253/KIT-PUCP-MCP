import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { renderInstallConfig } from "../scripts/lib/installation-config.js";
import { verifyClientIntegration } from "../scripts/lib/client-integration.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function skillFixture(root) {
  for (const skill of ["pucp-academic", "pucp-context", "profe-pucp"]) {
    await mkdir(path.join(root, skill), { recursive: true });
    await writeFile(path.join(root, skill, "SKILL.md"), `# ${skill}`);
  }
  await mkdir(path.join(root, "pucp-academic", "assets"), { recursive: true });
  await writeFile(path.join(root, "pucp-academic", "assets", "horario-pucp.html"), "template");
}

test("client verifier checks MCP, all skills, and the schedule asset independently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp client verify "));
  const launcherPath = path.join(root, "launcher.cmd");
  const configPath = path.join(root, "mcp.json");
  const skillsDir = path.join(root, "skills");
  await writeFile(launcherPath, "@echo off");
  await writeFile(configPath, renderInstallConfig({
    client: "generic",
    launcherPath,
    clientId: "cursor"
  }));
  await skillFixture(skillsDir);

  const report = await verifyClientIntegration({
    client: "generic",
    configPath,
    skillsDir,
    launcherPath,
    clientId: "cursor"
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.filter(({ area, status }) => area === "mcp" && status === "pass").length, 3);
  assert.equal(report.checks.filter(({ area, status }) => area === "skill" && status === "pass").length, 3);
  assert.equal(report.checks.find(({ area }) => area === "asset").status, "pass");
});

test("client verifier reports a missing asset without hiding healthy MCP entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp client missing asset "));
  const launcherPath = path.join(root, "launcher.cmd");
  const configPath = path.join(root, "mcp.json");
  const skillsDir = path.join(root, "skills");
  await writeFile(launcherPath, "@echo off");
  await writeFile(configPath, renderInstallConfig({
    client: "generic",
    launcherPath,
    clientId: "generic"
  }));
  for (const skill of ["pucp-academic", "pucp-context", "profe-pucp"]) {
    await mkdir(path.join(skillsDir, skill), { recursive: true });
    await writeFile(path.join(skillsDir, skill, "SKILL.md"), `# ${skill}`);
  }

  const report = await verifyClientIntegration({
    client: "generic",
    configPath,
    skillsDir,
    launcherPath,
    clientId: "generic"
  });
  assert.equal(report.ok, false);
  assert.equal(report.code, "skill_discovery_failed");
  assert.equal(report.checks.filter(({ area, status }) => area === "mcp" && status === "pass").length, 3);
});

test("agent-facing integration verifier emits one JSON report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp client cli "));
  const launcherPath = path.join(root, "launcher.cmd");
  const configPath = path.join(root, "mcp.json");
  const skillsDir = path.join(root, "skills");
  await writeFile(launcherPath, "@echo off");
  await writeFile(configPath, renderInstallConfig({
    client: "generic",
    launcherPath,
    clientId: "generic"
  }));
  await skillFixture(skillsDir);
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repositoryRoot, "scripts", "verify-client-integration.mjs"),
    "--client", "generic",
    "--config", configPath,
    "--skills-dir", skillsDir,
    "--launcher", launcherPath,
    "--client-id", "generic",
    "--json"
  ], { cwd: repositoryRoot, windowsHide: true });
  assert.equal(JSON.parse(stdout).ok, true);
});
