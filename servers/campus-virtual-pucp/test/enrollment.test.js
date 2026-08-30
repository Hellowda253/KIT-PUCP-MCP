import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAllowedCoursesHtml,
  parseCrossUnitVacanciesHtml,
  parseEnrollmentCalendarHtml,
  parseEnrollmentImpedimentsText,
  parseEnrollmentPortalHtml,
  parseRegistrationWorkspaceHtml,
  parseRegistrationSearchPayload,
  parseRegistrationScopePayload,
  parseScheduleResultsHtml
} from "../src/enrollment-parsers.js";
import {
  assessEnrollmentRisk,
  evaluateCourseSchedule,
  mergeSchedulePreferences,
  recommendCourseSchedules
} from "../src/schedule-optimizer.js";
import { readFile } from "node:fs/promises";

test("cross-unit vacancy parser preserves offering units and official vacancy evidence", async () => {
  const html = await readFile(
    new URL("./fixtures/cross-unit-vacancies.html", import.meta.url),
    "utf8"
  );
  const result = parseCrossUnitVacanciesHtml(html, {
    term: "2026-2",
    retrievedAt: "2026-08-04T20:00:00.000Z"
  });

  assert.equal(result.state, "available");
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.academicUnits, [
    "Facultad de Ciencias e Ingeniería",
    "Facultad de Ciencias Sociales"
  ]);
  assert.deepEqual(result.items[0], {
    term: "2026-2",
    academicUnit: "CIENCIAS E INGENIERÍA",
    courseCode: "MAT291",
    courseName: "MATEMÁTICAS PARA ECONOMISTAS",
    credits: 4,
    scheduleType: "class",
    scheduleId: "0501",
    modality: "presential",
    associatedScheduleIds: ["0502"],
    capacity: { totalVacancies: 40, unitVacancies: 5 },
    differentiatedVacancies: [
      { academicUnit: "CIENCIAS SOCIALES", vacancies: 3, note: "" },
      {
        academicUnit: "OTRAS UNIDADES",
        vacancies: null,
        note: "Vacantes no cubiertas por la unidad"
      }
    ],
    retrievedAt: "2026-08-04T20:00:00.000Z"
  });
  assert.equal(result.items[2].academicUnit, "CIENCIAS SOCIALES");
  assert.equal(result.items[2].modality, "virtual");
  assert.equal(JSON.stringify(result).includes("PRIVATE-UNIT-CODE"), false);
});

test("registration workspace exposes active enrollment data without hidden identity", () => {
  const html = `
    <h1>Matrícula: ESTUDIANTE (00000000) <span>Ciclo: 2026-2</span></h1>
    <div>Turno: 2781 de 5337</div><div>Cursos Inscritos: 1 Créditos Inscritos: 3</div><h2>Inscripción registrada</h2>
    <form name="filtros" method="post" action="/pucp/prematri/pmwmatrc/pmwmatrc;jsessionid=SECRET?accion=MostrarInscripcion">
      <input type="hidden" name="codalu" value="00000000"><input type="hidden" name="session" value="SECRET">
      <select name="ciclo" style="display:none"><option selected value='{"cicloano":"2026","ciclo":"02","tipociclo":"00"}'>2026-2</option><option>2026-1</option></select>
      <select name="facultad"><option value="12" selected>CIENCIAS E INGENIERIA</option><option value="14">CIENCIAS SOCIALES</option></select>
      <select name="especialidad"><option value='{"rama":"026","especialidad":"0","etapa":"02","facultad":"12"}' selected>INGENIERÍA INDUSTRIAL</option></select>
      <script>document.especialidades = [["026","0","02","12","INGENIERÍA INDUSTRIAL"],["031","0","02","14","ECONOMÍA"]];</script>
      <table><tr><th>Clave</th><th>Nombre del Curso</th><th>Créd.</th><th>Eliminar</th><th>Tipo</th><th>Horario</th><th>Estado</th><th>Posic. Relat.</th><th>Docentes</th><th>Sesiones</th></tr>
        <tr><td>IND345</td><td>DATA MINING</td><td>3</td><td><input type="checkbox" name="cursosEliminar" value="IND345T1031"></td><td>CLA</td><td>1031</td><td>Inscrito</td><td>1 de 30</td><td>DOCENTE</td><td>VIE 14:00-16:00 C</td></tr></table>
      <table><tr><th>Clave</th><th>Nombre del Curso</th><th>Créd.</th><th>Agregar</th><th>Tipo</th><th>Horario</th><th>Hor. Aso.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Docentes</th><th>Sesiones</th><th>¿Tiene sesiones virtuales?</th></tr>
        <tr><td colspan="14"><b>Nivel: 0</b></td></tr>
        <tr><td>GEM358</td><td>RESPONSABILIDAD SOCIAL</td><td>3.5</td><td><input type="checkbox" name="cursosAgregar" value="GEM358T10G1"></td><td>CLA</td><td>10G1</td><td></td><td>21</td><td>21</td><td>16</td><td></td><td>DOCENTE</td><td>JUE 17:00-20:00 C</td><td>No</td></tr></table>
    </form>`;
  const result = parseRegistrationWorkspaceHtml(html, { retrievedAt: "2026-08-04T18:00:00.000Z" });
  assert.equal(result.state, "available");
  assert.equal(result.enrollmentMode, "regular");
  assert.equal(result.activeTerm, "2026-2");
  assert.deepEqual(result.turn, { position: 2781, population: 5337, raw: "2781 de 5337" });
  assert.equal(result.scopes.faculties[1].label, "CIENCIAS SOCIALES");
  assert.equal(result.scopes.specialties[0].branchCode, "026");
  assert.equal(result.scopes.specialties[1].label, "ECONOMÍA");
  assert.equal(result.scopes.specialties[1].academicUnitCode, "14");
  assert.deepEqual(result.registered[0].position, { raw: "1 de 30", rank: 1, population: 30, state: "available", retrievedAt: "2026-08-04T18:00:00.000Z" });
  assert.equal(result.registered[0].internalSelectionRef, "IND345T1031");
  assert.equal(result.offerings[0].curriculumLevel, 0);
  assert.equal(result.offerings[0].capacity.registrations, 16);
  assert.equal(result.offerings[0].internalSelectionRef, "GEM358T10G1");
  assert.equal(JSON.stringify(result).includes("00000000"), false);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.equal(JSON.stringify(result).includes("2026-1"), false);
});

test("registration workspace reads exact relative positions from the registered-courses payload", () => {
  const html = `
    <h1>Matrícula 2026-2</h1>
    <h2>Inscripción registrada</h2>
    <select name="ciclo"><option selected>2026-2</option></select>`;
  const registeredPayload = JSON.stringify({
    error: false,
    data: [[
      "1IND50",
      "GESTIÓN DEL TALENTO HUMANO",
      "3",
      [
        ["T", "0831", "4/40", "1", "DOCENTE", "LUN 10:00-13:00 C", "0", "Inscrito", "1", "0"],
        ["P", "0832", "", "1", "DOCENTE", "VIE 20:00-22:00 C", "0", "Inscrito", "0", "0"]
      ],
      "1",
      "1"
    ]]
  });
  const result = parseRegistrationWorkspaceHtml(html, {
    registeredPayload,
    retrievedAt: "2026-08-04T18:00:00.000Z"
  });

  assert.equal(result.registered.length, 2);
  assert.equal(result.registered[0].scheduleType, "class");
  assert.deepEqual(result.registered[0].position, {
    raw: "4/40",
    rank: 4,
    population: 40,
    state: "available",
    retrievedAt: "2026-08-04T18:00:00.000Z"
  });
  assert.equal(result.registered[0].internalSelectionRef, "1IND50T0831");
  assert.equal(result.registered[1].position.state, "not_applicable");
  assert.equal(result.registered[1].internalSelectionRef, null);
});

test("registration workspace accepts a structurally compatible extemporaneous enrollment view", () => {
  const html = `
    <h1>Matrícula Extemporánea 2026-2</h1>
    <div>Turno: 10 de 100</div>
    <h2>Matrícula extemporánea</h2>
    <select name="facultad"><option value="14">CIENCIAS SOCIALES</option></select>
    <select name="especialidad"><option value='{"rama":"005","especialidad":"0","etapa":"02","facultad":"14"}'>ECONOMÍA</option></select>
    <table><tr><th>Clave</th><th>Nombre del Curso</th><th>Créd.</th><th>Agregar</th><th>Tipo</th><th>Horario</th><th>Hor. Aso.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Docentes</th><th>Sesiones</th><th>¿Tiene sesiones virtuales?</th></tr>
      <tr><td colspan="14">Nivel: 5</td></tr>
      <tr><td>MAT291</td><td>MATEMÁTICAS PARA ECONOMISTAS</td><td>4</td><td><input name="cursosAgregar" value="MAT291T0501"></td><td>CLA</td><td>0501</td><td></td><td>30</td><td>30</td><td>12</td><td>10</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td><td>No</td></tr>
    </table>`;
  const result = parseRegistrationWorkspaceHtml(html, { retrievedAt: "2026-08-10T12:00:00.000Z" });
  assert.equal(result.state, "available");
  assert.equal(result.activeTerm, "2026-2");
  assert.equal(result.enrollmentMode, "extemporaneous");
  assert.equal(result.offerings[0].courseCode, "MAT291");
  assert.equal(result.offerings[0].curriculumLevel, 5);
});

test("registration search JSON preserves official levels and capacity columns", () => {
  const payload = JSON.stringify({
    mode: "2",
    data: [[7, 1, [["ECO253", "MICROECONOMÍA", 3, [["0531", "T", "0", "", "1", "", "DOCENTE", "LUN 08:00-10:00 C", "30", "25", "12", "0", "0", "1", "0"]]]]]]
  });
  const result = parseRegistrationSearchPayload(payload, { term: "2026-2", retrievedAt: "2026-08-04T18:00:00.000Z" });
  assert.equal(result.state, "available");
  assert.equal(result.items[0].curriculumLevel, 7);
  assert.equal(result.items[0].capacity.vacancies, 30);
  assert.equal(result.items[0].capacity.unitVacancies, 25);
  assert.equal(result.items[0].capacity.registrations, 12);
  assert.equal(result.items[0].internalSelectionRef, "ECO253T0531");
});

test("registration scope AJAX payload exposes every faculty and specialty for the active term", () => {
  const result = parseRegistrationScopePayload(JSON.stringify({
    facultades: [["12", "CIENCIAS E INGENIERIA"], ["14", "CIENCIAS SOCIALES"]],
    especialidades: [
      ["026", "0", "02", "12", "INGENIERÍA INDUSTRIAL - PREGRADO EN FACULTAD"],
      ["005", "0", "02", "14", "ECONOMÍA - PREGRADO EN FACULTAD"]
    ]
  }));
  assert.equal(result.state, "available");
  assert.equal(result.faculties.length, 2);
  assert.deepEqual(result.faculties[1], { code: "14", label: "CIENCIAS SOCIALES", selected: false });
  assert.equal(result.specialties[1].academicUnitCode, "14");
  assert.equal(result.specialties[1].branchCode, "005");
});

test("registration scope resolver derives every hidden Campus code from visible names", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  assert.equal(typeof enrollmentParsers.resolveRegistrationAcademicScope, "function");
  const catalog = {
    faculties: [
      { code: "14", label: "CIENCIAS SOCIALES" },
      { code: "12", label: "CIENCIAS E INGENIERIA" }
    ],
    specialties: [
      { academicUnitCode: "14", branchCode: "005", specialtyCode: "4", stageCode: "02", label: "ACTUALIZACION EN ECONOMIA" },
      { academicUnitCode: "14", branchCode: "005", specialtyCode: "0", stageCode: "02", label: "ECONOMIA - PREGRADO EN FACULTAD" },
      { academicUnitCode: "12", branchCode: "086", specialtyCode: "0", stageCode: "02", label: "INGENIERIA INFORMATICA - PREGRADO EN FACULTAD" }
    ]
  };

  assert.deepEqual(
    enrollmentParsers.resolveRegistrationAcademicScope(catalog, {
      academicUnit: "Facultad de Ciencias Sociales",
      specialty: "Economía",
      curriculumLevel: 5
    }),
    {
      academicUnit: "CIENCIAS SOCIALES",
      specialty: "ECONOMIA - PREGRADO EN FACULTAD",
      curriculumLevel: 5,
      internal: {
        academicUnitCode: "14",
        branchCode: "005",
        specialtyCode: "0",
        programStageCode: "02"
      }
    }
  );
  assert.equal(
    enrollmentParsers.resolveRegistrationAcademicScope(catalog, {
      academicUnit: "Ciencias e Ingeniería",
      specialty: "Ingeniería Informática",
      curriculumLevel: 7
    }).internal.branchCode,
    "086"
  );
});

test("registration scope resolver refuses a curriculum level without a career", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  assert.throws(
    () => enrollmentParsers.resolveRegistrationAcademicScope({
      faculties: [{ code: "14", label: "CIENCIAS SOCIALES" }],
      specialties: []
    }, {
      academicUnit: "CIENCIAS SOCIALES",
      curriculumLevel: 5
    }),
    (error) => error?.code === "schedule_specialty_required"
  );
});

const scheduleHtml = `
  <h1>Consulta de horarios 2026-2</h1>
  <table>
    <tr>
      <th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th>
      <th>Hor.</th><th>Hor. Aso</th><th>Vac.</th><th>Vac.Unid</th>
      <th>Ins.</th><th>Mat.</th><th>Profesor</th>
      <th>Resultados de encuesta docente</th><th>Sesiones</th>
      <th>Sesiones presenciales</th><th>¿Tiene sesiones virtuales?</th>
    </tr>
    <tr>
      <td rowspan="2">1IND50</td><td rowspan="2">Gestión del talento humano</td>
      <td rowspan="2">3.0</td><td>Cla</td><td>0831</td><td>0832</td>
      <td>30</td><td>25</td><td>29</td><td>20</td><td>Ana Docente</td>
      <td>4.6</td><td>Lunes 08:00-10:00 (T) Z202<br>Miércoles 08:00-09:00 (T) Z202</td>
      <td>2</td><td>No</td>
    </tr>
    <tr>
      <td>Pra</td><td>0832</td><td>0831</td><td>20</td><td>20</td>
      <td>18</td><td>12</td><td>Docente Práctica</td><td>4.2</td>
      <td>Viernes 10:00-12:00 (P) A101</td><td>1</td><td>No</td>
    </tr>
    <tr>
      <td>1IND51</td><td>Analytics 2</td><td>4.0</td><td>Cla</td><td>0901</td><td></td>
      <td>25</td><td>25</td><td>15</td><td>10</td><td>Luis Profesor</td>
      <td></td><td>Martes 09:00-11:00 (T) VIRTUAL</td><td>0</td><td>Sí</td>
    </tr>
  </table>`;

test("schedule parser carries rowspanned course context and normalizes linked sessions", () => {
  const parsed = parseScheduleResultsHtml(scheduleHtml, {
    term: "2026-2",
    retrievedAt: "2026-08-02T12:00:00.000Z"
  });

  assert.equal(parsed.state, "available");
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(
    parsed.items.map(({ courseCode, scheduleId, scheduleType }) => ({
      courseCode,
      scheduleId,
      scheduleType
    })),
    [
      { courseCode: "1IND50", scheduleId: "0831", scheduleType: "class" },
      { courseCode: "1IND50", scheduleId: "0832", scheduleType: "practice" },
      { courseCode: "1IND51", scheduleId: "0901", scheduleType: "class" }
    ]
  );
  assert.deepEqual(parsed.items[0].associatedScheduleIds, ["0832"]);
  assert.deepEqual(parsed.items[0].capacity, {
    vacancies: 30,
    unitVacancies: 25,
    registrations: 29,
    enrolled: 20,
    userPosition: null,
    raw: { "Vac.": "30", "Vac.Unid": "25", "Ins.": "29", "Mat.": "20" }
  });
  assert.deepEqual(parsed.items[0].sessions[0], {
    day: "monday",
    start: "08:00",
    end: "10:00",
    kind: "class",
    room: "Z202",
    virtual: false
  });
  assert.equal(parsed.items[2].sessions[0].virtual, true);
  assert.equal(parsed.items[2].surveyScore, null);
});

test("schedule parser handles Campus rows that omit repeated course cells and Mat values", () => {
  const html = `
    <table>
      <tr>
        <th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th>
        <th>Hor.</th><th>Hor. Aso</th><th>Vac.</th><th>Vac.Unid</th>
        <th>Ins.</th><th>Mat.</th><th>Profesor</th>
        <th>Resultados de encuesta docente</th><th>Sesiones</th>
        <th>Sesiones presenciales</th><th>¿Tiene sesiones virtuales?</th>
      </tr>
      <tr>
        <td>IND275</td><td>CONTROL DE GESTIÓN INDUSTRIAL</td><td>4.5</td>
        <td>Cla</td><td>0731</td><td>0732</td><td>40</td><td>0</td><td>0</td>
        <td>Cornejo, C Haro, J</td><td>4.7</td>
        <td>MAR 20:00-22:00 C A303 MIE 20:00-22:00 C A301</td><td>2</td><td>No</td>
      </tr>
      <tr>
        <td>Pra</td><td>0732</td><td>0731</td><td>40</td><td>0</td><td>0</td>
        <td>Rios, E</td><td>4.2</td><td>VIE 18:00-20:00 P A204</td><td>1</td><td>No</td>
      </tr>
    </table>`;

  const parsed = parseScheduleResultsHtml(html, { term: "2026-2" });
  assert.equal(parsed.state, "available");
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(
    parsed.items.map(({ courseCode, scheduleId, scheduleType }) => ({
      courseCode,
      scheduleId,
      scheduleType
    })),
    [
      { courseCode: "IND275", scheduleId: "0731", scheduleType: "class" },
      { courseCode: "IND275", scheduleId: "0732", scheduleType: "practice" }
    ]
  );
  assert.equal(parsed.items[0].capacity.enrolled, null);
  assert.equal(parsed.items[0].capacity.raw["Mat."], "");
  assert.equal(parsed.items[0].professor, "Cornejo, C Haro, J");
  assert.deepEqual(
    parsed.items[0].sessions.map(({ day, start, end, room }) => ({ day, start, end, room })),
    [
      { day: "tuesday", start: "20:00", end: "22:00", room: "A303" },
      { day: "wednesday", start: "20:00", end: "22:00", room: "A301" }
    ]
  );
  assert.equal(parsed.items[1].professor, "Rios, E");
  assert.equal(parsed.items[1].sessions[0].day, "friday");
});

test("portal parser exposes Inscríbete aquí as confirmation-gated while other mutations stay blocked", () => {
  const html = `
    <nav data-enrollment-tabs>
      <a href="#student">Datos del Alumno</a>
      <a href="#courses">Cursos y Horarios</a>
      <a href="#exceptions">Excepciones</a>
      <a href="#services">Seguros y Servicios</a>
      <a href="#contact">Contáctanos</a>
    </nav>
    <section id="courses">
      <a href="/pucp/horarios/howcurho/howcurho;jsessionid=SECRET?accion=Ingresar&amp;codigo=20230001">Consulta de horarios</a>
      <a href="javascript:EnlaceNuevaPaginaInscripcion()">Inscríbete aquí</a>
    </section>
    <div>Turno de Matrícula</div><div>Cursos Permitidos</div>
    <div>Programación del semestre académico</div><div>Estadística de cursos</div>
    <div>Generador de horarios</div><div>Vacantes que ofrecen otras unidades</div>
    <div>Cursos ofrecidos Escuela de Posgrado</div>`;
  const parsed = parseEnrollmentPortalHtml(html, "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp");
  assert.deepEqual(parsed.sections.map(({ key }) => key), [
    "student_data",
    "courses_schedules",
    "exceptions",
    "insurance_services",
    "contacts"
  ]);
  const actions = parsed.sections.find(({ key }) => key === "courses_schedules").actions;
  assert.equal(actions.find(({ label }) => label === "Consulta de horarios").access, "read");
  assert.doesNotMatch(actions.find(({ label }) => label === "Consulta de horarios").href, /SECRET|20230001|codigo/i);
  assert.equal(actions.find(({ label }) => label === "Inscríbete aquí").access, "confirmation_required");
  assert.equal(actions.find(({ label }) => label === "Inscríbete aquí").href, undefined);
  assert.equal(actions.find(({ label }) => label === "Generador de horarios").access, "blocked");
  assert.equal(actions.find(({ label }) => label === "Estadística de cursos").access, "read");
  const studentActions = parsed.sections.find(({ key }) => key === "student_data").actions;
  assert.equal(studentActions.find(({ label }) => label === "Cursos Permitidos").access, "read");
});

test("allowed-course parser preserves curriculum and enrollment restrictions without identity", () => {
  const html = `
    <h2>Cursos Permitidos</h2><p>2026-2</p>
    <table>
      <tr><th>Clave</th><th>U. Curso</th><th>Nombre del Curso</th><th>Cred.</th><th>Tipo Curso</th><th>Niv.</th><th>Vez</th><th>Excepción</th><th>¿Sale a Matrícula?</th><th>Horarios Secundarios</th><th>Cursos Simultáneos</th><th>Considerar Simultaneidad</th><th>Fecha de registro</th></tr>
      <tr><td>IND275</td><td>CIENCIAS E ING.</td><td>CONTROL DE GESTIÓN INDUSTRIAL</td><td>4.5</td><td>OBLIGATORIO</td><td>7</td><td>1</td><td>NO</td><td>T</td><td>P, E</td><td>---</td><td>Si</td><td>30-07-2026 05:24 PM</td></tr>
      <tr><td>IND354</td><td>CIENCIAS E ING.</td><td>SIMULACIÓN AVANZADA</td><td>3</td><td>ELECTIVO DE LA ESPECIALIDAD</td><td>0</td><td>1</td><td>NO</td><td>NO</td><td>---</td><td>---</td><td>Si</td><td>30-07-2026 05:24 PM</td></tr>
    </table>`;
  const parsed = parseAllowedCoursesHtml(html, { term: "2026-2" });
  assert.equal(parsed.state, "available");
  assert.deepEqual(parsed.items[0], {
    code: "IND275",
    name: "CONTROL DE GESTIÓN INDUSTRIAL",
    academicUnit: "CIENCIAS E ING.",
    credits: 4.5,
    courseType: "OBLIGATORIO",
    curriculumLevel: 7,
    attempt: 1,
    exception: false,
    offeredForEnrollment: true,
    primarySessionTypes: ["class"],
    secondarySessionTypes: ["practice", "exam"],
    simultaneousCourses: [],
    considerSimultaneity: true,
    registeredAt: "2026-07-30T17:24:00-05:00",
    term: "2026-2",
    status: "allowed"
  });
  assert.equal(parsed.items[1].offeredForEnrollment, false);
  assert.equal(JSON.stringify(parsed).includes("20230001"), false);
});

test("enrollment calendar parser normalizes publication, enrollment, closure, and deadline dates", () => {
  const html = `
    <h3>Calendario de Matrícula</h3>
    <p><b>Publicación de horarios, turnos de matrícula y cursos permitidos</b><br>Domingo, 2 de agosto de 2026</p>
    <p><b>Matrícula vía Campus Virtual</b><br>Del martes, 4 de agosto de 2026 (desde las 8:00 a.m.) al jueves, 6 de agosto de 2026 (hasta las 9:00 p.m.)</p>
    <p><b>Cierre temporal para efectuar ajustes de horarios</b><br>Miércoles, 5 de agosto de 2026 (desde 12 m. hasta las 3:00 p.m.)</p>
    <p><b>Vencimiento de la primera cuota académica</b><br>Viernes, 7 de agosto de 2026</p>`;
  const parsed = parseEnrollmentCalendarHtml(html, { term: "2026-2" });
  assert.equal(parsed.state, "available");
  assert.deepEqual(parsed.items.map(({ id, start, end }) => ({ id, start, end })), [
    { id: "schedule_publication", start: "2026-08-02T00:00:00-05:00", end: "2026-08-02T23:59:59-05:00" },
    { id: "campus_enrollment", start: "2026-08-04T08:00:00-05:00", end: "2026-08-06T21:00:00-05:00" },
    { id: "temporary_closure", start: "2026-08-05T12:00:00-05:00", end: "2026-08-05T15:00:00-05:00" },
    { id: "first_installment_due", start: "2026-08-07T00:00:00-05:00", end: "2026-08-07T23:59:59-05:00" }
  ]);
});

test("enrollment impediment parser recognizes clear and blocking Campus responses", () => {
  assert.deepEqual(
    parseEnrollmentImpedimentsText("No presenta impedimentos para la matrícula.", { term: "2026-2" }),
    { state: "available", items: [] }
  );
  assert.deepEqual(
    parseEnrollmentImpedimentsText("Usted se encuentra apto para el proceso de matrícula.", { term: "2026-2" }),
    { state: "available", items: [] }
  );
  assert.deepEqual(
    parseEnrollmentImpedimentsText("Impedimentos de matrícula: Primera cuota académica pendiente", { term: "2026-2" }),
    {
      state: "available",
      items: [{
        id: "enrollment-impediment-1",
        kind: "financial",
        title: "Primera cuota académica pendiente",
        status: "blocking",
        blocking: true,
        term: "2026-2"
      }]
    }
  );
});

test("risk uses personal position first and otherwise falls back to demand pressure", () => {
  assert.deepEqual(
    assessEnrollmentRisk({
      vacancies: 30,
      registrations: 32,
      userPosition: 28,
      retrievedAt: "2026-08-02T12:00:00.000Z"
    }),
    {
      level: "high",
      score: 0.8,
      reason: "personal_position_near_cutoff",
      evidence: { vacancies: 30, registrations: 32, userPosition: 28 },
      retrievedAt: "2026-08-02T12:00:00.000Z",
      guaranteed: false
    }
  );
  assert.equal(assessEnrollmentRisk({ vacancies: 30, registrations: 10 }).level, "low");
  assert.equal(assessEnrollmentRisk({ vacancies: null, registrations: 10 }).level, "unknown");
});

const offerings = [
  {
    courseCode: "A100",
    courseName: "Curso A",
    scheduleId: "A1",
    professor: "Docente Preferido",
    surveyScore: 4.8,
    capacity: { vacancies: 30, registrations: 29 },
    sessions: [{ day: "monday", start: "08:00", end: "10:00", virtual: false }]
  },
  {
    courseCode: "A100",
    courseName: "Curso A",
    scheduleId: "A2",
    professor: "Docente Alterno",
    surveyScore: 4,
    capacity: { vacancies: 30, registrations: 12 },
    sessions: [{ day: "tuesday", start: "10:00", end: "12:00", virtual: false }]
  },
  {
    courseCode: "B200",
    courseName: "Curso B",
    scheduleId: "B1",
    professor: "Otra Docente",
    surveyScore: 4.5,
    capacity: { vacancies: 25, registrations: 20 },
    sessions: [{ day: "monday", start: "09:00", end: "11:00", virtual: false }]
  },
  {
    courseCode: "B200",
    courseName: "Curso B",
    scheduleId: "B2",
    professor: "Otra Docente",
    surveyScore: 4.5,
    capacity: { vacancies: 25, registrations: 20 },
    sessions: [{ day: "tuesday", start: "13:00", end: "15:00", virtual: false }]
  }
];

test("recommendations reject conflicts and rank valid schedules deterministically", () => {
  const result = recommendCourseSchedules({
    courseCodes: ["A100", "B200"],
    offerings,
    maxResults: 5,
    preferences: {
      preferredProfessors: ["Docente Preferido"],
      unavailable: [{ day: "monday", start: "07:00", end: "07:30" }]
    },
    retrievedAt: "2026-08-02T12:00:00.000Z"
  });
  assert.equal(result.status, "complete");
  assert.equal(result.recommendations.length, 3);
  for (const recommendation of result.recommendations) {
    assert.equal(recommendation.conflicts.length, 0);
    assert.equal(recommendation.scoreBreakdown.total, recommendation.score);
  }
  assert.deepEqual(
    result.recommendations[0].courses.map(({ scheduleId }) => scheduleId),
    ["A2", "B1"]
  );
  assert.match(result.recommendations[0].explanation.join(" "), /vacante|hueco|días/i);
});

test("evaluation reports hard conflicts and recommendations explain unsatisfied constraints", () => {
  const evaluation = evaluateCourseSchedule({
    offerings,
    selections: [
      { courseCode: "A100", scheduleId: "A1" },
      { courseCode: "B200", scheduleId: "B1" }
    ]
  });
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.conflicts[0].kind, "overlap");

  const impossible = recommendCourseSchedules({
    courseCodes: ["A100", "B200"],
    offerings,
    preferences: { freeDays: ["monday", "tuesday"] }
  });
  assert.equal(impossible.status, "no_valid_schedule");
  assert.ok(impossible.unsatisfiedConstraints.includes("free_days"));
  assert.ok(impossible.suggestedRelaxations.length > 0);
  assert.deepEqual(impossible.preferences.freeDays, ["monday", "tuesday"]);
});

test("invalid recommendation requests still expose the effective preferences", () => {
  const result = recommendCourseSchedules({
    courseCodes: [],
    localPreferences: { freeDays: ["friday"] },
    preferences: { maxDays: 3 }
  });

  assert.equal(result.status, "invalid_course_count");
  assert.deepEqual(result.preferences.freeDays, ["friday"]);
  assert.equal(result.preferences.maxDays, 3);
});

test("local schedule preferences merge with per-call overrides without mutating either", () => {
  const local = { freeDays: ["friday"], maxDays: 4, weights: { vacancySafety: 50 } };
  const overrides = { maxDays: 3, weights: { fewerGaps: 30 } };
  const merged = mergeSchedulePreferences(local, overrides);
  assert.deepEqual(merged.freeDays, ["friday"]);
  assert.equal(merged.maxDays, 3);
  assert.equal(merged.weights.vacancySafety, 50);
  assert.equal(merged.weights.fewerGaps, 30);
  assert.deepEqual(local, { freeDays: ["friday"], maxDays: 4, weights: { vacancySafety: 50 } });
});

test("schedule search retains only top results and reports deterministic truncation", () => {
  const many = [];
  const courseCodes = [];
  for (let course = 0; course < 6; course += 1) {
    const courseCode = `C${course}`;
    courseCodes.push(courseCode);
    for (let section = 0; section < 8; section += 1) {
      many.push({
        courseCode,
        courseName: courseCode,
        scheduleId: `${course}-${section}`,
        capacity: { vacancies: 40, registrations: section },
        sessions: []
      });
    }
  }
  const result = recommendCourseSchedules({
    courseCodes,
    offerings: many,
    maxResults: 5,
    searchLimits: { maxStates: 1_000 }
  });
  assert.equal(result.status, "partial");
  assert.equal(result.recommendations.length, 5);
  assert.equal(result.search.exhaustive, false);
  assert.equal(result.search.exploredStates <= 1_000, true);
  assert.equal(result.search.retained, 5);
  assert.equal(result.search.limitReason, "state_budget");
});

test("maxDays is enforced and reported by evaluation", () => {
  const threeDays = [
    ["A100", "A1", "monday"],
    ["B200", "B1", "tuesday"],
    ["C300", "C1", "wednesday"]
  ].map(([courseCode, scheduleId, day]) => ({
    courseCode,
    scheduleId,
    sessions: [{ day, start: "08:00", end: "09:00", virtual: false }]
  }));
  const recommendation = recommendCourseSchedules({
    courseCodes: ["A100", "B200", "C300"],
    offerings: threeDays,
    preferences: { maxDays: 2 }
  });
  assert.equal(recommendation.status, "no_valid_schedule");
  assert.ok(recommendation.unsatisfiedConstraints.includes("max_days"));
  assert.equal(recommendation.preferences.maxDays, 2);
  const evaluation = evaluateCourseSchedule({
    offerings: threeDays,
    selections: threeDays.map(({ courseCode, scheduleId }) => ({ courseCode, scheduleId })),
    preferences: { maxDays: 2 }
  });
  assert.equal(evaluation.valid, false);
  assert.ok(evaluation.hardConstraintViolations.includes("max_days"));
});

test("preferred days and hybrid modality influence ranking", () => {
  const preferredDay = recommendCourseSchedules({
    courseCodes: ["A100"],
    offerings: [
      { courseCode: "A100", scheduleId: "MON", sessions: [{ day: "monday", start: "09:00", end: "10:00", virtual: false }] },
      { courseCode: "A100", scheduleId: "TUE", sessions: [{ day: "tuesday", start: "09:00", end: "10:00", virtual: false }] }
    ],
    preferences: { preferredDays: ["tuesday"] }
  });
  assert.equal(preferredDay.recommendations[0].courses[0].scheduleId, "TUE");

  const hybrid = recommendCourseSchedules({
    courseCodes: ["B200"],
    offerings: [
      { courseCode: "B200", scheduleId: "P", sessions: [{ day: "monday", start: "10:00", end: "11:00", virtual: false }] },
      { courseCode: "B200", scheduleId: "H", sessions: [
        { day: "monday", start: "10:00", end: "11:00", virtual: false },
        { day: "wednesday", start: "10:00", end: "11:00", virtual: true }
      ] }
    ],
    preferences: { preferredModality: "hybrid" }
  });
  assert.equal(hybrid.recommendations[0].courses[0].scheduleId, "H");
});

test("portal parser exposes Matrícula extemporánea as read-only compatibility", () => {
  const html = `
    <nav data-enrollment-tabs><a href="#courses">Cursos y Horarios</a></nav>
    <section id="courses">
      <a href="javascript:EnlaceNuevaPaginaInscripcion()">Matrícula extemporánea</a>
    </section>`;
  const parsed = parseEnrollmentPortalHtml(html, "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp");
  const action = parsed.sections[0].actions[0];
  assert.equal(action.label, "Matrícula extemporánea");
  assert.equal(action.access, "read");
  assert.equal(action.reason, "extemporaneous_compatibility_read_only");
});

test("enrollment impediment XML response becomes a financial blocking item", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  assert.equal(typeof enrollmentParsers.parseEnrollmentImpedimentsResponse, "function");
  const result = enrollmentParsers.parseEnrollmentImpedimentsResponse(
    "<datos><error></error><impedimentos>ALUMNO NO CANCELA SU CUOTA ACADÉMICA 1 DEL CICLO 2026-2.</impedimentos></datos>",
    { term: "2026-2" }
  );
  assert.equal(result.state, "available");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, "financial");
  assert.equal(result.items[0].blocking, true);
});

test("schedule form resolves the captured Ciencias e Ingenieria and Ingenieria Industrial fields", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  assert.equal(typeof enrollmentParsers.buildScheduleSearchForm, "function");
  const html = `
    <form>
      <select name="facultad">
        <option value="">Seleccione</option>
        <option value="12">CIENCIAS E INGENIERIA</option>
      </select>
      <select name="rama">
        <option value="026">INGENIERIA INDUSTRIAL</option>
      </select>
      <select name="etapa"><option value=""></option></select>
    </form>`;
  const form = enrollmentParsers.buildScheduleSearchForm({
    term: "2026-2",
    courseCodes: [],
    academicScope: {
      academicUnit: "Ciencias e Ingeniería",
      specialty: "Ingeniería Industrial",
      specialtyCode: "0"
    }
  }, html);
  assert.equal(form.facultad, "12");
  assert.equal(form.facultaddescri, "CIENCIAS E INGENIERIA");
  assert.equal(form.rama, "026");
  assert.equal(form.especialidad, "0");
  assert.equal(form.especialidaddescri, "INGENIERIA INDUSTRIAL");
  assert.equal(form.tiposelec, "uAcad");
  assert.equal(form.orden, "checked");
  assert.equal(form.busquedaAnt, "0");
  assert.equal(form.ventanaEmergente, "1");
});

test("explicit Campus scope codes do not require re-reading the legacy selector page", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  assert.equal(typeof enrollmentParsers.scheduleScopeNeedsCatalog, "function");
  assert.equal(enrollmentParsers.scheduleScopeNeedsCatalog({
    academicUnit: "CIENCIAS E INGENIERIA",
    academicUnitCode: "12",
    specialty: "INGENIERIA INDUSTRIAL",
    branchCode: "026",
    specialtyCode: "0"
  }), false);
  assert.equal(enrollmentParsers.scheduleScopeNeedsCatalog({
    academicUnit: "CIENCIAS E INGENIERIA",
    specialty: "INGENIERIA INDUSTRIAL"
  }), true);
  assert.equal(enrollmentParsers.scheduleScopeNeedsCatalog({
    academicUnit: "ARQUITECTURA Y URBANISMO",
    specialty: "ARQUITECTURA"
  }), true);
  const known = enrollmentParsers.buildScheduleSearchForm({
    term: "2026-2",
    academicScope: {
      academicUnit: "Ciencias e Ingeniería",
      specialty: "Ingeniería Industrial"
    }
  }, "");
  assert.equal(known.facultad, "12");
  assert.equal(known.rama, "026");
  assert.equal(known.especialidad, "0");
  assert.equal(known.facultaddescri, "CIENCIAS E INGENIERIA");
  assert.equal(known.especialidaddescri, "INGENIERIA INDUSTRIAL");
});

test("schedule form resolves any faculty and career from the live Campus selectors", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  const html = `
    <form name="formulario">
      <select name="facultad">
        <option value="12">CIENCIAS E INGENIERIA</option>
        <option value="14" selected>CIENCIAS SOCIALES</option>
      </select>
      <select name="carrera">
        <option value="">Todas</option>
        <option value="005-0">ECONOMIA</option>
        <option value="010-0">SOCIOLOGIA</option>
      </select>
      <select name="etapa"><option value="">Todas</option></select>
    </form>`;
  const form = enrollmentParsers.buildScheduleSearchForm({
    term: "2026-2",
    academicScope: {
      academicUnit: "Facultad de Ciencias Sociales",
      specialty: "Economia"
    }
  }, html);
  assert.equal(form.facultad, "14");
  assert.equal(form.facultaddescri, "CIENCIAS SOCIALES");
  assert.equal(form.rama, "005");
  assert.equal(form.especialidad, "0");
  assert.equal(form.especialidaddescri, "ECONOMIA");
});

test("faculty catalog reload form follows the official MostrarCriteriosCursoHor request", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  assert.equal(typeof enrollmentParsers.buildScheduleScopeCatalogForm, "function");
  const html = `
    <select name="facultad">
      <option value="14">CIENCIAS SOCIALES</option>
      <option value="CR">ARTES ESCENICAS</option>
    </select>`;
  const form = enrollmentParsers.buildScheduleScopeCatalogForm({
    term: "2026-2",
    academicScope: { academicUnit: "Facultad de Ciencias Sociales" }
  }, html);
  assert.deepEqual(form, {
    accion: "MostrarCriteriosCursoHor",
    cicloano: "2026",
    ciclo: "02",
    tipociclo: "00",
    facultad: "14",
    facultaddescri: "CIENCIAS SOCIALES",
    rama: "",
    especialidad: "",
    especialidaddescri: "",
    etapa: "",
    etapadescri: "",
    orden: "",
    tiposelec: "uAcad",
    listacursos: "",
    formatedlistacursos: "",
    busquedaAnt: "0",
    ventanaEmergente: "1",
    idGrupoMatricula: ""
  });
});

test("official faculty registry resolves non-engineering and alphanumeric units without page HTML", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  const social = enrollmentParsers.buildScheduleScopeCatalogForm({
    term: "2026-2",
    academicScope: { academicUnit: "Facultad de Ciencias Sociales" }
  }, "");
  assert.equal(social.facultad, "14");
  assert.equal(social.facultaddescri, "CIENCIAS SOCIALES");
  const performingArts = enrollmentParsers.buildScheduleScopeCatalogForm({
    term: "2026-2",
    academicScope: { academicUnit: "Artes Escenicas" }
  }, "");
  assert.equal(performingArts.facultad, "CR");
  assert.equal(performingArts.facultaddescri, "ARTES ESCENICAS");
});

test("schedule career parser accepts the unclosed option tags emitted by Campus", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  const html = `
    <select name="facultad"><option value="14" selected>CIENCIAS SOCIALES</select>
    <select name="carrera"><option value="">Todas
      <option value="005-4">ACTUALIZACION EN ECONOMIA
      <option value="005-0">ECONOMIA
      <option value="010-0">SOCIOLOGIA
    </select>`;
  const form = enrollmentParsers.buildScheduleSearchForm({
    term: "2026-2",
    academicScope: {
      academicUnit: "Ciencias Sociales",
      specialty: "Economia"
    }
  }, html);
  assert.equal(form.facultad, "14");
  assert.equal(form.rama, "005");
  assert.equal(form.especialidad, "0");
  assert.equal(form.especialidaddescri, "ECONOMIA");
});

test("schedule parser propagates Campus level and elective separator rows", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  const html = `
    <table>
      <tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Hor. Aso</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Encuesta docente</th><th>Sesiones</th><th>Sesiones presenciales</th><th>Virtual</th></tr>
      <tr><td colspan="15"><b>Nivel 4</b></td></tr>
      <tr><td>INF140</td><td>Curso nivel cuatro</td><td>3</td><td>Cla</td><td>0401</td><td></td><td>30</td><td>30</td><td>0</td><td>0</td><td>Docente A</td><td>--</td><td>LUN 08:00-10:00 A101</td><td>1</td><td>No</td></tr>
      <tr><td colspan="15"><b>Nivel 7</b></td></tr>
      <tr><td>INF270</td><td>Curso nivel siete</td><td>4</td><td>Cla</td><td>0701</td><td></td><td>35</td><td>35</td><td>0</td><td>0</td><td>Docente B</td><td>--</td><td>MAR 09:00-11:00 A202</td><td>1</td><td>No</td></tr>
      <tr><td colspan="15"><b>Cursos Electivos</b></td></tr>
      <tr><td>INF399</td><td>Electivo</td><td>3</td><td>Cla</td><td>0901</td><td></td><td>20</td><td>20</td><td>0</td><td>0</td><td>Docente C</td><td>--</td><td>MIE 10:00-12:00 A303</td><td>1</td><td>No</td></tr>
    </table>`;
  const parsed = parseScheduleResultsHtml(html, { term: "2026-2" });
  assert.deepEqual(
    parsed.items.map(({ courseCode, curriculumLevel, curriculumGroup }) => ({
      courseCode,
      curriculumLevel,
      curriculumGroup
    })),
    [
      { courseCode: "INF140", curriculumLevel: 4, curriculumGroup: "Nivel 4" },
      { courseCode: "INF270", curriculumLevel: 7, curriculumGroup: "Nivel 7" },
      { courseCode: "INF399", curriculumLevel: 0, curriculumGroup: "Cursos Electivos" }
    ]
  );
  assert.deepEqual(
    enrollmentParsers.filterScheduleItemsByStage(parsed.items, "Nivel 7")
      .map(({ courseCode }) => courseCode),
    ["INF270"]
  );
  assert.deepEqual(
    enrollmentParsers.filterScheduleItemsByStage(parsed.items, "electivos")
      .map(({ courseCode }) => courseCode),
    ["INF399"]
  );
  assert.deepEqual(
    enrollmentParsers.filterScheduleItemsByStage(parsed.items, "Nivel 0")
      .map(({ courseCode }) => courseCode),
    ["INF399"]
  );
});

test("textual schedule level is a local filter and does not require an etapa code", async () => {
  const enrollmentParsers = await import("../src/enrollment-parsers.js");
  const html = `
    <select name="facultad"><option value="12">CIENCIAS E INGENIERIA</option></select>
    <select name="carrera"><option value="086-0">INGENIERIA INFORMATICA</option></select>
    <select name="etapa"><option value="">Todas</option></select>`;
  const form = enrollmentParsers.buildScheduleSearchForm({
    term: "2026-2",
    academicScope: {
      academicUnit: "Ciencias e Ingenieria",
      specialty: "Ingenieria Informatica",
      stage: "Nivel 7"
    }
  }, html);
  assert.equal(form.rama, "086");
  assert.equal(form.especialidad, "0");
  assert.equal(form.etapa, "");
  assert.equal(form.etapadescri, "");
});
