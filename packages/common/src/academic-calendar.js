import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { McpToolError } from "./errors.js";
import { readJsonCache, writeJsonAtomic } from "./json-cache.js";

const TIME_ZONE = "America/Lima";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const daySchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const textSchema = { type: "string", minLength: 1, maxLength: 200 };
const calendarSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "term", "program", "kind", "startDate", "endDate", "courseKeys", "source"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" },
    term: textSchema, program: textSchema,
    kind: { type: "string", enum: ["regular", "summer", "intensive", "continuing"] },
    startDate: daySchema, endDate: daySchema,
    courseKeys: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: textSchema },
    source: {
      type: "object", additionalProperties: false, required: ["url", "title", "evidence"],
      properties: {
        url: { type: "string", maxLength: 1000 }, title: textSchema,
        evidence: { type: "string", minLength: 10, maxLength: 1500 }
      }
    },
    weeks: {
      type: "array", minItems: 1, maxItems: 60,
      items: {
        type: "object", additionalProperties: false, required: ["number", "start", "end"],
        properties: { number: { type: "integer", minimum: 1, maximum: 60 }, start: daySchema, end: daySchema }
      }
    }
  }
};
const validateSchema = new Ajv({ strict: true }).compile(calendarSchema);
const invalid = () => new McpToolError("academic_calendar_invalid", "Check calendar dates, non-overlapping weeks, course scope and a public HTTPS PUCP source without query, fragment or credentials.");
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) throw invalid();
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid();
  return value;
}

function validatedCalendar(value) {
  if (!validateSchema(value)) throw invalid();
  const record = structuredClone(value);
  validDate(record.startDate);
  validDate(record.endDate);
  if (record.startDate > record.endDate ||
      Date.parse(record.endDate) - Date.parse(record.startDate) > 370 * 86400000) throw invalid();
  let url;
  try { url = new URL(record.source.url); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port ||
      !(url.hostname === "pucp.edu.pe" || url.hostname.endsWith(".pucp.edu.pe")) ||
      /\/(?:pucp|pluginfile\.php|login|auth)(?:\/|$)/iu.test(url.pathname)) throw invalid();
  record.source.url = url.href;
  const numbers = new Set();
  let priorEnd = "";
  if (record.weeks) {
    record.weeks.sort((a, b) => a.start.localeCompare(b.start));
    for (const week of record.weeks) {
      validDate(week.start); validDate(week.end);
      if (week.start > week.end || week.start < record.startDate || week.end > record.endDate ||
          week.start <= priorEnd || numbers.has(week.number)) throw invalid();
      numbers.add(week.number); priorEnd = week.end;
    }
  }
  return record;
}

function liveDate(instant) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new McpToolError("server_clock_invalid", "Server clock is invalid");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function weekAt(record, date) {
  if (date < record.startDate) return { state: "before_classes", week: null };
  if (date > record.endDate) return { state: "after_classes", week: null };
  if (record.weeks) {
    const match = record.weeks.find((week) => week.start <= date && week.end >= date);
    return { state: match ? "available" : "week_not_defined", week: match?.number ?? null };
  }
  return { state: "available", week: 1 + Math.floor((Date.parse(date) - Date.parse(record.startDate)) / (7 * 86400000)) };
}

function contextFor(records, options, instant) {
  const currentDate = liveDate(instant);
  const referenceDate = options.date ? validDate(options.date) : currentDate;
  const base = { queriedAt: instant, timeZone: TIME_ZONE, currentDate, referenceDate,
    currentWeek: null, referenceWeek: null, state: "calendar_unavailable",
    guidance: "Use a verified calendar and explicit week labels; never infer the current section from display order. A matching week is not proof of actual teaching progress." };
  const keys = [options.course, ...(options.courseKeys ?? [])].filter(Boolean).map(normalize);
  if (!keys.length && !options.calendarId && !options.program) return { ...base, state: "scope_required" };
  let matches = records.filter((record) =>
    (!options.calendarId || record.id === options.calendarId) &&
    (!options.term || normalize(record.term) === normalize(options.term)) &&
    (!options.program || normalize(record.program) === normalize(options.program)) &&
    (!keys.length || record.courseKeys.some((key) => keys.includes(normalize(key))))
  );
  const inRange = matches.filter((record) => record.startDate <= referenceDate && record.endDate >= referenceDate);
  if (inRange.length) matches = inRange;
  if (matches.length !== 1) return { ...base, state: matches.length ? "calendar_ambiguous" : "calendar_unavailable" };
  const record = matches[0];
  const current = weekAt(record, currentDate), target = weekAt(record, referenceDate);
  return { ...base, state: target.state, currentState: current.state,
    calendarId: record.id, term: record.term, program: record.program, kind: record.kind,
    startDate: record.startDate, endDate: record.endDate,
    currentWeek: current.week, referenceWeek: target.week,
    weekBasis: record.weeks ? "published_intervals" : "calculated_from_start",
    source: record.source,
    calendarAgeSeconds: Math.max(0, Math.floor((Date.parse(instant) - Date.parse(record.source.recordedAt)) / 1000))
  };
}

export function createAcademicCalendarStore({
  filePath = path.join(process.env.PUCP_DATA_DIR || path.join(root, "data"), "academic-calendars.json"),
  now = () => new Date().toISOString()
} = {}) {
  let queue = Promise.resolve();
  async function read() {
    const value = await readJsonCache(filePath, { fallback: { calendars: [] } });
    if (!Array.isArray(value?.calendars)) throw invalid();
    return value.calendars.map((record) => {
      const { recordedAt, verification, ...source } = record.source ?? {};
      const validated = validatedCalendar({ ...record, source });
      if (!Number.isFinite(Date.parse(recordedAt))) throw invalid();
      return { ...validated, source: { ...validated.source, recordedAt, verification: "agent_reported" } };
    });
  }
  async function save({ calendar }) {
    const record = validatedCalendar(calendar);
    const operation = queue.catch(() => {}).then(async () => {
      const calendars = await read();
      const saved = { ...record, source: { ...record.source, recordedAt: now(), verification: "agent_reported" } };
      await writeJsonAtomic(filePath, { calendars: [...calendars.filter(({ id }) => id !== saved.id), saved] });
      return { state: "saved", calendar: saved, guidance: "Stored locally only. Source verification was reported by the caller, not independently performed by the server." };
    });
    queue = operation;
    return operation;
  }
  async function context(options = {}) {
    try { return contextFor(await read(), options, now()); }
    catch (error) {
      if (error.code === "server_clock_invalid") throw error;
      if (options.date) validDate(options.date);
      return { ...contextFor([], options, now()), state: "calendar_unavailable", reason: "calendar_store_invalid" };
    }
  }
  async function list(options = {}) {
    const records = await read();
    const instant = now();
    return { ...contextFor(records, options, instant), calendars: records.map((record) => ({
      ...record, timing: contextFor([record], { calendarId: record.id, date: options.date }, instant)
    })) };
  }
  async function snapshot() {
    const instant = now();
    let records;
    try { records = await read(); } catch {
      return { context: (options) => ({ ...contextFor([], options, instant), state: "calendar_unavailable", reason: "calendar_store_invalid" }), calendars: [] };
    }
    return {
      context: (options) => contextFor(records, options, instant),
      calendars: records.map(({ id }) => contextFor(records, { calendarId: id }, instant))
    };
  }
  return { save, context, list, snapshot };
}

function sectionMatches(title, week) {
  if (!Number.isInteger(week)) return false;
  const match = String(title ?? "").match(/\bsemanas?\s+(\d{1,2})(?:\s*(y|a|al|hasta|[-–])\s*(\d{1,2}))?\b/iu);
  if (!match) return false;
  const first = Number(match[1]), last = match[3] ? Number(match[3]) : first;
  return match[2]?.toLowerCase() === "y" ? week === first || week === last : week >= first && week <= last;
}

const TEMPORAL_TOOLS = new Set([
  "get_course_outline", "search_materials", "get_paideia_folder_contents",
  "get_campus_agenda", "get_campus_day", "get_student_schedule",
  "get_academic_overview", "get_course_workspace", "list_upcoming_academic_items"
]);

export function withAcademicContext(tools, store) {
  return tools.map((tool) => !TEMPORAL_TOOLS.has(tool.name) ? tool : {
    ...tool,
    ...(tool.inputSchema ? { inputSchema: {
      ...tool.inputSchema,
      properties: { ...tool.inputSchema.properties, referenceDate: { ...daySchema,
        description: "Optional target class date for material matching; does not replace the current server date." } }
    } } : {}),
    description: `${tool.description ?? ""} Includes live-clock academicContext. Use referenceWeek and explicit section labels before choosing current materials; use referenceDate for a future class. calendar_unavailable requires verifying and recording a program calendar, not assuming week 1.`,
    handler: async (args = {}) => {
      const { referenceDate, ...queryArgs } = args;
      if (referenceDate) validDate(referenceDate);
      const result = await tool.handler(queryArgs);
      if (!result?.data || typeof result.data !== "object" || result.isError) return result;
      // One registry read and one clock instant per response, even for 200 events.
      const temporal = store.snapshot ? await store.snapshot() : store;
      const data = structuredClone(result.data);
      const course = data.course ?? {};
      const context = await temporal.context({
        course: args.course, courseKeys: [course.id, course.code, course.name, course.shortName, data.courseId],
        term: course.term || args.term, date: referenceDate || args.date || args.start
      });
      const sections = course.sections ?? [];
      context.matchingSections = sections.filter(({ title }) => sectionMatches(title, context.referenceWeek)).map(({ title }) => title);
      context.sectionsTruncated = course.truncated === true;
      if (context.state === "scope_required") context.calendars = temporal.calendars ?? [];
      data.academicContext = context;
      for (const field of ["items", "materials", "schedule", "upcoming"]) {
        if (!Array.isArray(data[field])) continue;
        data[field] = await Promise.all(data[field].map(async (item) => {
          const timing = await temporal.context({
            course: item.course || args.course,
            courseKeys: [item.courseId, item.courseCode, course.id, course.code, course.name],
            term: item.term || course.term,
            date: item.beginDate || item.date || (item.at ? item.at.slice(0, 10) : referenceDate || args.date || args.start)
          });
          return { ...item, academicTiming: {
            calendarId: timing.calendarId ?? null, state: timing.state,
            currentWeek: timing.currentWeek, referenceDate: timing.referenceDate,
            referenceWeek: timing.referenceWeek, weekBasis: timing.weekBasis ?? null
          },
            sectionMatchesReferenceWeek: sectionMatches(item.section, timing.referenceWeek) };
        }));
      }
      return { ...result, data };
    }
  });
}

export function createAcademicCalendarTools(store) {
  return [{
    name: "get_academic_calendar",
    description: "Read locally registered program/term calendars and compute weeks from the current server clock in America/Lima. Optional date computes a separate reference week. No Campus session or terminal required. Missing calendars must be verified at an official source before registration.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      calendarId: textSchema, course: textSchema, term: textSchema, program: textSchema, date: daySchema
    } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args) => store.list(args)
  }, {
    name: "set_academic_calendar",
    description: "Register or replace one LOCAL program calendar after inspecting its official public PUCP source. Include class start/end, applicable term/program, explicit course ids/codes/names and a short non-personal evidence excerpt. Use separate summer/intensive calendars and published week intervals when available. Does not alter Campus. Verification is caller-reported, not independently checked by the server.",
    inputSchema: { type: "object", additionalProperties: false, required: ["calendar"], properties: { calendar: calendarSchema } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (args) => store.save(args)
  }];
}
