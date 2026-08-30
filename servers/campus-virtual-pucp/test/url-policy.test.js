import assert from "node:assert/strict";
import test from "node:test";

import { createCampusUrlPolicy } from "../src/url-policy.js";

const policy = createCampusUrlPolicy({
  baseUrl: "https://campus.example.edu",
  agendaEntryUrl:
    "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda",
  agendaJsonUrl:
    "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON",
  authHosts: ["pandora.pucp.edu.pe"]
});

test("central URL policy permits exact public HTTPS origins and safe read paths", () => {
  for (const url of [
    "https://campus.example.edu/",
    "https://campus.example.edu/pucp/notas/oficiales?accion=consultar",
    "https://campus.example.edu/pucp/documentos/descarga/DOC-1.pdf",
    "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgenda",
    "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=IngresarMiAgendaJSON",
    "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar",
    "https://eros.pucp.edu.pe/pucp/solservi/sowtraca/sowtraca?accion=ListarTramites",
    "https://eros.pucp.edu.pe/pucp/pubweb/puwpubli/puwpubli?accion=Busqueda"
    ,"https://eros.pucp.edu.pe/pucp/document/dowdocum/dowdocum?accion=Descargar&documento=04983502"
  ]) {
    assert.equal(policy.assertRequest(url).href, url);
    assert.equal(policy.assertFinalUrl(url).href, url);
  }
});

test("legacy student academic GET actions are allowlisted while mutation actions stay blocked", () => {
  for (const url of [
    "https://eros.pucp.edu.pe/pucp/general/gewpealu/gewpealu?accion=ElegirPanel&misdatos=1",
    "https://eros.pucp.edu.pe/pucp/general/gewpealu/gewpealu?accion=AbrirPanel&codigo=20990001&misdatos=1",
    "https://eros.pucp.edu.pe/pucp/document/dowdocum/dowdocum?accion=VerCursos",
    "https://eros.pucp.edu.pe/pucp/solservi/sowatenc/sowatenc?accion=Panel"
    ,"https://eros.pucp.edu.pe/pucp/ctrlcurr/ccwconso/ccwconso?accion=EscogerFacultad&alumno=20990001"
    ,"https://eros.pucp.edu.pe/pucp/solservi/sowtraca/sowtraca?accion=MostrarBusquedaSolicitudes&indAlu=1&codAlumno=20990001"
  ]) {
    assert.doesNotThrow(() => policy.assertRequest(url));
  }
  assert.throws(
    () =>
      policy.assertRequest(
        "https://eros.pucp.edu.pe/pucp/solservi/sowatenc/sowatenc?accion=CrearSolicitud"
      ),
    (error) => error.code === "url_not_allowed"
  );
});

test("grade statistics POSTs are limited to the two exact read-only forms", () => {
  assert.doesNotThrow(() =>
    policy.assertLegacyReadQuery(
      "https://campus.example.edu/pucp/estadist/eswnotpa/eswnotpa",
      {
        body:
          "clavecurso=IEE272&Horario=0831&cicloano=2026&ciclo=01&TipoCiclo=00&comision=&tipoevalu=Ex&numeroeval=2&TipoHorario=&accion=Dibuja"
      }
    )
  );
  assert.doesNotThrow(() =>
    policy.assertLegacyReadQuery(
      "https://campus.example.edu/pucp/estadist/eswnotfi/eswnotfi",
      {
        body:
          "accion=Dibuja&cicloano=2026&ciclo=01&tipociclo=00&Horario=&clavecurso=1IND50&facultad=12"
      }
    )
  );
  for (const body of [
    "accion=Guardar&clavecurso=IEE272",
    "accion=Dibuja&clavecurso=IEE272&token=secret",
    "accion=Dibuja&clavecurso=IEE272&numeroeval=0"
  ]) {
    assert.throws(
      () =>
        policy.assertLegacyReadQuery(
          "https://campus.example.edu/pucp/estadist/eswnotpa/eswnotpa",
          { body }
        ),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("only the known agenda endpoint accepts a constrained read-only POST form", () => {
  const url =
    "https://eros.pucp.edu.pe/pucp/eventos/evwevnts/evwevnts?accion=MostrarMiAgendaJSON";
  assert.equal(
    policy.assertRequest(url, {
      method: "POST",
      form: {
        fechaInicio: "20260724",
        fechaFin: "20261022",
        categoria: "",
        grupo: "00"
      }
    }).href,
    url
  );
  for (const [candidate, options] of [
    ["https://campus.example.edu/pucp/solicitudes", { method: "POST", form: {} }],
    [url, { method: "POST", form: { fechaInicio: "bad", fechaFin: "20261022", categoria: "", grupo: "00" } }],
    [url, { method: "POST", form: { fechaInicio: "20260724", fechaFin: "20261022", categoria: "", grupo: "00", submit: "1" } }]
  ]) {
    assert.throws(
      () => policy.assertRequest(candidate, options),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("legacy academic report POSTs are limited to exact query endpoints and Consultar", () => {
  for (const [url, body] of [
    [
      "https://eros.pucp.edu.pe/pucp/rendimi/rewrenac/rewrenac",
      "accion=Consultar&checkboxes=1&codigo=20990001"
    ],
    [
      "https://eros.pucp.edu.pe/pucp/ctrlcurr/ccwconso/ccwconso",
      "accion=Consultar&alumno=20990001&facultad=12&carrera=026"
    ]
  ]) {
    assert.equal(
      policy.assertLegacyReadQuery(url, { method: "POST", body }).href,
      url
    );
  }
  for (const [url, body] of [
    [
      "https://eros.pucp.edu.pe/pucp/rendimi/rewrenac/rewrenac",
      "accion=Guardar&checkboxes=1"
    ],
    [
      "https://eros.pucp.edu.pe/pucp/ctrlcurr/ccwconso/ccwconso",
      "accion=Consultar&token=secret"
    ],
    [
      "https://eros.pucp.edu.pe/pucp/matricula/matricula",
      "accion=Consultar"
    ]
  ]) {
    assert.throws(
      () => policy.assertLegacyReadQuery(url, { method: "POST", body }),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("enrollment schedule search accepts only the captured read-only form", () => {
  const url = "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho";
  const body = new URLSearchParams({
    accion: "MostrarResultadosCursoHor",
    cicloano: "2026",
    ciclo: "02",
    tipociclo: "00",
    facultad: "12",
    facultaddescri: "CIENCIAS E INGENIERIA",
    rama: "",
    especialidad: "26",
    especialidaddescri: "INGENIERIA INDUSTRIAL",
    etapa: "",
    etapadescri: "",
    orden: "clave",
    tiposelec: "clave",
    listacursos: "1IND50 1IND51",
    formatedlistacursos: "1IND50 1IND51",
    busquedaAnt: "",
    ventanaEmergente: "0",
    idGrupoMatricula: ""
  }).toString();
  assert.equal(
    policy.assertLegacyReadQuery(url, { method: "POST", body }).href,
    url
  );
  for (const unsafe of [
    body.replace("MostrarResultadosCursoHor", "Inscribir"),
    `${body}&token=secret`,
    body.replace("1IND50+1IND51", "1IND50%3Cscript%3E"),
    body.replace("ventanaEmergente=0", "ventanaEmergente=1")
  ]) {
    assert.throws(
      () => policy.assertLegacyReadQuery(url, { method: "POST", body: unsafe }),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("cross-unit vacancies permit only the captured active-term read query", () => {
  const base = "https://eros.pucp.edu.pe/pucp/horarios/howvacdi/howvacdi";
  const query = new URLSearchParams({
    accion: "SeleccionaPaginaConsultaVacantesUnidad",
    cicloano: "2026",
    ciclo: "02",
    tipociclo: "00",
    aplicacionOrigen: "PM"
  });
  const entry = `${base}?${query}`;
  assert.equal(policy.assertRequest(entry).href, entry);

  const result = `${base}?${new URLSearchParams({
    accion: "MostrarResultadosConsultaVacantesDifAlumno",
    cicloano: "2026",
    ciclo: "02",
    tipociclo: "00",
    cmbUnidad: ""
  })}`;
  assert.equal(policy.assertRequest(result).href, result);

  for (const unsafe of [
    `${result}&alumno=20990001`,
    result.replace("ciclo=02", "ciclo=2"),
    result.replace("cmbUnidad=", "cmbUnidad=12"),
    result.replace("MostrarResultadosConsultaVacantesDifAlumno", "GuardarVacantes")
  ]) {
    assert.throws(
      () => policy.assertRequest(unsafe),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("enrollment schedule search accepts the captured read-only academic-scope form", () => {
  const url = "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho";
  const body = new URLSearchParams({
    accion: "MostrarResultadosCursoHor",
    cicloano: "2026",
    ciclo: "02",
    tipociclo: "00",
    facultad: "12",
    facultaddescri: "CIENCIAS E INGENIERIA",
    rama: "026",
    especialidad: "0",
    especialidaddescri: "INGENIERIA INDUSTRIAL",
    etapa: "",
    etapadescri: "",
    orden: "checked",
    tiposelec: "uAcad",
    listacursos: "",
    formatedlistacursos: "",
    busquedaAnt: "0",
    ventanaEmergente: "1",
    idGrupoMatricula: ""
  }).toString();
  assert.equal(
    policy.assertLegacyReadQuery(url, { method: "POST", body }).href,
    url
  );
});

test("schedule policy permits only the official faculty catalog reload form", () => {
  const url = "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho";
  const body = new URLSearchParams({
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
  }).toString();
  assert.equal(policy.assertLegacyReadQuery(url, { method: "POST", body }).href, url);
  assert.throws(
    () => policy.assertLegacyReadQuery(url, {
      method: "POST",
      body: body.replace("MostrarCriteriosCursoHor", "Inscribir")
    }),
    (error) => error.code === "url_not_allowed"
  );
});

test("schedule policy accepts alphanumeric Campus scope codes", () => {
  const url = "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho";
  const body = new URLSearchParams({
    accion: "MostrarResultadosCursoHor",
    cicloano: "2026",
    ciclo: "02",
    tipociclo: "00",
    facultad: "CR",
    facultaddescri: "ARTES ESCENICAS",
    rama: "089",
    especialidad: "C",
    especialidaddescri: "CIENCIA POLITICA",
    etapa: "",
    etapadescri: "",
    orden: "checked",
    tiposelec: "uAcad",
    listacursos: "",
    formatedlistacursos: "",
    busquedaAnt: "0",
    ventanaEmergente: "1",
    idGrupoMatricula: ""
  }).toString();
  assert.equal(policy.assertLegacyReadQuery(url, { method: "POST", body }).href, url);
});

test("allowed-courses report accepts only GenerarCursosPermitidos and never edit", () => {
  const url = "https://eros.pucp.edu.pe/pucp/ctrlcurr/ccwcurpe/ccwcurpe";
  const body = "accion=GenerarCursosPermitidos&cicloano=2026&ciclo=02&tipociclo=00&codigo=20230001&codFacultad=12";
  assert.doesNotThrow(() =>
    policy.assertLegacyReadQuery(url, { method: "POST", body })
  );
  for (const unsafe of [
    body.replace("GenerarCursosPermitidos", "EditarCursosPermitidos"),
    `${body}&token=secret`,
    body.replace("codigo=20230001", "codigo=bad-value")
  ]) {
    assert.throws(
      () => policy.assertLegacyReadQuery(url, { method: "POST", body: unsafe }),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("enrollment impediment validation permits only the captured empty read-only POST", () => {
  const url = "https://eros.pucp.edu.pe/pucp/prematri/pmwprinc/pmwprinc?accion=ValidarImpedimentos";
  assert.equal(
    policy.assertLegacyReadQuery(url, { method: "POST", body: "" }).href,
    url
  );
  assert.throws(
    () => policy.assertLegacyReadQuery(url, { method: "POST", body: "confirmar=1" }),
    (error) => error.code === "url_not_allowed"
  );
  assert.equal(policy.assertRequest(url).href, url);
  assert.throws(
    () => policy.assertRequest(`${url}&confirmar=1`),
    (error) => error.code === "url_not_allowed"
  );
});

test("known enrollment report GET actions are readable while enrollment writes remain blocked", () => {
  for (const url of [
    "https://eros.pucp.edu.pe/pucp/prematri/pmwprinc/pmwprinc?accion=MostrarPortal",
    "https://eros.pucp.edu.pe/pucp/horarios/howcurho/howcurho?accion=Ingresar",
    "https://eros.pucp.edu.pe/pucp/horarios/howgenho/howgenho?accion=MostrarHorarioAcademico",
    "https://eros.pucp.edu.pe/pucp/horarios/howcalen/howcalen?accion=MostrarResultadosCalendarioFacultad"
  ]) {
    assert.doesNotThrow(() => policy.assertRequest(url));
  }
  assert.throws(
    () => policy.assertRequest(
      "https://eros.pucp.edu.pe/pucp/matricula/inscripcion?accion=ConfirmarMatricula"
    ),
    (error) => error.code === "url_not_allowed"
  );
});

test("only the exact authenticated student schedule query is readable", () => {
  const exact =
    "https://eros.pucp.edu.pe/pucp/horarios/howhorac/howhorac?accion=MostrarResultadosHorAcad&alumno=20990001&cicloano=2026&ciclo=02&tipociclo=00&facultad=&rama=&checkclases=1&checkpra=1&checklab=1&checkexaotros=1&indicasesiones=1&formatedlistacursos=";
  assert.doesNotThrow(() => policy.assertRequest(exact));
  assert.doesNotThrow(() => policy.assertSubresource(exact, "GET"));
  assert.throws(
    () => policy.assertRequest(`${exact}&confirmar=1`),
    (error) => error.code === "url_not_allowed"
  );
  assert.throws(
    () => policy.assertRequest(exact.replace("checkexaotros=1", "checkexaotros=0")),
    (error) => error.code === "url_not_allowed"
  );
});

test("course roster permits only the exact authenticated read query", () => {
  const exact =
    "https://eros.pucp.edu.pe/pucp/notas/nownotfi/nownotfi?accion=Abrir&vernotas=0&cicloano=2026&ciclo=02&tipociclo=00&clavecurso=IND270";
  assert.doesNotThrow(() => policy.assertRequest(exact));
  assert.doesNotThrow(() => policy.assertSubresource(exact, "GET"));
  for (const candidate of [
    `${exact}&alumno=20990001`,
    exact.replace("accion=Abrir", "accion=EnviarMail"),
    exact.replace("clavecurso=IND270", "clavecurso=IND270%26guardar%3D1"),
    exact.replace("ciclo=02", "ciclo=2")
  ]) {
    assert.throws(
      () => policy.assertRequest(candidate),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("course hub permits only its captured empty read-only POST", () => {
  const url = "https://eros.pucp.edu.pe/pucp/ocr/ocwmcurs/ocwmcurs?accion=Ingresar&persona=20990001&cicloAnoMatri=2026&cicloMatri=02&tipoCicloMatri=00&cicloAnoDict=&cicloDict=&tipoCicloDict=&panel=&sCicloAnoAdmCurso=&sCicloAdmCurso=&sTipoCicloAdmCurso=&sTipoCicloAdmEspeci=&esCambioPestana=1&sPestana=1&session=SAFE_SESSION_TOKEN.1234567890";
  assert.doesNotThrow(() => policy.assertLegacyReadQuery(url, {
    method: "POST",
    body: ""
  }));
  assert.throws(
    () => policy.assertLegacyReadQuery(`${url}&guardar=1`, {
      method: "POST",
      body: ""
    }),
    (error) => error.code === "url_not_allowed"
  );
});

test("only the exact confirmed registration update form is accepted by the dedicated write guard", () => {
  const url = "https://campus.example.edu/pucp/prematri/pmwmatrc/pmwmatrc?accion=ActualizarInscripcion";
  assert.doesNotThrow(() => policy.assertRegistrationWrite(url, {
    body: "horariosAgregar=1IND50T0831ECO253T0531&horariosEliminar=IND345T1031&cicloano=2026&tipociclo=00&ciclo=02",
    activeTerm: "2026-2",
    expectedAddRefs: ["1IND50T0831", "ECO253T0531"],
    expectedRemoveRefs: ["IND345T1031"]
  }));
  assert.doesNotThrow(() => policy.assertRegistrationWrite(url, {
    body: "horariosAgregar=&horariosEliminar=1IND92T1031&cicloano=2026&tipociclo=00&ciclo=02",
    activeTerm: "2026-2",
    expectedAddRefs: [],
    expectedRemoveRefs: ["1IND92T1031"]
  }));
  for (const [candidate, body] of [
    [url.replace("ActualizarInscripcion", "ConfirmarMatricula"), "horariosAgregar=1IND50T0831&horariosEliminar=&cicloano=2026&tipociclo=00&ciclo=02"],
    [url, "horariosAgregar=1IND50T0831&horariosEliminar=&cicloano=2026&tipociclo=00&ciclo=02&session=SECRET"],
    [url, "horariosAgregar=1IND50T0831&horariosEliminar=&cicloano=2026&tipociclo=00&ciclo=01"],
    [url, "horariosAgregar=&horariosEliminar=&cicloano=2026&tipociclo=00&ciclo=02"]
  ]) {
    assert.throws(
      () => policy.assertRegistrationWrite(candidate, {
        body,
        activeTerm: "2026-2",
        expectedAddRefs: ["1IND50T0831"],
        expectedRemoveRefs: []
      }),
      (error) => error.code === "url_not_allowed"
    );
  }
  assert.throws(
    () => policy.assertRegistrationWrite(url, {
      body: "horariosAgregar=1IND50T0831ECO253T9999&horariosEliminar=&cicloano=2026&tipociclo=00&ciclo=02",
      activeTerm: "2026-2",
      expectedAddRefs: ["1IND50T0831", "ECO253T0531"],
      expectedRemoveRefs: []
    }),
    (error) => error.code === "url_not_allowed"
  );
});

test("registration offering search accepts only the active read-only AJAX form", () => {
  const url = "https://campus.example.edu/pucp/prematri/pmwmatrc/pmwmatrc?accion=ConsultarHorariosInscripcion";
  assert.doesNotThrow(() => policy.assertLegacyReadQuery(url, {
    body: "cicloano=2026&ciclo=02&tipociclo=00&facultad=14&nombre=&clave=ECO253&etapa=02&rama=005&especialidad=0"
  }));
  assert.throws(
    () => policy.assertLegacyReadQuery(url, {
      body: "cicloano=2026&ciclo=01&tipociclo=00&facultad=14&nombre=&clave=ECO253&etapa=02&rama=005&especialidad=0&session=SECRET"
    }),
    (error) => error.code === "url_not_allowed"
  );
});

test("registration scope catalog accepts only the active three-field read query", () => {
  const url = "https://campus.example.edu/pucp/prematri/pmwmatrc/pmwmatrc?accion=BuscarFacultadesEspecialidades";
  assert.doesNotThrow(() => policy.assertLegacyReadQuery(url, {
    body: "cicloano=2026&ciclo=02&tipociclo=00"
  }));
  for (const body of [
    "cicloano=2026&ciclo=02&tipociclo=00&codigo=99999999",
    "cicloano=2026&ciclo=1&tipociclo=00",
    "cicloano=2026&ciclo=02&tipociclo=00&guardar=1"
  ]) {
    assert.throws(
      () => policy.assertLegacyReadQuery(url, { body }),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("registered-course positions accept only the exact active-cycle read query", () => {
  const url = "https://campus.example.edu/pucp/prematri/pmwmatrc/pmwmatrc?accion=BuscarCursosInscritos";
  assert.doesNotThrow(() => policy.assertLegacyReadQuery(url, {
    body: "cicloano=2026&ciclo=02&tipociclo=00"
  }));
  assert.doesNotThrow(() => policy.assertFinalUrl(url));
  for (const body of [
    "cicloano=2026&ciclo=02&tipociclo=00&codalu=private",
    "cicloano=2026&ciclo=2&tipociclo=00",
    "cicloano=2026&ciclo=02&tipociclo=01"
  ]) {
    assert.throws(
      () => policy.assertLegacyReadQuery(url, { body }),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("policy blocks mutation actions, unsafe schemes, private addresses, and foreign redirects", () => {
  for (const url of [
    "https://campus.example.edu/pucp/finanzas/pagar?accion=consultar",
    "https://campus.example.edu/pucp/solicitudes?accion=crear",
    "https://campus.example.edu/pucp/perfil?accion=actualizar",
    "https://campus.example.edu/pucp/matricula?guardar=1",
    "https://localhost/pucp/notas",
    "https://127.0.0.1/pucp/notas",
    "https://evil.example/pucp/notas",
    "http://campus.example.edu/pucp/notas"
  ]) {
    assert.throws(
      () => policy.assertRequest(url),
      (error) => error.code === "url_not_allowed",
      url
    );
  }
  assert.throws(
    () => policy.assertFinalUrl("https://evil.example/redirected"),
    (error) => error.code === "url_not_allowed"
  );
});

test("credentials are filled only on exact allowlisted auth origins", () => {
  assert.equal(
    policy.assertCredentialOrigin("https://pandora.pucp.edu.pe/pucp/login").origin,
    "https://pandora.pucp.edu.pe"
  );
  assert.equal(
    policy.assertCredentialOrigin("https://campus.example.edu/login").origin,
    "https://campus.example.edu"
  );
  for (const url of [
    "https://pandora.pucp.edu.pe.evil.example/pucp/login",
    "https://eros.pucp.edu.pe.evil.example/login",
    "https://evil.example/login"
  ]) {
    assert.throws(
      () => policy.assertCredentialOrigin(url),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("authentication POST is limited to exact auth origins and login/SSO paths", () => {
  assert.equal(
    policy.assertAuthRequest(
      "https://pandora.pucp.edu.pe/pucp/login",
      { method: "POST" }
    ).origin,
    "https://pandora.pucp.edu.pe"
  );
  assert.equal(
    policy.assertAuthRequest(
      "https://campus.example.edu/login/index",
      { method: "POST" }
    ).origin,
    "https://campus.example.edu"
  );
  for (const url of [
    "https://pandora.pucp.edu.pe/pucp/matricula/guardar",
    "https://eros.pucp.edu.pe/pucp/login",
    "https://evil.example/login"
  ]) {
    assert.throws(
      () => policy.assertAuthRequest(url, { method: "POST" }),
      (error) => error.code === "url_not_allowed"
    );
  }
});

test("module pages containing mutation forms are refused before parsing", () => {
  assert.doesNotThrow(() =>
    policy.assertReadOnlyPage(
      '<form method="get" action="/pucp/notas"><input name="curso"><button>Buscar</button></form>',
      "https://campus.example.edu/pucp/notas"
    )
  );
  for (const html of [
    '<form method="post" action="/pucp/solicitudes/crear"><button>Enviar</button></form>',
    '<form method="get" action="/pucp/finanzas"><button>Pagar ahora</button></form>',
    '<button formaction="/pucp/matricula/guardar">Confirmar matrícula</button>'
  ]) {
    assert.throws(
      () => policy.assertReadOnlyPage(html, "https://campus.example.edu/pucp/inicio"),
      (error) => error.code === "mutation_refused"
    );
  }
});

test("subresource policy applies read-only path and query guards on allowlisted origins", () => {
  for (const url of [
    "https://campus.example.edu/assets/app.js?v=1",
    "https://campus.example.edu/pucp/notas/api?accion=consultar",
    "https://pandora.pucp.edu.pe/static/login.css"
  ]) {
    assert.equal(policy.assertSubresource(url, "GET").href, url);
  }
  for (const url of [
    "https://campus.example.edu/api/eliminar/registro",
    "https://campus.example.edu/assets/pay-now.js",
    "https://campus.example.edu/pucp/notas?accion=guardar",
    "https://campus.example.edu/pucp/notas?token=secret",
    "https://campus.example.edu/admin/write",
    "https://127.0.0.1/assets/app.js",
    "https://evil.example/assets/app.js"
  ]) {
    assert.throws(
      () => policy.assertSubresource(url, "GET"),
      (error) => error.code === "url_not_allowed",
      url
    );
  }
  assert.throws(
    () => policy.assertSubresource(
      "https://campus.example.edu/api/grades",
      "POST"
    ),
    (error) => error.code === "url_not_allowed"
  );
});
