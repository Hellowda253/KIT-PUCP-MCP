import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const TRANSIENT_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function renameWithRetry(source, destination, options) {
  const renameFile = options.renameFile ?? rename;
  const retryDelays = options.retryDelays ?? [0, 10, 30, 75];

  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const retryDelay = retryDelays[attempt];
      if (!TRANSIENT_RENAME_CODES.has(error?.code) || retryDelay === undefined) {
        throw error;
      }
      if (retryDelay > 0) {
        await wait(retryDelay);
      }
    }
  }
}

export async function writeJsonAtomic(filePath, value, options = {}) {
  let serialized;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch (cause) {
    const error = new TypeError("Value cannot be serialized as JSON", {
      cause
    });
    error.code = "JSON_NOT_SERIALIZABLE";
    throw error;
  }
  if (serialized === undefined) {
    const error = new TypeError("Value cannot be serialized as JSON");
    error.code = "JSON_NOT_SERIALIZABLE";
    throw error;
  }

  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`
  );

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${serialized}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await renameWithRetry(temporaryPath, destination, options);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readJsonCache(filePath, options = {}) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && Object.hasOwn(options, "fallback")) {
      return options.fallback;
    }
    throw error;
  }
}
