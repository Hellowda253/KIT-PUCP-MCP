import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createOverviewService } from "../src/service.js";

const paideia = {
  generatedAt: "2026-07-24T10:00:00.000Z",
  retrievedAt: "2026-07-24T10:00:00.000Z",
  courses: [{ id: "sim", name: "Simulación", shortName: "Simulación", sections: [] }],
  pendingItems: [
    {
      id: "p1",
      courseId: "sim",
      course: "Simulación",
      type: "assignment",
      title: "Informe",
      dueDate: "2026-07-26T23:59:00.000Z",
      dueTimestamp: Date.parse("2026-07-26T23:59:00.000Z")
    }
  ],
  materials: [
    { id: "m1", courseId: "sim", course: "Simulación", title: "Semana 8", type: "resource" }
  ],
  announcements: {
    sim: { state: "available", items: [{ id: "n1", course: "Simulación", title: "Aviso" }] }
  },
  grades: {
    sim: { state: "available", items: [{ course: "Simulación", name: "PC1", rawGrade: "17" }] }
  }
};

const campus = {
  generatedAt: "2026-07-24T11:00:00.000Z",
  retrievedAt: "2026-07-24T11:00:00.000Z",
  modules: {
    agenda: {
      state: "available",
      generatedAt: "2026-07-24T11:00:00.000Z",
      range: { start: "2026-07-24", end: "2026-08-31" },
      items: [
        {
          id: "e1",
          beginDate: "2026-07-25",
          beginTime: "08:00",
          endTime: "10:00",
          kind: "EXAMEN",
          course: "SIMULACIÓN",
          title: "Examen parcial",
          place: "E117",
          modality: "PRESENCIAL"
        }
      ]
    },
    enrolled_courses: {
      state: "available",
      items: [{ code: "1IND59", name: "Simulación", term: "2026-1", status: "Matriculado" }]
    },
    official_grades: {
      state: "available",
      items: [{ courseCode: "1IND59", course: "Simulación", item: "PC1", grade: "18", status: "Oficial", term: "2026-1" }]
    },
    enrollment: {
      state: "available",
      value: { term: "2026-2", turn: "1", status: "Habilitado" }
    },
    enrollment_calendar: {
      state: "available",
      items: [{ id: "campus_enrollment", title: "Matrícula vía Campus Virtual", term: "2026-2", start: "2026-08-04T08:00:00-05:00", end: "2026-08-06T21:00:00-05:00" }]
    },
    enrollment_impediments: {
      state: "available",
      items: [{ id: "imp-1", status: "warning", blocking: true }]
    },
    financial: {
      state: "available",
      value: { currency: "PEN", totalDue: 100, nextDueDate: "2026-08-15", status: "Pendiente" }
    },
    obligations: {
      state: "available",
      items: [{ kind: "Biblioteca", title: "Devolver libro", status: "Pendiente" }]
    },
    requests: {
      state: "available",
      items: [{ id: "r1", type: "Carta", status: "En proceso" }]
    }
  }
};

async function setup({ includePaideia = true, includeCampus = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "overview-"));
  const paideiaCachePath = path.join(root, "paideia.json");
  const campusCachePath = path.join(root, "campus.json");
  const paideiaHistoryPath = path.join(root, "paideia-history.json");
  const campusHistoryPath = path.join(root, "campus-history.json");
  const campusSchedulePath = path.join(root, "course-schedules.json");
  if (includePaideia) await writeFile(paideiaCachePath, JSON.stringify(paideia));
  if (includeCampus) await writeFile(campusCachePath, JSON.stringify(campus));
  if (includeCampus) await writeFile(campusSchedulePath, JSON.stringify({
    entries: [{
      generatedAt: "2026-07-24T11:00:00.000Z",
      retrievedAt: "2026-07-24T11:00:00.000Z",
      query: { mode: "current", term: "active" },
      items: [
        { courseCode: "1IND50", scheduleId: "0831", capacity: { vacancies: 30, registrations: 35, userPosition: 29 } },
        { courseCode: "1IND51", scheduleId: "0901", capacity: { vacancies: 25, registrations: 10, userPosition: 5 } },
        { courseCode: "1IND52", scheduleId: "0911", capacity: { vacancies: 0, registrations: 0, userPosition: null } }
      ]
    }, {
      generatedAt: "2026-07-24T11:30:00.000Z",
      retrievedAt: "2026-07-24T11:30:00.000Z",
      query: { mode: "historical", term: "2025-2" },
      items: [{ courseCode: "HIS100", scheduleId: "0001", capacity: { vacancies: 0, registrations: 99 } }]
    }]
  }));
  await writeFile(paideiaHistoryPath, JSON.stringify([{ syncedAt: "2026-07-24T10:00:00.000Z", changes: { added: ["m1"] } }]));
  await writeFile(campusHistoryPath, JSON.stringify([{ syncedAt: "2026-07-24T11:00:00.000Z", modules: { official_grades: { changed: true } } }]));
  return createOverviewService({
    paideiaCachePath,
    campusCachePath,
    paideiaHistoryPath,
    campusHistoryPath,
    campusSchedulePath,
    now: () => "2026-07-24T12:00:00.000Z"
  });
}

test("academic overview combines schedule, pending work, grades, and status-only sensitive alerts", async () => {
  const service = await setup();
  const result = await service.getAcademicOverview({
    start: "2026-07-24",
    end: "2026-07-27"
  });
  assert.deepEqual(Object.keys(result), ["source", "retrievedAt", "cache", "data", "warnings"]);
  assert.equal(result.source, "pucp_academic_overview");
  assert.deepEqual(result.data.upcoming.map(({ source }) => source), [
    "campus_virtual_pucp",
    "paideia"
  ]);
  assert.equal(result.data.officialGrades[0].grade, "18");
  assert.deepEqual(result.data.alerts.find(({ kind }) => kind === "financial"), {
    kind: "financial",
    status: "Pendiente",
    hasOutstandingBalance: true,
    nextDueDate: "2026-08-15"
  });
  assert.equal("totalDue" in result.data.alerts[0], false);
});

test("overview includes enrollment dates, impediments, and high-risk schedule alerts", async () => {
  const service = await setup();
  const result = await service.getAcademicOverview({
    start: "2026-08-01",
    end: "2026-08-07"
  });
  assert.deepEqual(result.data.upcoming.map(({ id }) => id), ["campus_enrollment"]);
  assert.deepEqual(result.data.alerts.find(({ kind }) => kind === "enrollment_impediments"), {
    kind: "enrollment_impediments",
    status: "attention_required",
    count: 1,
    blockingCount: 1
  });
  assert.deepEqual(result.data.alerts.find(({ kind }) => kind === "schedule_risk"), {
    kind: "schedule_risk",
    status: "high_risk",
    count: 2,
    criticalCount: 1,
    retrievedAt: "2026-07-24T11:00:00.000Z"
  });
});

test("course workspace uses Campus official grades and Paideia materials and pending items", async () => {
  const service = await setup();
  const result = await service.getCourseWorkspace({ course: "simulacion" });
  assert.equal(result.data.course.name, "Simulación");
  assert.equal(result.data.pendingItems[0].id, "p1");
  assert.equal(result.data.materials[0].id, "m1");
  assert.equal(result.data.officialGrades[0].grade, "18");
  assert.equal(result.data.paideiaGrades[0].rawGrade, "17");
});

test("upcoming and recent changes are deterministic and source-labelled", async () => {
  const service = await setup();
  const upcoming = await service.listUpcomingAcademicItems({
    start: "2026-07-24",
    end: "2026-07-27"
  });
  assert.deepEqual(upcoming.data.items.map(({ id }) => id), ["e1", "p1"]);
  const changes = await service.listRecentAcademicChanges({ limit: 10 });
  assert.deepEqual(changes.data.items.map(({ source }) => source), [
    "campus_virtual_pucp",
    "paideia"
  ]);
});

test("data status and partial-source operation report missing caches without failing", async () => {
  const service = await setup({ includeCampus: false });
  const status = await service.getAcademicDataStatus({});
  assert.equal(status.data.sources.campus_virtual_pucp.available, false);
  const overview = await service.getAcademicOverview({
    start: "2026-07-24",
    end: "2026-07-27"
  });
  assert.equal(overview.data.upcoming[0].source, "paideia");
  assert.match(overview.warnings.join(" "), /Campus/i);
});
