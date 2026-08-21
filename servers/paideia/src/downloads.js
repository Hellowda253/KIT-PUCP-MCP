import { lstat } from "node:fs/promises";
import path from "node:path";

import { resolveAllowedPath } from "@pucp-academic-mcp/common";

import { safeName } from "./text.js";

const EXTENSIONS = new Set([
  ".pdf", ".ppt", ".pptx", ".pps", ".ppsx", ".doc", ".docx",
  ".xls", ".xlsx", ".csv", ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".svg", ".bmp", ".tif", ".tiff", ".ico", ".zip", ".rar", ".7z", ".txt"
]);

const contentTypeExtensions = [
  [/pdf/i, ".pdf"],
  [/presentationml/i, ".pptx"],
  [/powerpoint/i, ".ppt"],
  [/wordprocessingml/i, ".docx"],
  [/msword/i, ".doc"],
  [/spreadsheetml/i, ".xlsx"],
  [/(?:ms-)?excel/i, ".xls"],
  [/csv/i, ".csv"],
  [/png/i, ".png"],
  [/jpe?g/i, ".jpg"],
  [/gif/i, ".gif"],
  [/webp/i, ".webp"],
  [/tiff?/i, ".tiff"],
  [/bmp/i, ".bmp"],
  [/7z/i, ".7z"],
  [/rar/i, ".rar"],
  [/zip/i, ".zip"],
  [/text\/plain/i, ".txt"]
];

const allowedMime = /^(?:application\/(?:pdf|msword|vnd\.ms-(?:powerpoint|word|excel)|vnd\.openxmlformats-officedocument\.(?:presentationml|wordprocessingml|spreadsheetml)\.[^;]+|vnd\.rar|rar|x-rar|x-rar-compressed|zip|x-zip-compressed|x-7z-compressed|csv)|text\/(?:plain|csv)|image\/(?:jpeg|png|gif|webp|svg\+xml|bmp|tiff|x-tiff|x-icon|vnd\.microsoft\.icon))(?:;|$)/i;

function dispositionName(value = "") {
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = value.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  try {
    return decodeURIComponent(encoded ?? plain ?? "");
  } catch {
    return encoded ?? plain ?? "";
  }
}

export function classifyDownload({
  url = "",
  activityType = "resource",
  contentType = "",
  contentDisposition = ""
} = {}) {
  if (["url", "forum", "page", "assignment", "quiz"].includes(activityType)) {
    return { downloadable: false, kind: activityType, extension: "" };
  }
  const name = dispositionName(contentDisposition);
  const rawExtension = path.extname(
    name || new URL(url || "https://invalid/").pathname
  ).toLowerCase();
  if (rawExtension && !EXTENSIONS.has(rawExtension)) {
    return { downloadable: false, kind: activityType, extension: "" };
  }
  let extension = rawExtension;
  if (!EXTENSIONS.has(extension)) {
    extension = contentTypeExtensions.find(([pattern]) => pattern.test(contentType))?.[1] ?? "";
  }
  const normalizedMime = contentType.trim();
  const mimeAllowed =
    normalizedMime === "" ||
    allowedMime.test(normalizedMime) ||
    (/^application\/octet-stream(?:;|$)/i.test(normalizedMime) && EXTENSIONS.has(extension));
  const downloadable = EXTENSIONS.has(extension) && mimeAllowed;
  return { downloadable, kind: activityType, extension };
}

export function sanitizeDownloadFileName(rawName, approvedExtension) {
  const extension = EXTENSIONS.has(String(approvedExtension).toLowerCase())
    ? String(approvedExtension).toLowerCase()
    : "";
  const currentExtension = path.extname(String(rawName));
  const base = safeName(path.basename(String(rawName), currentExtension));
  return `${base}${extension}`;
}

export async function resolveSafeWritePath(candidate, uniRoot) {
  let resolved;
  try {
    resolved = resolveAllowedPath(candidate, [uniRoot]);
  } catch (error) {
    if (String(error.code).toLowerCase() === "path_not_allowed") {
      error.code = "path_not_allowed";
    }
    throw error;
  }
  const root = path.resolve(uniRoot);
  try {
    if ((await lstat(root)).isSymbolicLink()) {
      const error = new Error("Paideia download root is a reparse link");
      error.code = "path_not_allowed";
      throw error;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const relative = path.relative(root, resolved);
  const segments = relative === "" ? [] : relative.split(path.sep);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        const error = new Error("Paideia download path contains a reparse link");
        error.code = "path_not_allowed";
        throw error;
      }
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
  return resolved;
}

export function courseDestination(courseName, uniRoot) {
  const resolved = validateDownloadDestination(uniRoot, uniRoot);
  return path.join(resolved, safeName(courseName || "Curso"));
}

export function materialDestination(courseName, section, courseRoot) {
  return section ? path.join(courseRoot, safeName(section)) : courseRoot;
}

export function validateDownloadDestination(candidate, uniRoot) {
  const resolved = path.resolve(candidate);
  const root = path.resolve(uniRoot);
  const relative = path.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Unsafe Paideia destination outside the configured download root");
  }
  return resolved;
}

export function createDownloadManifest({ entries = [] } = {}) {
  const rows = [...entries];
  return {
    entries: rows,
    find(candidate) {
      return rows.find((entry) =>
        entry.sourceUrl === candidate.sourceUrl ||
        (candidate.size !== undefined &&
          candidate.sha256 &&
          entry.size === candidate.size &&
          entry.sha256 === candidate.sha256)
      ) ?? null;
    },
    has(candidate) {
      return Boolean(this.find(candidate));
    },
    remove(entry) {
      const index = rows.indexOf(entry);
      if (index >= 0) rows.splice(index, 1);
    },
    add(entry) {
      if (!this.has(entry)) rows.push(entry);
      return entry;
    },
    toJSON() {
      return { entries: rows };
    }
  };
}
