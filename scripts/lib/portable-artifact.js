import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SOURCE_DIRECTORIES = Object.freeze(["packages", "servers", "skills", "config", "scripts"]);
const SOURCE_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  ".env.example",
  ".gitignore",
  "LICENSE",
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "SECURITY.md"
]);
const PRIVATE_ROOT_NAMES = new Set([
  ".git",
  "auth",
  "data",
  "downloads",
  "output",
  "remote-data",
  "remote-downloads",
  ".worktrees"
]);
const TEXT_EXTENSIONS = new Set([".json", ".md", ".txt", ".yaml", ".yml", ".toml", ".html"]);

function toPortablePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

async function physicalFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error(`portable artifact contains a symbolic link: ${toPortablePath(root, target)}`);
      if (stat.isDirectory()) await visit(target);
      else if (stat.isFile()) files.push(target);
    }
  }
  await visit(root);
  return files.sort((left, right) => toPortablePath(root, left).localeCompare(toPortablePath(root, right), "en"));
}

async function materializeLinks(root) {
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) {
        const source = await realpath(target);
        await rm(target, { recursive: true, force: true });
        await cp(source, target, { recursive: true, dereference: true });
      } else if (stat.isDirectory()) {
        await visit(target);
      }
    }
  }
  await visit(root);
}

function sourceFilter(source) {
  const parts = path.normalize(source).split(path.sep);
  return !parts.some((part) => part === "test" || part === "tests" || part === ".git");
}

async function hash(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function productionNpmInvocation({
  platform = process.platform,
  nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath
} = {}) {
  const npmArgs = ["ci", "--omit=dev", "--ignore-scripts"];
  if (platform === "win32" && npmExecPath) {
    return { command: nodePath, args: [npmExecPath, ...npmArgs] };
  }
  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    args: npmArgs
  };
}

export async function createPortableManifest({
  artifactRoot,
  version,
  runtimeDirectory
}) {
  const files = await physicalFiles(artifactRoot);
  const entries = [];
  for (const filePath of files) {
    const relativePath = toPortablePath(artifactRoot, filePath);
    if (relativePath === "portable-manifest.json") continue;
    const stat = await lstat(filePath);
    entries.push({ path: relativePath, size: stat.size, sha256: await hash(filePath) });
  }
  return {
    schemaVersion: 1,
    version,
    platform: "win32-x64",
    runtimeDirectory,
    files: entries
  };
}

export async function auditPortableTree(artifactRoot) {
  const files = await physicalFiles(artifactRoot);
  for (const filePath of files) {
    const relative = toPortablePath(artifactRoot, filePath);
    const parts = relative.split("/");
    const fileName = parts.at(-1).toLowerCase();
    const appRootName = parts[0] === "app" ? parts[1]?.toLowerCase() : null;
    if (
      fileName === ".env" ||
      fileName === ".env.local" ||
      fileName.endsWith(".log") ||
      fileName.endsWith(".bak") ||
      fileName.endsWith(".backup") ||
      (appRootName && PRIVATE_ROOT_NAMES.has(appRootName))
    ) {
      throw new Error(`portable artifact contains a private or generated path: ${relative}`);
    }
    if (TEXT_EXTENSIONS.has(path.extname(fileName)) && (await lstat(filePath)).size <= 1024 * 1024) {
      const text = await readFile(filePath, "utf8");
      if (/[A-Za-z]:\\Users\\[^\\\r\n]+\\/u.test(text)) {
        throw new Error(`portable artifact contains a local user path: ${relative}`);
      }
      if (/^(?:PAIDEIA_PASS|CAMPUS_PUCP_PASS)[ \t]*=[ \t]*[^ \t\r\n]+/imu.test(text)) {
        throw new Error(`portable artifact contains a credential assignment: ${relative}`);
      }
    }
  }
  return { ok: true, fileCount: files.length };
}

export async function buildPortableArtifact({
  repositoryRoot,
  artifactRoot,
  runtimeSource,
  runtimeDirectory,
  installDependencies = true,
  dependencySource
}) {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(artifactRoot);
  const appRoot = path.join(target, "app");
  await rm(target, { recursive: true, force: true });
  await mkdir(appRoot, { recursive: true });
  for (const relative of SOURCE_DIRECTORIES) {
    await cp(path.join(root, relative), path.join(appRoot, relative), {
      recursive: true,
      dereference: true,
      filter: sourceFilter
    });
  }
  for (const relative of SOURCE_FILES) {
    await cp(path.join(root, relative), path.join(appRoot, relative));
  }

  if (installDependencies) {
    const npm = productionNpmInvocation();
    await execFileAsync(npm.command, npm.args, {
      cwd: appRoot,
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } else {
    if (!dependencySource) throw new TypeError("dependencySource is required when dependency installation is disabled");
    await cp(path.resolve(dependencySource), path.join(appRoot, "node_modules"), {
      recursive: true,
      dereference: true
    });
  }
  await materializeLinks(path.join(appRoot, "node_modules"));

  const runtimeTarget = path.join(target, "runtime", runtimeDirectory);
  await mkdir(runtimeTarget, { recursive: true });
  await copyFile(path.join(path.resolve(runtimeSource), "node.exe"), path.join(runtimeTarget, "node.exe"));
  await cp(path.join(root, "scripts", "install.cmd"), path.join(target, "install.cmd"));
  await cp(path.join(root, "scripts", "launcher.cmd"), path.join(target, "launcher.cmd"));
  await mkdir(path.join(target, "scripts", "lib"), { recursive: true });
  await cp(path.join(root, "scripts", "portable-installer.mjs"), path.join(target, "scripts", "portable-installer.mjs"));
  await cp(
    path.join(root, "scripts", "lib", "portable-installation.js"),
    path.join(target, "scripts", "lib", "portable-installation.js")
  );

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  await auditPortableTree(target);
  const manifest = await createPortableManifest({
    artifactRoot: target,
    version: packageJson.version,
    runtimeDirectory
  });
  await writeFile(path.join(target, "portable-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
