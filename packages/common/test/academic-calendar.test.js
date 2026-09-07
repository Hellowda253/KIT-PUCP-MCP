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
  const store = calendar.createAcademicCalendarStore({ filePath, now: () => instant });
  return { store, filePath, setNow(value) { instant = value; } };
}

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
  assert.equal(missing.calendarRegistration.action, "register_verified_calendar");
  assert.equal(missing.calendarRegistration.tool, "set_academic_calendar");
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
  assert.equal(result.calendarRegistration.action, "verify_active_term_and_update_calendar");
  assert.equal(result.calendarRegistration.tool, "set_academic_calendar");
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
