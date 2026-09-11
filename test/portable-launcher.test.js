import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const launcherPath = path.join(repositoryRoot, "scripts", "portable-launcher.mjs");

function runLauncher(args, { input = "", env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcherPath, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
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
    child.stdin.end(input);
  });
}

async function portableFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp portable launcher "));
  const stateRoot = path.join(root, "private state");
  const chromePath = path.join(root, "Google", "Chrome", "Application", "chrome.exe");
  const serverPath = path.join(root, "versions", "0.4.0", "servers", "paideia", "src", "server.js");
  await mkdir(path.dirname(serverPath), { recursive: true });
  await mkdir(path.dirname(chromePath), { recursive: true });
  await writeFile(chromePath, "browser-placeholder");
  await mkdir(path.join(stateRoot, "profiles", "default"), { recursive: true });
  await writeFile(path.join(root, "current.json"), JSON.stringify({
    schemaVersion: 1,
    activeVersion: "0.4.0",
    previousVersion: null,
    runtimeRelativePath: "runtime/node-v24.16.0-win-x64/node.exe",
    launcherRelativePath: "versions/0.4.0/scripts/portable-launcher.mjs",
    stateRoot
  }));
  await writeFile(path.join(stateRoot, "profiles", "default", ".env.local"), [
    "PAIDEIA_USER=student",
    "PAIDEIA_PASS=private-password",
    `PAIDEIA_CHROME_PATH=${chromePath}`
  ].join("\n"));
  await writeFile(serverPath, `
    const result = {
      hasUser: process.env.PAIDEIA_USER === "student",
      hasPass: process.env.PAIDEIA_PASS === "private-password",
      dataDir: process.env.PUCP_DATA_DIR,
      profileDir: process.env.PUCP_PROFILE_DIR,
      downloadsDir: process.env.PUCP_DOWNLOADS_DIR,
      chromePath: process.env.PAIDEIA_CHROME_PATH
    };
    process.stdout.write(JSON.stringify(result));
  `);
  return { root, stateRoot, chromePath };
}

test("portable launcher loads the shared profile and isolated client directories", async () => {
  const fixture = await portableFixture();
  const result = await runLauncher([
    "paideia",
    "--client",
    "codex",
    "--install-root",
    fixture.root
  ], {
    env: {
      PROGRAMFILES: fixture.root,
      "PROGRAMFILES(X86)": "",
      LOCALAPPDATA: "",
      CAMPUS_PUCP_CHROME_PATH: ""
    }
  });

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hasUser, true);
  assert.equal(output.hasPass, true);
  assert.match(output.dataDir, /clients[\\/]codex[\\/]data[\\/]paideia$/u);
  assert.match(output.profileDir, /profiles[\\/]default$/u);
  assert.match(output.downloadsDir, /downloads$/u);
  assert.equal(output.chromePath, fixture.chromePath);
  assert.equal(/private-password/u.test(result.stderr), false);
});

test("portable launcher rejects unsafe client identifiers before spawning", async () => {
  const fixture = await portableFixture();
  const result = await runLauncher([
    "paideia",
    "--client",
    "../shared",
    "--install-root",
    fixture.root
  ]);

  assert.notEqual(result.code, 0);
  const failure = JSON.parse(result.stderr.trim());
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, "launcher_validation");
  assert.match(failure.detail, /client-id/u);
});
