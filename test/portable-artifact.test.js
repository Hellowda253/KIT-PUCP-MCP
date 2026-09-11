import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditPortableTree,
  buildPortableArtifact,
  createPortableManifest,
  productionNpmInvocation
} from "../scripts/lib/portable-artifact.js";
import { verifyPortableArtifact } from "../scripts/lib/portable-installation.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("portable production install invokes npm through Node on Windows", () => {
  const invocation = productionNpmInvocation({
    platform: "win32",
    nodePath: "C:\\Node\\node.exe",
    npmExecPath: "C:\\Node\\node_modules\\npm\\bin\\npm-cli.js"
  });
  assert.equal(invocation.command, "C:\\Node\\node.exe");
  assert.deepEqual(invocation.args, [
    "C:\\Node\\node_modules\\npm\\bin\\npm-cli.js",
    "ci",
    "--omit=dev",
    "--ignore-scripts"
  ]);
});

test("portable manifest inventories physical files deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp manifest "));
  await mkdir(path.join(root, "app"), { recursive: true });
  await writeFile(path.join(root, "app", "b.txt"), "b");
  await writeFile(path.join(root, "app", "a.txt"), "a");
  const manifest = await createPortableManifest({
    artifactRoot: root,
    version: "0.5.0",
    runtimeDirectory: "node-v24.16.0-win-x64"
  });
  assert.deepEqual(manifest.files.map(({ path: relative }) => relative), ["app/a.txt", "app/b.txt"]);
  assert.equal(manifest.files.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)), true);
});

test("portable audit rejects private files and embedded local user paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pucp audit "));
  await mkdir(path.join(root, "app"), { recursive: true });
  await writeFile(path.join(root, "app", ".env.local"), "PAIDEIA_PASS=secret");
  await assert.rejects(auditPortableTree(root), /private or generated path/iu);

  const clean = await mkdtemp(path.join(os.tmpdir(), "pucp audit content "));
  await mkdir(path.join(clean, "app"), { recursive: true });
  await writeFile(path.join(clean, "app", "readme.txt"), "C:\\Users\\private-user\\project");
  await assert.rejects(auditPortableTree(clean), /local user path/iu);
});

test("portable artifact contains materialized dependencies, skills, runtime, and entrypoints", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pucp artifact build "));
  const artifactRoot = path.join(sandbox, "KIT-PUCP-MCP");
  const runtimeSource = path.join(sandbox, "node-v24.16.0-win-x64");
  await mkdir(runtimeSource, { recursive: true });
  await cp(process.execPath, path.join(runtimeSource, "node.exe"));
  await mkdir(path.join(runtimeSource, "node_modules", "npm"), { recursive: true });
  await writeFile(path.join(runtimeSource, "node_modules", "npm", "unneeded.txt"), "not needed at runtime");

  const result = await buildPortableArtifact({
    repositoryRoot,
    artifactRoot,
    runtimeSource,
    runtimeDirectory: "node-v24.16.0-win-x64",
    installDependencies: false,
    dependencySource: path.join(repositoryRoot, "node_modules")
  });

  assert.equal(result.version, "0.4.0");
  assert.equal((await lstat(path.join(artifactRoot, "app", "node_modules", "@pucp-academic-mcp", "common"))).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(artifactRoot, "app", "skills", "pucp-academic", "assets", "horario-pucp.html"))).isFile(), true);
  assert.equal((await lstat(path.join(artifactRoot, "install.cmd"))).isFile(), true);
  assert.equal((await lstat(path.join(artifactRoot, "runtime", "node-v24.16.0-win-x64", "node.exe"))).isFile(), true);
  assert.equal(await lstat(path.join(artifactRoot, "runtime", "node-v24.16.0-win-x64", "node_modules")).then(() => true).catch(() => false), false);
  assert.equal(await readFile(path.join(artifactRoot, "app", "package.json"), "utf8").then((text) => JSON.parse(text).version), "0.4.0");
  assert.equal(await lstat(path.join(artifactRoot, "app", "packages", "common", "test")).then(() => true).catch(() => false), false);
  const verified = await verifyPortableArtifact(artifactRoot, { platform: "win32", arch: "x64" });
  assert.equal(verified.files.length > 20, true);
});
