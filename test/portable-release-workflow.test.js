import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("package exposes portable build and verification commands", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["build:portable"], "node scripts/build-portable-release.mjs");
  assert.equal(packageJson.scripts["verify:portable"], "node --test test/portable-*.test.js");
});

test("Windows workflow tests before building and publishes only tagged releases", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "release-portable-windows.yml"),
    "utf8"
  );
  assert.match(workflow, /runs-on:\s*windows-latest/u);
  assert.match(workflow, /npm test/u);
  assert.match(workflow, /npm run build:portable/u);
  assert.match(workflow, /github\.ref_type == 'tag'/u);
  assert.match(workflow, /gh release create/u);
  assert.equal(/api\.github\.com/u.test(workflow), false);
});

test("portable builder verifies official Node checksums and emits release checksums", async () => {
  const builder = await readFile(path.join(repositoryRoot, "scripts", "build-portable-release.mjs"), "utf8");
  assert.match(builder, /SHASUMS256\.txt/u);
  assert.match(builder, /node-v\$\{nodeVersion\}-win-x64\.zip/u);
  assert.match(builder, /buildReleaseManifest/u);
  assert.match(builder, /\.sha256/u);
  assert.match(builder, /65 \* 1024 \* 1024/u);
});

test("portable install entrypoint treats its own directory as the artifact root", async () => {
  const installCmd = await readFile(path.join(repositoryRoot, "scripts", "install.cmd"), "utf8");
  assert.match(installCmd, /set "PUCP_PORTABLE_ROOT=%~dp0\."/u);
  assert.equal(/PUCP_PORTABLE_ROOT=%~dp0\.\./u.test(installCmd), false);
});
