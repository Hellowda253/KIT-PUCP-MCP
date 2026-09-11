import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { parseEnv } from "@pucp-academic-mcp/common";

const CREDENTIAL_KEYS = Object.freeze([
  "PAIDEIA_USER",
  "PAIDEIA_PASS",
  "CAMPUS_PUCP_USER",
  "CAMPUS_PUCP_PASS"
]);

const SERVER_PATHS = Object.freeze({
  campus_virtual_pucp: [
    "servers",
    "campus-virtual-pucp",
    "src",
    "server.js"
  ],
  paideia: ["servers", "paideia", "src", "server.js"],
  pucp_academic_overview: ["servers", "overview", "src", "server.js"]
});

function check(id, status, detail, code = null) {
  return code ? { id, status, detail, code } : { id, status, detail };
}

async function exists(filePath, mode = constants.F_OK) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

function browserCandidates(env, values) {
  return [
    values.PAIDEIA_CHROME_PATH,
    values.CAMPUS_PUCP_CHROME_PATH,
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] &&
      path.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA &&
      path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    env.PROGRAMFILES &&
      path.join(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    env["PROGRAMFILES(X86)"] &&
      path.join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    env.LOCALAPPDATA &&
      path.join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.platform === "darwin" &&
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    process.platform !== "win32" && "/usr/bin/google-chrome",
    process.platform !== "win32" && "/usr/bin/chromium"
  ].filter(Boolean);
}

export async function inspectLocalRuntime({
  repositoryRoot,
  envText = "",
  env = process.env
}) {
  const values = parseEnv(envText);
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  const nodeOk = Number.isInteger(major) && major >= 20;
  const dependencyFiles = [
    path.join(repositoryRoot, "node_modules", "playwright", "package.json"),
    path.join(repositoryRoot, "node_modules", "ajv", "package.json")
  ];
  const dependenciesOk = (
    await Promise.all(dependencyFiles.map((candidate) => exists(candidate)))
  ).every(Boolean);
  const browserOk = (
    await Promise.all(browserCandidates(env, values).map((candidate) => exists(candidate)))
  ).some(Boolean);
  const gitignore = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8").catch(
    () => ""
  );
  const envIgnored = gitignore
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .includes(".env.local");
  const rootWritable = await exists(repositoryRoot, constants.W_OK);

  return {
    checks: [
      check(
        "node",
        nodeOk ? "pass" : "fail",
        nodeOk ? `Node.js ${process.versions.node}` : "Node.js 20+ is required"
      ),
      check(
        "dependencies",
        dependenciesOk ? "pass" : "fail",
        dependenciesOk ? "Workspace dependencies installed" : "Run npm ci"
      ),
      check(
        "browser",
        browserOk ? "pass" : "warn",
        browserOk ? "Compatible Chrome or Edge executable found" : "Chrome or Edge was not detected",
        browserOk ? null : "browser_required"
      ),
      check(
        "env-ignore",
        envIgnored ? "pass" : "fail",
        envIgnored ? ".env.local is excluded from Git" : "Ignore .env.local before adding credentials"
      ),
      check(
        "repository-write",
        rootWritable ? "pass" : "fail",
        rootWritable ? "Repository storage is writable" : "Repository is not writable"
      )
    ]
  };
}

export async function smokeStdioServer({ id, entrypoint, repositoryRoot }) {
  if (!(await exists(entrypoint))) {
    throw new Error(`Missing server entrypoint for ${id}`);
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [entrypoint], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`MCP smoke timeout for ${id}`));
      }
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Unable to start MCP server ${id}`, { cause: error }));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`MCP server ${id} exited with code ${code}`));
        return;
      }
      try {
        const messages = stdout
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        const initialized = messages.find(({ id: messageId }) => messageId === 1);
        const listed = messages.find(({ id: messageId }) => messageId === 2);
        const toolCount = listed?.result?.tools?.length ?? 0;
        resolve({
          id,
          initialize: Boolean(initialized?.result?.protocolVersion),
          toolCount,
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        reject(new Error(`Invalid MCP response from ${id}`, { cause: error }));
      }
    });
    child.stdin.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "pucp-mcp-doctor", version: "0.4.1" }
        }
      })}\n${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      })}\n${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      })}\n`
    );
  });
}

export async function runDoctor({
  repositoryRoot,
  envText,
  live = false,
  inspectRuntime = inspectLocalRuntime,
  smokeServer = smokeStdioServer,
  liveCheck
} = {}) {
  const doctorStartedAt = Date.now();
  if (!path.isAbsolute(repositoryRoot ?? "")) {
    throw new TypeError("repositoryRoot must be absolute");
  }
  const resolvedEnvText =
    envText ??
    (await readFile(path.join(repositoryRoot, ".env.local"), "utf8").catch(
      () => ""
    ));
  const values = parseEnv(resolvedEnvText);
  const credentials = Object.fromEntries(
    CREDENTIAL_KEYS.map((key) => [key, Boolean(values[key])])
  );
  const runtime = await inspectRuntime({
    repositoryRoot,
    envText: resolvedEnvText
  });
  const checks = [...runtime.checks];
  const serverTimings = {};
  checks.push(
    check(
      "credentials",
      Object.values(credentials).some(Boolean) ? "pass" : "warn",
      Object.values(credentials).some(Boolean)
        ? "At least one local credential pair is configured"
        : "Credentials are optional until a live PUCP query"
    )
  );

  for (const [id, parts] of Object.entries(SERVER_PATHS)) {
    const serverStartedAt = Date.now();
    try {
      const result = await smokeServer({
        id,
        entrypoint: path.join(repositoryRoot, ...parts),
        repositoryRoot
      });
      const ok = result.initialize === true && result.toolCount > 0;
      serverTimings[id] = Number.isInteger(result.durationMs)
        ? result.durationMs
        : Date.now() - serverStartedAt;
      checks.push(
        check(
          `mcp:${id}`,
          ok ? "pass" : "fail",
          ok ? `${result.toolCount} tools advertised` : "MCP handshake incomplete"
        )
      );
    } catch {
      serverTimings[id] = Date.now() - serverStartedAt;
      checks.push(check(`mcp:${id}`, "fail", "MCP server did not complete handshake"));
    }
  }

  if (live) {
    if (typeof liveCheck !== "function") {
      checks.push(
        check("live", "fail", "No explicit live-check adapter was provided")
      );
    } else {
      const liveResult = await liveCheck();
      checks.push(check("live", liveResult.status, liveResult.detail));
    }
  }

  return {
    ok: checks.every(({ status }) => status !== "fail"),
    generatedAt: new Date().toISOString(),
    live,
    checks,
    credentials,
    timings: {
      totalMs: Date.now() - doctorStartedAt,
      servers: serverTimings
    }
  };
}

export function formatDoctorHuman(report) {
  const lines = [
    `PUCP-MCP doctor: ${report.ok ? "ready" : "attention required"}`,
    ...report.checks.map(
      ({ id, status, detail }) => `[${status.toUpperCase()}] ${id}: ${detail}`
    ),
    "Credentials: " +
      Object.entries(report.credentials)
        .map(([name, configured]) => `${name}=${configured ? "configured" : "missing"}`)
        .join(", ")
  ];
  return `${lines.join("\n")}\n`;
}
