import { createHash, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PORTABLE_SERVERS = Object.freeze({
  paideia: ["servers", "paideia", "src", "server.js"],
  campus_virtual_pucp: ["servers", "campus-virtual-pucp", "src", "server.js"],
  pucp_academic_overview: ["servers", "overview", "src", "server.js"]
});

export const PORTABLE_SKILLS = Object.freeze([
  "pucp-academic",
  "pucp-context",
  "profe-pucp"
]);

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const KNOWN_FAILURES = new Map([
  ["ARTIFACT_INTEGRITY_FAILED", ["artifact_integrity_failed", false, "delete_staging_and_download_the_release_again"]],
  ["UNSUPPORTED_PLATFORM", ["unsupported_platform", false, "use_the_supported_windows_x64_release"]],
  ["BROWSER_REQUIRED", ["browser_required", true, "install_chrome_or_edge_then_run_doctor"]],
  ["CLIENT_CONFIG_INVALID", ["client_config_invalid", false, "restore_backup_and_merge_the_client_configuration_again"]],
  ["CLIENT_RESTART_REQUIRED", ["client_restart_required", true, "restart_the_client_then_verify_again"]],
  ["SKILL_DISCOVERY_FAILED", ["skill_discovery_failed", true, "verify_the_client_skill_directory_and_resync_skills"]],
  ["MCP_HANDSHAKE_FAILED", ["mcp_handshake_failed", true, "run_doctor_then_retry_integration"]],
  ["REPAIR_SOURCE_REQUIRED", ["repair_source_required", true, "download_the_same_release_and_run_repair_from_it"]],
  ["ORGANIZATION_POLICY_BLOCKED", ["organization_policy_blocked", false, "contact_the_device_administrator"]]
]);

function requireAbsolute(name, value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path`);
  }
  return path.normalize(value);
}

function requireVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new TypeError("version must be a semantic version");
  }
  return value;
}

function portableRelative(...parts) {
  return parts.join("/");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeTextAtomic(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function integrityError(detail) {
  const error = new Error(detail);
  error.code = "ARTIFACT_INTEGRITY_FAILED";
  return error;
}

function resolveArtifactPath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath === "" ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..") ||
    path.isAbsolute(relativePath)
  ) {
    throw integrityError(`unsafe artifact path: ${relativePath ?? ""}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const prefix = `${resolvedRoot}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw integrityError(`artifact path escapes its root: ${relativePath}`);
  return resolved;
}

async function hashFile(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function validatePortableManifest(manifest, { platform, arch }) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.platform !== "win32-x64" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw integrityError("portable-manifest.json has an unsupported shape");
  }
  requireVersion(manifest.version);
  if (!/^node-v[0-9A-Za-z.-]+-win-x64$/u.test(manifest.runtimeDirectory ?? "")) {
    throw integrityError("portable manifest has an invalid runtime directory");
  }
  if (platform !== "win32" || arch !== "x64") {
    const error = new Error(`portable release requires Windows x64; received ${platform}-${arch}`);
    error.code = "UNSUPPORTED_PLATFORM";
    throw error;
  }
  return manifest;
}

function currentCmd(pointer) {
  const runtime = pointer.runtimeRelativePath.replaceAll("/", "\\");
  const launcher = pointer.launcherRelativePath.replaceAll("/", "\\");
  return [
    "@echo off",
    `\"%~dp0${runtime}\" \"%~dp0${launcher}\" %* --install-root \"%~dp0.\"`,
    "exit /b %ERRORLEVEL%",
    ""
  ].join("\r\n");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function ensurePrivateState(stateRoot) {
  const profileRoot = path.join(stateRoot, "profiles", "default");
  await Promise.all([
    mkdir(profileRoot, { recursive: true }),
    mkdir(path.join(stateRoot, "clients"), { recursive: true }),
    mkdir(path.join(stateRoot, "downloads"), { recursive: true }),
    mkdir(path.join(stateRoot, "backups"), { recursive: true })
  ]);
  await writeFile(path.join(profileRoot, ".env.local"), "", {
    encoding: "utf8",
    flag: "wx"
  }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
}

async function activatePointer({ installRoot, pointer }) {
  await writeJsonAtomic(path.join(installRoot, "current.json"), pointer);
  await writeTextAtomic(path.join(installRoot, "current.cmd"), currentCmd(pointer));
}

async function pruneVersions(installRoot, keep) {
  const versionsRoot = path.join(installRoot, "versions");
  const entries = await readdir(versionsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(entry.name)) {
      continue;
    }
    await rm(path.join(versionsRoot, entry.name), { recursive: true, force: true });
  }
}

async function installedVersionMatches(versionRoot, manifest) {
  const appEntries = manifest.files.filter(({ path: relativePath }) => relativePath.startsWith("app/"));
  for (const entry of appEntries) {
    const relativePath = entry.path.slice("app/".length);
    const filePath = resolveArtifactPath(versionRoot, relativePath);
    try {
      const stat = await lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) return false;
      if (await hashFile(filePath) !== entry.sha256) return false;
    } catch {
      return false;
    }
  }
  return appEntries.length > 0;
}

async function replaceVersionDirectory({ staging, versionRoot }) {
  const displaced = `${versionRoot}.replaced-${randomUUID()}`;
  await rename(versionRoot, displaced);
  try {
    await rename(staging, versionRoot);
  } catch (error) {
    await rename(displaced, versionRoot).catch(() => {});
    throw error;
  }
  await rm(displaced, { recursive: true, force: true });
}

export function validateClientId(value) {
  if (typeof value !== "string" || !CLIENT_ID_PATTERN.test(value)) {
    throw new TypeError("client-id must match [a-z0-9][a-z0-9_-]{0,31}");
  }
  return value;
}

export async function detectInstalledBrowser({
  env = process.env,
  canAccess = async (candidate) => exists(candidate)
} = {}) {
  const candidates = [
    env.PAIDEIA_CHROME_PATH,
    env.CAMPUS_PUCP_CHROME_PATH,
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates.map((item) => path.normalize(item)))]) {
    if (await canAccess(candidate)) return candidate;
  }
  return null;
}

export function buildServerLaunch({
  server,
  clientId,
  installRoot,
  stateRoot,
  version
}) {
  if (!Object.hasOwn(PORTABLE_SERVERS, server)) {
    throw new TypeError(`unsupported portable server: ${server ?? ""}`);
  }
  const safeClientId = validateClientId(clientId);
  const safeInstallRoot = requireAbsolute("installRoot", installRoot);
  const safeStateRoot = requireAbsolute("stateRoot", stateRoot);
  const safeVersion = requireVersion(version);
  const clientDataRoot = path.join(safeStateRoot, "clients", safeClientId, "data");
  const dataRoot = server === "pucp_academic_overview"
    ? clientDataRoot
    : path.join(
        clientDataRoot,
        server === "campus_virtual_pucp" ? "campus-virtual-pucp" : "paideia"
      );

  return {
    server,
    clientId: safeClientId,
    entrypoint: path.join(safeInstallRoot, "versions", safeVersion, ...PORTABLE_SERVERS[server]),
    cwd: path.join(safeStateRoot, "profiles", "default"),
    env: {
      PUCP_PROFILE_DIR: path.join(safeStateRoot, "profiles", "default"),
      PUCP_DATA_DIR: dataRoot,
      PUCP_DOWNLOADS_DIR: path.join(safeStateRoot, "downloads"),
      CAMPUS_PUCP_PRIVATE_ROOT: path.join(safeStateRoot, "downloads", "Privado")
    }
  };
}

export function buildIntegrationManifest({
  version,
  installRoot,
  stateRoot,
  launcherPath
}) {
  const safeVersion = requireVersion(version);
  const safeInstallRoot = requireAbsolute("installRoot", installRoot);
  const safeStateRoot = requireAbsolute("stateRoot", stateRoot);
  const safeLauncherPath = requireAbsolute("launcherPath", launcherPath);
  return {
    schemaVersion: 1,
    version: safeVersion,
    installRoot: safeInstallRoot,
    stateRoot: safeStateRoot,
    clientIdPattern: CLIENT_ID_PATTERN.source,
    servers: Object.keys(PORTABLE_SERVERS).map((name) => ({
      name,
      transport: "stdio",
      command: safeLauncherPath,
      args: [name, "--client", "${CLIENT_ID}"]
    })),
    skills: {
      source: path.join(safeInstallRoot, "versions", safeVersion, "skills"),
      names: [...PORTABLE_SKILLS],
      copyMode: "recursive_with_assets"
    },
    assets: {
      scheduleTemplate: path.join(
        safeInstallRoot,
        "versions",
        safeVersion,
        "skills",
        "pucp-academic",
        "assets",
        "horario-pucp.html"
      )
    },
    clients: {
      codex: {
        mcp: "verified",
        skills: "verified",
        configHint: "~/.codex/config.toml",
        skillsHint: "~/.agents/skills"
      },
      antigravity: {
        mcp: "verified",
        skills: "verified",
        configHint: "~/.gemini/antigravity/mcp_config.json",
        skillsHint: "~/.gemini/antigravity/skills"
      },
      "claude-code": {
        mcp: "documented",
        skills: "documented",
        configHint: "claude mcp add --scope user",
        skillsHint: "~/.claude/skills"
      },
      "claude-desktop": {
        mcp: "documented",
        skills: "conditional",
        configHint: "Developer Settings",
        skillsHint: "verify client support before copying"
      },
      cursor: {
        mcp: "documented",
        skills: "conditional",
        configHint: "~/.cursor/mcp.json",
        skillsHint: "verify client support before copying"
      },
      "kimi-code": {
        mcp: "documented",
        skills: "conditional",
        configHint: "~/.kimi-code/mcp.json",
        skillsHint: "verify client support before copying"
      },
      generic: {
        mcp: "documented",
        skills: "conditional",
        configHint: "use command, args and env from this manifest",
        skillsHint: "copy only when Agent Skills are supported"
      }
    },
    privateLayout: {
      profile: path.join(safeStateRoot, "profiles", "default"),
      clientData: path.join(safeStateRoot, "clients", "${CLIENT_ID}", "data"),
      downloads: path.join(safeStateRoot, "downloads"),
      backups: path.join(safeStateRoot, "backups")
    }
  };
}

export function buildReleaseManifest({
  version,
  repository,
  assetName,
  sha256,
  size,
  nodeVersion
}) {
  const safeVersion = requireVersion(version);
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new TypeError("repository must use owner/name format");
  }
  const expectedAssetName = `KIT-PUCP-MCP-v${safeVersion}-windows-x64.zip`;
  if (assetName !== expectedAssetName) throw new TypeError(`assetName must be ${expectedAssetName}`);
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new TypeError("sha256 must contain 64 lowercase hexadecimal characters");
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > 65 * 1024 * 1024) {
    throw new TypeError("portable release size must be between 1 byte and 65 MiB");
  }
  if (typeof nodeVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(nodeVersion)) {
    throw new TypeError("nodeVersion must be an exact semantic version");
  }
  const assetUrl = `https://github.com/${repository}/releases/download/v${safeVersion}/${assetName}`;
  return {
    schemaVersion: 1,
    version: safeVersion,
    platform: "windows-x64",
    repository,
    assetName,
    assetUrl,
    checksumUrl: `${assetUrl}.sha256`,
    sha256,
    size,
    runtime: {
      name: "node",
      version: nodeVersion,
      directory: `node-v${nodeVersion}-win-x64`
    }
  };
}

export function buildCurrentPointer({
  version,
  previousVersion = null,
  runtimeDirectory,
  stateRoot
}) {
  const safeVersion = requireVersion(version);
  if (previousVersion !== null) requireVersion(previousVersion);
  if (typeof runtimeDirectory !== "string" || !/^node-v[0-9A-Za-z.-]+-win-x64$/u.test(runtimeDirectory)) {
    throw new TypeError("runtimeDirectory must name a bundled Windows x64 Node runtime");
  }
  return {
    schemaVersion: 1,
    activeVersion: safeVersion,
    previousVersion,
    runtimeRelativePath: portableRelative("runtime", runtimeDirectory, "node.exe"),
    launcherRelativePath: portableRelative("versions", safeVersion, "scripts", "portable-launcher.mjs"),
    stateRoot: requireAbsolute("stateRoot", stateRoot),
    updatedAt: new Date().toISOString()
  };
}

export async function verifyPortableArtifact(
  artifactRoot,
  { platform = process.platform, arch = process.arch } = {}
) {
  const root = requireAbsolute("artifactRoot", artifactRoot);
  let manifest;
  try {
    manifest = validatePortableManifest(
      await readJson(path.join(root, "portable-manifest.json")),
      { platform, arch }
    );
  } catch (error) {
    if (error.code === "UNSUPPORTED_PLATFORM" || error.code === "ARTIFACT_INTEGRITY_FAILED") throw error;
    throw integrityError("portable-manifest.json is missing or invalid");
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    if (
      !entry ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "") ||
      seen.has(entry.path)
    ) {
      throw integrityError(`invalid portable manifest entry: ${entry?.path ?? ""}`);
    }
    seen.add(entry.path);
    const filePath = resolveArtifactPath(root, entry.path);
    let stat;
    try {
      stat = await lstat(filePath);
    } catch {
      throw integrityError(`portable artifact file is missing: ${entry.path}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw integrityError(`portable artifact entry is not a physical file: ${entry.path}`);
    }
    if (stat.size !== entry.size || await hashFile(filePath) !== entry.sha256) {
      throw integrityError(`portable artifact file failed integrity verification: ${entry.path}`);
    }
  }
  const required = [
    "app/package.json",
    "app/scripts/portable-launcher.mjs",
    "launcher.cmd",
    `runtime/${manifest.runtimeDirectory}/node.exe`
  ];
  for (const relativePath of required) {
    if (!seen.has(relativePath)) throw integrityError(`portable artifact is missing required entry: ${relativePath}`);
  }
  return manifest;
}

async function defaultPortableDoctor({ repositoryRoot }) {
  const module = await import(pathToFileURL(path.join(repositoryRoot, "scripts", "lib", "doctor.js")));
  return module.runDoctor({ repositoryRoot, envText: "" });
}

export async function installPortableCore({
  artifactRoot,
  installRoot,
  stateRoot,
  dryRun = false,
  repair = false,
  doctor = defaultPortableDoctor,
  platform = process.platform,
  arch = process.arch
}) {
  const sourceRoot = requireAbsolute("artifactRoot", artifactRoot);
  const targetRoot = requireAbsolute("installRoot", installRoot);
  const privateRoot = requireAbsolute("stateRoot", stateRoot);
  const manifest = await verifyPortableArtifact(sourceRoot, { platform, arch });
  const existingPointer = await readJson(path.join(targetRoot, "current.json")).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      action: existingPointer ? "update" : "install",
      version: manifest.version,
      installRoot: targetRoot,
      stateRoot: privateRoot,
      previousVersion: existingPointer?.activeVersion ?? null
    };
  }

  const staging = path.join(targetRoot, "versions", `.staging-${manifest.version}-${randomUUID()}`);
  const versionRoot = path.join(targetRoot, "versions", manifest.version);
  const runtimeSource = path.join(sourceRoot, "runtime", manifest.runtimeDirectory);
  const runtimeTarget = path.join(targetRoot, "runtime", manifest.runtimeDirectory);
  await Promise.all([
    mkdir(path.dirname(staging), { recursive: true }),
    mkdir(path.dirname(runtimeTarget), { recursive: true }),
    ensurePrivateState(privateRoot)
  ]);

  try {
    await cp(path.join(sourceRoot, "app"), staging, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false
    });
    if (!(await exists(runtimeTarget))) {
      await cp(runtimeSource, runtimeTarget, {
        recursive: true,
        dereference: true,
        errorOnExist: true,
        force: false
      });
    }
    const report = await doctor({
      repositoryRoot: staging,
      stateRoot: privateRoot,
      runtimePath: path.join(runtimeTarget, "node.exe")
    });
    if (report?.ok !== true) {
      const error = new Error("portable MCP handshake failed before activation");
      error.code = "MCP_HANDSHAKE_FAILED";
      error.report = report;
      throw error;
    }

    if (!(await exists(versionRoot))) {
      await rename(staging, versionRoot);
    } else {
      const installedValid = await installedVersionMatches(versionRoot, manifest);
      if (!installedValid && !repair) {
        const error = new Error("installed version is damaged; rerun the matching release with repair");
        error.code = "REPAIR_SOURCE_REQUIRED";
        throw error;
      }
      if (!installedValid) await replaceVersionDirectory({ staging, versionRoot });
      else await rm(staging, { recursive: true, force: true });
    }
    await copyFile(path.join(sourceRoot, "launcher.cmd"), path.join(targetRoot, "launcher.cmd"));
    if (await exists(path.join(sourceRoot, "install.cmd"))) {
      await copyFile(path.join(sourceRoot, "install.cmd"), path.join(targetRoot, "install.cmd"));
    }
    if (await exists(path.join(sourceRoot, "scripts", "portable-installer.mjs"))) {
      await mkdir(path.join(targetRoot, "scripts", "lib"), { recursive: true });
      await copyFile(
        path.join(sourceRoot, "scripts", "portable-installer.mjs"),
        path.join(targetRoot, "scripts", "portable-installer.mjs")
      );
      await copyFile(
        path.join(sourceRoot, "scripts", "lib", "portable-installation.js"),
        path.join(targetRoot, "scripts", "lib", "portable-installation.js")
      );
    }
    const previousVersion = existingPointer?.activeVersion === manifest.version
      ? existingPointer?.previousVersion ?? null
      : existingPointer?.activeVersion ?? null;
    const pointer = buildCurrentPointer({
      version: manifest.version,
      previousVersion,
      runtimeDirectory: manifest.runtimeDirectory,
      stateRoot: privateRoot
    });
    const integration = buildIntegrationManifest({
      version: manifest.version,
      installRoot: targetRoot,
      stateRoot: privateRoot,
      launcherPath: path.join(targetRoot, "launcher.cmd")
    });
    const existingState = await readJson(path.join(privateRoot, "install-state.json")).catch((error) => {
      if (error.code === "ENOENT") return { schemaVersion: 1, releases: {} };
      throw error;
    });
    const installState = {
      schemaVersion: 1,
      activeVersion: manifest.version,
      previousVersion,
      releases: {
        ...(existingState.releases ?? {}),
        [manifest.version]: {
          runtimeDirectory: manifest.runtimeDirectory,
          installedAt: new Date().toISOString()
        }
      },
      managedClients: existingState.managedClients ?? {},
      lastAction: repair ? "repair" : existingPointer ? "update" : "install"
    };
    await writeJsonAtomic(path.join(targetRoot, "integration-manifest.json"), integration);
    await writeJsonAtomic(path.join(privateRoot, "install-state.json"), installState);
    await activatePointer({ installRoot: targetRoot, pointer });
    await pruneVersions(targetRoot, new Set([manifest.version, previousVersion].filter(Boolean)));
    return {
      ok: true,
      dryRun: false,
      action: installState.lastAction,
      activeVersion: manifest.version,
      previousVersion,
      installRoot: targetRoot,
      stateRoot: privateRoot,
      doctor: report,
      integrationManifest: path.join(targetRoot, "integration-manifest.json"),
      restartRequired: Boolean(existingPointer)
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function rollbackPortableCore({ installRoot }) {
  const targetRoot = requireAbsolute("installRoot", installRoot);
  const pointer = await readJson(path.join(targetRoot, "current.json"));
  if (!pointer.previousVersion) {
    const error = new Error("no previous portable version is available");
    error.code = "REPAIR_SOURCE_REQUIRED";
    throw error;
  }
  const installStatePath = path.join(pointer.stateRoot, "install-state.json");
  const installState = await readJson(installStatePath);
  const previousRelease = installState.releases?.[pointer.previousVersion];
  if (!previousRelease || !(await exists(path.join(targetRoot, "versions", pointer.previousVersion)))) {
    const error = new Error("previous portable version files are unavailable");
    error.code = "REPAIR_SOURCE_REQUIRED";
    throw error;
  }
  const nextPointer = buildCurrentPointer({
    version: pointer.previousVersion,
    previousVersion: pointer.activeVersion,
    runtimeDirectory: previousRelease.runtimeDirectory,
    stateRoot: pointer.stateRoot
  });
  const integration = buildIntegrationManifest({
    version: nextPointer.activeVersion,
    installRoot: targetRoot,
    stateRoot: pointer.stateRoot,
    launcherPath: path.join(targetRoot, "launcher.cmd")
  });
  await writeJsonAtomic(path.join(targetRoot, "integration-manifest.json"), integration);
  await writeJsonAtomic(installStatePath, {
    ...installState,
    activeVersion: nextPointer.activeVersion,
    previousVersion: nextPointer.previousVersion,
    lastAction: "rollback"
  });
  await activatePointer({ installRoot: targetRoot, pointer: nextPointer });
  return {
    ok: true,
    activeVersion: nextPointer.activeVersion,
    previousVersion: nextPointer.previousVersion,
    restartRequired: true
  };
}

export async function uninstallPortableCore({ installRoot, preserveData = true }) {
  const targetRoot = requireAbsolute("installRoot", installRoot);
  if (preserveData !== true) {
    throw new TypeError("portable uninstall always preserves private data");
  }
  const pointer = await readJson(path.join(targetRoot, "current.json"));
  if (pointer.schemaVersion !== 1 || !pointer.activeVersion || !pointer.stateRoot) {
    throw new TypeError("installRoot is not a marked PUCP-MCP portable installation");
  }
  await rm(targetRoot, { recursive: true, force: true });
  return {
    ok: true,
    action: "uninstall",
    preservedStateRoot: pointer.stateRoot,
    restartRequired: true
  };
}

function redact(text) {
  return String(text ?? "")
    .replace(/(password|pass|cookie|authorization|token|session)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/(?:camila|secret|session-value)[^\s,;]*/giu, "[redacted]");
}

export function normalizeInstallerFailure(error, {
  stage = "installation",
  backupPath = null
} = {}) {
  const [code, retryable, suggestedAction] = KNOWN_FAILURES.get(error?.code) ?? [
    "installation_incomplete",
    true,
    "run_doctor_then_retry_the_failed_stage_once"
  ];
  return {
    ok: false,
    stage,
    code,
    retryable,
    suggestedAction,
    backupPath,
    detail: redact(error?.message || "Portable installation did not complete")
  };
}
