import { isIP } from "node:net";

function policyError(message, details = {}, code = "url_not_allowed") {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function privateAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (isIP(host) === 6) {
    return (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      /^fe[89ab]/.test(host)
    );
  }
  return false;
}

function exactOrigin(value) {
  const candidate = String(value).includes("://") ? value : `https://${value}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw policyError("Campus origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    privateAddress(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw policyError("Campus origins must use public HTTPS without credentials");
  }
  return url.origin;
}

const MUTATION_TOKEN =
  /(?:^|[^a-z])(?:crear|create|guardar|save|actualizar|update|editar|edit|eliminar|delete|remove|pagar|pay|enviar|submit|confirmar|cancelar|anular|inscribir|retirar|cambiar|change|upload|subir|write)(?:[^a-z]|$)/i;
const MUTATION_CONTROL =
  /\b(?:guardar|pagar|enviar|confirmar\s+matr[ií]cula|retirar|anular|eliminar|actualizar\s+perfil|subir\s+archivo)\b/i;
const SAFE_ACTIONS = new Set([
  "",
  "consultar",
  "consultarhorariosinscripcion",
  "buscar",
  "busqueda",
  "buscarcursosinscritos",
  "buscarfacultadesespecialidades",
  "abrirpanel",
  "escogerfacultad",
  "listar",
  "listartramites",
  "mostrarbusquedasolicitudes",
  "detalle",
  "descargar",
  "elegirpanel",
  "ver",
  "vercursos",
  "panel",
  "ingresar",
  "mostrarhorarioacademico",
  "mostrarinscripcion",
  "mostrarportal",
  "mostrarcriterioscursohor",
  "mostrarresultadoscalendariofacultad",
  "mostrarresultadoscursohor",
  "ingresarmiagenda",
  "ingresarmiagendajson",
  "mostrarmiagendajson"
]);
const UNSAFE_QUERY_KEYS = /^(?:submit|save|guardar|delete|eliminar|pay|pagar|update|actualizar|upload|file|token|csrf)$/i;
const LEGACY_READ_QUERY_PATHS = new Set([
  "/pucp/rendimi/rewrenac/rewrenac",
  "/pucp/ctrlcurr/ccwconso/ccwconso"
]);
const PARTIAL_GRADE_STATISTICS_PATH =
  "/pucp/estadist/eswnotpa/eswnotpa";
const FINAL_GRADE_STATISTICS_PATH =
  "/pucp/estadist/eswnotfi/eswnotfi";
const COURSE_SCHEDULE_SEARCH_PATH =
  "/pucp/horarios/howcurho/howcurho";
const CROSS_UNIT_VACANCIES_PATH =
  "/pucp/horarios/howvacdi/howvacdi";
const ALLOWED_COURSES_REPORT_PATH =
  "/pucp/ctrlcurr/ccwcurpe/ccwcurpe";
const ENROLLMENT_IMPEDIMENTS_PATH =
  "/pucp/prematri/pmwprinc/pmwprinc";
const REGISTRATION_WRITE_PATH =
  "/pucp/prematri/pmwmatrc/pmwmatrc";

function formAttribute(fragment, name) {
  return fragment.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i")
  )?.[1] ?? "";
}

export function createCampusUrlPolicy({
  baseUrl,
  agendaEntryUrl,
  agendaJsonUrl,
  authHosts = ["pandora.pucp.edu.pe"],
  readHosts = []
}) {
  const base = new URL(baseUrl);
  const agendaEntry = new URL(agendaEntryUrl);
  const agendaJson = new URL(agendaJsonUrl);
  const baseOrigin = exactOrigin(base.origin);
  const agendaOrigin = exactOrigin(agendaEntry.origin);
  if (agendaJson.origin !== agendaOrigin) {
    throw policyError("Campus agenda URLs must share one exact origin");
  }
  const authOrigins = new Set([
    baseOrigin,
    ...authHosts.filter(Boolean).map(exactOrigin)
  ]);
  const requestOrigins = new Set([
    baseOrigin,
    agendaOrigin,
    ...readHosts.filter(Boolean).map(exactOrigin)
  ]);
  const serviceOrigins = new Set([
    agendaOrigin,
    ...readHosts.filter(Boolean).map(exactOrigin)
  ]);

  function parse(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw policyError("Campus URL is invalid");
    }
    if (
      url.protocol !== "https:" ||
      privateAddress(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw policyError("Campus URL must use a public HTTPS host");
    }
    return url;
  }

  function assertSafeGet(url, { allowAuth = false } = {}) {
    if (allowAuth && authOrigins.has(url.origin)) return url;
    if (!requestOrigins.has(url.origin)) {
      throw policyError("Campus URL origin is not allowlisted", {
        origin: url.origin
      });
    }
    if (url.href === agendaEntry.href || url.href === agendaJson.href) {
      return url;
    }
    if (
      url.pathname === ENROLLMENT_IMPEDIMENTS_PATH &&
      url.searchParams.size === 1 &&
      url.searchParams.get("accion") === "ValidarImpedimentos"
    ) {
      return url;
    }
    if (url.pathname === CROSS_UNIT_VACANCIES_PATH) {
      const entries = [...url.searchParams];
      const values = Object.fromEntries(entries);
      const keys = new Set(entries.map(([key]) => key));
      const exactKeys = (expected) =>
        entries.length === expected.length &&
        keys.size === expected.length &&
        expected.every((key) => Object.hasOwn(values, key));
      const common =
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        values.tipociclo === "00";
      const validEntry =
        values.accion === "SeleccionaPaginaConsultaVacantesUnidad" &&
        exactKeys([
          "accion",
          "cicloano",
          "ciclo",
          "tipociclo",
          "aplicacionOrigen"
        ]) &&
        values.aplicacionOrigen === "PM";
      const validResult =
        values.accion === "MostrarResultadosConsultaVacantesDifAlumno" &&
        exactKeys([
          "accion",
          "cicloano",
          "ciclo",
          "tipociclo",
          "cmbUnidad"
        ]) &&
        values.cmbUnidad === "";
      const valid = common && (validEntry || validResult);
      if (valid) return url;
      throw policyError(
        "Campus cross-unit vacancies URL is not the exact active-term read query",
        {
          action: values.accion ?? "",
          parameters: entries.map(([key]) => key)
        }
      );
    }
    assertNoMutation(url);
    if (url.pathname !== "/" && !/^\/(?:pucp|portal|campus|app)(?:\/|$)/i.test(url.pathname)) {
      throw policyError("Campus URL path is not a safe read endpoint");
    }
    return url;
  }

  function assertNoMutation(url) {
    const decoded = decodeURIComponent(`${url.pathname} ${url.search}`);
    if (MUTATION_TOKEN.test(decoded)) {
      throw policyError("Campus URL contains a mutation action");
    }
    for (const [key, value] of url.searchParams) {
      if (UNSAFE_QUERY_KEYS.test(key)) {
        throw policyError("Campus URL contains an unsafe action parameter", {
          parameter: key
        });
      }
      if (
        key.toLowerCase() === "accion" &&
        !SAFE_ACTIONS.has(value.trim().toLowerCase())
      ) {
        throw policyError("Campus URL contains an unsafe action value", {
          action: value
        });
      }
    }
  }

  function assertAgendaForm(form = {}) {
    const allowed = ["fechaInicio", "fechaFin", "categoria", "grupo"];
    if (
      Object.keys(form).some((key) => !allowed.includes(key)) ||
      !/^\d{8}$/.test(String(form.fechaInicio ?? "")) ||
      !/^\d{8}$/.test(String(form.fechaFin ?? "")) ||
      !/^[\w -]{0,20}$/.test(String(form.categoria ?? "")) ||
      !/^\d{2}$/.test(String(form.grupo ?? ""))
    ) {
      throw policyError("Campus agenda POST form is not the known read-only shape");
    }
  }

  function assertRequest(value, {
    method = "GET",
    form,
    allowAuth = false
  } = {}) {
    const url = parse(value);
    const verb = String(method).toUpperCase();
    if (verb === "GET" || verb === "HEAD") {
      return assertSafeGet(url, { allowAuth });
    }
    if (verb === "POST" && url.href === agendaJson.href) {
      assertAgendaForm(form);
      return url;
    }
    throw policyError("Campus request method or endpoint is not read-only");
  }

  function assertLegacyReadQuery(value, {
    method = "POST",
    body = ""
  } = {}) {
    const url = parse(value);
    const raw = String(body);
    const gradeStatistics = [
      PARTIAL_GRADE_STATISTICS_PATH,
      FINAL_GRADE_STATISTICS_PATH
    ].includes(url.pathname);
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      url.pathname === REGISTRATION_WRITE_PATH &&
      url.searchParams.size === 1 &&
      url.searchParams.get("accion") === "BuscarFacultadesEspecialidades"
    ) {
      const form = new URLSearchParams(raw);
      const entries = [...form];
      const values = Object.fromEntries(entries);
      const expected = ["cicloano", "ciclo", "tipociclo"];
      const keys = new Set(entries.map(([key]) => key));
      const valid =
        raw.length <= 256 &&
        entries.length === expected.length &&
        keys.size === expected.length &&
        expected.every((key) => keys.has(key)) &&
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        values.tipociclo === "00";
      if (valid) return url;
      throw policyError("Campus registration scope catalog is not the exact read-only form");
    }
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      url.pathname === REGISTRATION_WRITE_PATH &&
      url.searchParams.size === 1 &&
      url.searchParams.get("accion") === "BuscarCursosInscritos"
    ) {
      const form = new URLSearchParams(raw);
      const entries = [...form];
      const values = Object.fromEntries(entries);
      const expected = ["cicloano", "ciclo", "tipociclo"];
      const keys = new Set(entries.map(([key]) => key));
      const valid =
        raw.length <= 256 &&
        entries.length === expected.length &&
        keys.size === expected.length &&
        expected.every((key) => keys.has(key)) &&
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        values.tipociclo === "00";
      if (valid) return url;
      throw policyError("Campus registered-course query is not the exact read-only form");
    }
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      url.pathname === REGISTRATION_WRITE_PATH &&
      url.searchParams.size === 1 &&
      url.searchParams.get("accion") === "ConsultarHorariosInscripcion"
    ) {
      const form = new URLSearchParams(raw);
      const entries = [...form];
      const values = Object.fromEntries(entries);
      const expected = ["cicloano", "ciclo", "tipociclo", "facultad", "nombre", "clave", "etapa", "rama", "especialidad"];
      const keys = new Set(entries.map(([key]) => key));
      const valid =
        raw.length <= 8_192 &&
        entries.length === expected.length &&
        keys.size === expected.length &&
        expected.every((key) => keys.has(key)) &&
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        values.tipociclo === "00" &&
        /^[A-Za-z0-9]{0,4}$/.test(values.facultad ?? "") &&
        /^[A-Za-z0-9]{0,4}$/.test(values.etapa ?? "") &&
        /^[A-Za-z0-9]{0,4}$/.test(values.rama ?? "") &&
        /^[A-Za-z0-9]{0,4}$/.test(values.especialidad ?? "") &&
        /^(?:[A-Z0-9-]{2,15}(?:\s+[A-Z0-9-]{2,15}){0,29})?$/i.test(values.clave ?? "") &&
        /^[\p{L}\p{N} .,'()&/-]{0,120}$/u.test(values.nombre ?? "");
      if (valid) return url;
      throw policyError("Campus registration offering search is not the exact read-only form");
    }
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      url.pathname === ENROLLMENT_IMPEDIMENTS_PATH &&
      url.searchParams.size === 1 &&
      url.searchParams.get("accion") === "ValidarImpedimentos"
    ) {
      if (raw === "") return url;
      throw policyError(
        "Campus enrollment impediment validation must use the exact empty read-only POST"
      );
    }
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      url.pathname === ALLOWED_COURSES_REPORT_PATH &&
      !url.search
    ) {
      const form = new URLSearchParams(raw);
      const entries = [...form];
      const values = Object.fromEntries(entries);
      const expected = [
        "accion",
        "cicloano",
        "ciclo",
        "tipociclo",
        "codigo",
        "codFacultad"
      ];
      const keys = new Set(entries.map(([key]) => key));
      const valid =
        raw.length <= 2_048 &&
        entries.length === expected.length &&
        keys.size === expected.length &&
        expected.every((key) => keys.has(key)) &&
        values.accion === "GenerarCursosPermitidos" &&
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        /^\d{2}$/.test(values.tipociclo ?? "") &&
        /^\d{8}$/.test(values.codigo ?? "") &&
        /^\d{1,3}$/.test(values.codFacultad ?? "");
      if (valid) return url;
      throw policyError(
        "Campus allowed-courses report is not the exact read-only form"
      );
    }
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      url.pathname === COURSE_SCHEDULE_SEARCH_PATH &&
      !url.search
    ) {
      if (!raw || raw.length > 32_768) {
        throw policyError("Campus schedule search body is invalid");
      }
      const form = new URLSearchParams(raw);
      const entries = [...form];
      const values = Object.fromEntries(entries);
      const expected = [
        "accion",
        "cicloano",
        "ciclo",
        "tipociclo",
        "facultad",
        "facultaddescri",
        "rama",
        "especialidad",
        "especialidaddescri",
        "etapa",
        "etapadescri",
        "orden",
        "tiposelec",
        "listacursos",
        "formatedlistacursos",
        "busquedaAnt",
        "ventanaEmergente",
        "idGrupoMatricula"
      ];
      const keys = new Set(entries.map(([key]) => key));
      const exactKeys =
        entries.length === expected.length &&
        keys.size === expected.length &&
        expected.every((key) => keys.has(key));
      const courseList = /^(?:[A-Z0-9]{3,12})(?:\s+[A-Z0-9]{3,12}){0,29}$/i;
      const safeLabel = /^[\p{L}\p{N} .,'()&/-]{0,120}$/u;
      const safeScopeCode = /^[A-Za-z0-9]{0,4}$/;
      const commonValid =
        exactKeys &&
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        /^\d{2}$/.test(values.tipociclo ?? "") &&
        safeScopeCode.test(values.facultad ?? "") &&
        safeScopeCode.test(values.especialidad ?? "") &&
        safeScopeCode.test(values.rama ?? "") &&
        safeScopeCode.test(values.etapa ?? "") &&
        ["clave", "uAcad"].includes(values.tiposelec) &&
        ["0", "1"].includes(values.ventanaEmergente) &&
        /^\d{0,12}$/.test(values.idGrupoMatricula ?? "") &&
        safeLabel.test(values.facultaddescri ?? "") &&
        safeLabel.test(values.especialidaddescri ?? "") &&
        safeLabel.test(values.etapadescri ?? "") &&
        safeLabel.test(values.busquedaAnt ?? "");
      const resultValid =
        values.accion === "MostrarResultadosCursoHor" &&
        ["clave", "checked"].includes(values.orden) &&
        (
          values.tiposelec === "clave"
            ? values.orden === "clave" &&
              values.ventanaEmergente === "0" &&
              values.busquedaAnt === "" &&
              courseList.test(values.listacursos ?? "") &&
              values.formatedlistacursos === values.listacursos
            : values.orden === "checked" &&
              values.ventanaEmergente === "1" &&
              values.busquedaAnt === "0" &&
              /^[A-Za-z0-9]{1,3}$/.test(values.facultad ?? "") &&
              values.listacursos === "" && values.formatedlistacursos === ""
        );
      const catalogValid =
        values.accion === "MostrarCriteriosCursoHor" &&
        values.tiposelec === "uAcad" &&
        ["", "checked"].includes(values.orden) &&
        values.ventanaEmergente === "1" &&
        values.busquedaAnt === "0" &&
        /^[A-Za-z0-9]{1,3}$/.test(values.facultad ?? "") &&
        values.listacursos === "" &&
        values.formatedlistacursos === "";
      const valid = commonValid && (resultValid || catalogValid);
      if (valid) return url;
      throw policyError(
        "Campus schedule search is not the exact read-only form"
      );
    }
    if (
      String(method).toUpperCase() === "POST" &&
      requestOrigins.has(url.origin) &&
      gradeStatistics &&
      !url.search
    ) {
      const form = new URLSearchParams(raw);
      const entries = [...form];
      const values = Object.fromEntries(entries);
      const keys = new Set(entries.map(([key]) => key));
      const exactKeys = (expected) =>
        keys.size === expected.length &&
        expected.every((key) => keys.has(key)) &&
        entries.length === expected.length;
      const commonValid =
        values.accion === "Dibuja" &&
        /^\d{4}$/.test(values.cicloano ?? "") &&
        /^\d{2}$/.test(values.ciclo ?? "") &&
        /^[A-Z0-9]{3,12}$/i.test(values.clavecurso ?? "") &&
        /^[A-Z0-9]{0,10}$/i.test(values.Horario ?? "");
      const partialValid =
        url.pathname === PARTIAL_GRADE_STATISTICS_PATH &&
        exactKeys([
          "clavecurso",
          "Horario",
          "cicloano",
          "ciclo",
          "TipoCiclo",
          "comision",
          "tipoevalu",
          "numeroeval",
          "TipoHorario",
          "accion"
        ]) &&
        commonValid &&
        /^\d{2}$/.test(values.TipoCiclo ?? "") &&
        /^[A-Z0-9]{0,10}$/i.test(values.comision ?? "") &&
        /^[A-Z]{1,4}$/i.test(values.tipoevalu ?? "") &&
        /^(?:[1-9]|[1-9]\d)$/.test(values.numeroeval ?? "") &&
        /^[A-Z0-9]{0,10}$/i.test(values.TipoHorario ?? "");
      const finalValid =
        url.pathname === FINAL_GRADE_STATISTICS_PATH &&
        exactKeys([
          "accion",
          "cicloano",
          "ciclo",
          "tipociclo",
          "Horario",
          "clavecurso",
          "facultad"
        ]) &&
        commonValid &&
        /^\d{2}$/.test(values.tipociclo ?? "") &&
        /^\d{1,3}$/.test(values.facultad ?? "");
      if (partialValid || finalValid) return url;
      throw policyError(
        "Campus grade statistics query is not the exact read-only form"
      );
    }
    if (
      String(method).toUpperCase() !== "POST" ||
      !requestOrigins.has(url.origin) ||
      !LEGACY_READ_QUERY_PATHS.has(url.pathname) ||
      url.search
    ) {
      throw policyError("Campus legacy report query is not an allowlisted endpoint");
    }
    if (!raw || raw.length > 32_768) {
      throw policyError("Campus legacy report query body is invalid");
    }
    const form = new URLSearchParams(raw);
    if (
      form.getAll("accion").length !== 1 ||
      form.get("accion") !== "Consultar"
    ) {
      throw policyError("Campus legacy report action must be Consultar");
    }
    for (const [key, value] of form) {
      if (
        !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) ||
        UNSAFE_QUERY_KEYS.test(key) ||
        value.length > 500 ||
        MUTATION_TOKEN.test(`${key} ${value}`)
      ) {
        throw policyError("Campus legacy report form contains an unsafe field");
      }
    }
    return url;
  }

  function assertCredentialOrigin(value) {
    const url = parse(value);
    if (!authOrigins.has(url.origin)) {
      throw policyError("Credentials may only be filled on an allowlisted auth origin");
    }
    return url;
  }

  function assertAuthRequest(value, { method = "GET" } = {}) {
    const url = parse(value);
    if (!authOrigins.has(url.origin)) {
      throw policyError("Authentication request origin is not allowlisted");
    }
    const verb = String(method).toUpperCase();
    if (["GET", "HEAD"].includes(verb)) return url;
    if (
      verb !== "POST" ||
      !/(?:^|\/)(?:login|auth|sso|saml|oauth|cas)(?:\/|$)/i.test(url.pathname) ||
      MUTATION_TOKEN.test(decodeURIComponent(`${url.pathname} ${url.search}`))
    ) {
      throw policyError("Authentication POST is not a known login/SSO path");
    }
    return url;
  }

  function assertReadOnlyPage(html, pageUrl) {
    const source = String(html);
    for (const form of source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const method = (formAttribute(form[1], "method") || "GET").toUpperCase();
      const action = new URL(
        formAttribute(form[1], "action") || pageUrl,
        pageUrl
      ).href;
      if (method !== "GET" || MUTATION_CONTROL.test(form[2])) {
        throw policyError(
          "Campus page contains a mutation form and was refused",
          { pageUrl },
          "mutation_refused"
        );
      }
      try {
        assertRequest(action);
      } catch {
        throw policyError(
          "Campus page form targets an unsafe endpoint",
          { pageUrl },
          "mutation_refused"
        );
      }
    }
    for (const control of source.matchAll(
      /<(?:button|input)\b([^>]*)(?:>([\s\S]*?)<\/button>)?/gi
    )) {
      const text = `${formAttribute(control[1], "value")} ${formAttribute(control[1], "formaction")} ${cleanControlText(control[2])}`;
      if (MUTATION_CONTROL.test(text) || MUTATION_TOKEN.test(formAttribute(control[1], "formaction"))) {
        throw policyError(
          "Campus page contains a mutation control and was refused",
          { pageUrl },
          "mutation_refused"
        );
      }
    }
    return true;
  }

  function assertFinalUrl(value) {
    return assertRequest(value);
  }

  function assertRegistrationWrite(
    value,
    {
      body = "",
      activeTerm = "",
      expectedAddRefs = [],
      expectedRemoveRefs = []
    } = {}
  ) {
    const url = parse(value);
    if (
      !requestOrigins.has(url.origin) ||
      url.pathname !== REGISTRATION_WRITE_PATH ||
      url.searchParams.size !== 1 ||
      url.searchParams.get("accion") !== "ActualizarInscripcion"
    ) {
      throw policyError("Campus registration write endpoint is not allowlisted");
    }
    const form = new URLSearchParams(String(body));
    const expected = [
      "horariosAgregar",
      "horariosEliminar",
      "cicloano",
      "tipociclo",
      "ciclo"
    ];
    const keys = [...form.keys()];
    if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
      throw policyError("Campus registration write fields are not the exact allowlist");
    }
    const reference = /^[A-Z0-9-]{6,31}$/;
    const add = form.get("horariosAgregar") ?? "";
    const remove = form.get("horariosEliminar") ?? "";
    const expectedAdd = [...expectedAddRefs].map(String);
    const expectedRemove = [...expectedRemoveRefs].map(String);
    const term = String(activeTerm).match(/^(\d{4})-(\d{1,2})$/);
    if (
      (!add && !remove) ||
      expectedAdd.some((value) => !reference.test(value)) ||
      expectedRemove.some((value) => !reference.test(value)) ||
      add !== expectedAdd.join("") ||
      remove !== expectedRemove.join("") ||
      !term ||
      form.get("cicloano") !== term[1] ||
      form.get("ciclo") !== term[2].padStart(2, "0") ||
      form.get("tipociclo") !== "00"
    ) {
      throw policyError("Campus registration write payload is invalid for the active term");
    }
    return url;
  }

  function assertSubresource(value, method = "GET") {
    const url = parse(value);
    if (!["GET", "HEAD"].includes(String(method).toUpperCase())) {
      throw policyError("Campus subresource method is not read-only");
    }
    if (!requestOrigins.has(url.origin) && !authOrigins.has(url.origin)) {
      throw policyError("Campus subresource origin is not allowlisted");
    }
    assertNoMutation(url);
    if (
      url.pathname !== "/" &&
      url.pathname !== "/favicon.ico" &&
      !/^\/(?:assets|static|resources|public|css|js|fonts|images|api|pucp|portal|campus|app|login|auth|sso|saml|oauth|cas)(?:\/|$)/i.test(
        url.pathname
      )
    ) {
      throw policyError("Campus subresource path is not allowlisted");
    }
    return url;
  }

  return {
    agendaEntryUrl: agendaEntry.href,
    agendaJsonUrl: agendaJson.href,
    authOrigins: [...authOrigins],
    baseOrigin,
    serviceOrigins: [...serviceOrigins],
    assertAuthRequest,
    assertCredentialOrigin,
    assertFinalUrl,
    assertLegacyReadQuery,
    assertRegistrationWrite,
    assertReadOnlyPage,
    assertRequest,
    assertSubresource
  };
}

function cleanControlText(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
