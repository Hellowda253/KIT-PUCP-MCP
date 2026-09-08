import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as calendar from "../src/academic-calendar.js";

// Synthetic calendars: no institutional dates or personal account data.
const record = {
  id: "regular-demo", term: "2026-2", program: "Programa de prueba", kind: "regular",
  startDate: "2026-08-17", endDate: "2026-12-12",
  courseKeys: ["demo-course", "DEM101", "Curso de prueba"],
  source: { url: "https://www.pucp.edu.pe/calendario-prueba", title: "Fixture", evidence: "Inicio 17/08; fin 12/12; programa de prueba." }
};
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pucp-calendar-"));
  let instant = "2026-08-31T04:59:59Z";
  const filePath = path.join(dir, "calendars.json");
  const store = calendar.createAcademicCalendarStore({ filePath, now: () => instant, registryUrl: null });
  return { store, filePath, setNow(value) { instant = value; } };
}

test("curated repository calendar initializes academic context without agent registration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pucp-calendar-registry-"));
  let fetches = 0;
  const store = calendar.createAcademicCalendarStore({
    filePath: path.join(dir, "local.json"),
    registryCachePath: path.join(dir, "registry-cache.json"),
    bundledRegistryPath: null,
    registryUrl: "https://raw.githubusercontent.com/Hellowda253/KIT-PUCP-MCP/main/config/academic-calendars.json",
    now: () => "2026-09-07T15:00:00.000Z",
    fetchImpl: async () => {
      fetches += 1;
      return {
        ok: true,
        async json() {
          return {
            schemaVersion: 1,
            updatedAt: "2026-09-06T12:00:00.000Z",
            calendars: [{ ...record, id: "public-2026-2", courseKeys: ["*"] }]
          };
        }
      };
    }
  });

  const first = await store.context({ course: "NEW101", term: "2026-2" });
  const second = await store.context({ course: "OTHER101", term: "2026-2" });

  assert.equal(first.state, "available");
  assert.equal(first.currentWeek, 4);
  assert.equal(first.source.verification, "repository_curated");
  assert.equal(second.calendarId, "public-2026-2");
  assert.equal(fetches, 1);
});

test("cached repository calendar survives a later GitHub outage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pucp-calendar-registry-cache-"));
  const options = {
    filePath: path.join(dir, "local.json"),
    registryCachePath: path.join(dir, "registry-cache.json"),
    bundledRegistryPath: null,
    registryUrl: "https://raw.githubusercontent.com/Hellowda253/KIT-PUCP-MCP/main/config/academic-calendars.json",
    now: () => "2026-09-07T15:00:00.000Z"
  };
  const registry = {
    schemaVersion: 1,
    updatedAt: "2026-09-06T12:00:00.000Z",
    calendars: [{ ...record, id: "public-2026-2", courseKeys: ["*"] }]
  };
  const online = calendar.createAcademicCalendarStore({
    ...options,
    fetchImpl: async () => ({ ok: true, async json() { return registry; } })
  });
  assert.equal((await online.context({ course: "DEM101", term: "2026-2" })).state, "available");

  const offline = calendar.createAcademicCalendarStore({
    ...options,
    now: () => "2026-09-08T15:00:00.000Z",
    fetchImpl: async () => { throw new Error("offline"); }
  });
  const result = await offline.context({ course: "DEM101", term: "2026-2" });
  assert.equal(result.state, "available");
  assert.equal(result.source.verification, "repository_curated");
});

test("bundled curated calendar keeps the current term available before the first successful download", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pucp-calendar-bundled-"));
  const bundledRegistryPath = path.resolve("config/academic-calendars.json");
  const store = calendar.createAcademicCalendarStore({
    filePath: path.join(dir, "local.json"),
    registryCachePath: path.join(dir, "registry-cache.json"),
    bundledRegistryPath,
    registryUrl: "https://raw.githubusercontent.com/Hellowda253/KIT-PUCP-MCP/main/config/academic-calendars.json",
    now: () => "2026-09-07T15:00:00.000Z",
    fetchImpl: async () => { throw new Error("offline"); }
  });
  const result = await store.context({ course: "IND270", term: "2026-2" });
  assert.equal(result.state, "available");
  assert.equal(result.calendarId, "pucp-regular-2026-2");
  assert.equal(result.currentDate, "2026-09-07");
  assert.equal(result.currentWeek, 4);
});

test("curated repository calendar takes precedence over a local record with the same id", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pucp-calendar-override-"));
  const store = calendar.createAcademicCalendarStore({
    filePath: path.join(dir, "local.json"),
    registryCachePath: path.join(dir, "registry-cache.json"),
    bundledRegistryPath: null,
    registryUrl: "https://raw.githubusercontent.com/Hellowda253/KIT-PUCP-MCP/main/config/academic-calendars.json",
    now: () => "2026-09-07T15:00:00.000Z",
    fetchImpl: async () => ({ ok: true, async json() { return {
      schemaVersion: 1,
      updatedAt: "2026-09-06T12:00:00.000Z",
      calendars: [{ ...record, id: "same", courseKeys: ["*"], startDate: "2026-08-17" }]
    }; } })
  });
  await store.save({ calendar: { ...record, id: "same", courseKeys: ["*"], startDate: "2026-08-24" } });
  const result = await store.context({ course: "DEM101", term: "2026-2" });
  assert.equal(result.startDate, "2026-08-17");
  assert.equal(result.source.verification, "repository_curated");
});

test("equivalent pregrado calendars are deduplicated and term alone resolves the curated record", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pucp-calendar-equivalent-"));
  const store = calendar.createAcademicCalendarStore({
    filePath: path.join(dir, "local.json"),
    registryCachePath: path.join(dir, "registry-cache.json"),
    bundledRegistryPath: null,
    registryUrl: "https://raw.githubusercontent.com/Hellowda253/KIT-PUCP-MCP/main/config/academic-calendars.json",
    now: () => "2026-09-07T15:00:00.000Z",
    fetchImpl: async () => ({ ok: true, async json() { return {
      schemaVersion: 1,
      updatedAt: "2026-09-06T12:00:00.000Z",
      calendars: [{
        ...record,
        id: "pucp-regular-2026-2",
        program: "Pregrado PUCP",
        courseKeys: ["*"]
      }]
    }; } })
  });
  await store.save({ calendar: {
    ...record,
    id: "pucp_pregrado_2026_2",
    program: "pregrado",
    courseKeys: ["*"]
  } });

  const byCourse = await store.context({ course: "1IND52", term: "2026-2" });
  const byTerm = await store.list({ term: "2026-2" });

  assert.equal(byCourse.state, "available");
  assert.equal(byCourse.calendarId, "pucp-regular-2026-2");
  assert.equal(byCourse.currentWeek, 4);
  assert.equal(byCourse.source.verification, "repository_curated");
  assert.equal(byTerm.state, "available");
  assert.equal(byTerm.calendars.length, 1);
});

test("calendar context uses the live Lima date, never snapshot timestamps", async (t) => {
  const s = await setup(t);
  await s.store.save({ calendar: record });
  const a = await s.store.context({ course: "DEM101" });
  assert.equal(a.currentDate, "2026-08-30");
  assert.equal(a.currentWeek, 2);
  s.setNow("2026-08-31T05:00:00Z");
  const b = await s.store.context({ course: "DEM101" });
  assert.equal(b.currentWeek, 3);
  assert.equal(b.currentDate, "2026-08-31");
  assert.equal(b.source.recordedAt, a.source.recordedAt);
  assert.equal(b.weekBasis, "calculated_from_start");
});

test("next-session week is distinct from the current week", async (t) => {
  const { store } = await setup(t);
  await store.save({ calendar: record });
  const result = await store.context({ course: "DEM101", date: "2026-08-31" });
  assert.equal(result.currentWeek, 2);
  assert.equal(result.referenceWeek, 3);
  assert.equal(result.referenceDate, "2026-08-31");
});

test("summer has its own length and explicit week intervals including recess", async (t) => {
  const { store, setNow } = await setup(t);
  await store.save({ calendar: { ...record, id: "summer", term: "2027-0", kind: "summer",
    startDate: "2027-01-04", endDate: "2027-02-20", weeks: [
      { number: 1, start: "2027-01-04", end: "2027-01-09" },
      { number: 2, start: "2027-01-18", end: "2027-01-23" }
    ] } });
  setNow("2027-01-20T12:00:00Z");
  assert.equal((await store.context({ course: "DEM101" })).currentWeek, 2);
  setNow("2027-01-12T12:00:00Z");
  const gap = await store.context({ course: "DEM101" });
  assert.equal(gap.currentWeek, null);
  assert.equal(gap.state, "week_not_defined");
  setNow("2027-03-01T12:00:00Z");
  const after = await store.context({ course: "DEM101" });
  assert.equal(after.currentWeek, null);
  assert.equal(after.state, "after_classes");
});

test("unknown programs, new terms and competing calendars never inherit a guessed week", async (t) => {
  const { store } = await setup(t);
  const missing = await store.context({ course: "DEM101" });
  assert.equal(missing.state, "calendar_unavailable");
  assert.equal(missing.calendarRegistration.required, true);
  assert.equal(missing.calendarRegistration.action, "refresh_curated_calendar_registry");
  assert.equal(missing.calendarRegistration.tool, "get_academic_calendar");
  assert.equal(missing.calendarRegistration.fallbackTool, "set_academic_calendar");
  assert.match(missing.calendarRegistration.officialSourceHint, /^https:\/\/estudiante\.pucp\.edu\.pe\//u);
  await store.save({ calendar: record });
  assert.equal((await store.context({ course: "OTHER101" })).currentWeek, null);
  assert.equal((await store.context({ course: "DEM101", term: "2027-1" })).currentWeek, null);
  assert.equal((await store.context({})).state, "scope_required");
  await store.save({ calendar: { ...record, id: "other-program", program: "Otro programa" } });
  assert.equal((await store.context({ course: "DEM101" })).state, "calendar_ambiguous");
  assert.equal((await store.context({ course: "DEM101", program: record.program })).currentWeek, 2);
});

test("a verified program-wide calendar can initialize future course queries without per-course registration", async (t) => {
  const { store } = await setup(t);
  await store.save({ calendar: { ...record, id: "program-wide", courseKeys: ["*"] } });
  const result = await store.context({ course: "NEW101", term: "2026-2" });
  assert.equal(result.state, "available");
  assert.equal(result.calendarId, "program-wide");
  assert.equal(result.currentWeek, 2);
});

test("weeks above 19 require verifying the active term instead of exposing a stale week", async (t) => {
  const { store, setNow } = await setup(t);
  await store.save({ calendar: { ...record, id: "stale-term", courseKeys: ["*"] } });
  setNow("2026-12-28T12:00:00Z");
  const result = await store.context({ course: "DEM101", term: "2026-2" });
  assert.equal(result.state, "calendar_verification_required");
  assert.equal(result.currentWeek, null);
  assert.equal(result.calculatedCurrentWeek, 20);
  assert.equal(result.calendarRegistration.required, true);
  assert.equal(result.calendarRegistration.reason, "week_exceeds_19");
  assert.equal(result.calendarRegistration.action, "refresh_curated_calendar_registry");
  assert.equal(result.calendarRegistration.tool, "get_academic_calendar");
});

test("validation rejects invalid dates, overlapping weeks and private source URLs atomically", async (t) => {
  const { store, filePath } = await setup(t);
  await store.save({ calendar: record });
  const before = await readFile(filePath, "utf8");
  for (const invalid of [
    { startDate: "2026-02-30" }, { endDate: "2025-01-01" },
    { source: { ...record.source, url: "https://www.pucp.edu.pe/?session=secret" } },
    { source: { ...record.source, url: "https://evil.example/calendario" } },
    { weeks: [{ number: 1, start: "2026-08-17", end: "2026-08-25" }, { number: 2, start: "2026-08-24", end: "2026-08-30" }] }
  ]) await assert.rejects(store.save({ calendar: { ...record, ...invalid } }), { code: "academic_calendar_invalid" });
  assert.equal(await readFile(filePath, "utf8"), before);
});

test("decorated MCP material results include matching week evidence without hiding sections", async (t) => {
  const { store, setNow } = await setup(t);
  await store.save({ calendar: record });
  setNow("2026-08-31T12:00:00Z");
  const data = { course: { id: "demo-course", sections: [
    { title: "Semana 1 — Unidad 1" },
    { title: "Semanas 3 y 4 — Unidad 2: Asignación de costos" },
    { title: "Unidad 3" }
  ] } };
  const [tool] = calendar.withAcademicContext([{ name: "get_course_outline", handler: async () => ({
    source: "paideia", cache: { generatedAt: "2026-08-01T00:00:00Z" }, data
  }) }], store);
  const result = await tool.handler({ course: "prueba" });
  assert.equal(result.data.academicContext.currentWeek, 3);
  assert.equal(result.data.course.sections.length, 3);
  assert.deepEqual(result.data.academicContext.matchingSections, ["Semanas 3 y 4 — Unidad 2: Asignación de costos"]);
  assert.equal(data.academicContext, undefined);
  setNow("2026-09-14T12:00:00Z");
  assert.equal((await tool.handler({ course: "prueba" })).data.academicContext.currentWeek, 5);
});

test("calendar registration is serialized and isolated per profile", async (t) => {
  const a = await setup(t), b = await setup(t);
  await Promise.all([a.store.save({ calendar: record }), a.store.save({ calendar: { ...record, id: "second", courseKeys: ["SECOND"] } })]);
  assert.equal((await a.store.list()).calendars.length, 2);
  assert.equal((await b.store.list()).calendars.length, 0);
});

test("aggregate agenda context is derived from matching item calendars", async () => {
  const temporal = { calendars: [], async context(args) {
    if (!args.course) return { state: "scope_required", currentWeek: null, referenceWeek: null };
    return { state: "available", calendarId: "engineering-2026-2", currentWeek: 3,
      referenceDate: args.date, referenceWeek: args.date?.endsWith('31') ? 3 : 4, weekBasis: "calendar" };
  } };
  const [tool] = calendar.withAcademicContext([{ name: "get_campus_agenda", handler: async () => ({ data: { items: [
    { course: "CUR100", beginDate: "2026-08-31" }, { course: "CUR200", beginDate: "2026-09-07" }
  ] } }) }], temporal);
  const result = await tool.handler({ start: "2026-08-31" });
  assert.equal(result.data.academicContext.state, "available");
  assert.equal(result.data.academicContext.calendarId, "engineering-2026-2");
  assert.deepEqual(result.data.academicContext.referenceWeeks, [3, 4]);
});
