import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function filesBelow(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function sameFile(left, right) {
  try {
    const [source, target] = await Promise.all([readFile(left), readFile(right)]);
    return source.equals(target);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function syncSkills({
  repositoryRoot,
  destinations = [],
  dryRun = false,
  force = false,
  backupRoot
}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  if (destinations.length === 0 || destinations.some((item) => !path.isAbsolute(item))) {
    throw new TypeError("At least one absolute skill destination is required");
  }
  if (backupRoot !== undefined && !path.isAbsolute(backupRoot)) {
    throw new TypeError("backupRoot must be absolute");
  }
  const sourceRoot = path.join(repositoryRoot, "skills");
  const relativeFiles = await filesBelow(sourceRoot);
  const changes = [];
  const uniqueDestinations = [...new Set(destinations.map((item) => path.resolve(item)))];
  for (const [destinationIndex, destination] of uniqueDestinations.entries()) {
    for (const relative of relativeFiles) {
      const source = path.join(sourceRoot, relative);
      const target = path.join(destination, relative);
      if (await sameFile(source, target)) continue;
      changes.push({ source, target, relative, destinationIndex, existed: await exists(target) });
    }
  }
  const conflicts = changes.filter(({ existed }) => existed);
  if (!dryRun && conflicts.length > 0 && !force) {
    throw new Error(`${conflicts.length} installed skill file(s) differ; review with --dry-run and use --force to replace them.`);
  }
  const backups = [];
  if (!dryRun) {
    const backupBatch = backupRoot
      ? path.join(backupRoot, new Date().toISOString().replaceAll(":", "-"))
      : null;
    for (const change of changes) {
      if (change.existed && backupBatch) {
        const backupPath = path.join(
          backupBatch,
          `destination-${change.destinationIndex + 1}`,
          change.relative
        );
        await mkdir(path.dirname(backupPath), { recursive: true });
        await copyFile(change.target, backupPath);
        backups.push(backupPath);
      }
      await mkdir(path.dirname(change.target), { recursive: true });
      await copyFile(change.source, change.target);
    }
  }
  return {
    dryRun,
    changed: changes.length,
    conflicts: conflicts.length,
    destinations: uniqueDestinations,
    backups,
    files: changes.map(({ target, existed }) => ({ target, existed }))
  };
}

async function pathExists(directory) {
  try {
    await readdir(directory);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function defaultSkillDestinations(target, {
  home = os.homedir(),
  exists: existsDirectory = pathExists
} = {}) {
  if (target === "codex") return [path.join(home, ".agents", "skills")];
  if (target === "antigravity") {
    const candidates = [
      path.join(home, ".gemini", "antigravity", "skills"),
      path.join(home, ".gemini", "config", "skills")
    ];
    const existing = [];
    for (const candidate of candidates) {
      if (await existsDirectory(candidate)) existing.push(candidate);
    }
    return existing.length > 0 ? existing : [candidates[0]];
  }
  if (target === "claude-code") return [path.join(home, ".claude", "skills")];
  throw new TypeError(`Unsupported skill target: ${target}`);
}
