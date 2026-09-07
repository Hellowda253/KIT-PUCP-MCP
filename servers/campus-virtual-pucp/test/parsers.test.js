import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeAgendaPayload,
  parseLegacyAcademicTargets,
  parseLegacyStudentScheduleHtml,
  parseLegacyFinancialHtml,
  parseLegacyHistoryHtml,
  parseLegacyObligationsHtml,
  parseLegacyRequestHistoryHtml,
  parseLegacyDocumentCoursesHtml,
  parseLegacyCourseDocumentTargets,
  parseLegacyCourseDocumentsHtml,
  parseLegacyAcademicPerformanceHtml,
  parseLegacyCurriculumHtml,
  parseLegacyGradeStatisticsHtml,
  parseLegacyPartialGradesHtml,
  parseCourseParticipantsHtml,
  parseAgendaPayload,
  parseModuleHtml,
  parsePortalModules
} from "../src/parsers.js";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFile(path.join(fixtureRoot, name), "utf8");
const baseUrl = "https://campus.example.edu";

test("course participant roster preserves the leading blank column and minimizes personal data", () => {
  const html = `
    <table>
      <tr><th></th><th>Alumno</th><th>Nombre</th><th>Horario</th><th>Especialidad</th><th>E-mail</th><th>Enviar Mail</th></tr>
      <tr><td><input type="checkbox"></td><td>20990001</td><td>Ana Ejemplo</td><td>0731</td><td>Ingeniería Industrial</td><td><a href="mailto:ana@example.invalid">ana@example.invalid</a></td><td>Enviar</td></tr>
      <tr><td><input type="checkbox"></td><td>20990002</td><td>Bruno Prueba</td><td>0732</td><td>Ingeniería Informática</td><td>bruno@example.invalid</td><td>Enviar</td></tr>
    </table>`;

  const minimized = parseCourseParticipantsHtml(html);
  assert.equal(minimized.state, "available");
  assert.equal(minimized.total, 2);
  assert.deepEqual(minimized.items[0], {
    fullName: "Ana Ejemplo",
    schedule: "0731",
    specialty: "Ingeniería Industrial"
  });
  assert.equal(JSON.stringify(minimized).includes("20990001"), false);
  assert.equal(JSON.stringify(minimized).includes("example.invalid"), false);

  const explicit = parseCourseParticipantsHtml(html, {
    includeEmail: true,
    schedule: "0732",
    query: "bruno",
    limit: 1
  });
  assert.deepEqual(explicit.items, [{
    fullName: "Bruno Prueba",
    institutionalEmail: "bruno@example.invalid",
    schedule: "0732",
    specialty: "Ingeniería Informática"
  }]);
  assert.equal(explicit.total, 1);
  assert.equal(explicit.count, 1);
  assert.equal(explicit.truncated, false);
});

test("course participant parser refuses unrelated tables", () => {
  assert.deepEqual(
    parseCourseParticipantsHtml("<table><tr><th>Curso</th></tr><tr><td>IND270</td></tr></table>"),
    { state: "unavailable", items: [], reason: "unsupported_layout" }
  );
});

test("legacy grade statistics normalize summary, pass rates, distribution, and note types", async () => {
  const result = parseLegacyGradeStatisticsHtml(
    await fixture("legacy-grade-statistics.html")
  );
  assert.deepEqual(result.summary, {
    noteType: "NORMAL",
    count: 31,
    mean: 10.45,
    standardDeviation: 2.71,
    median: 10,
    minimum: 4,
    maximum: 16
  });
  assert.equal(result.course, "ELECTRICIDAD INDUSTRIAL");
  assert.equal(result.term, "2026-1");
  assert.equal(result.schedule, "0831");
  assert.equal(result.evaluationType, "Examen");
  assert.equal(result.evaluationNumber, 2);
  assert.equal(result.approvedPercentage, 45.2);
  assert.equal(result.failedPercentage, 54.8);
  assert.deepEqual(result.distribution[1], {
    grade: 14,
    frequency: 4,
    percentage: 12.9,
    cumulativePercentage: 19.4
  });
  assert.deepEqual(result.noteTypes, [
    { type: "FALTA", count: 19 },
    { type: "NORMAL", count: 31 }
  ]);
});

test("grade statistics derive pass rates from the official numeric distribution when chart labels are iframe-only", async () => {
  const html = (await fixture("legacy-grade-statistics.html"))
    .replace("<div>Aprob. 45.2%</div>", "")
    .replace("<div>Desap. 54.8%</div>", "");
  const result = parseLegacyGradeStatisticsHtml(html);
  assert.equal(result.approvedPercentage, 16.1);
  assert.equal(result.failedPercentage, 83.9);
  assert.equal(result.passRateSource, "derived_from_distribution");
});

test("portal navigation is classified into the supported read-only Campus modules", async () => {
  const modules = parsePortalModules(await fixture("portal.html"), baseUrl);
  assert.deepEqual(
    modules.map(({ key }) => key),
    [
      "agenda",
      "enrolled_courses",
      "official_grades",
      "academic_history",
      "academic_performance",
      "curriculum",
      "enrollment",
      "financial",
      "obligations",
      "requests",
      "documents",
      "other"
    ]
  );
  assert.equal(modules[0].href.startsWith(baseUrl), true);
});

test("portal navigation extracts read targets from legacy onclick menus", () => {
  const modules = parsePortalModules(
    `
      <a onclick="actualizarIframe('/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda')">
        <img>
      </a>
      <a href="javascript:NotasParcialesAlumno('private-session')">
        Notas parciales
      </a>
    `,
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );

  assert.deepEqual(modules, [
    {
      key: "agenda",
      label: "Agenda",
      href:
        "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda",
      state: "supported"
    }
  ]);
});

test("portal navigation recognizes Matrícula instead of reporting it as unsupported", () => {
  const modules = parsePortalModules(
    `<a href="https://eros.pucp.edu.pe/pucp/matricula/matricula">Matrícula</a>`,
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );
  assert.equal(modules.length, 1);
  assert.equal(modules[0].key, "enrollment");
  assert.equal(modules[0].state, "supported");
});

test("focused module parsers normalize authenticated student data", async () => {
  const cases = [
    ["enrolled_courses", "courses.html", {
      code: "1IND59", name: "Simulación", term: "2026-1", schedule: "0834",
      modality: "Presencial", place: "E117", status: "Matriculado"
    }],
    ["official_grades", "grades.html", {
      courseCode: "1IND59", course: "Simulación", item: "Nota final",
      grade: "18", scale: "0-20", status: "Oficial", term: "2026-1"
    }],
    ["academic_history", "history.html", {
      term: "2025-2", courseCode: "IND231", course: "Investigación de operaciones",
      credits: 4.5, grade: "17", status: "Aprobado"
    }],
    ["academic_performance", "performance.html", {
      term: "2026-1", weightedAverage: 16.75, craest: 72.4,
      meritOrder: 12, facultyPopulation: 340
    }],
    ["curriculum", "curriculum.html", {
      code: "1IND60", name: "Proyecto de ingeniería", credits: 4,
      status: "Pendiente", prerequisites: ["1IND59", "IND231"]
    }],
    ["obligations", "obligations.html", {
      kind: "Biblioteca", title: "Devolver libro", status: "Pendiente", dueDate: "2026-08-01"
    }],
    ["requests", "requests.html", {
      id: "SOL-77", type: "Carta de presentación", status: "Atendida",
      createdAt: "2026-07-01", updatedAt: "2026-07-03"
    }]
  ];
  for (const [module, name, expected] of cases) {
    const result = parseModuleHtml(module, await fixture(name), baseUrl);
    assert.equal(result.state, "available", module);
    assert.deepEqual(result.items[0], expected, module);
  }

  assert.deepEqual(
    parseModuleHtml("enrollment", await fixture("enrollment.html"), baseUrl).value,
    {
      term: "2026-2", turn: "1", status: "Habilitado",
      allowedCourses: 6, results: "Sin resultados publicados"
    }
  );
  assert.deepEqual(
    parseModuleHtml("financial", await fixture("financial.html"), baseUrl).value,
    {
      currency: "PEN", totalDue: 1234.5, nextDueDate: "2026-08-15",
      status: "Pendiente", documentCount: 2
    }
  );
});

test("documents take sensitivity from cached portal metadata and retain only safe metadata", async () => {
  const result = parseModuleHtml("documents", await fixture("documents.html"), baseUrl);
  assert.deepEqual(result.items, [
    {
      id: "DOC-ACA", title: "Programa analítico de Simulación",
      category: "Programa analítico", term: "2026-1",
      href: "https://campus.example.edu/pucp/documentos/descarga/DOC-ACA.pdf",
      sensitivity: "academic", downloadable: true
    },
    {
      id: "DOC-PRI", title: "Boleta de notas", category: "Calificaciones",
      term: "2026-1",
      href: "https://campus.example.edu/pucp/documentos/descarga/DOC-PRI.pdf",
      sensitivity: "private", downloadable: true
    }
  ]);
});

test("known empty states clear data while unsupported layouts stay unavailable", async () => {
  assert.deepEqual(
    parseModuleHtml("official_grades", await fixture("empty-grades.html"), baseUrl),
    { state: "available", items: [] }
  );
  assert.deepEqual(
    parseModuleHtml("official_grades", await fixture("unsupported.html"), baseUrl),
    { state: "unavailable", items: [], reason: "unsupported_layout" }
  );
});

test("module parsing is scoped to its explicit container, not unrelated page chrome", () => {
  const html = `
    <table id="global-search-results">
      <thead><tr><th>Código</th><th>Curso</th><th>Evaluación</th><th>Nota</th><th>Escala</th><th>Estado</th><th>Semestre</th></tr></thead>
      <tbody><tr><td>EVIL1</td><td>Tabla global</td><td>Fila ajena</td><td>20</td><td>0-20</td><td>Visible</td><td>2026-1</td></tr></tbody>
    </table>
    <section data-module="official_grades">
      <table>
        <thead><tr><th>Código</th><th>Curso</th><th>Evaluación</th><th>Nota</th><th>Escala</th><th>Estado</th><th>Semestre</th></tr></thead>
        <tbody><tr><td>SAFE1</td><td>Curso propio</td><td>Final</td><td>18</td><td>0-20</td><td>Oficial</td><td>2026-1</td></tr></tbody>
      </table>
    </section>`;
  const result = parseModuleHtml("official_grades", html, baseUrl);
  assert.equal(result.state, "available");
  assert.deepEqual(result.items.map(({ courseCode }) => courseCode), ["SAFE1"]);
});

test("module-specific headers and labels are required before data becomes authoritative", () => {
  for (const module of [
    "enrolled_courses",
    "official_grades",
    "academic_history",
    "curriculum",
    "obligations",
    "requests",
    "documents"
  ]) {
    const result = parseModuleHtml(
      module,
      `<section data-module="${module}"><table><tr><th>Nombre</th><th>Correo</th></tr><tr><td>Ana</td><td>a@example.invalid</td></tr></table></section>`,
      baseUrl
    );
    assert.equal(result.state, "unavailable", module);
    assert.equal(result.reason, "unsupported_layout", module);
  }
  for (const module of ["academic_performance", "enrollment", "financial"]) {
    const result = parseModuleHtml(
      module,
      `<section data-module="${module}"><dl><dt>Nombre</dt><dd>Ana</dd><dt>Correo</dt><dd>a@example.invalid</dd></dl></section>`,
      baseUrl
    );
    assert.equal(result.state, "unavailable", module);
    assert.equal(result.reason, "unsupported_layout", module);
  }
});

test("recognized empty performance, enrollment, and financial containers clear stale values", () => {
  assert.deepEqual(
    parseModuleHtml(
      "academic_performance",
      '<section data-module="academic_performance"><p class="empty-state">No hay datos disponibles.</p></section>',
      baseUrl
    ),
    { state: "available", items: [] }
  );
  for (const module of ["enrollment", "financial"]) {
    assert.deepEqual(
      parseModuleHtml(
        module,
        `<section data-module="${module}"><p class="empty-state">No hay datos disponibles.</p></section>`,
        baseUrl
      ),
      { state: "available", value: null },
      module
    );
  }
});

test("agenda payload uses ISO-8859-1 decoding without mojibake and preserves legacy fields", () => {
  const json = JSON.stringify({
    events: [{
      id: "77",
      category: "09",
      title: "PRÁCTICA DE SIMULACIÓN (2026-1, 1IND59, HORARIO 0834, SESIÓN PRESENCIAL)",
      description: "PRÁCTICA DE SIMULACIÓN (2026-1, 1IND59, HORARIO 0834, SESIÓN PRESENCIAL)",
      place: "Salón E117",
      begin: { date: "20260725", time: "0830" },
      end: { date: "20260725", time: "1030" }
    }]
  });
  const bytes = Buffer.from(json, "latin1");
  assert.match(decodeAgendaPayload(bytes), /PRÁCTICA/);
  const [event] = parseAgendaPayload(bytes);
  assert.deepEqual(event, {
    id: "77", category: "09",
    title: "PRÁCTICA DE SIMULACIÓN (2026-1, 1IND59, HORARIO 0834, SESIÓN PRESENCIAL)",
    description: "PRÁCTICA DE SIMULACIÓN (2026-1, 1IND59, HORARIO 0834, SESIÓN PRESENCIAL)",
    kind: "PRÁCTICA", course: "SIMULACIÓN", term: "2026-1", code: "1IND59",
    schedule: "0834", modality: "PRESENCIAL", place: "Salón E117",
    beginDate: "2026-07-25", endDate: "2026-07-25",
    beginTime: "08:30", endTime: "10:30",
    start: "2026-07-25T08:30:00-05:00", end: "2026-07-25T10:30:00-05:00"
  });
});

test("legacy Cursos y actividades is the authenticated student's enrolled-course hub", () => {
  const modules = parsePortalModules(
    `<a onclick="actualizarIframe('/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar')">Cursos y actividades</a>`,
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );

  assert.deepEqual(modules, [{
    key: "enrolled_courses",
    label: "Cursos y actividades",
    href: "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar",
    state: "supported"
  }]);
});

test("course document route is distinct from the enrolled-course hub despite sharing its label", () => {
  const modules = parsePortalModules(
    `
      <a onclick="actualizarIframe('/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar')">Cursos y actividades</a>
      <a onclick="actualizarIframe('/pucp/document/dowdocum/dowdocum?accion=VerCursos')">Cursos y actividades</a>
    `,
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );

  assert.deepEqual(
    modules.map(({ key }) => key),
    ["enrolled_courses", "documents"]
  );
});

test("legacy course hub exposes ephemeral read targets without carrying the session id", async () => {
  const result = parseLegacyAcademicTargets(
    await fixture("legacy-course-hub.html"),
    "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar"
  );

  assert.equal(result.term, "2026-1");
  assert.match(result.partialGradesUrl, /nownotpa\?accion=Ingresar/);
  assert.match(result.historyUrl, /nowhisno\?accion=Ingresar/);
  assert.equal(result.partialGradesUrl.includes("never-cache-this"), false);
  assert.equal(result.historyUrl.includes("never-cache-this"), false);
  assert.match(result.personalPanelUrl, /accion=AbrirPanel/);
  assert.equal(result.personalPanelUrl.includes("never-cache-this"), false);
  assert.match(result.studentScheduleUrl, /howhorac\?accion=MostrarResultadosHorAcad/);
  assert.equal(result.studentScheduleUrl.includes("never-cache-this"), false);
});

test("legacy student schedule grid merges adjacent hours and preserves overlaps", async () => {
  const result = parseLegacyStudentScheduleHtml(
    await fixture("legacy-student-schedule.html")
  );

  assert.equal(result.state, "available");
  assert.equal(result.term, "2026-2");
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.items[0], {
    courseCode: "IND275",
    courseName: "CONTROL DE GESTIÓN IND.",
    term: "2026-2",
    scheduleId: "0734",
    scheduleType: "class",
    rawScheduleType: "T",
    section: "C",
    day: "monday",
    start: "08:00",
    end: "10:00",
    room: "A303",
    modality: "in_person"
  });
  assert.deepEqual(
    result.items.filter(({ day, start }) => day === "thursday" && start === "10:00")
      .map(({ courseCode, scheduleType }) => [courseCode, scheduleType]),
    [["1IND52", "practice"], ["1MEC10", "exam"]]
  );
});

test("legacy partial-grade matrix becomes one explicitly non-official item per assessment", async () => {
  const result = parseLegacyPartialGradesHtml(
    await fixture("legacy-notes.html")
  );

  assert.equal(result.state, "available");
  assert.equal(result.items.length, 7);
  assert.deepEqual(result.items[0], {
    courseCode: "1IND59",
    course: "SIMULACIÓN",
    item: "Práctica tipo B 1",
    assessmentType: "Práctica tipo B",
    assessmentNumber: "1",
    grade: "17",
    scale: "0-20",
    status: "No oficial",
    term: "2026-1",
    formula: "( 2Pb + 2Ta ) / 4",
    statistics: {
      kind: "partial",
      courseCode: "1IND59",
      year: "2026",
      cycle: "01",
      cycleType: "00",
      evaluationType: "Pb",
      evaluationNumber: 1,
      schedule: "0834",
      commission: ""
    }
  });
  assert.equal(result.items[3].grade, "F");
});

test("legacy history preserves official state, open-cycle warning, merit and enrollment fields", async () => {
  const result = parseLegacyHistoryHtml(await fixture("legacy-history.html"));

  assert.equal(result.state, "available");
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items[0], {
    term: "2025-2",
    courseCode: "1IND48",
    course: "ANALYTICS 1",
    credits: 3,
    attempt: 1,
    kind: "CLASE",
    schedule: "0631",
    modality: "PRESENCIAL",
    grade: "16.00",
    ects: "B",
    meritApproved: { rank: 31, total: 125 },
    meritOverall: { rank: 20, total: 128 },
    enrollmentTurn: 1,
    instructors: "DOCENTE UNO",
    status: "Oficial",
    statistics: {
      kind: "final",
      courseCode: "1IND48",
      year: "2025",
      cycle: "02",
      cycleType: "00",
      faculty: "12",
      meritType: "1",
      schedule: "0631"
    }
  });
  assert.equal(result.items[1].term, "2026-1");
  assert.equal(result.items[1].status, "No oficial");
  assert.equal(result.items[2].kind, "LABORATORIO");
});

test("legacy performance result exposes CRAEst, averages, credits and both merit scopes", async () => {
  const result = parseLegacyAcademicPerformanceHtml(
    await fixture("legacy-performance-result.html")
  );

  assert.deepEqual(result, {
    state: "available",
    items: [{
      term: "2026-1",
      weightedAverage: 13.48,
      approvedAverage: 13.61,
      lastFourTermsAverage: 12.62,
      craest: 50.9,
      meritOrder: 2391,
      facultyPopulation: 4776,
      meritPercent: 50.06,
      specialtyMeritOrder: 462,
      specialtyPopulation: 1015,
      specialtyMeritPercent: 45.51,
      historicalEnrolledCredits: 120.25,
      historicalApprovedCredits: 115.75,
      currentApprovedCredits: 124.75,
      processedAt: "16-04-2026",
      gradesThroughTerm: "2026-0"
    }]
  });
});

test("legacy curriculum result exposes plan totals and normalized course progress", async () => {
  const result = parseLegacyCurriculumHtml(
    await fixture("legacy-curriculum-result.html")
  );

  assert.equal(result.state, "available");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    code: "1IND50",
    name: "GESTIÓN DEL TALENTO HUMANO",
    type: "OBL",
    credits: 3,
    attempt: 1,
    grade: "14.00",
    term: "2026-1",
    equivalence: "",
    observation: "",
    status: "Aprobado",
    prerequisites: []
  });
  assert.equal(result.items[1].status, "Sin calificar");
  assert.deepEqual(result.summary, {
    academicUnit: "CIENCIAS E INGENIERIA",
    specialty: "INGENIERÍA INDUSTRIAL",
    stage: "PREGRADO EN FACULTAD",
    plan: "35 - Desde 2026-2 (Vigente)",
    requiredCredits: 129.25,
    accumulatedCredits: 60
  });
});

test("legacy personal panel classifies academic and administrative read targets", async () => {
  const modules = parsePortalModules(
    await fixture("legacy-personal-hub.html"),
    "https://eros.pucp.edu.pe/pucp/general/gewpealu/gewpealu?accion=AbrirPanel"
  );

  assert.deepEqual(
    modules.map(({ key }) => key),
    [
      "academic_performance",
      "curriculum",
      "financial",
      "obligations",
      "requests"
    ]
  );
  const requests = modules.find(({ key }) => key === "requests");
  assert.equal(new URL(requests.href).searchParams.get("codAlumno"), "20990001");
});

test("Curriculum Vitae does not shadow the academic consolidated curriculum", () => {
  const modules = parsePortalModules(
    `
      <a href="javascript:location.href='/pucp/cvitae?accion=consultar'">Curriculum Vitae - CVPUCP</a>
      <a href="javascript:location.href='/pucp/ctrlcurr?accion=consultar'">Consolidado curricular</a>
    `,
    "https://eros.pucp.edu.pe/pucp/"
  );

  assert.equal(
    modules.find(({ key }) => key === "curriculum")?.label,
    "Consolidado curricular"
  );
});

test("legacy payment documents produce a private financial summary without sequence identifiers", async () => {
  const result = parseLegacyFinancialHtml(
    await fixture("legacy-financial.html")
  );

  assert.equal(result.state, "available");
  assert.equal(result.value.currency, "PEN");
  assert.equal(result.value.totalDue, 1959.96);
  assert.equal(result.value.nextDueDate, "10-08-2026");
  assert.equal(result.value.status, "Pendiente");
  assert.equal(result.value.documentCount, 2);
  assert.deepEqual(result.value.documents[0], {
    term: "2026-1",
    document: "Cuota 2 - 0",
    currency: "PEN",
    amount: 2045.39,
    status: "CANCELADA EN CAMPUS VIRTUAL",
    dueDate: "15-04-2026",
    paidAt: "23-04-2026"
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("recognized empty legacy obligations page is authoritative", async () => {
  assert.deepEqual(
    parseLegacyObligationsHtml(
      await fixture("legacy-obligations-empty.html")
    ),
    { state: "available", items: [] }
  );
});

test("legacy request history keeps status metadata and drops student identity", async () => {
  const html = await fixture("legacy-requests.html");
  const result = parseLegacyRequestHistoryHtml(html);

  assert.deepEqual(result, {
    state: "available",
    items: [{
      id: "2026-412-S0078508",
      type: "Constancias y cartas",
      status: "ATENDIDA",
      createdAt: "03/07/2026 19:16:09",
      updatedAt: "03/07/2026 19:27:02",
      detail: "Solicitud con 1 constancia."
    }]
  });
  assert.equal(JSON.stringify(result).includes("20990001"), false);
  assert.equal(JSON.stringify(result).includes("PERSONA PRIVADA"), false);
  assert.equal(
    parseModuleHtml("requests", html, baseUrl).state,
    "available"
  );
});

test("legacy course document index becomes non-downloadable academic containers", async () => {
  const result = parseLegacyDocumentCoursesHtml(
    await fixture("legacy-document-courses.html")
  );

  assert.deepEqual(result, {
    state: "available",
    items: [{
      id: "course-1",
      title: "Analytics 2 1IND51 (2026-1)",
      category: "Curso o actividad",
      term: "2026-1",
      href: "",
      sensitivity: "academic",
      downloadable: false
    }, {
      id: "course-2",
      title: "Simulación 1IND59 (2026-1)",
      category: "Curso o actividad",
      term: "2026-1",
      href: "",
      sensitivity: "academic",
      downloadable: false
    }]
  });
});

test("legacy document index yields ephemeral course targets without session identifiers", async () => {
  const result = parseLegacyCourseDocumentTargets(
    await fixture("legacy-document-courses.html"),
    "https://eros.pucp.edu.pe/pucp/document/dowdocum/dowdocum?accion=VerCursos"
  );

  assert.equal(result.length, 2);
  assert.match(result[0].href, /accion=Ingresar/);
  assert.match(result[0].href, /clavecurso=1IND51/);
  assert.equal(result[0].href.includes("never-cache-this"), false);
});

test("legacy course document tree creates explicit download metadata without student identity", async () => {
  const result = parseLegacyCourseDocumentsHtml(
    await fixture("legacy-course-documents.html"),
    "https://eros.pucp.edu.pe/pucp/document/dowdocum/dowdocum?accion=Ingresar"
  );

  assert.equal(result.state, "available");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    id: "04983502",
    title: "Grupos TA",
    category: "Material de curso",
    term: "2026-1",
    courseCode: "1IND59",
    format: "xlsx",
    size: "17.8 KB",
    href: "https://eros.pucp.edu.pe/pucp/document/dowdocum/dowdocum?accion=Descargar&documento=04983502",
    sensitivity: "academic",
    downloadable: true
  });
  assert.equal(JSON.stringify(result).includes("20990001"), false);
  assert.equal(JSON.stringify(result).includes("never-cache-this"), false);
});
