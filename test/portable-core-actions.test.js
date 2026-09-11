import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  installPortableCore,
  rollbackPortableCore,
  uninstallPortableCore,
  verifyPortableArtifact
} from "../scripts/lib/portable-installation.js";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function portableArtifact(version) {
  const root = await mkdtemp(path.join(os.tmpdir(), `pucp artifact ${version} `));
  const files = new Map([
    ["app/package.json", `${JSON.stringify({ name: "portable-test", version })}\n`],
    ["app/scripts/portable-launcher.mjs", "process.exitCode = 0;\n"],
    ["app/servers/paideia/src/server.js", "process.exitCode = 0;\n"],
    ["app/servers/campus-virtual-pucp/src/server.js", "process.exitCode = 0;\n"],
    ["app/servers/overview/src/server.js", "process.exitCode = 0;\n"],
    ["app/skills/pucp-academic/assets/horario-pucp.html", "<!doctype html><title>Horario</title>"],
    ["app/skills/pucp-context/SKILL.md", "# Context"],
    ["app/skills/profe-pucp/SKILL.md", "# Profe"],
    ["runtime/node-v24.16.0-win-x64/node.exe", "portable-node-test"],
    ["install.cmd", "@echo off\r\n"],
    ["scripts/portable-installer.mjs", "process.exitCode = 0;\n"],
    ["scripts/lib/portable-installation.js", "export {};\n"],
    ["launcher.cmd", "@echo off\r\ncall \"%~dp0current.cmd\" %*\r\n"]
  ]);
  const entries = [];
  for (const [relativePath, content] of files) {
    const target = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    entries.push({
      path: relativePath,
      size: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
  await writeFile(path.join(root, "portable-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    version,
    platform: "win32-x64",
    runtimeDirectory: "node-v24.16.0-win-x64",
    files: entries
  }, null, 2)}\n`);
  return root;
}

test("portable artifact verification checks every declared byte before installation", async () => {
  const artifactRoot = await portableArtifact("0.5.0");
  const verified = await verifyPortableArtifact(artifactRoot, { platform: "win32", arch: "x64" });
  assert.equal(verified.version, "0.5.0");
  await writeFile(path.join(artifactRoot, "app", "package.json"), "tampered");
  await assert.rejects(
    verifyPortableArtifact(artifactRoot, { platform: "win32", arch: "x64" }),
    (error) => error.code === "ARTIFACT_INTEGRITY_FAILED"
  );
});

test("dry-run describes a portable installation without writing anything", async () => {
  const artifactRoot = await portableArtifact("0.5.0");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp dry run "));
  const installRoot = path.join(sandbox, "Programs", "PUCP-MCP");
  const stateRoot = path.join(sandbox, "state");
  const result = await installPortableCore({ artifactRoot, installRoot, stateRoot, dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.version, "0.5.0");
  assert.equal(await exists(installRoot), false);
  assert.equal(await exists(stateRoot), false);
});

test("install activates a verified version and creates only private empty state", async () => {
  const artifactRoot = await portableArtifact("0.5.0");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp install "));
  const installRoot = path.join(sandbox, "Programs", "PUCP-MCP");
  const stateRoot = path.join(sandbox, "state");
  const doctorCalls = [];
  const result = await installPortableCore({
    artifactRoot,
    installRoot,
    stateRoot,
    doctor: async (options) => {
      doctorCalls.push(options);
      return { ok: true, checks: [] };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.activeVersion, "0.5.0");
  assert.equal(doctorCalls.length, 1);
  const pointer = JSON.parse(await readFile(path.join(installRoot, "current.json"), "utf8"));
  assert.equal(pointer.activeVersion, "0.5.0");
  assert.equal(pointer.previousVersion, null);
  assert.equal(await exists(path.join(installRoot, "versions", "0.5.0", "package.json")), true);
  assert.equal(await exists(path.join(installRoot, "runtime", "node-v24.16.0-win-x64", "node.exe")), true);
  assert.equal(await exists(path.join(installRoot, "install.cmd")), true);
  assert.equal(await exists(path.join(installRoot, "scripts", "portable-installer.mjs")), true);
  const currentCmd = await readFile(path.join(installRoot, "current.cmd"), "utf8");
  assert.match(currentCmd, /versions\\0\.5\.0\\scripts\\portable-launcher\.mjs/u);
  assert.match(currentCmd, /--install-root "%~dp0\."/u);
  assert.equal(await readFile(path.join(stateRoot, "profiles", "default", ".env.local"), "utf8"), "");
  const integration = JSON.parse(await readFile(path.join(installRoot, "integration-manifest.json"), "utf8"));
  assert.equal(/password|cookie|private-password/iu.test(JSON.stringify(integration)), false);
});

test("update preserves private state and keeps exactly one rollback target", async () => {
  const first = await portableArtifact("0.4.0");
  const second = await portableArtifact("0.5.0");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp update "));
  const installRoot = path.join(sandbox, "Programs", "PUCP-MCP");
  const stateRoot = path.join(sandbox, "state");
  const doctor = async () => ({ ok: true, checks: [] });
  await installPortableCore({ artifactRoot: first, installRoot, stateRoot, doctor });
  const profilePath = path.join(stateRoot, "profiles", "default", ".env.local");
  await writeFile(profilePath, "PAIDEIA_USER=student\nPAIDEIA_PASS=keep-me\n");
  await writeFile(path.join(stateRoot, "clients", "codex", "data", "cache.json"), "{}", { flush: true }).catch(async () => {
    await mkdir(path.join(stateRoot, "clients", "codex", "data"), { recursive: true });
    await writeFile(path.join(stateRoot, "clients", "codex", "data", "cache.json"), "{}");
  });

  const result = await installPortableCore({ artifactRoot: second, installRoot, stateRoot, doctor });
  const pointer = JSON.parse(await readFile(path.join(installRoot, "current.json"), "utf8"));
  assert.equal(result.activeVersion, "0.5.0");
  assert.equal(pointer.previousVersion, "0.4.0");
  assert.match(await readFile(profilePath, "utf8"), /keep-me/u);
  assert.equal(await exists(path.join(stateRoot, "clients", "codex", "data", "cache.json")), true);

  const rollback = await rollbackPortableCore({ installRoot });
  assert.equal(rollback.activeVersion, "0.4.0");
  const rolledBack = JSON.parse(await readFile(path.join(installRoot, "current.json"), "utf8"));
  assert.equal(rolledBack.previousVersion, "0.5.0");
});

test("failed doctor leaves the previously active release untouched", async () => {
  const first = await portableArtifact("0.4.0");
  const second = await portableArtifact("0.5.0");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp failed update "));
  const installRoot = path.join(sandbox, "Programs", "PUCP-MCP");
  const stateRoot = path.join(sandbox, "state");
  await installPortableCore({
    artifactRoot: first,
    installRoot,
    stateRoot,
    doctor: async () => ({ ok: true, checks: [] })
  });
  await assert.rejects(
    installPortableCore({
      artifactRoot: second,
      installRoot,
      stateRoot,
      doctor: async () => ({ ok: false, checks: [{ id: "mcp", status: "fail" }] })
    }),
    (error) => error.code === "MCP_HANDSHAKE_FAILED"
  );
  const pointer = JSON.parse(await readFile(path.join(installRoot, "current.json"), "utf8"));
  assert.equal(pointer.activeVersion, "0.4.0");
});

test("repair restores a damaged active version from the matching verified artifact", async () => {
  const artifactRoot = await portableArtifact("0.5.0");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp repair "));
  const installRoot = path.join(sandbox, "Programs", "PUCP-MCP");
  const stateRoot = path.join(sandbox, "state");
  const doctor = async () => ({ ok: true, checks: [] });
  await installPortableCore({ artifactRoot, installRoot, stateRoot, doctor });
  const packagePath = path.join(installRoot, "versions", "0.5.0", "package.json");
  await writeFile(packagePath, "damaged");

  await assert.rejects(
    installPortableCore({ artifactRoot, installRoot, stateRoot, doctor }),
    (error) => error.code === "REPAIR_SOURCE_REQUIRED"
  );
  const repaired = await installPortableCore({
    artifactRoot,
    installRoot,
    stateRoot,
    doctor,
    repair: true
  });
  assert.equal(repaired.action, "repair");
  assert.match(await readFile(packagePath, "utf8"), /portable-test/u);
});

test("uninstall removes only the marked portable core and preserves private state", async () => {
  const artifactRoot = await portableArtifact("0.5.0");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp uninstall "));
  const installRoot = path.join(sandbox, "Programs", "PUCP-MCP");
  const stateRoot = path.join(sandbox, "state");
  await installPortableCore({
    artifactRoot,
    installRoot,
    stateRoot,
    doctor: async () => ({ ok: true, checks: [] })
  });
  await writeFile(path.join(stateRoot, "profiles", "default", ".env.local"), "KEEP=yes\n");

  const result = await uninstallPortableCore({ installRoot, preserveData: true });
  assert.equal(result.ok, true);
  assert.equal(await exists(installRoot), false);
  assert.match(await readFile(path.join(stateRoot, "profiles", "default", ".env.local"), "utf8"), /KEEP=yes/u);
});
