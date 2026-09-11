import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "@pucp-academic-mcp/common";

import {
  buildServerLaunch,
  detectInstalledBrowser,
  normalizeInstallerFailure
} from "./lib/portable-installation.js";

function parseArgs(argv) {
  const [server, ...rest] = argv;
  const options = { server };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!["--client", "--install-root"].includes(flag)) {
      throw new TypeError(`unknown launcher argument: ${flag ?? ""}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${flag} requires a value`);
    }
    options[flag === "--client" ? "clientId" : "installRoot"] = value;
    index += 1;
  }
  if (!options.server) throw new TypeError("server is required");
  if (!options.clientId) throw new TypeError("--client is required");
  return options;
}

function defaultInstallRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

async function readable(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(argv) {
  const parsed = parseArgs(argv);
  const installRoot = path.resolve(parsed.installRoot || defaultInstallRoot());
  const pointerPath = path.join(installRoot, "current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  if (pointer.schemaVersion !== 1 || typeof pointer.activeVersion !== "string") {
    const error = new Error("current.json does not contain a supported active installation");
    error.code = "MCP_HANDSHAKE_FAILED";
    throw error;
  }
  const launch = buildServerLaunch({
    server: parsed.server,
    clientId: parsed.clientId,
    installRoot,
    stateRoot: pointer.stateRoot,
    version: pointer.activeVersion
  });
  if (!(await readable(launch.entrypoint))) {
    const error = new Error(`installed server entrypoint is missing: ${parsed.server}`);
    error.code = "MCP_HANDSHAKE_FAILED";
    throw error;
  }

  await Promise.all([
    mkdir(launch.cwd, { recursive: true }),
    mkdir(launch.env.PUCP_DATA_DIR, { recursive: true }),
    mkdir(launch.env.PUCP_DOWNLOADS_DIR, { recursive: true }),
    mkdir(launch.env.CAMPUS_PUCP_PRIVATE_ROOT, { recursive: true })
  ]);
  const profilePath = path.join(launch.cwd, ".env.local");
  const profileValues = parseEnv(
    await readFile(profilePath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    })
  );
  const childEnv = {
    ...profileValues,
    ...process.env,
    ...launch.env
  };
  if (profileValues.PUCP_DOWNLOADS_DIR && !process.env.PUCP_DOWNLOADS_DIR) {
    childEnv.PUCP_DOWNLOADS_DIR = path.resolve(profileValues.PUCP_DOWNLOADS_DIR);
  }
  if (!childEnv.PAIDEIA_CHROME_PATH || !childEnv.CAMPUS_PUCP_CHROME_PATH) {
    const browserPath = await detectInstalledBrowser({ env: childEnv });
    if (browserPath) {
      childEnv.PAIDEIA_CHROME_PATH ||= browserPath;
      childEnv.CAMPUS_PUCP_CHROME_PATH ||= browserPath;
    }
  }

  const child = spawn(process.execPath, [launch.entrypoint], {
    cwd: launch.cwd,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
}

main(process.argv.slice(2)).catch((error) => {
  const failure = normalizeInstallerFailure(error, { stage: "launcher_validation" });
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
});
