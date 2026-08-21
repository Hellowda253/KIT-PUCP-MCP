import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCampusService } from "../src/service.js";

const generatedAt = "2026-07-24T10:00:00.000Z";
const snapshot = {
  generatedAt,
  retrievedAt: generatedAt,
  modules: {
    agenda: {
      state: "available",
      generatedAt,
      range: { start: "2026-07-24", end: "2026-08-31" },
      items: [
        { id: "a2", beginDate: "2026-07-25", beginTime: "10:00", kind: "EXAMEN", course: "SIMULACIÓN", title: "Examen" },
        { id: "a1", beginDate: "2026-07-24", beginTime: "08:00", kind: "PRÁCTICA", course: "SIMULACIÓN", title: "Práctica" }
      ]
    },
    enrolled_courses: {
      state: "available", generatedAt,
      items: [{ code: "1IND59", name: "Simulación", term: "2026-1", schedule: "0834", modality: "Presencial", place: "E117", status: "Matriculado" }]
    },
    official_grades: {
      state: "available", generatedAt,
      items: [{ courseCode: "1IND59", course: "Simulación", item: "Nota final", grade: "18", scale: "0-20", status: "Oficial", term: "2026-1" }]
    },
    academic_history: {
      state: "available", generatedAt,
      items: [{ term: "2025-2", courseCode: "IND231", course: "Investigación de operaciones", credits: 4.5, grade: "17", status: "Aprobado" }]
    },
    academic_performance: {
      state: "available", generatedAt,
      items: [{ term: "2026-1", weightedAverage: 16.75, craest: 72.4, meritOrder: 12, facultyPopulation: 340 }]
    },
    curriculum: {
      state: "available", generatedAt,
      summary: { plan: "35 - Vigente", requiredCredits: 129.25, accumulatedCredits: 60 },
      items: [{ code: "1IND60", name: "Proyecto", credits: 4, status: "Pendiente", prerequisites: ["1IND59"] }]
    },
    enrollment: {
      state: "available", generatedAt,
      alerts: ["Cursos permitidos aún no publicados."],
      value: { term: "2026-2", turn: "1", status: "Habilitado", allowedCourses: 6, results: "Sin resultados" }
    },
    enrollment_calendar: {
      state: "available", generatedAt,
      items: [{ id: "matricula", title: "Matrícula vía Campus Virtual", start: "2026-08-04T08:00:00-05:00", end: "2026-08-06T21:00:00-05:00" }]
    },
    enrollment_impediments: {
      state: "available", generatedAt,
      items: [{ id: "IMP-1", kind: "financial", title: "Primera cuota pendiente", status: "warning", blocking: false }]
    },
    allowed_courses: {
      state: "available", generatedAt,
      items: [{ code: "1IND50", name: "Gestión del talento humano", credits: 3, status: "allowed" }, { code: "1IND51", name: "Analytics 2", credits: 4, status: "allowed" }]
    },
    cross_unit_vacancies: {
      state: "available", generatedAt,
      items: [{ courseCode: "ECO215", courseName: "Economía", vacancies: 5, academicUnit: "Economía" }]
    },
    enrollment_portal: {
      state: "available", generatedAt,
      value: {
        sections: [
          { key: "student_data", label: "Datos del Alumno", state: "available", actions: [] },
          { key: "courses_schedules", label: "Cursos y Horarios", state: "available", actions: [{ label: "Consulta de horarios", access: "read" }] },
          { key: "exceptions", label: "Excepciones", state: "available", actions: [{ label: "Solicitar excepción", access: "blocked", reason: "mutation_not_allowed" }], data: { status: "Sin solicitudes" } },
          { key: "insurance_services", label: "Seguros y Servicios", state: "available", actions: [] },
          { key: "contacts", label: "Contáctanos", state: "available", actions: [] }
        ]
      }
    },
    financial: {
      state: "available", generatedAt,
      value: { currency: "PEN", totalDue: 1234.5, nextDueDate: "2026-08-15", status: "Pendiente", documentCount: 2 }
    },
    obligations: {
      state: "available", generatedAt,
      items: [{ kind: "Biblioteca", title: "Devolver libro", status: "Pendiente", dueDate: "2026-08-01" }]
    },
    requests: {
      state: "available", generatedAt,
      items: [{ id: "SOL-77", type: "Carta", status: "Atendida", createdAt: "2026-07-01", updatedAt: "2026-07-03" }]
    },
    documents: {
      state: "available", generatedAt,
      items: [
        { id: "DOC-ACA", title: "Programa analítico de Simulación", category: "Programa analítico", term: "2026-1", href: "https://campus.example.edu/pucp/documentos/DOC-ACA.pdf", sensitivity: "academic", downloadable: true },
        { id: "DOC-PRI", title: "Boleta de notas", category: "Calificaciones", term: "2026-1", href: "https://campus.example.edu/pucp/documentos/DOC-PRI.pdf", sensitivity: "private", downloadable: true }
      ]
    },
    other: { state: "unavailable", generatedAt, items: [], reason: "unsupported_module" }
  }
};

async function setup(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "campus-service-"));
  const cachePath = path.join(dir, "cache.json");
  await writeFile(cachePath, JSON.stringify(options.snapshot ?? snapshot));
  const schedulePath = path.join(dir, "course-schedules.json");
  const preferencesPath = path.join(dir, "schedule-preferences.local.json");
  const scheduleGeneratedAt = "2026-07-24T10:29:00.000Z";
  await writeFile(schedulePath, JSON.stringify(options.scheduleCache ?? {
    entries: [{
      generatedAt: scheduleGeneratedAt,
      retrievedAt: scheduleGeneratedAt,
      query: { mode: "current", term: "active", courseCodes: ["1IND50", "1IND51"], courseName: "", academicScope: null },
      items: [
        { courseCode: "1IND50", courseName: "Gestión del talento humano", term: "2026-2", scheduleId: "0831", scheduleType: "class", associatedScheduleIds: [], professor: "Ana Docente", surveyScore: 4.6, capacity: { vacancies: 30, registrations: 29, userPosition: 20 }, sessions: [{ day: "monday", start: "08:00", end: "10:00", virtual: false }], retrievedAt: scheduleGeneratedAt },
        { courseCode: "1IND50", courseName: "Gestión del talento humano", term: "2026-2", scheduleId: "0832", scheduleType: "class", associatedScheduleIds: [], professor: "Ana Docente", surveyScore: 4.6, capacity: { vacancies: 30, registrations: 12, userPosition: 8 }, sessions: [{ day: "tuesday", start: "10:00", end: "12:00", virtual: false }], retrievedAt: scheduleGeneratedAt },
        { courseCode: "1IND51", courseName: "Analytics 2", term: "2026-2", scheduleId: "0901", scheduleType: "class", associatedScheduleIds: [], professor: "Luis Profesor", surveyScore: 4.4, capacity: { vacancies: 25, registrations: 20, userPosition: 14 }, sessions: [{ day: "monday", start: "10:00", end: "12:00", virtual: false }], retrievedAt: scheduleGeneratedAt }
      ]
    }]
  }));
  await writeFile(preferencesPath, JSON.stringify(options.preferences ?? { freeDays: ["friday"], timePreference: "morning" }));
  const calls = [];
  const adapter = options.adapter ?? {
    async sync(input) {
      calls.push({ kind: "sync", input });
      return { ...snapshot, generatedAt: options.now?.() ?? generatedAt };
    },
    async downloadDocument(input) {
      calls.push({ kind: "download", input });
      return { status: "downloaded", path: "safe.pdf" };
    }
  };
  const service = createCampusService({
    cachePath,
    historyPath: path.join(dir, "history.json"),
    manifestPath: path.join(dir, "manifest.json"),
    schedulePath,
    preferencesPath,
    adapter,
    now: options.now ?? (() => "2026-07-24T10:30:00.000Z"),
    maxActiveDownloads: options.maxActiveDownloads ?? 2,
    jobTtlSeconds: options.jobTtlSeconds ?? 3600,
    maxRetainedJobs: options.maxRetainedJobs ?? 100
  });
  return { service, calls, cachePath, schedulePath, preferencesPath, dir };
}

test("enrollment portal, reports, schedules, preferences, and optimizer use stable envelopes", async () => {
  const { service } = await setup();
  const results = [
    await service.getEnrollmentCalendar({ term: "2026-2" }),
    await service.getEnrollmentImpediments({ term: "2026-2" }),
    await service.listAllowedCourses({ term: "2026-2" }),
    await service.searchCourseSchedules({ term: "2026-2", courseCodes: ["1IND50", "1IND51"] }),
    await service.getCourseScheduleDetails({ term: "2026-2", course: "1IND50", schedule: "0831" }),
    await service.getCourseEnrollmentStatistics({ term: "2026-2", course: "1IND50", schedule: "0831" }),
    await service.listCrossUnitVacancies({ term: "2026-2" }),
    await service.listEnrollmentPortalSections({}),
    await service.getEnrollmentPortalSection({ section: "exceptions" }),
    await service.getSchedulePreferences(),
    await service.recommendCourseSchedules({ courseCodes: ["1IND50", "1IND51"], term: "2026-2" }),
    await service.evaluateCourseSchedule({ selections: [{ courseCode: "1IND50", scheduleId: "0831" }, { courseCode: "1IND51", scheduleId: "0901" }], term: "2026-2" })
  ];
  for (const result of results) {
    assert.deepEqual(Object.keys(result), ["source", "retrievedAt", "cache", "data", "warnings"]);
  }
  assert.equal(results[2].data.items.length, 2);
  assert.equal(results[3].data.total, 3);
  assert.equal(results[4].data.item.scheduleId, "0831");
  assert.equal(results[5].data.items[0].risk.guaranteed, false);
  assert.equal(results[7].data.sections.length, 5);
  assert.equal(results[8].data.section.actions[0].access, "blocked");
  assert.deepEqual(results[9].data.local.freeDays, ["friday"]);
  assert.equal(results[10].data.status, "complete");
  assert.equal(results[10].data.recommendations.length, 2);
  assert.equal(results[11].data.valid, true);
});

test("enrollment statistics prefer the live registered position over cached capacity", async () => {
  const seen = [];
  const { service } = await setup({
    scheduleCache: {
      entries: [{
        generatedAt,
        retrievedAt: generatedAt,
        query: { mode: "current", term: "active", courseCodes: ["1IND50"], courseName: "", academicScope: null },
        items: [{
          courseCode: "1IND50",
          courseName: "Gestión del talento humano",
          term: "2026-2",
          scheduleId: "0831",
          scheduleType: "class",
          capacity: { vacancies: 40, registrations: 10, userPosition: null },
          retrievedAt: generatedAt
        }]
      }]
    },
    adapter: {
      async sync() { return snapshot; },
      async readRegistrationWorkspace(input) {
        seen.push(input);
        return {
          state: "available",
          enrollmentMode: "regular",
          activeTerm: "2026-2",
          retrievedAt: "2026-08-04T19:00:00.000Z",
          registered: [{
            courseCode: "1IND50",
            scheduleId: "0831",
            scheduleType: "class",
            position: { raw: "4/40", rank: 4, population: 40, state: "available" }
          }],
          offerings: [{
            courseCode: "1IND50",
            scheduleId: "0831",
            scheduleType: "class",
            capacity: { vacancies: 40, registrations: 10, userPosition: 4 },
            retrievedAt: "2026-08-04T19:00:00.000Z"
          }]
        };
      }
    }
  });

  const result = await service.getCourseEnrollmentStatistics({
    course: "1IND50",
    schedule: "0831"
  });

  assert.equal(result.data.items[0].capacity.userPosition, 4);
  assert.equal(result.data.items[0].risk.reason, "personal_position_has_margin");
  assert.deepEqual(seen[0].courseCodes, ["1IND50"]);
});

test("missing schedule cache starts one exact read-only search job and returns pending", async () => {
  let resolveSearch;
  const seen = [];
  const { service } = await setup({
    scheduleCache: { entries: [] },
    adapter: {
      sync: async () => snapshot,
      searchScheduleCatalog(input) {
        seen.push(input);
        return new Promise((resolve) => { resolveSearch = resolve; });
      }
    }
  });
  const first = await service.searchCourseSchedules({ term: "2026-2", courseCodes: ["1IND50"] });
  const second = await service.searchCourseSchedules({ term: "2026-2", courseCodes: ["1IND50"] });
  assert.equal(first.data.state, "pending");
  assert.equal(first.data.jobId, second.data.jobId);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].allowMutations, false);
  assert.equal(seen[0].useCampusGenerator, false);
  resolveSearch({ state: "available", retrievedAt: generatedAt, items: [] });
  await service.waitForIdle();
});

test("stale schedule detail returns cache while one exact refresh runs", async () => {
  const staleAt = "2026-07-24T08:00:00.000Z";
  const seen = [];
  const { service } = await setup({
    scheduleCache: {
      entries: [{
        generatedAt: staleAt,
        retrievedAt: staleAt,
        query: { mode: "current", term: "2026-2", courseCodes: ["1IND50"], courseName: "", academicScope: null },
        items: [{ courseCode: "1IND50", term: "2026-2", scheduleId: "0831", scheduleType: "class", sessions: [] }]
      }]
    },
    adapter: {
      async sync() { return snapshot; },
      async searchCurrentCourseSchedules(input) {
        seen.push(input);
        return { state: "available", activeTerm: "2026-2", source: "schedule_catalog", sourcesUsed: ["schedule_catalog"], retrievedAt: generatedAt, items: [] };
      }
    }
  });

  const result = await service.getCourseScheduleDetails({
    course: "1IND50",
    schedule: "0831"
  });
  assert.equal(result.data.state, "available");
  assert.equal(result.data.item.scheduleId, "0831");
  assert.match(result.data.refreshJobId, /^course-schedules-/);
  assert.match(result.warnings[0], /refresh/i);
  await service.waitForIdle();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].courseCodes, ["1IND50"]);
});

test("forced schedule recommendation refreshes the full requested course batch", async () => {
  const seen = [];
  const { service } = await setup({
    adapter: {
      async sync() { return snapshot; },
      async searchCurrentCourseSchedules(input) {
        seen.push(input);
        return { state: "available", activeTerm: "2026-2", source: "schedule_catalog", sourcesUsed: ["schedule_catalog"], retrievedAt: generatedAt, items: [] };
      }
    }
  });
  const result = await service.recommendCourseSchedules({
    courseCodes: ["1IND50", "1IND51"],
    forceRefresh: true
  });
  assert.equal(result.data.status, "complete");
  assert.match(result.data.refreshJobId, /^course-schedules-/);
  assert.match(result.warnings[0], /refresh/i);
  await service.waitForIdle();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].courseCodes, ["1IND50", "1IND51"]);
});

test("academic schedule scope preserves visible names and official curriculum level", async () => {
  const seen = [];
  const { service } = await setup({
    scheduleCache: { entries: [] },
    adapter: {
      sync: async () => snapshot,
      async searchScheduleCatalog(input) {
        seen.push(input);
        return { state: "available", retrievedAt: generatedAt, items: [] };
      }
    }
  });
  const result = await service.searchCourseSchedules({
    term: "2026-2",
    academicScope: {
      academicUnit: "Ciencias e Ingeniería",
      specialty: "Ingeniería Industrial",
      curriculumLevel: 7
    }
  });
  assert.equal(result.data.state, "pending");
  await service.waitForIdle();
  assert.deepEqual(seen[0].academicScope, {
    academicUnit: "Ciencias e Ingeniería",
    specialty: "Ingeniería Industrial",
    curriculumLevel: 7
  });
});

test("curriculum level requires a visible specialty instead of a broad faculty query", async () => {
  const { service } = await setup({ scheduleCache: { entries: [] } });
  await assert.rejects(
    service.searchCourseSchedules({
      academicScope: { academicUnit: "CIENCIAS SOCIALES", curriculumLevel: 5 }
    }),
    (error) => error?.code === "schedule_specialty_required"
  );
});

test("schedule scope catalog exposes names but never hidden Campus selector codes", async () => {
  const { service } = await setup({
    adapter: {
      sync: async () => snapshot,
      async readRegistrationWorkspace() {
        return {
          state: "available",
          activeTerm: "2026-2",
          retrievedAt: generatedAt,
          scopes: {
            faculties: [{ code: "14", label: "CIENCIAS SOCIALES" }],
            specialties: [{
              academicUnitCode: "14",
              branchCode: "005",
              specialtyCode: "0",
              stageCode: "02",
              label: "ECONOMÍA - PREGRADO EN FACULTAD"
            }]
          }
        };
      }
    }
  });
  const result = await service.listScheduleScopes();
  assert.deepEqual(result.data.faculties, [{ academicUnit: "CIENCIAS SOCIALES" }]);
  assert.deepEqual(result.data.specialties, [{
    academicUnit: "CIENCIAS SOCIALES",
    specialty: "ECONOMÍA - PREGRADO EN FACULTAD"
  }]);
  assert.equal(JSON.stringify(result.data).includes("branchCode"), false);
  assert.equal(JSON.stringify(result.data).includes("stageCode"), false);
});

test("schedule scope resolution failures remain actionable in background job status", async () => {
  const { service } = await setup({
    scheduleCache: { entries: [] },
    adapter: {
      sync: async () => snapshot,
      async searchScheduleCatalog() {
        const error = new Error("Campus schedule scope was not found");
        error.code = "schedule_scope_not_found";
        throw error;
      }
    }
  });
  const queued = await service.searchCourseSchedules({
    term: "2026-2",
    academicScope: { academicUnit: "UNIDAD DESCONOCIDA" }
  });
  await service.waitForIdle();
  const status = await service.getCampusJobStatus({ jobId: queued.data.jobId });
  assert.equal(status.data.status, "failed");
  assert.equal(status.data.error.code, "schedule_scope_not_found");
});

test("background schedule timeouts expose only a safe category and stage", async () => {
  const { service } = await setup({
    scheduleCache: { entries: [] },
    adapter: {
      async sync() { return snapshot; },
      async searchCurrentCourseSchedules() {
        const error = new Error("password=do-not-leak at https://private.example.invalid");
        error.name = "TimeoutError";
        error.stage = "schedule_catalog.navigation";
        throw error;
      }
    }
  });
  const queued = await service.searchCourseSchedules({ courseCodes: ["1IND50"] });
  await service.waitForIdle();
  const status = await service.getCampusJobStatus({ jobId: queued.data.jobId });
  assert.equal(status.data.error.code, "timeout");
  assert.equal(status.data.error.retryable, true);
  assert.equal(status.data.error.stage, "schedule_catalog.navigation");
  assert.equal(JSON.stringify(status.data.error).includes("do-not-leak"), false);
  assert.equal(JSON.stringify(status.data.error).includes("private.example"), false);
});

test("current schedule search derives the active term and uses the registration portal source first", async () => {
  const seen = [];
  const { service } = await setup({
    now: () => "2026-08-04T10:00:00-05:00",
    scheduleCache: { entries: [] },
    adapter: {
      sync: async () => snapshot,
      async searchCurrentCourseSchedules(input) {
        seen.push(input);
        return {
          state: "available",
          enrollmentMode: "extemporaneous",
          activeTerm: "2026-2",
          sourcesUsed: ["enrollment_portal"],
          retrievedAt: generatedAt,
          items: [{ courseCode: "1IND50", term: "2026-2", scheduleId: "0831", capacity: { vacancies: 30, registrations: 12 } }]
        };
      }
    }
  });
  const queued = await service.searchCourseSchedules({ term: "2026-1", courseCodes: ["1IND50"] });
  assert.equal(queued.data.query.term, "2026-2");
  await service.waitForIdle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].allowMutations, false);
  assert.equal(seen[0].term, "2026-2");
  assert.equal(seen[0].preferRegistrationPortal, true);
  assert.equal(Object.hasOwn(seen[0], "requestedTerm"), false);
  const result = await service.searchCourseSchedules({ courseCodes: ["1IND50"] });
  assert.deepEqual(result.data.sourcesUsed, ["enrollment_portal"]);
  assert.equal(result.data.activeTerm, "2026-2");
  assert.equal(result.data.enrollmentMode, "extemporaneous");
});

test("current schedule search skips the registration portal after the published window ended", async () => {
  const seen = [];
  const closedSnapshot = structuredClone(snapshot);
  closedSnapshot.modules.enrollment_portal.value.sections[1].actions.push({
    label: "Inscríbete aquí",
    access: "confirmation_required"
  });
  const { service } = await setup({
    now: () => "2026-08-21T12:00:00-05:00",
    snapshot: closedSnapshot,
    scheduleCache: { entries: [] },
    adapter: {
      sync: async () => snapshot,
      async searchCurrentCourseSchedules(input) {
        seen.push(input);
        return {
          state: "available",
          activeTerm: "2026-2",
          source: "schedule_catalog",
          sourcesUsed: ["schedule_catalog"],
          warnings: ["Schedule catalog counts can differ from enrollment-time values."],
          retrievedAt: "2026-08-21T12:00:00-05:00",
          items: []
        };
      }
    }
  });

  await service.searchCourseSchedules({ courseCodes: ["1IND50"] });
  await service.waitForIdle();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].preferRegistrationPortal, false);
  const result = await service.searchCourseSchedules({ courseCodes: ["1IND50"] });
  assert.equal(result.data.source, "schedule_catalog");
  assert.match(result.warnings.join(" "), /differ/i);
});

test("historical schedule search is isolated from the current enrollment cache and uses the shared catalog source", async () => {
  const seen = [];
  const { service } = await setup({
    scheduleCache: { entries: [] },
    adapter: {
      sync: async () => snapshot,
      async searchHistoricalCourseSchedules(input) {
        seen.push(input);
        return { state: "available", retrievedAt: generatedAt, source: "schedule_catalog", sourcesUsed: ["schedule_catalog"], items: [] };
      }
    }
  });
  const queued = await service.searchHistoricalCourseSchedules({ term: "2026-1", courseCodes: ["1IND50"] });
  await service.waitForIdle();
  assert.equal(queued.data.query.term, "2026-1");
  assert.equal(seen[0].term, "2026-1");
  assert.equal(seen[0].allowMutations, false);
  const result = await service.searchHistoricalCourseSchedules({ term: "2026-1", courseCodes: ["1IND50"] });
  assert.equal(result.data.source, "schedule_catalog");
  assert.deepEqual(result.data.sourcesUsed, ["schedule_catalog"]);
});

test("legacy schedule cache source names are migrated to the shared catalog vocabulary", async () => {
  const { service } = await setup({
    scheduleCache: {
      entries: [{
        generatedAt: "2026-07-24T10:29:00.000Z",
        retrievedAt: "2026-07-24T10:29:00.000Z",
        query: { mode: "current", term: "active", courseCodes: ["1IND50"], courseName: "", academicScope: null },
        state: "available",
        source: "enrollment_portal",
        sourcesUsed: ["enrollment_portal", "authenticated_schedule_report"],
        differences: [{ courseCode: "1IND50", authenticatedScheduleReport: 29 }],
        activeTerm: "2026-2",
        items: [{ courseCode: "1IND50", scheduleId: "0831" }]
      }]
    }
  });
  const result = await service.searchCourseSchedules({ courseCodes: ["1IND50"] });
  assert.deepEqual(result.data.sourcesUsed, ["enrollment_portal", "schedule_catalog"]);
  assert.equal(result.data.differences[0].scheduleCatalog, 29);
  assert.equal(Object.hasOwn(result.data.differences[0], "authenticatedScheduleReport"), false);
});

test("extemporaneous enrollment remains readable but cannot prepare or commit writes", async () => {
  const workspace = {
    state: "available",
    enrollmentMode: "extemporaneous",
    activeTerm: "2026-2",
    retrievedAt: generatedAt,
    turn: null,
    summary: {},
    scopes: { faculties: [], specialties: [] },
    registered: [],
    offerings: [{
      courseCode: "MAT291",
      scheduleId: "0501",
      scheduleType: "class",
      internalSelectionRef: "MAT291T0501",
      associatedScheduleIds: [],
      sessions: []
    }]
  };
  let commits = 0;
  const { service } = await setup({
    adapter: {
      sync: async () => snapshot,
      async readRegistrationWorkspace() { return structuredClone(workspace); },
      async commitCourseRegistration() { commits += 1; }
    }
  });
  const status = await service.getRegistrationPortalStatus();
  assert.equal(status.data.enrollmentMode, "extemporaneous");
  assert.match(status.warnings.join(" "), /read-only|solo lectura/i);
  await assert.rejects(
    service.prepareCourseRegistration({
      add: [{ courseCode: "MAT291", scheduleId: "0501", scheduleType: "class" }]
    }),
    (error) => error?.code === "registration_write_unverified_mode"
  );
  assert.equal(commits, 0);
});

test("registration changes require a live preview and a one-use confirmation token", async () => {
  const commits = [];
  const reads = [];
  const workspace = {
    state: "available",
    accountBinding: "private-account-binding",
    activeTerm: "2026-2",
    retrievedAt: generatedAt,
    turn: { position: 2781, population: 5337, raw: "2781 de 5337" },
    summary: { registeredCourses: 1, registeredCredits: 3 },
    scopes: { faculties: [], specialties: [] },
    registered: [{ courseCode: "IND345", scheduleId: "1031", credits: 3, status: "Inscrito", internalSelectionRef: "IND345T1031", position: { raw: "1 de 30", rank: 1, population: 30, state: "available", retrievedAt: generatedAt } }],
    offerings: [
      { courseCode: "1IND50", scheduleId: "0831", credits: 3, scheduleType: "class", associatedScheduleIds: ["0832"], internalSelectionRef: "1IND50T0831", sessions: [{ day: "monday", start: "08:00", end: "10:00" }], capacity: { vacancies: 30, registrations: 12 } },
      { courseCode: "1IND50", scheduleId: "0832", credits: 3, scheduleType: "practice", associatedScheduleIds: ["0831"], internalSelectionRef: "1IND50P0832", sessions: [{ day: "friday", start: "10:00", end: "12:00" }], capacity: { vacancies: 20, registrations: 10 } }
    ]
  };
  let current = structuredClone(workspace);
  const { service, schedulePath } = await setup({
    adapter: {
      sync: async () => snapshot,
      async readRegistrationWorkspace(input) { reads.push(input); return structuredClone(current); },
      async commitCourseRegistration(input) {
        commits.push(input);
        current = {
          ...current,
          registered: [{ ...workspace.offerings[0], status: "Inscrito", position: { raw: "8 de 30", rank: 8, population: 30, state: "available", retrievedAt: generatedAt } }]
        };
        return structuredClone(current);
      }
    }
  });
  const preview = await service.prepareCourseRegistration({
    add: [{ courseCode: "1IND50", scheduleId: "0831" }],
    remove: [{ courseCode: "IND345", scheduleId: "1031" }]
  });
  assert.equal(commits.length, 0);
  assert.equal(preview.data.confirmationRequired, true);
  assert.equal(preview.data.before.length, 1);
  assert.equal(preview.data.add.length, 2);
  assert.equal(preview.data.after.length, 2);
  assert.equal(preview.data.confirmationToken.length >= 16, true);
  assert.equal(JSON.stringify(preview).includes("private-account-binding"), false);
  const committed = await service.commitCourseRegistration({ confirmationToken: preview.data.confirmationToken, confirmed: true });
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].addRefs, ["1IND50T0831", "1IND50P0832"]);
  assert.deepEqual(commits[0].removeRefs, ["IND345T1031"]);
  assert.deepEqual(commits[0].addCourseCodes, ["1IND50"]);
  assert.deepEqual(reads[0].courseCodes, ["1IND50"]);
  assert.equal(committed.data.registered[0].position.rank, 8);
  assert.deepEqual(JSON.parse(await readFile(schedulePath, "utf8")).entries, []);
  await assert.rejects(
    service.commitCourseRegistration({ confirmationToken: preview.data.confirmationToken, confirmed: true }),
    (error) => error.code === "confirmation_token_invalid"
  );
  const rejectedPreview = await service.prepareCourseRegistration({
    remove: [{ courseCode: "1IND50", scheduleId: "0831" }]
  });
  await assert.rejects(
    service.commitCourseRegistration({ confirmationToken: rejectedPreview.data.confirmationToken, confirmed: false }),
    (error) => error.code === "registration_confirmation_required"
  );
  await assert.rejects(
    service.commitCourseRegistration({ confirmationToken: rejectedPreview.data.confirmationToken, confirmed: true }),
    (error) => error.code === "confirmation_token_invalid"
  );
});

test("pure course removal sends only the principal Campus checkbox reference", async () => {
  const workspace = {
    state: "available",
    enrollmentMode: "regular",
    accountBinding: "private-account-binding",
    activeTerm: "2026-2",
    retrievedAt: generatedAt,
    turn: null,
    summary: { registeredCourses: 1, registeredCredits: 3 },
    scopes: { faculties: [], specialties: [] },
    registered: [
      {
        courseCode: "1IND92",
        scheduleId: "1031",
        scheduleType: "class",
        credits: 3,
        status: "Inscrito",
        internalSelectionRef: "1IND92T1031",
        sessions: [{ day: "tuesday", start: "19:00", end: "22:00" }]
      },
      {
        courseCode: "1IND92",
        scheduleId: "1031",
        scheduleType: "practice",
        credits: 3,
        status: "Inscrito",
        internalSelectionRef: null,
        sessions: [{ day: "friday", start: "16:00", end: "18:00" }]
      },
      {
        courseCode: "1IND92",
        scheduleId: "1031",
        scheduleType: "exam",
        credits: 3,
        status: "Inscrito",
        internalSelectionRef: null,
        sessions: [{ day: "monday", start: "18:30", end: "21:30" }]
      }
    ],
    offerings: []
  };
  let current = structuredClone(workspace);
  const commits = [];
  const { service } = await setup({
    adapter: {
      sync: async () => snapshot,
      async readRegistrationWorkspace() { return structuredClone(current); },
      async commitCourseRegistration(input) {
        commits.push(input);
        current = { ...current, registered: [] };
        return structuredClone(current);
      }
    }
  });

  const preview = await service.prepareCourseRegistration({
    remove: [{ courseCode: "1IND92", scheduleId: "1031" }]
  });
  assert.equal(preview.data.add.length, 0);
  assert.equal(preview.data.remove.length, 3);
  assert.equal(preview.data.after.length, 0);

  const result = await service.commitCourseRegistration({
    confirmationToken: preview.data.confirmationToken,
    confirmed: true
  });
  assert.equal(result.data.state, "committed");
  assert.deepEqual(commits[0].addRefs, []);
  assert.deepEqual(commits[0].removeRefs, ["1IND92T1031"]);
});

test("registration commit refuses a changed live state instead of submitting or retrying", async () => {
  let reads = 0;
  let commits = 0;
  const base = {
    state: "available", activeTerm: "2026-2", retrievedAt: generatedAt,
    summary: {}, scopes: { faculties: [], specialties: [] }, registered: [],
    offerings: [{ courseCode: "1IND50", scheduleId: "0831", internalSelectionRef: "1IND50T0831", capacity: { vacancies: 30, registrations: 12 }, sessions: [] }]
  };
  const { service } = await setup({
    adapter: {
      sync: async () => snapshot,
      async readRegistrationWorkspace() {
        reads += 1;
        return reads === 1 ? structuredClone(base) : { ...structuredClone(base), offerings: [{ ...base.offerings[0], capacity: { vacancies: 30, registrations: 13 } }] };
      },
      async commitCourseRegistration() { commits += 1; }
    }
  });
  const preview = await service.prepareCourseRegistration({ add: [{ courseCode: "1IND50", scheduleId: "0831" }] });
  await assert.rejects(
    service.commitCourseRegistration({ confirmationToken: preview.data.confirmationToken, confirmed: true }),
    (error) => error.code === "registration_state_changed"
  );
  assert.equal(commits, 0);
});

test("all successful Campus queries use one five-field envelope and normalized module data", async () => {
  const { service } = await setup();
  const results = [
    await service.listCampusModules(),
    await service.getCampusAgenda({ start: "2026-07-24", end: "2026-07-25", kind: "PRACTICA,EXAMEN" }),
    await service.getCampusDay({ date: "2026-07-24" }),
    await service.listEnrolledCourses({ query: "simu" }),
    await service.listOfficialGrades({ term: "2026-1" }),
    await service.getAcademicHistory({}),
    await service.getAcademicPerformance({}),
    await service.getCurriculumProgress({ status: "Pendiente" }),
    await service.getEnrollmentStatus({}),
    await service.getFinancialStatus({}),
    await service.listObligations({ status: "Pendiente" }),
    await service.listRequests({}),
    await service.searchCampusDocuments({ query: "programa" })
  ];
  for (const result of results) {
    assert.deepEqual(Object.keys(result), ["source", "retrievedAt", "cache", "data", "warnings"]);
    assert.equal(result.source, "campus_virtual_pucp");
  }
  assert.equal(results[8].data.value.allowedCourseCount, 2);
  assert.equal(results[8].data.value.impedimentCount, 1);
  assert.equal(results[8].data.value.activeWindow, false);
  assert.match(results[8].data.value.nextDates[0].title, /Campus Virtual/);
  assert.deepEqual(results[1].data.items.map(({ id }) => id), ["a1", "a2"]);
  assert.deepEqual(results[2].data.items.map(({ id }) => id), ["a1"]);
  assert.equal(results[3].data.items[0].code, "1IND59");
  assert.equal(results[7].data.summary.plan, "35 - Vigente");
  assert.equal(results[8].data.value.turn, "1");
  assert.equal(results[8].data.alerts.length, 2);
  assert.match(results[8].data.alerts[1], /get_enrollment_impediments/);
  assert.equal(results[9].data.value.totalDue, 1234.5);
  assert.equal(results[12].data.items[0].sensitivity, "academic");
  assert.equal(results[0].data.modules.find(({ key }) => key === "other").state, "unavailable");
});

test("retired Campus modules are hidden even when an older cache still contains them", async () => {
  const legacySnapshot = structuredClone(snapshot);
  legacySnapshot.modules.postgraduate_offerings = {
    state: "available",
    generatedAt,
    items: [{ courseCode: "POS500" }]
  };
  const { service } = await setup({ snapshot: legacySnapshot });

  const catalog = await service.listCampusModules();
  const status = await service.getCampusStatus();

  assert.equal(
    catalog.data.modules.some(({ key }) => key === "postgraduate_offerings"),
    false
  );
  assert.equal(Object.hasOwn(status.data.modules, "postgraduate_offerings"), false);
});

test("stale or forced queries return last good cache and dedupe one metadata-only refresh job", async () => {
  let resolveSync;
  const seen = [];
  const stale = structuredClone(snapshot);
  stale.generatedAt = "2026-07-23T00:00:00.000Z";
  stale.modules.agenda.generatedAt = "2026-07-23T00:00:00.000Z";
  const { service } = await setup({
    snapshot: stale,
    adapter: {
      sync(input) {
        seen.push(input);
        return new Promise((resolve) => { resolveSync = resolve; });
      }
    }
  });
  const first = await service.getCampusAgenda({
    start: "2026-07-24",
    end: "2026-07-25"
  });
  const second = await service.getCampusAgenda({
    start: "2026-07-24",
    end: "2026-07-25",
    forceRefresh: true
  });
  assert.equal(first.data.items.length, 2);
  assert.match(first.warnings[0], /refresh/i);
  assert.equal(first.data.refreshJobId, second.data.refreshJobId);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].metadataOnly, true);
  assert.equal(seen[0].allowDownloads, false);
  assert.equal(seen[0].allowMutations, false);
  assert.equal(seen[0].start, "2026-07-24");
  assert.equal(seen[0].end, "2026-07-25");
  resolveSync(snapshot);
  await service.waitForIdle();
});

test("fresh agenda cache outside the requested range starts a range-specific refresh and returns non-authoritative unavailable data", async () => {
  let resolveSync;
  const seen = [];
  const { service } = await setup({
    adapter: {
      sync(input) {
        seen.push(input);
        return new Promise((resolve) => { resolveSync = resolve; });
      }
    }
  });
  const result = await service.getCampusAgenda({
    start: "2026-09-01",
    end: "2026-09-05"
  });
  assert.equal(result.cache.stale, false);
  assert.equal(result.data.state, "unavailable");
  assert.equal(result.data.reason, "range_not_cached");
  assert.equal(result.data.authoritative, false);
  assert.deepEqual(result.data.items, []);
  assert.match(result.warnings.join(" "), /range|coverage|cached/i);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, "range_not_cached");
  assert.equal(seen[0].start, "2026-09-01");
  assert.equal(seen[0].end, "2026-09-05");
  resolveSync(snapshot);
  await service.waitForIdle();
});

test("partially covered agenda range returns only overlapping cache with a warning while refreshing the full requested range", async () => {
  let resolveSync;
  const partial = structuredClone(snapshot);
  partial.modules.agenda.items.push({
    id: "a3",
    beginDate: "2026-08-31",
    beginTime: "09:00",
    kind: "CLASE",
    course: "SIMULACIÓN",
    title: "Última clase"
  });
  const seen = [];
  const { service } = await setup({
    snapshot: partial,
    adapter: {
      sync(input) {
        seen.push(input);
        return new Promise((resolve) => { resolveSync = resolve; });
      }
    }
  });
  const result = await service.getCampusAgenda({
    start: "2026-08-30",
    end: "2026-09-02"
  });
  assert.equal(result.data.state, "available");
  assert.equal(result.data.authoritative, false);
  assert.deepEqual(result.data.items.map(({ id }) => id), ["a3"]);
  assert.match(result.warnings.join(" "), /range|coverage|cached/i);
  assert.equal(seen[0].start, "2026-08-30");
  assert.equal(seen[0].end, "2026-09-02");
  resolveSync(partial);
  await service.waitForIdle();
});

test("sync preserves last good structural failures, clears trusted empty modules, and keeps role-unavailable modules unavailable", async () => {
  const refreshed = structuredClone(snapshot);
  refreshed.generatedAt = "2026-07-24T11:00:00.000Z";
  refreshed.modules.official_grades = {
    state: "unavailable", items: [], reason: "unsupported_layout"
  };
  refreshed.modules.requests = { state: "available", items: [] };
  refreshed.modules.curriculum = {
    state: "unavailable", items: [], reason: "role_unavailable"
  };
  const { service, cachePath } = await setup({
    adapter: { async sync() { return refreshed; } }
  });
  await service.syncCampusVirtual({});
  await service.waitForIdle();
  const updated = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(updated.modules.official_grades.state, "available");
  assert.equal(updated.modules.official_grades.items[0].grade, "18");
  assert.equal(updated.modules.official_grades.lastSyncState, "unavailable");
  assert.deepEqual(updated.modules.requests.items, []);
  assert.equal(updated.modules.curriculum.state, "unavailable");
  assert.deepEqual(updated.modules.curriculum.items, []);
});

test("explicit document downloads use cached sensitivity, dedupe jobs, and enforce active limit", async () => {
  const resolvers = [];
  const seen = [];
  const { service } = await setup({
    maxActiveDownloads: 1,
    adapter: {
      async sync() { return snapshot; },
      downloadDocument(input) {
        seen.push(input);
        return new Promise((resolve) => resolvers.push(resolve));
      }
    }
  });
  const first = await service.downloadCampusDocument({ document: "DOC-PRI" });
  const duplicate = await service.downloadCampusDocument({ document: "DOC-PRI" });
  assert.equal(first.data.jobId, duplicate.data.jobId);
  await assert.rejects(
    service.downloadCampusDocument({ document: "DOC-ACA" }),
    (error) => error.code === "download_limit_reached"
  );
  assert.equal(seen[0].document.sensitivity, "private");
  assert.equal(seen[0].document.id, "DOC-PRI");
  resolvers[0]({ status: "downloaded", path: "safe.pdf" });
  await service.waitForIdle();
  assert.equal((await service.getCampusJobStatus({ jobId: first.data.jobId })).data.status, "completed");
});

test("unavailable modules return a stable unavailable state without throwing", async () => {
  const unavailable = structuredClone(snapshot);
  unavailable.modules.academic_performance = {
    state: "unavailable",
    items: [],
    reason: "role_unavailable",
    generatedAt
  };
  const { service } = await setup({ snapshot: unavailable });
  const result = await service.getAcademicPerformance({});
  assert.deepEqual(result.data, {
    state: "unavailable",
    reason: "role_unavailable",
    items: []
  });
});

test("sync writes summarized per-module changes and job pruning removes expired results", async () => {
  let clock = "2026-07-24T10:30:00.000Z";
  const changed = structuredClone(snapshot);
  changed.generatedAt = clock;
  changed.modules.obligations.items.push({
    kind: "Académica", title: "Encuesta", status: "Pendiente", dueDate: "2026-08-02"
  });
  const { service } = await setup({
    now: () => clock,
    jobTtlSeconds: 1,
    adapter: { async sync() { return changed; } }
  });
  const queued = await service.syncCampusVirtual({});
  await service.waitForIdle();
  const changes = await service.listCampusChanges({ module: "obligations" });
  assert.equal(changes.data.syncs.length, 1);
  assert.equal(changes.data.syncs[0].modules.obligations.addedCount, 1);
  clock = "2026-07-24T10:30:02.000Z";
  await service.getCampusStatus();
  await assert.rejects(
    service.getCampusJobStatus({ jobId: queued.data.jobId }),
    (error) => error.code === "job_not_found"
  );
});

test("invalid dates and ambiguous documents fail with structured codes", async () => {
  const ambiguous = structuredClone(snapshot);
  ambiguous.modules.documents.items[1].title = ambiguous.modules.documents.items[0].title;
  const { service } = await setup({ snapshot: ambiguous });
  await assert.rejects(
    service.getCampusDay({ date: "24/07/2026" }),
    (error) => error.code === "invalid_date"
  );
  await assert.rejects(
    service.downloadCampusDocument({ document: "Programa analítico" }),
    (error) => error.code === "document_ambiguous"
  );
});

test("grade statistics resolve only cached institutional references and persist on-demand results", async () => {
  const withStatistics = structuredClone(snapshot);
  withStatistics.modules.official_grades.items = [
    {
      courseCode: "IEE272",
      course: "Electricidad Industrial",
      item: "Examen 2",
      assessmentType: "Examen",
      assessmentNumber: "2",
      grade: "10",
      status: "No oficial",
      term: "2026-1",
      statistics: {
        kind: "partial",
        courseCode: "IEE272",
        year: "2026",
        cycle: "01",
        cycleType: "00",
        evaluationType: "Ex",
        evaluationNumber: 2,
        schedule: "0831",
        commission: ""
      }
    },
    {
      courseCode: "1IND50",
      course: "Gestión del Talento Humano",
      item: "Nota final",
      grade: "14",
      status: "No oficial",
      term: "2026-1",
      statistics: {
        kind: "final",
        courseCode: "1IND50",
        year: "2026",
        cycle: "01",
        cycleType: "00",
        faculty: "12",
        meritType: "1",
        schedule: "0731"
      }
    }
  ];
  const calls = [];
  const statisticsResult = {
    state: "available",
    course: "ELECTRICIDAD INDUSTRIAL",
    term: "2026-1",
    summary: {
      noteType: "NORMAL",
      count: 31,
      mean: 10.45,
      standardDeviation: 2.71,
      median: 10,
      minimum: 4,
      maximum: 16
    },
    distribution: [],
    noteTypes: []
  };
  const { service } = await setup({
    snapshot: withStatistics,
    adapter: {
      async sync() {
        return withStatistics;
      },
      async getPartialGradeStatistics(reference) {
        calls.push(["partial", reference]);
        return { ...statisticsResult, kind: "partial" };
      },
      async getFinalGradeStatistics(reference) {
        calls.push(["final", reference]);
        return { ...statisticsResult, kind: "final" };
      }
    }
  });

  const queued = await service.getPartialGradeStatistics({
    course: "IEE272",
    term: "2026-1",
    evaluationType: "Ex",
    evaluationNumber: 2
  });
  assert.equal(queued.data.state, "pending");
  await service.waitForIdle();
  const completed = await service.getCampusJobStatus({
    jobId: queued.data.jobId
  });
  assert.equal(completed.data.status, "completed");
  assert.equal(completed.data.result.summary.mean, 10.45);

  const cached = await service.getPartialGradeStatistics({
    course: "IEE272",
    term: "2026-1",
    evaluationType: "Ex",
    evaluationNumber: 2
  });
  assert.equal(cached.data.state, "available");
  assert.equal(cached.data.summary.median, 10);
  assert.equal(calls.length, 1);

  const finalQueued = await service.getFinalGradeStatistics({
    course: "1IND50",
    term: "2026-1"
  });
  assert.equal(finalQueued.data.state, "pending");
  await service.waitForIdle();
  assert.equal(calls[1][0], "final");

  const missing = await service.getPartialGradeStatistics({
    course: "IEE272",
    term: "2026-1",
    evaluationType: "Ex",
    evaluationNumber: 99
  });
  assert.equal(missing.data.state, "unavailable");
  assert.equal(missing.data.reason, "evaluation_not_found");
});

test("partial statistics distinguish an existing assessment whose statistics are not published", async () => {
  const snapshotWithoutStatistics = structuredClone(snapshot);
  snapshotWithoutStatistics.modules.official_grades.items.push({
    courseCode: "IEE272",
    course: "Electricidad Industrial",
    item: "Examen 3",
    assessmentType: "Ex",
    assessmentNumber: 3,
    grade: "14",
    term: "2026-1"
  });
  const { service } = await setup({ snapshot: snapshotWithoutStatistics });
  const result = await service.getPartialGradeStatistics({
    course: "IEE272",
    term: "2026-1",
    evaluationType: "Ex",
    evaluationNumber: 3
  });
  assert.equal(result.data.state, "unavailable");
  assert.equal(result.data.reason, "statistics_not_published");
});
