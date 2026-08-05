import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

const JSON_CLIENTS = new Set([
  "antigravity",
  "claude-code",
  "claude-desktop",
  "generic"
]);

function requireAbsolute(name, value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError(`${name} must be absolute`);
  }
  return path.normalize(value);
}

function tomlString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderCodex(config) {
  return `${Object.entries(config.mcpServers)
    .map(
      ([name, server]) =>
        `[mcp_servers.${name}]\ncommand = ${tomlString(server.command)}\nargs = [${server.args
          .map(tomlString)
          .join(", ")}]`
    )
    .join("\n\n")}\n`;
}

export function buildInstallConfig({
  repositoryRoot,
  nodePath = process.execPath
} = {}) {
  const root = requireAbsolute("repositoryRoot", repositoryRoot);
  const command = requireAbsolute("nodePath", nodePath);
  return {
    mcpServers: Object.fromEntries(
      Object.entries(SERVER_PATHS).map(([name, parts]) => [
        name,
        {
          command,
          args: [path.join(root, ...parts)]
        }
      ])
    )
  };
}

export function renderInstallConfig({ client, repositoryRoot, nodePath } = {}) {
  const config = buildInstallConfig({ repositoryRoot, nodePath });
  if (client === "codex") {
    return renderCodex(config);
  }
  if (JSON_CLIENTS.has(client)) {
    return `${JSON.stringify(config, null, 2)}\n`;
  }
  throw new TypeError(`Unsupported client: ${client ?? ""}`);
}

export async function writeInstallConfig(outputPath, options) {
  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    throw new TypeError("outputPath must be explicit");
  }
  const target = path.resolve(outputPath);
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, renderInstallConfig(options), {
    encoding: "utf8",
    flag: "wx"
  });
  await rename(temporary, target);
  return target;
}

export const SUPPORTED_INSTALL_CLIENTS = Object.freeze([
  "codex",
  ...JSON_CLIENTS
]);
