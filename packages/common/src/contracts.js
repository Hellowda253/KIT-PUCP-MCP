import { mkdir } from "node:fs/promises";
import path from "node:path";

import { writeJsonAtomic } from "./json-cache.js";

function serverDefinition(server) {
  if (!server?.id || !server.command || !Array.isArray(server.args)) {
    throw new TypeError("Each server requires id, command, and args");
  }
  const envKeys = [...new Set(server.envKeys ?? [])].sort();
  return {
    command: server.command,
    args: [...server.args],
    ...(envKeys.length === 0
      ? {}
      : {
          env: Object.fromEntries(
            envKeys.map((key) => [key, `\${${key}}`])
          )
        })
  };
}

export function buildAntigravityConfig({ servers }) {
  if (!Array.isArray(servers)) {
    throw new TypeError("servers must be an array");
  }
  const entries = [...servers]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((server) => [server.id, serverDefinition(server)]);

  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new TypeError("Server ids must be unique");
  }
  return { mcpServers: Object.fromEntries(entries) };
}

export async function writeAntigravityConfig(outputPath, options) {
  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    throw new TypeError("outputPath must be explicit");
  }
  await writeJsonAtomic(outputPath, buildAntigravityConfig(options));
}

export function buildToolContracts(tools) {
  if (!Array.isArray(tools)) {
    throw new TypeError("tools must be an array");
  }
  return [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => {
      if (!/^[a-z][a-z0-9_]*$/u.test(tool?.name ?? "")) {
        throw new TypeError("Tool names must use lowercase snake_case");
      }
      return {
        fileName: `${tool.name}.json`,
        value: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema ?? {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      };
    });
}

export async function writeToolContracts(outputDirectory, tools) {
  if (typeof outputDirectory !== "string" || outputDirectory.trim() === "") {
    throw new TypeError("outputDirectory must be explicit");
  }
  await mkdir(outputDirectory, { recursive: true });
  const contracts = buildToolContracts(tools);
  for (const contract of contracts) {
    await writeJsonAtomic(
      path.join(outputDirectory, contract.fileName),
      contract.value
    );
  }
  return contracts.map(({ fileName }) => path.join(outputDirectory, fileName));
}
