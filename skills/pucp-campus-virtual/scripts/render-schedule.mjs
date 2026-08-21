#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareScheduleDisplayData } from "./schedule-display.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.resolve(SCRIPT_DIR, "../assets/horario-pucp.html");
const DATA_SCRIPT = /(<script id="schedule-data" type="application\/json">)[\s\S]*?(<\/script>)/;

function normalizeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Schedule data must be a JSON object");
  }
  if (!Array.isArray(data.courses) || !Array.isArray(data.sessions)) {
    throw new TypeError("Schedule data must contain courses and sessions arrays");
  }
  const credits = Number(data.credits ?? 0);
  if (!Number.isFinite(credits) || credits < 0) {
    throw new TypeError("Schedule credits must be a non-negative number");
  }
  return prepareScheduleDisplayData({
    term: String(data.term ?? ""),
    credits,
    courses: data.courses,
    sessions: data.sessions
  });
}

function serializeForHtml(data) {
  return JSON.stringify(normalizeData(data), null, 2).replaceAll("<", "\\u003c");
}

export async function renderScheduleTemplate({
  data,
  outputPath,
  templatePath = DEFAULT_TEMPLATE,
  force = true
}) {
  if (!outputPath) throw new TypeError("An outputPath is required");
  const template = await readFile(templatePath, "utf8");
  if (!DATA_SCRIPT.test(template)) {
    throw new Error("The schedule template does not contain #schedule-data");
  }
  if (!force) {
    try {
      await access(outputPath);
      throw new Error(`Output already exists: ${outputPath}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const embedded = `\n${serializeForHtml(data)}\n  `;
  const html = template.replace(DATA_SCRIPT, (_match, opening, closing) =>
    `${opening}${embedded}${closing}`
  );
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  return path.resolve(outputPath);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args) {
  const dataPath = option(args, "--data");
  const outputPath = option(args, "--output");
  const templatePath = option(args, "--template") ?? DEFAULT_TEMPLATE;
  if (!dataPath || !outputPath) {
    throw new Error("Usage: render-schedule.mjs --data schedule.json --output horario.html [--template template.html] [--force]");
  }
  const data = JSON.parse(await readFile(path.resolve(dataPath), "utf8"));
  const rendered = await renderScheduleTemplate({
    data,
    outputPath: path.resolve(outputPath),
    templatePath: path.resolve(templatePath),
    force: args.includes("--force")
  });
  process.stdout.write(`${rendered}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
