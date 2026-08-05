import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "@pucp-academic-mcp/common";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(serverRoot, "../..");

async function firstExisting(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next explicitly local candidate.
    }
  }
  return undefined;
}

export function defaultPaideiaPaths(env = process.env) {
  const dataRoot = path.resolve(
    env.PUCP_DATA_DIR || path.join(repositoryRoot, "data", "paideia")
  );
  return {
    cachePath: path.join(dataRoot, "cache.json"),
    historyPath: path.join(dataRoot, "sync-history.json"),
    manifestPath: path.join(dataRoot, "download-manifest.json"),
    uniRoot: path.resolve(
      env.PUCP_DOWNLOADS_DIR || path.join(repositoryRoot, "downloads", ".UNI V2")
    )
  };
}

export async function loadPaideiaConfig(env = process.env) {
  const filePath = await firstExisting([
    path.join(process.cwd(), ".env.local"),
    path.join(repositoryRoot, ".env.local"),
    path.join(serverRoot, ".env.local")
  ]);
  const values = await loadEnv({
    filePath,
    env,
    defaults: {
      PAIDEIA_BASE_URL: "https://paideiacursos.pucp.edu.pe",
      PAIDEIA_CONTINUING_BASE_URL: "https://paideiaprogramas.pucp.edu.pe",
      PAIDEIA_CHROME_PATH: "",
      PAIDEIA_AUTH_HOSTS: "pandora.pucp.edu.pe",
      PAIDEIA_MAX_RESPONSE_BYTES: String(100 * 1024 * 1024)
    }
  });
  return {
    user: values.PAIDEIA_USER || "",
    pass: values.PAIDEIA_PASS || "",
    baseUrl: String(values.PAIDEIA_BASE_URL).replace(/\/+$/, ""),
    continuingBaseUrl: String(values.PAIDEIA_CONTINUING_BASE_URL)
      .replace(/\/+$/, ""),
    chromePath: values.PAIDEIA_CHROME_PATH || "",
    authHosts: String(values.PAIDEIA_AUTH_HOSTS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    maxResponseBytes: Math.max(
      1,
      Number(values.PAIDEIA_MAX_RESPONSE_BYTES) || 100 * 1024 * 1024
    )
  };
}
