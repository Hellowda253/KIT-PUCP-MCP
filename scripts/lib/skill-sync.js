import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
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
  force = false
}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  if (destinations.length === 0 || destinations.some((item) => !path.isAbsolute(item))) {
    throw new TypeError("At least one absolute skill destination is required");
  }
  const sourceRoot = path.join(repositoryRoot, "skills");
  const relativeFiles = await filesBelow(sourceRoot);
  const changes = [];
  for (const destination of [...new Set(destinations.map((item) => path.resolve(item)))]) {
    for (const relative of relativeFiles) {
      const source = path.join(sourceRoot, relative);
      const target = path.join(destination, relative);
      if (await sameFile(source, target)) continue;
      changes.push({ source, target, existed: await exists(target) });
    }
  }
  const conflicts = changes.filter(({ existed }) => existed);
  if (!dryRun && conflicts.length > 0 && !force) {
    throw new Error(`${conflicts.length} installed skill file(s) differ; review with --dry-run and use --force to replace them.`);
  }
  if (!dryRun) {
    for (const change of changes) {
      await mkdir(path.dirname(change.target), { recursive: true });
      await copyFile(change.source, change.target);
    }
  }
  return {
    dryRun,
    changed: changes.length,
    conflicts: conflicts.length,
    destinations: [...new Set(destinations.map((item) => path.resolve(item)))],
    files: changes.map(({ target, existed }) => ({ target, existed }))
  };
}
