#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareScheduleDisplayData } from "./schedule-display.mjs";
import { prepareScheduleSourceData } from "./schedule-source.mjs";

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

const EXAM_TYPES = new Set(["partial", "final", "unknown"]);
const EXAM_STATUSES = new Set(["published", "schedule_only", "not_published", "unknown"]);

function sessionRooms(session) {
  return [...new Set([
    ...(Array.isArray(session?.rooms) ? session.rooms : []),
    session?.room
  ].map((room) => String(room ?? "").trim()).filter(Boolean))];
}

export function mergeExamRoomSessions(sessions = []) {
  const merged = [];
  const examIndexes = new Map();
  for (const session of sessions) {
    if (session?.type !== "exam") {
      merged.push(session);
      continue;
    }
    const identity = JSON.stringify([
      session.examType ?? "",
      session.date ?? "",
      session.day ?? "",
      session.start ?? "",
      session.end ?? "",
      session.scheduleId ?? "",
      ...(session.courseCodes ?? []).map((code) => String(code).trim().toUpperCase()).sort()
    ]);
    const rooms = sessionRooms(session);
    const existingIndex = examIndexes.get(identity);
    if (existingIndex === undefined) {
      examIndexes.set(identity, merged.length);
      merged.push({
        ...session,
        ...(rooms.length > 0 ? { room: rooms.join(", "), rooms } : {})
      });
      continue;
    }
    const existing = merged[existingIndex];
    const combinedRooms = [...new Set([...sessionRooms(existing), ...rooms])];
    merged[existingIndex] = {
      ...existing,
      ...(combinedRooms.length > 0
        ? { room: combinedRooms.join(", "), rooms: combinedRooms }
        : {})
    };
  }
  return merged;
}

function examDateParts(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { weekday: date.getUTCDay() || 7 };
}

function validateExamMetadata(sessions) {
  const seen = new Set();
  for (const session of sessions.filter(({ type }) => type === "exam")) {
    const parts = examDateParts(session.date);
    const datePrecision = session.datePrecision ?? (parts ? "exact_date" : null);
    const weekdayOnly = datePrecision === "weekday_time_only" && !session.date;
    if (!EXAM_TYPES.has(session.examType) || (!parts && !weekdayOnly)) {
      throw validationError(
        "schedule_exam_metadata_required",
        "Every exam session requires examType and either a valid ISO date or datePrecision=weekday_time_only when the Campus schedule catalog publishes only weekday and time.",
        { session }
      );
    }
    if (parts && datePrecision === "weekday_time_only") {
      throw validationError(
        "schedule_exam_metadata_conflict",
        `Exam ${session.date} has an exact date but is marked weekday_time_only.`,
        { session }
      );
    }
    if (parts && parts.weekday !== session.day) {
      throw validationError(
        "schedule_exam_date_day_mismatch",
        `Exam date ${session.date} does not match day ${session.day}.`,
        { session }
      );
    }
    const identity = [
      session.examType,
      session.date,
      datePrecision,
      session.day,
      session.start,
      session.end,
      session.room ?? "",
      ...(session.courseCodes ?? []).map((code) => String(code).trim().toUpperCase()).sort()
    ].join("|");
    if (seen.has(identity)) {
      throw validationError(
        "schedule_exam_duplicate",
        `Duplicate exam session: ${session.date} ${session.start}-${session.end}.`,
        { session }
      );
    }
    seen.add(identity);
  }
}

export function validateDeclaredExamSessions(data) {
  validateExamMetadata(data.sessions ?? []);
  const examSessionsByCourse = new Map();
  for (const session of data.sessions.filter((item) => item?.type === "exam")) {
    for (const code of Array.isArray(session.courseCodes) ? session.courseCodes : []) {
      const normalized = String(code).trim().toLocaleUpperCase("es-PE");
      if (!normalized) continue;
      if (!examSessionsByCourse.has(normalized)) examSessionsByCourse.set(normalized, []);
      examSessionsByCourse.get(normalized).push(session);
    }
  }
  const missing = [];
  for (const course of data.courses) {
    const evidence = courseEvidence(course);
    if (!evidence.courseCode) continue;
    const normalizedCode = evidence.courseCode.toLocaleUpperCase("es-PE");
    const courseExamSessions = examSessionsByCourse.get(normalizedCode) ?? [];
    const hasExamSession = courseExamSessions.length > 0;
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

    if (!EXAM_STATUSES.has(status)) {
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
    if (status === "schedule_only") {
      if (courseExamSessions.some((session) => session.datePrecision !== "weekday_time_only" || session.date)) {
        throw validationError(
          "schedule_exam_status_conflict",
          `Course ${evidence.courseCode} is marked schedule_only but contains an exact dated exam. Use published for exact Campus dates.`,
          { courseCode: evidence.courseCode, scheduleId: evidence.scheduleId }
        );
      }
      if (!hasExamText || !hasExamSession) missing.push(evidence);
      continue;
    }
    if (courseExamSessions.some((session) => session.datePrecision === "weekday_time_only" && !session.date)) {
      throw validationError(
        "schedule_exam_status_conflict",
        `Course ${evidence.courseCode} has only weekday/time exam evidence. Use examStatus=schedule_only instead of published.`,
        { courseCode: evidence.courseCode, scheduleId: evidence.scheduleId }
      );
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
  data = prepareScheduleSourceData(data);
  if (!Array.isArray(data.courses) || !Array.isArray(data.sessions)) {
    throw new TypeError("Schedule data must contain courses and sessions arrays");
  }
  const credits = Number(data.credits ?? 0);
  if (!Number.isFinite(credits) || credits < 0) {
    throw new TypeError("Schedule credits must be a non-negative number");
  }
  validateDeclaredExamSessions(data);
  const sessions = mergeExamRoomSessions(data.sessions);
  return prepareScheduleDisplayData({
    term: String(data.term ?? ""),
    credits,
    courses: data.courses,
    sessions
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

export function defaultScheduleOutputPath(data, cwd = process.cwd()) {
  const term = String(prepareScheduleSourceData(data).term ?? "PUCP").replace(/[^0-9A-Za-z-]/gu, "");
  return path.resolve(cwd, "Horarios_PUCP", `Horario_PUCP_${term || "PUCP"}.html`);
}

async function main(args) {
  const dataPath = option(args, "--data");
  const templatePath = option(args, "--template") ?? DEFAULT_TEMPLATE;
  if (!dataPath) {
    throw new Error("Usage: render-schedule.mjs --data schedule.json [--output horario.html] [--template template.html] [--force]");
  }
  const data = JSON.parse(await readFile(path.resolve(dataPath), "utf8"));
  const outputPath = option(args, "--output") ?? defaultScheduleOutputPath(data);
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
