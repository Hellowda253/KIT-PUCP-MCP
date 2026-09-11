import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repositoryRoot, "scripts", "portable-installer.mjs");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function minimalArtifact() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp cli artifact "));
  const entries = [];
  const contents = {
    "app/package.json": `${JSON.stringify({ name: "portable-cli-test", version: "0.5.0" })}\n`,
    "app/scripts/portable-launcher.mjs": "process.exitCode = 0;\n",
    "runtime/node-v24.16.0-win-x64/node.exe": "portable-node-test",
    "launcher.cmd": "@echo off\r\ncall \"%~dp0current.cmd\" %*\r\n"
  };
  for (const [relative, content] of Object.entries(contents)) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    entries.push({
      path: relative,
      size: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
  await writeFile(path.join(root, "portable-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    version: "0.5.0",
    platform: "win32-x64",
    runtimeDirectory: "node-v24.16.0-win-x64",
    files: entries
  }));
  return root;
}

test("portable installer CLI exposes a non-mutating JSON dry run", async () => {
  const artifactRoot = await minimalArtifact();
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp cli dry "));
  const installRoot = path.join(sandbox, "install");
  const stateRoot = path.join(sandbox, "state");
  const result = await runCli([
    "install",
    "--artifact-root", artifactRoot,
    "--install-dir", installRoot,
    "--state-dir", stateRoot,
    "--dry-run",
    "--json"
  ]);

  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.action, "install");
  assert.equal(await exists(installRoot), false);
  assert.equal(await exists(stateRoot), false);
});

test("portable installer CLI returns actionable JSON for invalid invocations", async () => {
  const result = await runCli(["install", "--unknown"]);
  assert.notEqual(result.code, 0);
  const report = JSON.parse(result.stderr.trim());
  assert.equal(report.ok, false);
  assert.equal(report.stage, "argument_validation");
  assert.ok(report.suggestedAction);
});

test("cmd entrypoints avoid PowerShell and preserve caller arguments", async () => {
  const installCmd = await readFile(path.join(repositoryRoot, "scripts", "install.cmd"), "utf8");
  const launcherCmd = await readFile(path.join(repositoryRoot, "scripts", "launcher.cmd"), "utf8");
  assert.equal(/powershell/iu.test(installCmd), false);
  assert.match(installCmd, /set "PUCP_PORTABLE_ROOT=%~dp0\."/u);
  assert.match(installCmd, /portable-installer\.mjs/iu);
  assert.match(installCmd, /%\*/u);
  assert.match(launcherCmd, /current\.cmd/iu);
  assert.match(launcherCmd, /%\*/u);
});
