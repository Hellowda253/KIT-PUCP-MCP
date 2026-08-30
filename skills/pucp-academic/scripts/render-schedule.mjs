#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareScheduleDisplayData } from "./schedule-display.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.resolve(SCRIPT_DIR, "../assets/horario-pucp.html");
const DATA_SCRIPT = /(<script id="schedule-data" type="application\/json">)[\s\S]*?(<\/script>)/;

function declaresExams(value) {
  if (Array.isArray(value)) return value.length > 0;
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^(?:-|—|–|n\/?a|none|no aplica|sin exámenes?)$/iu.test(text);
}

function validationError(code, message, details) {
  const error = new TypeError(message);
  error.code = code;
  error.details = details;
  return error;
}

function courseEvidence(course) {
  return {
    courseCode: String(course?.code ?? "").trim(),
    scheduleId: String(course?.scheduleId ?? "").trim(),
    sessionType: "exam"
  };
}

export function validateDeclaredExamSessions(data) {
  const coursesWithExamSessions = new Set(
    data.sessions
      .filter((session) => session?.type === "exam")
      .flatMap((session) => Array.isArray(session.courseCodes) ? session.courseCodes : [])
      .map((code) => String(code).trim().toLocaleUpperCase("es-PE"))
      .filter(Boolean)
  );
  const missing = [];
  for (const course of data.courses) {
    const evidence = courseEvidence(course);
    if (!evidence.courseCode) continue;
    const normalizedCode = evidence.courseCode.toLocaleUpperCase("es-PE");
    const hasExamSession = coursesWithExamSessions.has(normalizedCode);
    const hasExamText = declaresExams(course?.exams);
    const status = course?.examStatus;

    if (status === undefined || status === null || status === "") {
      if (!hasExamText && !hasExamSession) {
        throw validationError(
          "schedule_exam_status_required",
          `examStatus is required for ${evidence.courseCode} when exams is empty. Use not_published only when Campus explicitly confirms that no exam information is published; otherwise use unknown and call get_course_schedule_details.`,
          { courseCode: evidence.courseCode, scheduleId: evidence.scheduleId }
        );
      }
      if (!hasExamSession) missing.push(evidence);
      continue;
    }

    if (!new Set(["published", "not_published", "unknown"]).has(status)) {
      throw validationError(
        "schedule_exam_status_invalid",
        `Invalid examStatus for ${evidence.courseCode}: ${status}`,
        { courseCode: evidence.courseCode, scheduleId: evidence.scheduleId, examStatus: status }
      );
    }
    if (status === "unknown") {
      throw validationError(
        "schedule_data_incomplete",
        `Exam information is unknown for ${evidence.courseCode}. Call get_course_schedule_details and regenerate the schedule.`,
        { missing: [evidence], retryWith: "get_course_schedule_details" }
      );
    }
    if (status === "not_published") {
      if (hasExamText || hasExamSession) {
        throw validationError(
          "schedule_exam_status_conflict",
          `Course ${evidence.courseCode} is marked not_published but contains exam information. Preserve the official Campus data and use published.`,
          { courseCode: evidence.courseCode, scheduleId: evidence.scheduleId }
        );
      }
      continue;
    }
    if (!hasExamText || !hasExamSession) missing.push(evidence);
  }
  if (missing.length > 0) {
    const codes = missing.map(({ courseCode }) => courseCode);
    throw validationError(
      "schedule_data_incomplete",
      `Missing official exam sessions for ${codes.join(", ")}. Call get_course_schedule_details for the listed course and schedule, preserve every type="exam" session, and regenerate. Do not replace exams with "-" to bypass validation.`,
      { missing, retryWith: "get_course_schedule_details" }
    );
  }
}

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
  validateDeclaredExamSessions(data);
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
