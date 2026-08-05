import { readFile } from "node:fs/promises";

function decodeQuotedValue(value, quote) {
  const body = value.slice(1, -1);
  let decoded = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const next = body[index + 1];
    if (character === "\\" && next === quote) {
      decoded += next;
      index += 1;
    } else {
      decoded += character;
    }
  }
  return decoded;
}

function decodeValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return decodeQuotedValue(value, '"');
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return decodeQuotedValue(value, "'");
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u
    );
    if (!match) {
      continue;
    }
    values[match[1]] = decodeValue(match[2]);
  }
  return values;
}

export async function loadEnv({
  filePath,
  env = process.env,
  defaults = {},
  required = []
} = {}) {
  const fileValues = filePath
    ? parseEnv(await readFile(filePath, "utf8"))
    : {};
  const values = { ...defaults, ...fileValues, ...env };
  const missing = required.filter(
    (name) => !Object.hasOwn(values, name) || values[name] === ""
  );

  if (missing.length > 0) {
    const error = new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
    error.code = "ENV_MISSING";
    error.missing = missing;
    throw error;
  }
  return values;
}
