import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAcademicCalendarStore } from "../packages/common/src/academic-calendar.js";
import { createOverviewServer } from "../servers/overview/src/server.js";
import { createPaideiaServer } from "../servers/paideia/src/server.js";
import { createCampusVirtualServer } from "../servers/campus-virtual-pucp/src/server.js";

const record = {
  id: "fixture", program: "Demo", term: "2026-2", kind: "regular",
  startDate: "2026-08-17", endDate: "2026-12-12", courseKeys: ["DEMO101"],
  source: { url: "https://www.pucp.edu.pe/fixture", title: "Synthetic fixture", evidence: "Synthetic dates for testing only." }
};
const parse = (result) => JSON.parse(result.result.content[0].text);
const call = (server, name, args) => server.handleMessage({
  jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args }
});

test("stdio calendar registration works without academic caches and reaches all three servers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "calendar-protocol-"));
  let now = "2026-08-30T22:00:00Z";
  const store = createAcademicCalendarStore({ filePath: path.join(dir, "calendar.json"), now: () => now });
  const overview = createOverviewServer({ service: {}, calendarStore: store });
  const init = await overview.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  assert.ok(init.result.serverInfo);
  assert.equal(parse(await call(overview, "set_academic_calendar", { calendar: record })).state, "saved");
  assert.equal(parse(await call(overview, "get_academic_calendar", { course: "DEMO101" })).currentWeek, 2);
  const paideia = createPaideiaServer({ calendarStore: store, service: {
    getCourseOutline: async () => ({ source: "paideia", cache: { generatedAt: "2026-08-01" }, data: {
      course: { id: "DEMO101", sections: [{ title: "Semanas 3 y 4 — Unidad 2" }] }
    } })
  } });
  const outline = parse(await call(paideia, "get_course_outline", { course: "DEMO101", referenceDate: "2026-08-31" }));
  assert.equal(outline.data.academicContext.currentWeek, 2);
  assert.equal(outline.data.academicContext.referenceWeek, 3);
  assert.equal(outline.data.academicContext.matchingSections.length, 1);
  const campus = createCampusVirtualServer({ calendarStore: store, service: {
    getCampusAgenda: async () => ({ source: "campus_virtual_pucp", data: { items: [
      { course: "DEMO101", beginDate: "2026-08-31" }
    ] } })
  } });
  const agenda = parse(await call(campus, "get_campus_agenda", { start: "2026-08-30", end: "2026-09-01" }));
  assert.equal(agenda.data.items[0].academicTiming.currentWeek, 2);
  assert.equal(agenda.data.items[0].academicTiming.referenceWeek, 3);
  now = "2026-08-31T12:00:00Z";
  assert.equal(parse(await call(paideia, "get_course_outline", { course: "DEMO101" })).data.academicContext.currentWeek, 3);
  const invalid = await call(overview, "set_academic_calendar", { calendar: { ...record, startDate: "2026-02-30" } });
  assert.equal(parse(invalid).error.code, "academic_calendar_invalid");
  assert.equal(parse(await call(overview, "get_academic_calendar", { course: "DEMO101" })).currentWeek, 3);
});
