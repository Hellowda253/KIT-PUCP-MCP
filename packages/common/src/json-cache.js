import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJsonAtomic(filePath, value) {
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
    await rename(temporaryPath, destination);
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
