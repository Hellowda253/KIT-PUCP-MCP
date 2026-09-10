import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { McpToolError } from "./errors.js";
import { readJsonCache, writeJsonAtomic } from "./json-cache.js";

const TIME_ZONE = "America/Lima";
const MAX_REGULAR_WEEK = 19;
const OFFICIAL_CALENDAR_HINT = "https://estudiante.pucp.edu.pe/calendario-academico/";
export const DEFAULT_ACADEMIC_CALENDAR_REGISTRY_URL =
  "https://raw.githubusercontent.com/Hellowda253/KIT-PUCP-MCP/main/config/academic-calendars.json";
const DEFAULT_REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;
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

function canonicalProgram(value) {
  const program = normalize(value).replace(/^programa\s+de\s+/u, "");
  if (/^pregrado(?:\s+pucp)?$/u.test(program)) return "pregrado";
  if (/^(?:posgrado|postgrado)(?:\s+pucp)?$/u.test(program)) return "posgrado";
  if (/^educacion\s+continua(?:\s+pucp)?$/u.test(program)) return "educacion continua";
  return program;
}

function verificationPriority(record) {
  return record.source?.verification === "repository_curated" ? 2 : 1;
}

function preferredCalendar(left, right) {
  return verificationPriority(right) > verificationPriority(left) ? right : left;
}

function equivalentCalendarKey(record) {
  const courseScope = [...record.courseKeys].map(normalize).sort().join("|");
  return [
    normalize(record.term),
    canonicalProgram(record.program),
    record.kind,
    record.startDate,
    record.endDate,
    courseScope
  ].join("\0");
}

function deduplicateCalendars(records) {
  const byId = new Map();
  for (const record of records) {
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? preferredCalendar(existing, record) : record);
  }
  const equivalent = new Map();
  for (const record of byId.values()) {
    const key = equivalentCalendarKey(record);
    const existing = equivalent.get(key);
    equivalent.set(key, existing ? preferredCalendar(existing, record) : record);
  }
  return [...equivalent.values()];
}

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
  const elapsedWeek = 1 + Math.floor((Date.parse(date) - Date.parse(record.startDate)) / (7 * 86400000));
  if (elapsedWeek > MAX_REGULAR_WEEK) return {
    state: "calendar_verification_required", week: null,
    calculatedWeek: elapsedWeek, reason: "week_exceeds_19"
  };
  if (date > record.endDate) return { state: "after_classes", week: null };
  if (record.weeks) {
    const match = record.weeks.find((week) => week.start <= date && week.end >= date);
    if (!match) return { state: "week_not_defined", week: null };
    if (match.number > MAX_REGULAR_WEEK) return {
      state: "calendar_verification_required", week: null,
      calculatedWeek: match.number, reason: "week_exceeds_19"
    };
    return { state: "available", week: match.number, calculatedWeek: match.number };
  }
  return { state: "available", week: elapsedWeek, calculatedWeek: elapsedWeek };
}

function registrationAction(reason) {
  const stale = reason === "week_exceeds_19";
  return {
    required: true,
    reason,
    action: stale ? "refresh_curated_calendar_registry" : "refresh_curated_calendar_registry",
    tool: "get_academic_calendar",
    fallbackTool: "set_academic_calendar",
    officialSourceHint: OFFICIAL_CALENDAR_HINT,
    instruction: stale
      ? "Refresh the curated KIT PUCP calendar registry and verify that it contains the active term. Use set_academic_calendar only as a temporary local fallback if the registry is unavailable or incomplete."
      : "Refresh the curated KIT PUCP calendar registry. Use set_academic_calendar only as a temporary local fallback when an official term has not yet been published in the registry."
  };
}

function contextFor(records, options, instant) {
  const currentDate = liveDate(instant);
  const referenceDate = options.date ? validDate(options.date) : currentDate;
  const base = { queriedAt: instant, timeZone: TIME_ZONE, currentDate, referenceDate,
    currentWeek: null, referenceWeek: null, state: "calendar_unavailable",
    guidance: "Use a verified calendar and explicit week labels; never infer the current section from display order. A matching week is not proof of actual teaching progress." };
  const keys = [options.course, ...(options.courseKeys ?? [])].filter(Boolean).map(normalize);
  if (!keys.length && !options.calendarId && !options.program && !options.term) return {
    ...base,
    state: "scope_required",
    ...(records.length ? {} : { calendarRegistration: registrationAction("missing_verified_calendar") })
  };
  let matches = records.filter((record) =>
    (!options.calendarId || record.id === options.calendarId) &&
    (!options.term || normalize(record.term) === normalize(options.term)) &&
    (!options.program || canonicalProgram(record.program) === canonicalProgram(options.program))
  );
  if (keys.length) {
    const direct = matches.filter((record) => record.courseKeys.some((key) => keys.includes(normalize(key))));
    matches = direct.length ? direct : matches.filter((record) => record.courseKeys.includes("*"));
  }
  const inRange = matches.filter((record) => record.startDate <= referenceDate && record.endDate >= referenceDate);
  if (inRange.length) matches = inRange;
  if (matches.length !== 1) return {
    ...base,
    state: matches.length ? "calendar_ambiguous" : "calendar_unavailable",
    ...(matches.length ? {} : { calendarRegistration: registrationAction("missing_verified_calendar") })
  };
  const record = matches[0];
  const current = weekAt(record, currentDate), target = weekAt(record, referenceDate);
  const verificationRequired = current.state === "calendar_verification_required" ||
    target.state === "calendar_verification_required";
  return { ...base, state: verificationRequired ? "calendar_verification_required" : target.state,
    currentState: current.state,
    calendarId: record.id, term: record.term, program: record.program, kind: record.kind,
    startDate: record.startDate, endDate: record.endDate,
    currentWeek: current.week, referenceWeek: target.week,
    calculatedCurrentWeek: current.calculatedWeek ?? current.week,
    calculatedReferenceWeek: target.calculatedWeek ?? target.week,
    weekBasis: record.weeks ? "published_intervals" : "calculated_from_start",
    source: record.source,
    calendarAgeSeconds: Math.max(0, Math.floor((Date.parse(instant) - Date.parse(record.source.recordedAt)) / 1000)),
    ...(verificationRequired ? { calendarRegistration: registrationAction("week_exceeds_19") } : {})
  };
}

export function createAcademicCalendarStore({
  filePath = path.join(process.env.PUCP_DATA_DIR || path.join(root, "data"), "academic-calendars.json"),
  registryUrl = process.env.PUCP_ACADEMIC_CALENDAR_URL || DEFAULT_ACADEMIC_CALENDAR_REGISTRY_URL,
  registryCachePath = path.join(path.dirname(filePath), "academic-calendar-registry-cache.json"),
  bundledRegistryPath = path.join(root, "config", "academic-calendars.json"),
  registryTtlMs = DEFAULT_REGISTRY_TTL_MS,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString()
} = {}) {
  let queue = Promise.resolve();
  let registryMemory = null;

  async function readLocal() {
    const value = await readJsonCache(filePath, { fallback: { calendars: [] } });
    if (!Array.isArray(value?.calendars)) throw invalid();
    return value.calendars.map((record) => {
      const { recordedAt, verification, ...source } = record.source ?? {};
      const validated = validatedCalendar({ ...record, source });
      if (!Number.isFinite(Date.parse(recordedAt))) throw invalid();
      return { ...validated, source: { ...validated.source, recordedAt, verification: "agent_reported" } };
    });
  }

  function curatedRecords(document) {
    if (document?.schemaVersion !== 1 || !Array.isArray(document.calendars) ||
        !Number.isFinite(Date.parse(document.updatedAt))) throw invalid();
    return document.calendars.map((record) => {
      const validated = validatedCalendar(record);
      return {
        ...validated,
        source: {
          ...validated.source,
          recordedAt: document.updatedAt,
          verification: "repository_curated"
        }
      };
    });
  }

  async function registryFallback() {
    const cached = await readJsonCache(registryCachePath, { fallback: null });
    if (cached?.document) {
      try { return { records: curatedRecords(cached.document), fetchedAt: cached.fetchedAt }; }
      catch { /* Try the bundled registry below. */ }
    }
    if (bundledRegistryPath) {
      const bundled = await readJsonCache(bundledRegistryPath, { fallback: null });
      if (bundled) return { records: curatedRecords(bundled), fetchedAt: null };
    }
    return { records: [], fetchedAt: null };
  }

  async function readRegistry() {
    if (!registryUrl) return [];
    const instant = now();
    if (registryMemory && Date.parse(instant) - Date.parse(registryMemory.checkedAt) < registryTtlMs) {
      return registryMemory.records;
    }
    try {
      const url = new URL(registryUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
          url.hostname !== "raw.githubusercontent.com" ||
          !/^\/Hellowda253\/KIT-PUCP-MCP\/(?:main|[0-9a-f]{40})\/config\/academic-calendars\.json$/u.test(url.pathname)) {
        throw invalid();
      }
      if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
      const response = await fetchImpl(url.href, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response?.ok) throw new Error("registry_http_error");
      const document = await response.json();
      const records = curatedRecords(document);
      await writeJsonAtomic(registryCachePath, { fetchedAt: instant, registryUrl: url.href, document });
      registryMemory = { records, checkedAt: instant };
      return records;
    } catch {
      const fallback = await registryFallback();
      registryMemory = { records: fallback.records, checkedAt: instant };
      return fallback.records;
    }
  }

  async function read() {
    const [curated, local] = await Promise.all([readRegistry(), readLocal()]);
    return deduplicateCalendars([...curated, ...local]);
  }
  async function save({ calendar }) {
    const record = validatedCalendar(calendar);
    const operation = queue.catch(() => {}).then(async () => {
      const calendars = await readLocal();
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
    description: `${tool.description ?? ""} Includes live-clock academicContext from the curated KIT PUCP calendar registry. Use referenceWeek and explicit section labels before choosing current materials; use referenceDate for a future class. If calendarRegistration.required is true, refresh the registry with get_academic_calendar and report a missing term honestly; use set_academic_calendar only as a temporary local fallback.`,
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
        term: course.term || data.activeTerm || data.term || args.term,
        date: referenceDate || args.date || args.start
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
      if (context.state === "scope_required") {
        const timings = ["items", "materials", "schedule", "upcoming"]
          .flatMap(field => Array.isArray(data[field]) ? data[field] : [])
          .map(item => item.academicTiming)
          .filter(timing => timing?.state === "available" && timing.calendarId);
        const grouped = new Map();
        for (const timing of timings) {
          if (!grouped.has(timing.calendarId)) grouped.set(timing.calendarId, []);
          grouped.get(timing.calendarId).push(timing);
        }
        if (grouped.size === 1) {
          const [calendarId, values] = [...grouped.entries()][0];
          data.academicContext = {
            ...context,
            state: "available",
            calendarId,
            currentWeek: values.find(value => Number.isInteger(value.currentWeek))?.currentWeek ?? null,
            referenceWeek: null,
            referenceWeeks: [...new Set(values.map(value => value.referenceWeek).filter(Number.isInteger))].sort((a, b) => a - b),
            weekBasis: "aggregate_items"
          };
        } else if (grouped.size > 1) {
          data.academicContext = {
            ...context,
            state: "mixed_calendars",
            contexts: [...grouped.entries()].map(([calendarId, values]) => ({
              calendarId,
              currentWeek: values.find(value => Number.isInteger(value.currentWeek))?.currentWeek ?? null,
              referenceWeeks: [...new Set(values.map(value => value.referenceWeek).filter(Number.isInteger))].sort((a, b) => a - b)
            }))
          };
        }
      }
      return { ...result, data };
    }
  });
}

export function createAcademicCalendarTools(store) {
  return [{
    name: "get_academic_calendar",
    description: "Read the curated KIT PUCP repository calendar plus optional local overrides and compute weeks from the current server clock in America/Lima. The registry is refreshed automatically and supports regular and summer terms. If the active term is absent, report that limitation; use set_academic_calendar only as a temporary local fallback.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      calendarId: textSchema, course: textSchema, term: textSchema, program: textSchema, date: daySchema
    } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (args) => store.list(args)
  }, {
    name: "set_academic_calendar",
    description: "Register or replace one LOCAL fallback calendar after inspecting an official public PUCP page or PDF. Prefer the automatically downloaded curated repository registry. Include class start/end, applicable term/program and a short non-personal evidence excerpt. Use separate summer/intensive calendars and published week intervals when available. Does not alter Campus.",
    inputSchema: { type: "object", additionalProperties: false, required: ["calendar"], properties: { calendar: calendarSchema } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (args) => store.save(args)
  }];
}
