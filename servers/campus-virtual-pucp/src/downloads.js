import { createHash } from "node:crypto";
import { access, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  readJsonCache,
  resolveAllowedPath,
  writeJsonAtomic
} from "@pucp-academic-mcp/common";

import { safeName, searchableText } from "./text.js";

const EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
  ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".txt", ".zip"
]);
const MIME_EXTENSION = [
  [/^application\/pdf(?:;|$)/i, ".pdf"],
  [/wordprocessingml/i, ".docx"],
  [/^application\/msword(?:;|$)/i, ".doc"],
  [/spreadsheetml/i, ".xlsx"],
  [/(?:ms-)?excel/i, ".xls"],
  [/^text\/csv(?:;|$)/i, ".csv"],
  [/^text\/plain(?:;|$)/i, ".txt"],
  [/^image\/jpe?g(?:;|$)/i, ".jpg"],
  [/^image\/png(?:;|$)/i, ".png"],
  [/^image\/tiff?(?:;|$)/i, ".tiff"],
  [/^application\/(?:zip|x-zip-compressed)(?:;|$)/i, ".zip"]
];
const ALLOWED_MIME =
  /^(?:application\/(?:pdf|msword|vnd\.ms-(?:word|excel)|vnd\.openxmlformats-officedocument\.(?:wordprocessingml|spreadsheetml)\.[^;]+|zip|x-zip-compressed)|text\/(?:plain|csv)|image\/(?:jpeg|png|tiff))(?:;|$)/i;
const manifestLocks = new Map();

function downloadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function dispositionName(value = "") {
  const encoded = String(value).match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = String(value).match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  try {
    return decodeURIComponent(encoded ?? plain ?? "");
  } catch {
    return encoded ?? plain ?? "";
  }
}

export function classifyCampusDownload({
  url = "",
  contentType = "",
  contentDisposition = ""
} = {}) {
  const name = dispositionName(contentDisposition);
  const rawExtension = path.extname(
    name || new URL(url || "https://invalid/").pathname
  ).toLowerCase();
  if (rawExtension && !EXTENSIONS.has(rawExtension)) {
    return { downloadable: false, extension: "" };
  }
  const extension = EXTENSIONS.has(rawExtension)
    ? rawExtension
    : MIME_EXTENSION.find(([pattern]) => pattern.test(contentType))?.[1] ?? "";
  const mime = String(contentType).trim();
  const mimeAllowed =
    ALLOWED_MIME.test(mime) ||
    (/^application\/octet-stream(?:;|$)/i.test(mime) && EXTENSIONS.has(extension));
  return {
    downloadable: EXTENSIONS.has(extension) && mimeAllowed,
    extension: EXTENSIONS.has(extension) && mimeAllowed ? extension : ""
  };
}

function inferCourse(document) {
  const title = String(document.title ?? "");
  const match = title.match(
    /(?:programa\s+anal[ií]tico|s[ií]labo|sumilla)(?:\s+del?\s+curso)?\s+de\s+(.+)$/i
  );
  return safeName(match?.[1] ?? "Campus Virtual");
}

export function routeDocumentDestination(document, {
  uniRoot,
  privateRoot
}) {
  if (document.sensitivity === "academic") {
    return path.join(
      path.resolve(uniRoot),
      inferCourse(document),
      "CAMPUS NUEVO"
    );
  }
  if (document.sensitivity === "private") {
    return path.join(
      path.resolve(privateRoot),
      safeName(document.category || "Documentos")
    );
  }
  throw downloadError(
    "document_not_downloadable",
    "Campus document has no trusted cached sensitivity classification"
  );
}

export async function resolveSafeCampusWritePath(candidate, allowedRoots) {
  let resolved;
  try {
    resolved = resolveAllowedPath(candidate, allowedRoots);
  } catch (error) {
    if (String(error.code).toLowerCase() === "path_not_allowed") {
      error.code = "path_not_allowed";
    }
    throw error;
  }
  for (const rootValue of allowedRoots) {
    const root = path.resolve(rootValue);
    const relative = path.relative(root, resolved);
    if (
      relative !== "" &&
      (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
    ) {
      continue;
    }
    try {
      if ((await lstat(root)).isSymbolicLink()) {
        throw downloadError("path_not_allowed", "Campus download root is a reparse link");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let current = root;
    for (const segment of relative === "" ? [] : relative.split(path.sep)) {
      current = path.join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw downloadError(
            "path_not_allowed",
            "Campus download path contains a reparse link"
          );
        }
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
    }
    return resolved;
  }
  throw downloadError("path_not_allowed", "Campus path is outside approved roots");
}

export function createCampusDownloadManifest({ entries = [] } = {}) {
  const rows = [...entries];
  return {
    entries: rows,
    hasUrl(sourceUrl) {
      return rows.some((entry) => entry.sourceUrl === sourceUrl);
    },
    hasContent({ size, sha256 }) {
      return rows.some((entry) => entry.size === size && entry.sha256 === sha256);
    },
    add(entry) {
      if (!this.hasUrl(entry.sourceUrl) && !this.hasContent(entry)) rows.push(entry);
      return entry;
    },
    toJSON() {
      return { entries: rows };
    }
  };
}

function safeFileName(rawName, extension) {
  const current = path.extname(String(rawName));
  return `${safeName(path.basename(String(rawName), current))}${extension}`;
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export function createCampusDocumentDownloader({
  uniRoot,
  privateRoot,
  manifestPath,
  policy,
  fetchDocument,
  maxResponseBytes = 50 * 1024 * 1024,
  now = () => new Date().toISOString()
}) {
  if (!uniRoot || !privateRoot || !manifestPath || !policy || !fetchDocument) {
    throw new TypeError("Campus downloader requires roots, manifest, policy, and fetch boundary");
  }

  function serialized(operation) {
    const previous = manifestLocks.get(manifestPath) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    manifestLocks.set(manifestPath, queued);
    return previous
      .then(operation, operation)
      .finally(() => {
        release();
        if (manifestLocks.get(manifestPath) === queued) {
          manifestLocks.delete(manifestPath);
        }
      });
  }

  async function download(document) {
    return serialized(async () => {
      if (!document?.downloadable || !document.href) {
        throw downloadError(
          "document_not_downloadable",
          "Campus document is not marked downloadable in the local cache"
        );
      }
      policy.assertRequest(document.href);
      const stored = await readJsonCache(manifestPath, {
        fallback: { entries: [] }
      });
      const manifest = createCampusDownloadManifest(stored);
      if (manifest.hasUrl(document.href)) {
        return {
          status: "skipped",
          reason: "source_url_seen",
          sourceUrl: document.href
        };
      }
      const response = await fetchDocument(document.href);
      if (Number(response.status) < 200 || Number(response.status) >= 300) {
        throw downloadError("download_failed", "Campus document returned a non-success status");
      }
      policy.assertFinalUrl(response.finalUrl || document.href);
      const headers = Object.fromEntries(
        Object.entries(response.headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          String(value)
        ])
      );
      const declared = Number(headers["content-length"] || 0);
      if (declared > maxResponseBytes) {
        throw downloadError("document_too_large", "Campus document exceeds the size limit");
      }
      const body = Buffer.from(response.body ?? []);
      if (body.length > maxResponseBytes) {
        throw downloadError("document_too_large", "Campus document exceeds the size limit");
      }
      const classification = classifyCampusDownload({
        url: response.finalUrl || document.href,
        contentType: headers["content-type"] || "",
        contentDisposition: headers["content-disposition"] || ""
      });
      if (!classification.downloadable) {
        throw downloadError(
          "document_not_downloadable",
          "Campus response is not an approved document type"
        );
      }
      const sha256 = createHash("sha256").update(body).digest("hex");
      const identity = { size: body.length, sha256 };
      if (manifest.hasContent(identity)) {
        return {
          status: "skipped",
          reason: "duplicate_content",
          sourceUrl: document.href,
          ...identity
        };
      }
      const destination = routeDocumentDestination(document, {
        uniRoot,
        privateRoot
      });
      const safeDestination = await resolveSafeCampusWritePath(destination, [
        uniRoot,
        privateRoot
      ]);
      await mkdir(safeDestination, { recursive: true });
      const rawName =
        dispositionName(headers["content-disposition"]) ||
        path.basename(new URL(response.finalUrl || document.href).pathname) ||
        document.title;
      const target = await resolveSafeCampusWritePath(
        path.join(safeDestination, safeFileName(rawName, classification.extension)),
        [uniRoot, privateRoot]
      );
      if (await exists(target)) {
        return {
          status: "skipped",
          reason: "already_exists",
          sourceUrl: document.href,
          path: target
        };
      }
      await writeFile(target, body, { flag: "wx" });
      const entry = {
        sourceUrl: document.href,
        path: target,
        ...identity,
        downloadedAt: now()
      };
      manifest.add(entry);
      await writeJsonAtomic(manifestPath, manifest.toJSON());
      return { status: "downloaded", ...entry };
    });
  }

  return { download };
}
