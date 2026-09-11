import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { buildPortableArtifact } from "./lib/portable-artifact.js";
import { buildReleaseManifest } from "./lib/portable-installation.js";

const execFileAsync = promisify(execFile);
const MAX_RELEASE_BYTES = 65 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    outputDir: path.resolve("output", "portable"),
    nodeVersion: "24.16.0",
    repository: "Hellowda253/KIT-PUCP-MCP",
    keepStaging: false,
    reuseNodeModules: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (["--keep-staging", "--reuse-node-modules"].includes(flag)) {
      if (flag === "--keep-staging") options.keepStaging = true;
      if (flag === "--reuse-node-modules") options.reuseNodeModules = true;
      continue;
    }
    if (!["--output-dir", "--runtime-dir", "--node-version", "--repository"].includes(flag)) {
      throw new TypeError(`unknown portable build argument: ${flag ?? ""}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${flag} requires a value`);
    if (flag === "--output-dir") options.outputDir = path.resolve(value);
    if (flag === "--runtime-dir") options.runtimeDir = path.resolve(value);
    if (flag === "--node-version") options.nodeVersion = value;
    if (flag === "--repository") options.repository = value;
    index += 1;
  }
  if (!/^\d+\.\d+\.\d+$/u.test(options.nodeVersion)) {
    throw new TypeError("--node-version must be an exact version such as 24.16.0");
  }
  return options;
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}: ${url}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
}

async function obtainNodeRuntime({ nodeVersion, outputDir }) {
  const archiveName = `node-v${nodeVersion}-win-x64.zip`;
  const baseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
  const cacheRoot = await mkdtemp(path.join(outputDir, ".node-runtime-"));
  const archivePath = path.join(cacheRoot, archiveName);
  const checksumsPath = path.join(cacheRoot, "SHASUMS256.txt");
  await Promise.all([
    download(`${baseUrl}/${archiveName}`, archivePath),
    download(`${baseUrl}/SHASUMS256.txt`, checksumsPath)
  ]);
  const checksumLine = (await readFile(checksumsPath, "utf8"))
    .split(/\r?\n/u)
    .find((line) => line.trim().endsWith(`  ${archiveName}`));
  const expected = checksumLine?.trim().split(/\s+/u)[0];
  if (!expected || expected !== await sha256(archivePath)) {
    throw new Error("official Node runtime checksum verification failed");
  }
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  await execFileAsync(tar, ["-xf", archivePath, "-C", cacheRoot], { windowsHide: true });
  return {
    directory: path.join(cacheRoot, `node-v${nodeVersion}-win-x64`),
    cleanupRoot: cacheRoot
  };
}

async function main(argv) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("portable Windows releases must be built on Windows x64");
  }
  const options = parseArgs(argv);
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const runtimeDirectory = `node-v${options.nodeVersion}-win-x64`;
  await mkdir(options.outputDir, { recursive: true });
  let runtime = options.runtimeDir
    ? { directory: options.runtimeDir, cleanupRoot: null }
    : await obtainNodeRuntime({ nodeVersion: options.nodeVersion, outputDir: options.outputDir });
  if (path.basename(runtime.directory).toLowerCase() !== runtimeDirectory.toLowerCase()) {
    throw new TypeError(`runtime directory must be named ${runtimeDirectory}`);
  }
  await access(path.join(runtime.directory, "node.exe"));

  const assetName = `KIT-PUCP-MCP-v${packageJson.version}-windows-x64.zip`;
  const stagingName = assetName.slice(0, -4);
  const artifactRoot = path.join(options.outputDir, stagingName);
  const assetPath = path.join(options.outputDir, assetName);
  try {
    await buildPortableArtifact({
      repositoryRoot,
      artifactRoot,
      runtimeSource: runtime.directory,
      runtimeDirectory,
      installDependencies: !options.reuseNodeModules,
      dependencySource: options.reuseNodeModules ? path.join(repositoryRoot, "node_modules") : undefined
    });
    await rm(assetPath, { force: true });
    await execFileAsync("tar.exe", ["-a", "-cf", assetPath, "-C", artifactRoot, "."], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    const size = (await stat(assetPath)).size;
    if (size > MAX_RELEASE_BYTES) {
      throw new Error(`portable ZIP exceeds 65 MiB: ${size} bytes`);
    }
    const digest = await sha256(assetPath);
    const releaseManifest = buildReleaseManifest({
      version: packageJson.version,
      repository: options.repository,
      assetName,
      sha256: digest,
      size,
      nodeVersion: options.nodeVersion
    });
    await writeFile(path.join(options.outputDir, `${assetName}.sha256`), `${digest}  ${assetName}\n`);
    await writeFile(path.join(options.outputDir, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      assetPath,
      checksumPath: `${assetPath}.sha256`,
      manifestPath: path.join(options.outputDir, "release-manifest.json"),
      size,
      sha256: digest
    }, null, 2)}\n`);
  } finally {
    if (!options.keepStaging) await rm(artifactRoot, { recursive: true, force: true });
    if (runtime.cleanupRoot) await rm(runtime.cleanupRoot, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: "portable_build_failed", detail: error.message })}\n`);
  process.exitCode = 1;
});
