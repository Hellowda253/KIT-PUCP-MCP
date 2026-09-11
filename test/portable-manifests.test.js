import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Ajv from "ajv/dist/2020.js";

import {
  buildCurrentPointer,
  buildIntegrationManifest,
  buildReleaseManifest
} from "../scripts/lib/portable-installation.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const schemaRoot = path.join(repositoryRoot, "scripts", "schemas");

async function validator(name) {
  const schema = JSON.parse(await readFile(path.join(schemaRoot, `${name}.schema.json`), "utf8"));
  return new Ajv({ allErrors: true }).compile(schema);
}

test("portable public manifests satisfy strict versioned schemas", async () => {
  const installRoot = "C:\\Users\\Student\\AppData\\Local\\Programs\\PUCP-MCP";
  const stateRoot = "C:\\Users\\Student\\AppData\\Local\\PUCP-MCP";
  const release = buildReleaseManifest({
    version: "0.5.0",
    repository: "Hellowda253/KIT-PUCP-MCP",
    assetName: "KIT-PUCP-MCP-v0.5.0-windows-x64.zip",
    sha256: "a".repeat(64),
    size: 42_000_000,
    nodeVersion: "24.16.0"
  });
  const integration = buildIntegrationManifest({
    version: "0.5.0",
    installRoot,
    stateRoot,
    launcherPath: `${installRoot}\\launcher.cmd`
  });
  const current = buildCurrentPointer({
    version: "0.5.0",
    previousVersion: "0.4.0",
    runtimeDirectory: "node-v24.16.0-win-x64",
    stateRoot
  });
  const installState = {
    schemaVersion: 1,
    activeVersion: "0.5.0",
    previousVersion: "0.4.0",
    releases: {
      "0.5.0": { runtimeDirectory: "node-v24.16.0-win-x64", installedAt: "2026-09-10T12:00:00.000Z" }
    },
    managedClients: {},
    lastAction: "update"
  };

  for (const [name, value] of Object.entries({ release, integration, current, "install-state": installState })) {
    const validate = await validator(name);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({ ...value, unexpected: true }), false, `${name} must reject unknown fields`);
  }
});

test("release manifest uses immutable versioned GitHub asset URLs without API calls", () => {
  const release = buildReleaseManifest({
    version: "0.5.0",
    repository: "Hellowda253/KIT-PUCP-MCP",
    assetName: "KIT-PUCP-MCP-v0.5.0-windows-x64.zip",
    sha256: "b".repeat(64),
    size: 1,
    nodeVersion: "24.16.0"
  });
  assert.equal(release.assetUrl, "https://github.com/Hellowda253/KIT-PUCP-MCP/releases/download/v0.5.0/KIT-PUCP-MCP-v0.5.0-windows-x64.zip");
  assert.equal(release.checksumUrl, `${release.assetUrl}.sha256`);
  assert.equal(/api\.github\.com/u.test(JSON.stringify(release)), false);
});
