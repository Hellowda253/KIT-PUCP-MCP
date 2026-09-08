import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLiveCampusAdapter,
  prepareScheduleScopeCatalog,
  readAllowedPageFrames,
  readScheduleEntryPage,
  readStablePageContent,
  requestWithRedirectPolicy,
  waitForCampusLanding
} from "../src/live-adapter.js";
import * as liveAdapter from "../src/live-adapter.js";
import { createCampusUrlPolicy } from "../src/url-policy.js";

const agendaEntry =
  "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda";
const agendaJson =
  "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON";
const campusPortal =
  "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp";

test("academic performance selects the newest enrolled-student report instead of the enrollment-turn report", () => {
  assert.equal(typeof liveAdapter.selectAcademicPerformanceReportIndex, "function");
  const html = `
    <table>
      <tr><th>Opciones disponibles</th></tr>
      <tr><td><input name="tiporend" value="1"><input name="cicloanho" value="2026"><input name="ciclo" value="02"><input name="checkboxes" type="checkbox" checked>Turno de Matrícula</td></tr>
      <tr><td><input name="tiporend" value="2"><input name="cicloanho" value="2025"><input name="ciclo" value="00"><input name="checkboxes" type="checkbox">Alumnos Matriculados</td></tr>
      <tr><td><input name="tiporend" value="2"><input name="cicloanho" value="2026"><input name="ciclo" value="01"><input name="checkboxes" type="checkbox">Alumnos Matriculados</td></tr>
      <tr><td><input name="tiporend" value="3"><input name="cicloanho" value="2026"><input name="ciclo" value="01"><input name="checkboxes" type="checkbox">Historia</td></tr>
    </table>`;
  assert.equal(liveAdapter.selectAcademicPerformanceReportIndex(html), 2);
});

test("schedule scope catalog reloads the requested faculty before resolving its career", async () => {
  assert.equal(typeof prepareScheduleScopeCatalog, "function");
  const initialHtml = `
    <select name="facultad">
      <option value="12" selected>CIENCIAS E INGENIERIA</option>
      <option value="14">CIENCIAS SOCIALES</option>
    </select>`;
  const socialSciencesHtml = `
    <select name="facultad"><option value="14" selected>CIENCIAS SOCIALES</option></select>
    <select name="carrera"><option value="005-0">ECONOMIA</option></select>
    <select name="etapa"><option value="">Todas</option></select>`;
  const posts = [];
  const result = await prepareScheduleScopeCatalog({
    query: {
      term: "2026-2",
      academicScope: {
        academicUnit: "Facultad de Ciencias Sociales",
        specialty: "Economia"
      }
    },
    readEntryHtml: async () => initialHtml,
    postCatalog: async (form) => {
      posts.push(form);
      return socialSciencesHtml;
    }
  });
  assert.equal(result, socialSciencesHtml);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].accion, "MostrarCriteriosCursoHor");
  assert.equal(posts[0].facultad, "14");
  assert.equal(posts[0].rama, "");
});

test("known Campus faculties load their live careers without reopening the popup form", async () => {
  const socialSciencesHtml = `
    <select name="facultad"><option value="14" selected>CIENCIAS SOCIALES</option></select>
    <select name="carrera"><option value="005-0">ECONOMIA</option></select>`;
  let reads = 0;
  const posts = [];
  const result = await prepareScheduleScopeCatalog({
    query: {
      term: "2026-2",
      academicScope: {
        academicUnit: "Facultad de Ciencias Sociales",
        specialty: "Economia"
      }
    },
    readEntryHtml: async () => {
      reads += 1;
      throw new Error("popup entry must not be required for a known faculty");
    },
    postCatalog: async (form) => {
      posts.push(form);
      return socialSciencesHtml;
    }
  });
  assert.equal(result, socialSciencesHtml);
  assert.equal(reads, 0);
  assert.equal(posts[0].facultad, "14");
});

test("schedule catalog explicitly opens the schedule entry after authentication", async () => {
  assert.equal(typeof readScheduleEntryPage, "function");
  const entryUrl = "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho?accion=Ingresar";
  const calls = [];
  const page = {
    async goto(url, options) {
      calls.push([url, options]);
      return { ok: () => true };
    },
    url() {
      return entryUrl;
    },
    async waitForFunction(_callback, _argument, options) {
      calls.push(["waitForFaculty", options]);
    },
    async content() {
      return '<select name="facultad"><option value="14">CIENCIAS SOCIALES</option></select>';
    }
  };
  const policy = {
    assertRequest(url) { assert.equal(url, entryUrl); },
    assertFinalUrl(url) { assert.equal(url, entryUrl); }
  };
  const html = await readScheduleEntryPage({ page, entryUrl, policy });
  assert.match(html, /CIENCIAS SOCIALES/);
  assert.deepEqual(calls, [
    [entryUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }],
    ["waitForFaculty", { timeout: 45_000 }]
  ]);
});

test("schedule catalog can use the authenticated frame-aware navigator", async () => {
  const entryUrl = "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho?accion=Ingresar";
  const policy = {
    assertRequest(url) { assert.equal(url, entryUrl); },
    assertFinalUrl(url) { assert.equal(url, entryUrl); }
  };
  const html = await readScheduleEntryPage({
    entryUrl,
    policy,
    navigate: async (url) => ({
      url,
      html: "<main>shell</main>",
      frames: [
        { url, html: '<select name="facultad"><option value="14">CIENCIAS SOCIALES</option></select>' }
      ]
    })
  });
  assert.match(html, /name="facultad"/);
});

function config(temporary) {
  return {
    user: "local-user",
    pass: "local-pass",
    baseUrl: "https://campus.example.edu",
    portalUrl: campusPortal,
    agendaEntryUrl: agendaEntry,
    agendaJsonUrl: agendaJson,
    authHosts: ["pandora.pucp.edu.pe"],
    readHosts: ["eros.pucp.edu.pe"],
    chromePath: "",
    maxResponseBytes: 1024,
    uniRoot: path.join(temporary, ".UNI V2"),
    privateRoot: path.join(temporary, "PUCP Privado")
  };
}

test("live participant lookup uses the dedicated authenticated roster reader", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-participants-"));
  const calls = [];
  const session = {
    async authenticate() {
      calls.push("authenticate");
      return campusPortal;
    },
    async queryCourseParticipants(options) {
      calls.push(["query", options]);
      return {
        url: "https://eros.pucp.edu.pe/pucp/notas/nownotfi/nownotfi?accion=Abrir&vernotas=0&cicloano=2026&ciclo=02&tipociclo=00&clavecurso=IND270",
        courseCode: "IND270",
        courseName: "Procesos Industriales",
        term: "2026-2",
        html: `<table><tr><th></th><th>Alumno</th><th>Nombre</th><th>Horario</th><th>Especialidad</th><th>E-mail</th><th>Enviar Mail</th></tr><tr><td></td><td>20990001</td><td>Ana Ejemplo</td><td>0731</td><td>Ingeniería Industrial</td><td>ana@example.invalid</td><td></td></tr></table>`
      };
    },
    async close() {
      calls.push("close");
    }
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-24T12:00:00.000Z"
  });

  const result = await adapter.getCourseParticipants({
    course: "IND270",
    schedule: "0731",
    includeEmail: false,
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false
  });

  assert.equal(result.courseCode, "IND270");
  assert.equal(result.items.length, 1);
  assert.equal(Object.hasOwn(result.items[0], "institutionalEmail"), false);
  assert.deepEqual(calls, [
    "authenticate",
    ["query", { course: "IND270" }],
    "close"
  ]);
});

test("live Campus adapter reuses one authenticated session across consecutive reads", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-session-reuse-"));
  let created = 0;
  let authenticated = 0;
  let closed = 0;
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    reuseSessions: true,
    createSession: async () => {
      created += 1;
      return {
        async authenticate() { authenticated += 1; return campusPortal; },
        async queryCourseParticipants() {
          return {
            url: "https://eros.pucp.edu.pe/pucp/notas/nownotfi/nownotfi?accion=Abrir&vernotas=0&cicloano=2026&ciclo=02&tipociclo=00&clavecurso=IND270",
            courseCode: "IND270",
            courseName: "Procesos Industriales",
            term: "2026-2",
            html: "<table><tr><th></th><th>Alumno</th><th>Nombre</th><th>Horario</th><th>Especialidad</th><th>E-mail</th><th>Enviar Mail</th></tr></table>"
          };
        },
        async close() { closed += 1; }
      };
    }
  });

  const input = {
    course: "IND270",
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false
  };
  await adapter.getCourseParticipants(input);
  await adapter.getCourseParticipants(input);
  assert.deepEqual({ created, authenticated, closed }, { created: 1, authenticated: 1, closed: 0 });
  assert.equal(adapter.getSessionMetrics().sessionReused, 1);
  await adapter.close();
  assert.equal(closed, 1);
});

test("course-link discovery waits for the asynchronously rendered Campus list", async () => {
  assert.equal(typeof liveAdapter.readVisibleCourseLinks, "function");
  let rendered = false;
  const page = {
    async waitForFunction(_predicate, _argument, options) {
      assert.deepEqual(options, { timeout: 45_000 });
      rendered = true;
    },
    locator(selector) {
      assert.equal(
        selector,
        'a[href*="PanelCursoPersonaCiclo"], a[onclick*="PanelCursoPersonaCiclo"]'
      );
      return {
        async evaluateAll() {
          assert.equal(rendered, true);
          return [
            { index: 0, label: "IND270", rowText: "IND270 Curso", navigation: "PanelCursoPersonaCiclo('IND270')" },
            { index: 1, label: "Curso", rowText: "IND270 Curso", navigation: "PanelCursoPersonaCiclo('IND270')" }
          ];
        }
      };
    }
  };

  const result = await liveAdapter.readVisibleCourseLinks(page);

  assert.equal(result[0].rowText, "IND270 Curso");
  assert.equal(result.length, 1);
});

test("course roster navigation waits for the Alumnos control after course-page navigation", async () => {
  assert.equal(typeof liveAdapter.waitForStudentsLink, "function");
  let waited = false;
  const link = {
    first() { return this; },
    async waitFor(options) {
      assert.deepEqual(options, { state: "visible", timeout: 45_000 });
      waited = true;
    }
  };
  const page = {
    getByText(label, options) {
      assert.equal(label, "Alumnos");
      assert.deepEqual(options, { exact: true });
      return link;
    }
  };

  assert.equal(await liveAdapter.waitForStudentsLink(page), link);
  assert.equal(waited, true);
});

test("injected live adapter performs metadata-only discovery and known agenda POST with no downloads", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-"));
  const calls = [];
  const portal = `
    <nav>
      <a href="${agendaEntry}">Mi agenda</a>
    </nav>`;
  const portalFrame = `
    <nav>
      <a href="https://campus.example.edu/pucp/notas/oficiales?accion=consultar">Notas oficiales</a>
      <a href="https://campus.example.edu/pucp/finanzas/estado?accion=consultar">Estado financiero</a>
    </nav>`;
  const grades = `
    <section data-module="official_grades">
      <p class="empty-state">No hay resultados para mostrar.</p>
    </section>`;
  const mutationPage = `
    <section data-module="financial">
      <form method="post" action="/pucp/finanzas/pagar"><button>Pagar</button></form>
    </section>`;
  const agendaBytes = Buffer.from(JSON.stringify({
    events: [{
      id: "1", category: "09",
      title: "PRÁCTICA DE SIMULACIÓN (2026-1, 1IND59, HORARIO 0834, SESIÓN PRESENCIAL)",
      description: "PRÁCTICA DE SIMULACIÓN (2026-1, 1IND59, HORARIO 0834, SESIÓN PRESENCIAL)",
      place: "E117",
      begin: { date: "20260724", time: "0800" },
      end: { date: "20260724", time: "1000" }
    }]
  }), "latin1");
  const session = {
    async authenticate(input) {
      calls.push([
        "authenticate",
        input.user,
        input.pass,
        input.entryUrl
      ]);
    },
    async goto(url) {
      calls.push(["goto", url]);
      if (url === campusPortal) {
        return {
          url,
          html: portal,
          frames: [
            { url, html: portal },
            {
              url: "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs",
              html: portalFrame
            }
          ]
        };
      }
      if (url.includes("/notas/")) return { url, html: grades };
      if (url.includes("/finanzas/")) return { url, html: mutationPage };
      if (url === agendaEntry) {
        return {
          url,
          html: `
            <main>Agenda</main>
            <form method="post" action="${agendaJson}">
              <input name="fechaInicio">
              <input name="fechaFin">
            </form>
          `
        };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    async post(url, options) {
      calls.push(["post", url, options.form]);
      return { status: 200, finalUrl: url, body: agendaBytes, headers: {} };
    },
    async close() {
      calls.push(["close"]);
    }
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-07-24T10:00:00.000Z"
  });
  const result = await adapter.sync({
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    start: "2026-07-24",
    end: "2026-07-31"
  });
  assert.equal(result.modules.agenda.items[0].course, "SIMULACIÓN");
  assert.deepEqual(result.modules.official_grades.items, []);
  assert.equal(result.modules.financial.state, "unavailable");
  assert.equal(result.modules.financial.reason, "mutation_refused");
  assert.equal(result.modules.curriculum.reason, "role_unavailable");
  const authentication = calls.find(([kind]) => kind === "authenticate");
  assert.equal(authentication[3], agendaEntry);
  const post = calls.find(([kind]) => kind === "post");
  assert.deepEqual(post[2], {
    fechaInicio: "20260724",
    fechaFin: "20260731",
    categoria: "",
    grupo: "00"
  });
  assert.equal(calls.some(([kind]) => kind === "download"), false);
});

test("legacy course hub fans out to partial grades, history, and current enrolled courses", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-academic-"));
  const calls = [];
  const courseHubUrl =
    "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar";
  const portal = `
    <a onclick="actualizarIframe('/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar')">
      Cursos y actividades
    </a>
    <a onclick="actualizarIframe('/pucp/pubweb/puwpubli/puwpubli?accion=Busqueda')">
      Documentos
    </a>
    <a onclick="actualizarIframe('/pucp/solservi/sowtraca/sowtraca?accion=ListarTramites')">
      Trámites académicos
    </a>`;
  const courseHub = `
    <form name="formresultado">
      <input name="persona" value="20990001">
      <input name="cicloAnoMatri" value="2026">
      <input name="cicloMatri" value="01">
      <input name="tipoCicloMatri" value="00">
      <input name="session" value="secret-session">
    </form>`;
  const partialGrades = `
    <h2>Notas Parciales del ciclo 2026-1</h2>
    <form method="post" action="/pucp/notas/reclamar">
      <button>Enviar reclamo</button>
    </form>
    <table>
      <tr><td colspan="3">SIMULACIÓN(1IND59)</td></tr>
      <tr><td colspan="3">Fórmula de Calificación: ( 2Pb ) / 2</td></tr>
      <tr><td></td><td colspan="2">Práctica tipo B</td></tr>
      <tr><td>Nro</td><td>1</td><td>2</td></tr>
      <tr><td>Nota</td><td>17</td><td>8</td></tr>
    </table>`;
  const history = `
    <form method="post" action="/pucp/notas/solicitar-certificado">
      <button>Solicitar certificado</button>
    </form>
    <table><tr><td>Ciclo : 2026-1</td></tr><tr><td>Notas NO OFICIAL</td></tr></table>
    <table>
      <tr>
        <th>Clave</th><th>Nombre del Curso</th><th>Créd</th><th>Vez</th>
        <th>Tipo</th><th>Horario</th><th>Modalidad</th><th>Nota</th>
        <th>CalificaciónECTS</th><th>Mérito/Aprobados</th>
        <th>Mérito/Total</th><th>TM</th><th>Profesor</th>
      </tr>
      <tr>
        <td>1IND59</td><td>SIMULACIÓN</td><td>3.5</td><td>1</td>
        <td>CLASE</td><td>0834</td><td>PRESENCIAL</td><td>15.00</td>
        <td>B</td><td>29/107</td><td>18/109</td><td>1</td><td>DOCENTE</td>
      </tr>
    </table>`;
  const personalPanel = `
    <a href="javascript:location.href='/pucp/rendimi/rewrenac/rewrenac?accion=Ingresar&codigo=20990001'">
      Rendimiento académico
    </a>
    <a href="javascript:location.href='/pucp/ctrlcurr/ccwconso/ccwconso?accion=EscogerFacultad&alumno=20990001'">
      Consolidado curricular
    </a>
    <a href="javascript:location.href='/pucp/cobralum/cawdocpg/cawdocpg?accion=Buscar&Codigo=20990001&misdatos=1'">
      Documentos de pago
    </a>
    <a href="javascript:mostrarAlertaIdioma('/pucp/cobralum/cawoblig/cawoblig?accion=Ingresar&Codigo=20990001&misdatos=1')">
      Obligaciones de pago
    </a>
    <button onclick="mostrarAlertaIdioma('/pucp/solservi/sowtraca/sowtraca?accion=MostrarBusquedaSolicitudes&indAlu=1&codAlumno=20990001')">
      Seguimiento de trámites académicos
    </button>
    <a href="javascript:location.href='/pucp/document/dowdocum/dowdocum?accion=VerCursos'">
      Programas analíticos de cursos
    </a>`;
  const financial = `
    <h2>Documentos de Pagos</h2>
    <form method="post" action="/pucp/cobralum/cawdocpg/cawdocpg">
      <input name="accion" value="Imprimir">
    </form>
    <table>
      <tr><th>Ciclo</th><th>Documento</th><th>U.M.</th><th>Importe</th><th>Estado</th><th>Vence</th><th>Pago</th></tr>
      <tr><td>2026-1</td><td>Cuota 1</td><td>S/</td><td>100.00</td><td>CANCELADA</td><td>10-03-2026</td><td>09-03-2026</td></tr>
    </table>`;
  const obligations = `
    <h2>Obligaciones de Pago</h2>
    <table><tr><td>Objetos Adeudados</td></tr></table>`;
  const requests = `
    <h2>Búsqueda de trámites académicos</h2>
    <table><tr><td>Constancias y cartas</td><td>1 ocurrencia(s)</td></tr></table>
    <table>
      <tr><th>N° Solicitud</th><th>Fecha y hora de registro</th><th>Fecha y hora de pago</th><th>Estado</th><th>Observación/Dictamen</th></tr>
      <tr><td>REQ-1</td><td>01/07/2026</td><td>02/07/2026</td><td>ATENDIDA</td><td>Lista</td></tr>
    </table>
    <form method="post" action="/pucp/solservi/sowtraca/sowtraca">
      <input name="accion" value="EditarSolicitudes">
    </form>`;
  const documents = `
    <h2>Documentos de cursos y actividades</h2>
    <form><input name="usuario" value="20990001"><input name="session" value="secret-session"></form>
    <table><tr><th></th><th>Nombres</th></tr><tr><td>1</td><td><a href="javascript:Documentos('202601001IND59','CU');">Simulación 1IND59 (2026-1)</a></td></tr></table>
    <form method="post" action="/pucp/document/dowdocum/dowdocum">
      <input name="accion" value="Publicar">
    </form>`;
  const courseDocuments = `
    <h2>DOCUMENTOS DEL CURSO</h2>
    <input name="cicloano" value="2026"><input name="ciclo" value="01">
    <input name="clavecurso" value="1IND59"><input name="session" value="secret-session">
    <div><img alt="Documento xlsx"><a class="mArchD" href="javascript:mArcD('04983502');">Grupos TA (17.8 KB)</a></div>`;
  const performance = `
    <h1>Rendimiento Académico</h1>
    <p>Alumnos Matriculados en CIENCIAS E ING. en el ciclo 2026-1</p>
    <p>Orden de Mérito en CIENCIAS E ING. 20 de 100 (20 %)</p>
    <p>CRA Estandarizado 80.5</p>
    <p>Promedio General Aprobados 15.5</p>
    <p>Promedio General Ponderado 15.25</p>
    <p>Promedio General Ponderado Últimos 4 Ciclos 15.0</p>`;
  const curriculum = `
    <h1>Consolidado curricular</h1>
    <table>
      <tr><td>Unidad académica</td><td>CIENCIAS E INGENIERIA</td></tr>
      <tr><td>Especialidad</td><td>INGENIERÍA INDUSTRIAL</td></tr>
      <tr><td>Etapa</td><td>PREGRADO EN FACULTAD</td></tr>
      <tr><td>Plan de estudios</td><td>35 - Vigente</td></tr>
    </table>
    <table>
      <tr><th>Clave</th><th>Nombre del curso</th><th>Tipo</th><th>Créditos</th><th>Vez</th><th>Nota</th><th>Ciclo</th><th>Equivalencia</th><th>Observación</th></tr>
      <tr><td>1IND59</td><td>SIMULACIÓN</td><td>OBL</td><td>3.5</td><td>1</td><td>15</td><td>2026-1</td><td></td><td></td></tr>
    </table>`;
  const studentSchedule = await readFile(
    new URL("./fixtures/legacy-student-schedule.html", import.meta.url),
    "utf8"
  );
  const session = {
    async authenticate() {},
    async goto(url) {
      calls.push(url);
      if (url === campusPortal) {
        return {
          url,
          html: portal,
          frames: [{ url, html: portal }]
        };
      }
      if (url === courseHubUrl) return { url, html: courseHub };
      if (url.includes("/nownotpa/")) return { url, html: partialGrades };
      if (url.includes("/nowhisno/")) return { url, html: history };
      if (url.includes("/howhorac/")) return { url, html: studentSchedule };
      if (url.includes("accion=AbrirPanel")) return { url, html: personalPanel };
      if (url.includes("/cawdocpg/")) return { url, html: financial };
      if (url.includes("/cawoblig/")) return { url, html: obligations };
      if (url.includes("MostrarBusquedaSolicitudes")) return { url, html: requests };
      if (url.includes("/dowdocum/") && url.includes("accion=Ingresar")) {
        return { url, html: courseDocuments };
      }
      if (url.includes("/dowdocum/")) return { url, html: documents };
      if (url.includes("/sowtraca/") || url.includes("/puwpubli/")) {
        return {
          url,
          html: `<form method="post" action="/pucp/mutating"><button>Enviar</button></form>`
        };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    async queryLegacyReadPage(module, url) {
      calls.push(["queryLegacyReadPage", module, url]);
      if (module === "academic_performance") {
        return { url: url.split("?")[0], html: performance };
      }
      if (module === "curriculum") {
        return { url: url.split("?")[0], html: curriculum };
      }
      throw new Error(`unexpected read query ${module}`);
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-07-24T10:00:00.000Z"
  });

  const result = await adapter.sync({
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false
  });

  assert.equal(result.modules.official_grades.state, "available");
  assert.equal(result.modules.official_grades.items[0].grade, "17");
  assert.equal(result.modules.official_grades.items[0].status, "No oficial");
  assert.equal(
    result.modules.official_grades.items.find(({ item }) => item === "Nota final").grade,
    "15.00"
  );
  assert.equal(result.modules.academic_history.items[0].courseCode, "1IND59");
  assert.equal(result.modules.academic_performance.items[0].craest, 80.5);
  assert.equal(result.modules.curriculum.items[0].code, "1IND59");
  assert.deepEqual(result.modules.enrollment.value, {
    term: "2026-1",
    turn: 1,
    status: "Matriculado",
    allowedCourses: null,
    results: "1 curso matriculado"
  });
  assert.equal(result.modules.financial.value.totalDue, 0);
  assert.equal(result.modules.financial.value.status, "Al día");
  assert.deepEqual(result.modules.obligations.items, []);
  assert.equal(result.modules.requests.items[0].id, "REQ-1");
  assert.equal(result.modules.documents.items[0].title, "Grupos TA");
  assert.equal(result.modules.documents.items[0].downloadable, true);
  assert.equal(result.modules.student_schedule.state, "available");
  assert.equal(result.modules.student_schedule.source, "student_schedule_page");
  assert.equal(result.modules.student_schedule.items[0].room, "A303");
  assert.deepEqual(result.modules.enrolled_courses.items, [{
    code: "1IND59",
    name: "SIMULACIÓN",
    term: "2026-1",
    schedule: "0834",
    modality: "PRESENCIAL",
    place: "",
    status: "Matriculado"
  }]);
  assert.equal(calls.some((url) => url.includes("secret-session")), false);
});

test("grade statistics adapter opens only the captured partial and final read references", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-statistics-"));
  const html = await readFile(
    new URL("./fixtures/legacy-grade-statistics.html", import.meta.url)
  );
  const calls = [];
  const session = {
    async authenticate({ entryUrl }) {
      calls.push({ authenticate: entryUrl });
      return entryUrl;
    },
    async queryGradeStatistics(reference, kind, entryUrl) {
      calls.push({ kind, reference, entryUrl });
      return {
        url: `https://eros.pucp.edu.pe/pucp/estadist/${kind}`,
        html: html.toString("utf8")
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session
  });

  const partial = await adapter.getPartialGradeStatistics({
    kind: "partial",
    courseCode: "IEE272",
    year: "2026",
    cycle: "01",
    cycleType: "00",
    evaluationType: "Ex",
    evaluationNumber: 2,
    schedule: "0831",
    commission: ""
  });
  const final = await adapter.getFinalGradeStatistics({
    kind: "final",
    courseCode: "1IND50",
    year: "2026",
    cycle: "01",
    cycleType: "00",
    faculty: "12",
    meritType: "1",
    schedule: "0731"
  });

  assert.equal(partial.summary.mean, 10.45);
  assert.equal(final.summary.median, 10);
  assert.deepEqual(calls, [
    {
      authenticate:
        "https://eros.pucp.edu.pe/pucp/notas/nownotpa/nownotpa?accion=Ingresar&codigo=local-user&cicloano=2026&ciclo=01&tipociclo=00"
    },
    {
      kind: "partial",
      entryUrl:
        "https://eros.pucp.edu.pe/pucp/notas/nownotpa/nownotpa?accion=Ingresar&codigo=local-user&cicloano=2026&ciclo=01&tipociclo=00",
      reference: {
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
      authenticate:
        "https://eros.pucp.edu.pe/pucp/notas/nowhisno/nowhisno?accion=Ingresar&codigo=local-user"
    },
    {
      kind: "final",
      entryUrl:
        "https://eros.pucp.edu.pe/pucp/notas/nowhisno/nowhisno?accion=Ingresar&codigo=local-user",
      reference: {
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
  ]);
});

test("schedule catalog adapter uses the shared public report and never authenticates or opens the Campus generator", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-schedules-"));
  const calls = [];
  const html = `
    <table>
      <tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Hor. Aso</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Resultados de encuesta docente</th><th>Sesiones</th><th>Sesiones presenciales</th><th>¿Tiene sesiones virtuales?</th></tr>
      <tr><td>1IND50</td><td>Gestión del talento humano</td><td>3</td><td>Cla</td><td>0831</td><td></td><td>30</td><td>25</td><td>20</td><td>10</td><td>DOCENTE</td><td>4.5</td><td>Lunes 08:00-10:00 Z202</td><td>1</td><td>No</td></tr>
    </table>`;
  const session = {
    async authenticate({ entryUrl }) {
      calls.push(["authenticate", entryUrl]);
    },
    async queryCourseSchedules(query, entryUrl) {
      calls.push(["queryCourseSchedules", query, entryUrl]);
      return { url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho", html };
    },
    async close() {
      calls.push(["close"]);
    }
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-02T12:00:00.000Z"
  });
  const result = await adapter.searchScheduleCatalog({
    term: "2026-2",
    courseCodes: ["1IND50"],
    academicScope: null,
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    useCampusGenerator: false
  });
  assert.equal(result.state, "available");
  assert.equal(result.items[0].scheduleId, "0831");
  assert.equal(calls.some(([kind]) => kind === "authenticate"), false);
  assert.match(calls.find(([kind]) => kind === "queryCourseSchedules")[2], /howcurho\/howcurho\?accion=Ingresar$/);
  assert.equal(calls.some(([, value]) => /howgenho/i.test(String(value))), false);
  await assert.rejects(
    adapter.searchScheduleCatalog({ term: "2026-2", courseCodes: ["1IND50"], useCampusGenerator: true }),
    (error) => error.code === "mutation_refused"
  );
});

test("course schedule adapter falls back to exact per-course reports when a batch layout is unsupported", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-schedule-fallback-"));
  const calls = [];
  const scheduleHtml = (courseCode, scheduleId) => `
    <table>
      <tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Hor. Aso</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Resultados de encuesta docente</th><th>Sesiones</th><th>Sesiones presenciales</th><th>¿Tiene sesiones virtuales?</th></tr>
      <tr><td>${courseCode}</td><td>Curso ${courseCode}</td><td>3</td><td>Cla</td><td>${scheduleId}</td><td></td><td>30</td><td>25</td><td>20</td><td>10</td><td>DOCENTE</td><td>4.5</td><td>Lunes 08:00-10:00 Z202</td><td>1</td><td>No</td></tr>
    </table>`;
  const session = {
    async authenticate() {},
    async queryCourseSchedules(query) {
      calls.push([...query.courseCodes]);
      if (query.courseCodes.length > 1) {
        return {
          url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
          html: "<html><body>Consulta no procesada</body></html>"
        };
      }
      const courseCode = query.courseCodes[0];
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
        html: scheduleHtml(courseCode, courseCode === "1IND52" ? "0801" : "0901")
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-02T12:00:00.000Z"
  });
  const result = await adapter.searchScheduleCatalog({
    term: "2026-2",
    courseCodes: ["1IND52", "IND270"],
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    useCampusGenerator: false
  });
  assert.equal(result.state, "available");
  assert.deepEqual(result.items.map(({ courseCode }) => courseCode), ["1IND52", "IND270"]);
  assert.deepEqual(calls, [["1IND52", "IND270"], ["1IND52"], ["IND270"]]);
});

test("registration adapter reads Inscríbete aquí as the primary current schedule source", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-registration-primary-"));
  const calls = [];
  const registeredPayload = JSON.stringify({
    error: false,
    data: [["ECO253", "ECONOMÍA", "3", [
      ["T", "0531", "9/30", "1", "DOCENTE", "LUN 08:00-10:00 C", "0", "Inscrito", "1", "0"],
      ["E", "0531", "", "1", "DOCENTE", "MAR 08:00-10:00 C", "0", "Inscrito", "0", "0"]
    ], "1", "1"]]
  });
  const html = `
    <h1>Matrícula <span>Ciclo: 2026-2</span></h1><h2>Inscripción registrada</h2><div>Turno: 10 de 100</div>
    <select name="facultad"><option value="14">CIENCIAS SOCIALES</option></select>
    <select name="especialidad"><option value='{"rama":"005","especialidad":"0","etapa":"02","facultad":"14"}'>ECONOMÍA</option></select>
    <table><tr><th>Clave</th><th>Nombre del Curso</th><th>Créd.</th><th>Eliminar</th><th>Tipo</th><th>Horario</th><th>Estado</th><th>Posic. Relat.</th><th>Docentes</th><th>Sesiones</th></tr>
    <tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td><input name="cursosEliminar" value="ECO253T0531"></td><td>CLA</td><td>0531</td><td>Inscrito</td><td>8 de 30</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>
    <table><tr><th>Clave</th><th>Nombre del Curso</th><th>Créd.</th><th>Agregar</th><th>Tipo</th><th>Horario</th><th>Hor. Aso.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Docentes</th><th>Sesiones</th><th>¿Tiene sesiones virtuales?</th></tr>
    <tr><td colspan="14">Nivel: 7</td></tr><tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td><input name="cursosAgregar" value="ECO253T0531"></td><td>CLA</td><td>0531</td><td></td><td>30</td><td>30</td><td>12</td><td></td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td><td>No</td></tr></table>`;
  const session = {
    async authenticate({ entryUrl }) { calls.push(["authenticate", entryUrl]); },
    async queryRegistrationWorkspace(filters) {
      calls.push(["workspace", filters]);
      return {
        url: "https://eros.pucp.edu.pe/pucp/prematri/pmwmatrc/pmwmatrc?accion=MostrarInscripcion",
        html,
        registeredPayload,
        ...(filters.courseCodes?.length ? {
          searchPayload: JSON.stringify({ mode: 2, data: [[7, 1, [["ECO253", "ECONOMÍA", 3, [["0531", "T", "0", "", "1", "", "DOCENTE", "LUN 08:00-10:00 C", "30", "30", "12", "0", "0", "1", "0"]]]]]] })
        } : {})
      };
    },
    async queryCourseSchedules() {
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
        html: `<table><tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Sesiones</th></tr><tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td>Cla</td><td>0531</td><td>29</td><td>30</td><td>12</td><td>0</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>`
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary), createSession: async () => session,
    now: () => "2026-08-04T18:00:00.000Z"
  });
  const workspace = await adapter.readRegistrationWorkspace({ metadataOnly: true, allowDownloads: false, allowMutations: false });
  assert.equal(workspace.activeTerm, "2026-2");
  const result = await adapter.searchCurrentCourseSchedules({ courseCodes: ["ECO253"], metadataOnly: true, allowDownloads: false, allowMutations: false, useCampusGenerator: false });
  assert.equal(result.items[0].courseCode, "ECO253");
  assert.equal(result.items[0].capacity.userPosition, 9);
  assert.equal(result.items[0].position.raw, "9/30");
  assert.equal(result.items[0].capacity.vacancies, 30);
  assert.deepEqual(result.sourcesUsed, ["enrollment_portal", "schedule_catalog"]);
  assert.equal(result.differences[0].field, "vacancies");
  assert.equal(calls.some(([kind]) => kind === "workspace"), true);
  assert.equal(calls.filter(([kind]) => kind === "authenticate").length, 2);
});

test("current schedule search falls back to the shared catalog when registration is closed", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-registration-closed-"));
  const calls = [];
  const session = {
    async authenticate() { calls.push("authenticate"); },
    async queryRegistrationWorkspace() {
      calls.push("registration");
      const error = new Error("Registration portal is no longer visible");
      error.code = "registration_portal_not_visible";
      throw error;
    },
    async queryCourseSchedules(options) {
      calls.push(["catalog", options.term, options.academicScope ?? null]);
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
        html: `<table><tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Sesiones</th></tr><tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td>Cla</td><td>0531</td><td>29</td><td>30</td><td>12</td><td>0</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>`
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-21T12:00:00.000Z"
  });

  const result = await adapter.searchCurrentCourseSchedules({
    term: "2026-2",
    courseCodes: ["ECO253"],
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    useCampusGenerator: false
  });

  assert.equal(result.state, "available");
  assert.equal(result.source, "schedule_catalog");
  assert.deepEqual(result.sourcesUsed, ["schedule_catalog"]);
  assert.equal(result.activeTerm, "2026-2");
  assert.equal(result.items[0].courseCode, "ECO253");
  assert.match(result.warnings[0], /differ/i);
  assert.deepEqual(calls.slice(0, 2), ["authenticate", "registration"]);
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "catalog"), true);
});

test("current external academic scope falls back to the shared catalog when enrollment scope is unavailable", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-registration-external-scope-"));
  const calls = [];
  const session = {
    async authenticate() { calls.push("authenticate"); },
    async queryRegistrationWorkspace() {
      calls.push("registration");
      const error = new Error("External faculty is absent from the enrollment scope");
      error.code = "schedule_scope_not_found";
      throw error;
    },
    async queryCourseSchedules(options) {
      calls.push(["catalog", options.term, options.academicScope]);
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
        html: `<table><tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Profesor</th><th>Sesiones</th></tr><tr><td>1ECO15</td><td>ECONOMÍA</td><td>3</td><td>Cla</td><td>0721</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>`
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-28T12:00:00-05:00"
  });
  const result = await adapter.searchCurrentCourseSchedules({
    term: "2026-2",
    academicScope: { academicUnit: "CIENCIAS SOCIALES", specialty: "ECONOMÍA" },
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    useCampusGenerator: false
  });
  assert.equal(result.state, "available");
  assert.equal(result.source, "schedule_catalog");
  assert.deepEqual(result.sourcesUsed, ["schedule_catalog"]);
  assert.equal(result.activeTerm, "2026-2");
  assert.equal(result.items[0].courseCode, "1ECO15");
  assert.match(result.warnings[0], /academic scope.*enrollment.*catalog/i);
  assert.deepEqual(calls.slice(0, 2), ["authenticate", "registration"]);
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "catalog"), true);
});

test("current schedule search goes directly to the catalog when registration is known to be closed", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-registration-skipped-"));
  const calls = [];
  const session = {
    async authenticate() {
      calls.push("authenticate");
      throw new Error("registration authentication must be skipped");
    },
    async queryRegistrationWorkspace() {
      calls.push("registration");
      throw new Error("registration workspace must be skipped");
    },
    async queryCourseSchedules() {
      calls.push("catalog");
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
        html: `<table><tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Sesiones</th></tr><tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td>Cla</td><td>0531</td><td>29</td><td>30</td><td>12</td><td>0</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>`
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-21T12:00:00-05:00"
  });

  const result = await adapter.searchCurrentCourseSchedules({
    term: "2026-2",
    courseCodes: ["ECO253"],
    preferRegistrationPortal: false,
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    useCampusGenerator: false
  });

  assert.equal(result.source, "schedule_catalog");
  assert.deepEqual(result.sourcesUsed, ["schedule_catalog"]);
  assert.deepEqual(calls, ["catalog"]);
  assert.match(result.warnings[0], /differ/i);
});

test("academic-scope current search uses the catalog after registration closes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-registration-scope-"));
  const session = {
    async authenticate() {},
    async queryRegistrationWorkspace() {
      const error = new Error("Registration portal is not visible");
      error.code = "registration_portal_not_visible";
      throw error;
    },
    async queryCourseSchedules(options) {
      assert.equal(options.academicScope.academicUnit, "CIENCIAS SOCIALES");
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho",
        html: `<table><tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Sesiones</th></tr><tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td>Cla</td><td>0531</td><td>29</td><td>30</td><td>12</td><td>0</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>`
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session
  });
  const result = await adapter.searchCurrentCourseSchedules({
    term: "2026-2",
    academicScope: { academicUnit: "CIENCIAS SOCIALES" },
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false,
    useCampusGenerator: false
  });
  assert.equal(result.items[0].courseCode, "ECO253");
});

test("confirmed registration adapter sends only prepared opaque references", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-registration-write-"));
  const calls = [];
  const after = { state: "available", activeTerm: "2026-2", retrievedAt: "2026-08-04T18:00:00.000Z", registered: [{ courseCode: "1IND50", scheduleId: "0831", position: { raw: "8 de 30", rank: 8 } }], offerings: [], scopes: {} };
  const session = {
    async authenticate({ entryUrl }) { calls.push(["authenticate", entryUrl]); },
    async commitRegistrationChange(input) { calls.push(["commit", input]); return after; },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({ loadConfig: async () => config(temporary), createSession: async () => session });
  const result = await adapter.commitCourseRegistration({ activeTerm: "2026-2", addRefs: ["1IND50T0831"], removeRefs: ["IND345T1031"], allowMutations: true, confirmationToken: "opaque-token" });
  assert.equal(result.registered[0].position.rank, 8);
  assert.deepEqual(calls[1][1], { activeTerm: "2026-2", addRefs: ["1IND50T0831"], removeRefs: ["IND345T1031"], addCourseCodes: [] });
  await assert.rejects(
    adapter.commitCourseRegistration({ activeTerm: "2026-2", addRefs: ["1IND50T0831"], removeRefs: [], allowMutations: false }),
    (error) => error.code === "mutation_refused"
  );
});

test("registration changes settle only after pure removals disappear", () => {
  assert.equal(typeof liveAdapter.registrationChangesApplied, "function");
  const enrolled = {
    registered: [{ internalSelectionRef: "1IND92T1031" }]
  };
  assert.equal(liveAdapter.registrationChangesApplied(enrolled, {
    addCourseCodes: [],
    removeRefs: ["1IND92T1031"]
  }), false);
  assert.equal(liveAdapter.registrationChangesApplied({ registered: [] }, {
    addCourseCodes: [],
    removeRefs: ["1IND92T1031"]
  }), true);
});

test("historical schedule adapter uses the public report without Campus authentication", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-public-history-"));
  let authenticated = false;
  const html = `<table><tr><th>Clave</th><th>Nombre del curso</th><th>Cr.</th><th>Tipo Hor.</th><th>Hor.</th><th>Vac.</th><th>Vac.Unid</th><th>Ins.</th><th>Mat.</th><th>Profesor</th><th>Sesiones</th></tr><tr><td>ECO253</td><td>ECONOMÍA</td><td>3</td><td>Cla</td><td>0531</td><td>30</td><td>30</td><td>12</td><td>10</td><td>DOCENTE</td><td>LUN 08:00-10:00 C</td></tr></table>`;
  const session = {
    async authenticate() { authenticated = true; throw new Error("must not authenticate"); },
    async queryCourseSchedules() { return { url: "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho", html }; },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({ loadConfig: async () => config(temporary), createSession: async () => session });
  const result = await adapter.searchHistoricalCourseSchedules({ term: "2026-1", courseCodes: ["ECO253"], metadataOnly: true, allowDownloads: false, allowMutations: false, useCampusGenerator: false });
  assert.equal(authenticated, false);
  assert.equal(result.items[0].term, "2026-1");
  assert.equal(result.source, "schedule_catalog");
  assert.deepEqual(result.sourcesUsed, ["schedule_catalog"]);
});

test("live sync catalogs enrollment portal, calendar, and allowed courses without enrollment actions", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-enrollment-"));
  const crossUnitVacancies = await readFile(
    new URL("./fixtures/cross-unit-vacancies.html", import.meta.url),
    "utf8"
  );
  const portal = `
    <h1>Matrícula 2026-2</h1>
    <nav data-enrollment-tabs>
      <a href="#student">Datos del Alumno</a><a href="#courses">Cursos y Horarios</a>
      <a href="#exceptions">Excepciones</a><a href="#services">Seguros y Servicios</a>
      <a href="#contact">Contáctanos</a>
    </nav>
    <section id="student"><span>Cursos Permitidos</span></section>
    <section id="courses"><a href="/pucp/horarios/howcurho/howcurho?accion=Ingresar">Consulta de horarios</a><a href="javascript:EnlaceNuevaPaginaInscripcion()">Inscríbete aquí</a></section>
    <h3>Calendario de Matrícula</h3>
    <p><b>Publicación de horarios, turnos de matrícula y cursos permitidos</b><br>Domingo, 2 de agosto de 2026</p>
    <p><b>Matrícula vía Campus Virtual</b><br>Del martes, 4 de agosto de 2026 (desde las 8:00 a.m.) al jueves, 6 de agosto de 2026 (hasta las 9:00 p.m.)</p>`;
  const allowed = `
    <h2>Cursos Permitidos</h2>
    <table><tr><th>Clave</th><th>U. Curso</th><th>Nombre del Curso</th><th>Cred.</th><th>Tipo Curso</th><th>Niv.</th><th>Vez</th><th>Excepción</th><th>¿Sale a Matrícula?</th><th>Horarios Secundarios</th><th>Cursos Simultáneos</th><th>Considerar Simultaneidad</th><th>Fecha de registro</th></tr>
    <tr><td>1IND50</td><td>CIENCIAS E ING.</td><td>GESTIÓN DEL TALENTO</td><td>3</td><td>OBLIGATORIO</td><td>7</td><td>1</td><td>NO</td><td>T</td><td>E</td><td>---</td><td>Si</td><td>30-07-2026 05:24 PM</td></tr></table>`;
  const calls = [];
  const session = {
    async authenticate() {},
    async goto(url) {
      calls.push(["goto", url]);
      if (url === campusPortal) return { url, html: portal, frames: [{ url, html: portal }] };
      throw new Error(`unexpected URL ${url}`);
    },
    async queryAllowedCourses(term) {
      calls.push(["queryAllowedCourses", term]);
      return { url: "https://eros.pucp.edu.pe/pucp/ctrlcurr/ccwcurpe/ccwcurpe", html: allowed };
    },
    async queryEnrollmentImpediments(term) {
      calls.push(["queryEnrollmentImpediments", term]);
      return { body: "<datos><error></error><impedimentos></impedimentos></datos>" };
    },
    async queryCrossUnitVacancies(term) {
      calls.push(["queryCrossUnitVacancies", term]);
      return {
        url: "https://eros.pucp.edu.pe/pucp/horarios/howvacdi/howvacdi?accion=MostrarResultadosConsultaVacantesDifAlumno&cicloano=2026&ciclo=02&tipociclo=00&cmbUnidad=",
        html: crossUnitVacancies
      };
    },
    async close() {}
  };
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => session,
    now: () => "2026-08-02T12:00:00.000Z"
  });
  const result = await adapter.sync({ metadataOnly: true, allowDownloads: false, allowMutations: false });
  assert.equal(result.modules.enrollment_portal.state, "available");
  assert.equal(result.modules.enrollment_portal.value.sections.length, 5);
  assert.equal(result.modules.enrollment_calendar.items[0].id, "schedule_publication");
  assert.equal(result.modules.allowed_courses.items[0].code, "1IND50");
  assert.equal(result.modules.enrollment_impediments.state, "available");
  assert.deepEqual(result.modules.enrollment_impediments.items, []);
  assert.equal(Object.hasOwn(result.modules, "semester_programming"), false);
  assert.equal(result.modules.cross_unit_vacancies.state, "available");
  assert.equal(result.modules.cross_unit_vacancies.items[0].courseCode, "MAT291");
  assert.equal(Object.hasOwn(result.modules, "postgraduate_offerings"), false);
  assert.deepEqual(calls.find(([kind]) => kind === "queryAllowedCourses")[1], { term: "2026-2" });
  assert.deepEqual(calls.find(([kind]) => kind === "queryEnrollmentImpediments")[1], { term: "2026-2" });
  assert.deepEqual(calls.find(([kind]) => kind === "queryCrossUnitVacancies")[1], { term: "2026-2" });
  assert.equal(JSON.stringify(result).includes("EnlaceNuevaPaginaInscripcion"), false);
  const direct = await adapter.getAllowedCourses({
    term: "2026-2",
    metadataOnly: true,
    allowDownloads: false,
    allowMutations: false
  });
  assert.equal(direct.items[0].code, "1IND50");
});

test("live sync refuses any invocation that could broaden beyond metadata-only read access", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-live-refuse-"));
  const adapter = createLiveCampusAdapter({
    loadConfig: async () => config(temporary),
    createSession: async () => {
      throw new Error("must not create a session");
    }
  });
  await assert.rejects(
    adapter.sync({ metadataOnly: false }),
    (error) => error.code === "mutation_refused"
  );
  await assert.rejects(
    adapter.sync({ metadataOnly: true, allowDownloads: true, allowMutations: false }),
    (error) => error.code === "mutation_refused"
  );
});

test("page content waits for a secondary Campus navigation before retrying", async () => {
  let reads = 0;
  let waits = 0;
  const page = {
    async content() {
      reads += 1;
      if (reads === 1) {
        throw new Error(
          "page.content: Unable to retrieve content because the page is navigating and changing the content."
        );
      }
      return "<main>Campus estable</main>";
    },
    async waitForLoadState(state, options) {
      assert.equal(state, "domcontentloaded");
      assert.deepEqual(options, { timeout: 15_000 });
      waits += 1;
    }
  };

  const html = await readStablePageContent(page);

  assert.equal(html, "<main>Campus estable</main>");
  assert.equal(reads, 2);
  assert.equal(waits, 1);
});

test("portal frame collection keeps only allowlisted read frames", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-frames-"));
  const policy = createCampusUrlPolicy(config(temporary));
  const frame = (url, html) => ({
    url() {
      return url;
    },
    async content() {
      return html;
    }
  });
  let networkIdleWaits = 0;
  const page = {
    async waitForLoadState(state, options) {
      assert.equal(state, "networkidle");
      assert.deepEqual(options, { timeout: 5_000 });
      networkIdleWaits += 1;
    },
    frames() {
      return [
        frame(campusPortal, "<main>Portal</main>"),
        frame(
          "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs",
          "<nav>Menú académico</nav>"
        ),
        frame("https://evil.example/frame", "<p>Foreign</p>")
      ];
    }
  };

  const frames = await readAllowedPageFrames(page, policy);

  assert.equal(networkIdleWaits, 1);
  assert.deepEqual(frames, [
    { url: campusPortal, html: "<main>Portal</main>" },
    {
      url: "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs",
      html: "<nav>Menú académico</nav>"
    }
  ]);
});

test("Campus login waits through Pandora until a read origin settles", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-landing-"));
  const policy = createCampusUrlPolicy(config(temporary));
  let currentUrl =
    "https://pandora.pucp.edu.pe/pucp/idp/profile/SAML2/Callback";
  let waits = 0;
  const page = {
    url() {
      return currentUrl;
    },
    async waitForURL(predicate, options) {
      assert.equal(
        predicate(new URL(currentUrl)),
        false
      );
      const redirector = new URL("https://campus.example.edu/");
      assert.equal(predicate(redirector), false);
      const landing = new URL(
        "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
      );
      assert.equal(predicate(landing), true);
      assert.deepEqual(options, {
        waitUntil: "commit",
        timeout: 15_000
      });
      waits += 1;
      currentUrl = landing.href;
    }
  };

  await waitForCampusLanding(page, policy);

  assert.equal(waits, 1);
  assert.equal(
    page.url(),
    "https://eros.pucp.edu.pe/pucp/jsp/Intranet.jsp"
  );
});

function response({ status, url, location = "", body = "ok" }) {
  let disposed = false;
  return {
    status: () => status,
    url: () => url,
    headers: () => location ? { location } : {},
    body: async () => Buffer.from(body),
    dispose: async () => { disposed = true; },
    wasDisposed: () => disposed
  };
}

test("manual GET redirects validate Location before the next request", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-redirect-get-"));
  const policy = createCampusUrlPolicy(config(temporary));
  const first = response({
    status: 302,
    url: "https://campus.example.edu/pucp/documentos/DOC.pdf",
    location: "https://evil.example/steal"
  });
  const calls = [];
  const request = {
    async get(url, options) {
      calls.push({ method: "GET", url, options });
      return first;
    }
  };
  await assert.rejects(
    requestWithRedirectPolicy({
      request,
      initialUrl: "https://campus.example.edu/pucp/documentos/DOC.pdf",
      policy
    }),
    (error) => error.code === "url_not_allowed"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(first.wasDisposed(), true);
});

test("agenda POST redirect changes to validated GET without forwarding form/body", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-redirect-post-"));
  const cfg = config(temporary);
  const policy = createCampusUrlPolicy(cfg);
  const first = response({
    status: 303,
    url: agendaJson,
    location: agendaEntry
  });
  const terminal = response({
    status: 200,
    url: agendaEntry,
    body: "done"
  });
  const calls = [];
  const request = {
    async post(url, options) {
      calls.push({ method: "POST", url, options });
      return first;
    },
    async get(url, options) {
      calls.push({ method: "GET", url, options });
      return terminal;
    }
  };
  const form = {
    fechaInicio: "20260724",
    fechaFin: "20260731",
    categoria: "",
    grupo: "00"
  };
  const result = await requestWithRedirectPolicy({
    request,
    initialUrl: agendaJson,
    policy,
    method: "POST",
    form
  });
  assert.equal(result, terminal);
  assert.equal(first.wasDisposed(), true);
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "GET"]);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.deepEqual(calls[0].options.form, form);
  assert.equal(Object.hasOwn(calls[1].options, "form"), false);
  await terminal.dispose();
});

test("agenda preserving redirect never forwards POST across origins", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "campus-redirect-307-"));
  const policy = createCampusUrlPolicy(config(temporary));
  const first = response({
    status: 307,
    url: agendaJson,
    location: "https://campus.example.edu/pucp/agenda-copy"
  });
  const calls = [];
  const request = {
    async post(url, options) {
      calls.push({ url, options });
      return first;
    }
  };
  await assert.rejects(
    requestWithRedirectPolicy({
      request,
      initialUrl: agendaJson,
      policy,
      method: "POST",
      form: {
        fechaInicio: "20260724",
        fechaFin: "20260731",
        categoria: "",
        grupo: "00"
      }
    }),
    (error) => error.code === "url_not_allowed"
  );
  assert.equal(calls.length, 1);
  assert.equal(first.wasDisposed(), true);
});
