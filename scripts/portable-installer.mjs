import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  installPortableCore,
  normalizeInstallerFailure,
  rollbackPortableCore,
  uninstallPortableCore
} from "./lib/portable-installation.js";

const ACTIONS = new Set(["install", "update", "repair", "doctor", "rollback", "uninstall"]);
const VALUE_FLAGS = new Set(["--artifact-root", "--install-dir", "--state-dir"]);
const BOOLEAN_FLAGS = new Set(["--json", "--dry-run", "--preserve-data"]);

function defaults() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return {
    installRoot: path.join(localAppData, "Programs", "PUCP-MCP"),
    stateRoot: path.join(localAppData, "PUCP-MCP"),
    artifactRoot: path.resolve(import.meta.dirname, "..")
  };
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!ACTIONS.has(action)) {
    throw new TypeError(`action must be one of: ${[...ACTIONS].join(", ")}`);
  }
  const options = { action, ...defaults(), json: false, dryRun: false, preserveData: true };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (flag === "--json") options.json = true;
      if (flag === "--dry-run") options.dryRun = true;
      if (flag === "--preserve-data") options.preserveData = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new TypeError(`unknown installer argument: ${flag ?? ""}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${flag} requires a value`);
    if (flag === "--artifact-root") options.artifactRoot = path.resolve(value);
    if (flag === "--install-dir") options.installRoot = path.resolve(value);
    if (flag === "--state-dir") options.stateRoot = path.resolve(value);
    index += 1;
  }
  if (options.dryRun && !["install", "update", "repair"].includes(action)) {
    throw new TypeError("--dry-run is available only for install, update, or repair");
  }
  return options;
}

async function installedDoctor(installRoot) {
  const pointer = JSON.parse(await readFile(path.join(installRoot, "current.json"), "utf8"));
  const repositoryRoot = path.join(installRoot, "versions", pointer.activeVersion);
  const profilePath = path.join(pointer.stateRoot, "profiles", "default", ".env.local");
  const envText = await readFile(profilePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const doctorModule = await import(pathToFileURL(path.join(repositoryRoot, "scripts", "lib", "doctor.js")));
  return doctorModule.runDoctor({ repositoryRoot, envText });
}

function humanReport(report) {
  if (report.ok === false) return `${report.code}: ${report.detail}\nSuggested action: ${report.suggestedAction}\n`;
  const action = report.action ?? "doctor";
  const version = report.activeVersion ?? report.version ?? "";
  return `PUCP-MCP ${action} completed${version ? ` for ${version}` : ""}.\n`;
}

async function execute(options) {
  if (["install", "update", "repair"].includes(options.action)) {
    return installPortableCore({
      artifactRoot: options.artifactRoot,
      installRoot: options.installRoot,
      stateRoot: options.stateRoot,
      dryRun: options.dryRun,
      repair: options.action === "repair"
    });
  }
  if (options.action === "doctor") {
    const report = await installedDoctor(options.installRoot);
    return { ...report, action: "doctor" };
  }
  if (options.action === "rollback") {
    return { ...(await rollbackPortableCore({ installRoot: options.installRoot })), action: "rollback" };
  }
  return uninstallPortableCore({
    installRoot: options.installRoot,
    preserveData: options.preserveData
  });
}

let stage = "argument_validation";
let parsed;
try {
  parsed = parseArgs(process.argv.slice(2));
  stage = parsed.action === "doctor" ? "core_doctor" : `core_${parsed.action}`;
  const report = await execute(parsed);
  process.stdout.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : humanReport(report));
  process.exitCode = report.ok === false ? 1 : 0;
} catch (error) {
  const failure = normalizeInstallerFailure(error, { stage });
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
}
