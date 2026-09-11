import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  PORTABLE_SERVERS,
  PORTABLE_SKILLS,
  validateClientId
} from "./portable-installation.js";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function requireAbsolute(name, value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path`);
  }
  return path.normalize(value);
}

function parseJsonConfig(text) {
  const parsed = JSON.parse(text);
  if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") {
    throw new TypeError("client configuration has no mcpServers object");
  }
  return parsed.mcpServers;
}

function codexServerStatus(text, name, launcherPath, clientId) {
  const header = `[mcp_servers.${name}]`;
  const start = text.indexOf(header);
  if (start < 0) return false;
  const next = text.indexOf("\n[", start + header.length);
  const block = text.slice(start, next < 0 ? undefined : next);
  const escapedLauncher = launcherPath.replaceAll("\\", "\\\\");
  return block.includes(`command = \"${escapedLauncher}\"`) &&
    block.includes(`\"${name}\"`) &&
    block.includes("\"--client\"") &&
    block.includes(`\"${clientId}\"`);
}

export async function verifyClientIntegration({
  client,
  configPath,
  skillsDir,
  launcherPath,
  clientId
}) {
  const safeConfigPath = requireAbsolute("configPath", configPath);
  const safeSkillsDir = requireAbsolute("skillsDir", skillsDir);
  const safeLauncherPath = requireAbsolute("launcherPath", launcherPath);
  const safeClientId = validateClientId(clientId);
  const checks = [];
  checks.push({
    area: "launcher",
    id: "launcher",
    status: await exists(safeLauncherPath) ? "pass" : "fail"
  });

  let text = "";
  let jsonServers = null;
  try {
    text = await readFile(safeConfigPath, "utf8");
    if (client !== "codex") jsonServers = parseJsonConfig(text);
  } catch {
    for (const name of Object.keys(PORTABLE_SERVERS)) {
      checks.push({ area: "mcp", id: name, status: "fail" });
    }
  }
  if (text) {
    for (const name of Object.keys(PORTABLE_SERVERS)) {
      const server = jsonServers?.[name];
      const pass = client === "codex"
        ? codexServerStatus(text, name, safeLauncherPath, safeClientId)
        : server?.command === safeLauncherPath &&
          JSON.stringify(server.args) === JSON.stringify([name, "--client", safeClientId]);
      checks.push({ area: "mcp", id: name, status: pass ? "pass" : "fail" });
    }
  }

  for (const skill of PORTABLE_SKILLS) {
    checks.push({
      area: "skill",
      id: skill,
      status: await exists(path.join(safeSkillsDir, skill, "SKILL.md")) ? "pass" : "fail"
    });
  }
  checks.push({
    area: "asset",
    id: "schedule_template",
    status: await exists(path.join(safeSkillsDir, "pucp-academic", "assets", "horario-pucp.html"))
      ? "pass"
      : "fail"
  });

  const mcpFailed = checks.some(({ area, status }) => ["launcher", "mcp"].includes(area) && status === "fail");
  const skillFailed = checks.some(({ area, status }) => ["skill", "asset"].includes(area) && status === "fail");
  return {
    ok: !mcpFailed && !skillFailed,
    client,
    clientId: safeClientId,
    code: mcpFailed ? "client_config_invalid" : skillFailed ? "skill_discovery_failed" : null,
    suggestedAction: mcpFailed
      ? "restore_backup_and_merge_the_generated_fragment_again"
      : skillFailed
        ? "resync_the_complete_skill_directories"
        : null,
    checks
  };
}
