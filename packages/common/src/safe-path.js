import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

function normalizeRoots(allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new TypeError("allowedRoots must contain at least one path");
  }
  return allowedRoots.map((root) => path.resolve(root));
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function canonicalizePotentialPath(
  value,
  {
    existsPath = existsSync,
    realpath = (existingPath) => realpathSync.native(existingPath)
  } = {}
) {
  let existingParent = path.resolve(value);
  const missingSegments = [];

  while (!existsPath(existingParent)) {
    const parent = path.dirname(existingParent);
    if (parent === existingParent) {
      throw new Error(`Unable to find an existing parent for ${value}`);
    }
    missingSegments.unshift(path.basename(existingParent));
    existingParent = parent;
  }

  return path.resolve(realpath(existingParent), ...missingSegments);
}

function isResolvedPathAllowed(resolved, roots, fileSystem) {
  if (!roots.some((root) => isWithin(resolved, root))) {
    return false;
  }

  const canonicalCandidate = canonicalizePotentialPath(resolved, fileSystem);
  return roots.some((root) =>
    isWithin(canonicalCandidate, canonicalizePotentialPath(root, fileSystem))
  );
}

export function isPathAllowed(candidate, allowedRoots, fileSystem) {
  const roots = normalizeRoots(allowedRoots);
  return isResolvedPathAllowed(path.resolve(candidate), roots, fileSystem);
}

export function resolveAllowedPath(candidate, allowedRoots, fileSystem) {
  const roots = normalizeRoots(allowedRoots);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(roots[0], candidate);

  if (!isResolvedPathAllowed(resolved, roots, fileSystem)) {
    const error = new Error("Path is outside the configured allowlist");
    error.code = "PATH_NOT_ALLOWED";
    throw error;
  }
  return resolved;
}
