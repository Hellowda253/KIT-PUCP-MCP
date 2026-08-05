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
      // Continue through explicitly local candidates only.
    }
  }
  return undefined;
}

export function defaultCampusPaths(env = process.env) {
  const dataRoot = path.resolve(
    env.PUCP_DATA_DIR ||
      path.join(repositoryRoot, "data", "campus-virtual-pucp")
  );
  return {
    cachePath: path.join(dataRoot, "cache.json"),
    historyPath: path.join(dataRoot, "sync-history.json"),
    manifestPath: path.join(dataRoot, "download-manifest.json"),
    schedulePath: path.join(dataRoot, "course-schedules.json"),
    preferencesPath: path.join(dataRoot, "schedule-preferences.local.json"),
    uniRoot: path.resolve(
      env.CAMPUS_PUCP_UNI_ROOT ||
        env.PUCP_DOWNLOADS_DIR ||
        path.join(repositoryRoot, "downloads", ".UNI V2")
    ),
    privateRoot: path.resolve(
      env.CAMPUS_PUCP_PRIVATE_ROOT ||
        path.join(repositoryRoot, "downloads", "PUCP Privado")
    )
  };
}

function list(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function loadCampusConfig(
  env = process.env,
  options = {}
) {
  const filePath =
    options.filePath !== undefined
      ? options.filePath || undefined
      : await firstExisting([
          path.join(process.cwd(), ".env.local"),
          path.join(repositoryRoot, ".env.local"),
          path.join(serverRoot, ".env.local")
        ]);
  const values = await loadEnv({
    filePath,
    env,
    defaults: {
      CAMPUS_PUCP_BASE_URL: "https://campusvirtual.pucp.edu.pe",
      CAMPUS_PUCP_PORTAL_URL:
        "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp",
      CAMPUS_PUCP_AGENDA_ENTRY_URL:
        "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda",
      CAMPUS_PUCP_AGENDA_JSON_URL:
        "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON",
      CAMPUS_PUCP_AUTH_HOSTS: "pandora.pucp.edu.pe",
      CAMPUS_PUCP_READ_HOSTS: "eros.pucp.edu.pe,ares.pucp.edu.pe",
      CAMPUS_PUCP_CHROME_PATH: "",
      CAMPUS_PUCP_MAX_RESPONSE_BYTES: String(50 * 1024 * 1024)
    }
  });
  const paths = defaultCampusPaths(values);
  return {
    user: values.CAMPUS_PUCP_USER || values.PAIDEIA_USER || "",
    pass: values.CAMPUS_PUCP_PASS || values.PAIDEIA_PASS || "",
    baseUrl: String(values.CAMPUS_PUCP_BASE_URL).replace(/\/+$/, ""),
    portalUrl: String(values.CAMPUS_PUCP_PORTAL_URL),
    agendaEntryUrl: String(values.CAMPUS_PUCP_AGENDA_ENTRY_URL),
    agendaJsonUrl: String(values.CAMPUS_PUCP_AGENDA_JSON_URL),
    authHosts: list(values.CAMPUS_PUCP_AUTH_HOSTS),
    readHosts: list(values.CAMPUS_PUCP_READ_HOSTS),
    chromePath:
      values.CAMPUS_PUCP_CHROME_PATH ||
      values.PAIDEIA_CHROME_PATH ||
      "",
    maxResponseBytes: Math.max(
      1,
      Number(values.CAMPUS_PUCP_MAX_RESPONSE_BYTES) || 50 * 1024 * 1024
    ),
    ...paths
  };
}
