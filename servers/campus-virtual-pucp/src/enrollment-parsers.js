import { cleanText, searchableText } from "./text.js";

const DAY_NAMES = new Map([
  ["lunes", "monday"],
  ["lun", "monday"],
  ["martes", "tuesday"],
  ["mar", "tuesday"],
  ["miercoles", "wednesday"],
  ["mie", "wednesday"],
  ["jueves", "thursday"],
  ["jue", "thursday"],
  ["viernes", "friday"],
  ["vie", "friday"],
  ["sabado", "saturday"],
  ["sab", "saturday"],
  ["domingo", "sunday"],
  ["dom", "sunday"]
]);

function attribute(fragment, name) {
  return String(fragment).match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i")
  )?.[2] ?? "";
}

function numberOrNull(value) {
  const normalized = cleanText(value).replace(",", ".");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function absoluteReadUrl(value, baseUrl) {
  if (!value || /^javascript:/i.test(value)) return undefined;
  try {
    const decoded = String(value)
      .replace(/&amp;/gi, "&")
      .replace(/&#(?:x27|39);/gi, "'")
      .replace(/&quot;/gi, '"');
    const url = new URL(decoded, baseUrl);
    if (url.protocol !== "https:") return undefined;
    url.pathname = url.pathname.replace(/;jsessionid=[^/;?]+/gi, "");
    const sensitive = new Set([
      "idsesion",
      "sesion",
      "session",
      "session_id",
      "token",
      "codigo",
      "codigousuario"
    ]);
    for (const key of [...url.searchParams.keys()]) {
      if (sensitive.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function scheduleScopeOptions(html, name) {
  const select = [...String(html).matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
    .find((match) => searchableText(attribute(match[1], "name")) === searchableText(name));
  if (!select) return [];
  return [...select[2].matchAll(
    /<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi
  )]
    .map((match) => ({
      code: cleanText(attribute(match[1], "value")),
      label: cleanText(match[2])
    }))
    .filter(({ code, label }) => code && label);
}

function normalizedScopeLabel(name, value) {
  const normalized = searchableText(value);
  return name === "facultad"
    ? normalized.replace(/^facultad(?:\s+de)?\s+/, "")
    : normalized;
}

const SCHEDULE_FACULTIES = [
  ["78", "ARQUITECTURA Y URBANISMO"],
  ["26", "ARTE Y DISENO"],
  ["CR", "ARTES ESCENICAS"],
  ["19", "CEPREPUC"],
  ["22", "CICLO INICIAL"],
  ["13", "CIENCIAS CONTABLES"],
  ["12", "CIENCIAS E INGENIERIA"],
  ["14", "CIENCIAS SOCIALES"],
  ["21", "CIENCIAS Y ARTES DE LA COMUN.", ["CIENCIAS Y ARTES DE LA COMUNICACION"]],
  ["65", "CONSORCIO DE UNIVERSIDADES"],
  ["64", "CTRO.PERU. AUDICION.LENGUAJE", ["CENTRO PERUANO DE AUDICION LENGUAJE"]],
  ["15", "DERECHO"],
  ["16", "EDUCACION"],
  ["CF", "ESC GOBIERNO Y POLIT PUBLICAS", ["ESCUELA DE GOBIERNO Y POLITICAS PUBLICAS"]],
  ["75", "ESCUELA DE DANZA CONTEMPORANEA"],
  ["51", "ESCUELA DE ESTUDIOS ESPECIALES"],
  ["48", "ESCUELA DE FORMA. MAGIST.", ["ESCUELA DE FORMACION MAGISTERIAL"]],
  ["CC", "ESCUELA DE MUSICA"],
  ["10", "ESCUELA DE POSGRADO"],
  ["54", "ESCUELA DE TEATRO"],
  ["20", "ESTUDIOS GENERALES CIENCIAS"],
  ["18", "ESTUDIOS GENERALES LETRAS"],
  ["DH", "GASTRONOMIA, HOTELERIA Y TURISMO"],
  ["77", "GESTION Y ALTA DIRECCION"],
  ["17", "LETRAS Y CIENCIAS HUMANAS"],
  ["DB", "PSICOLOGIA"],
  ["11", "TRABAJO SOCIAL"]
];

const SCHEDULE_SCOPE_FALLBACKS = {
  facultad: new Map(SCHEDULE_FACULTIES.flatMap(([code, label, aliases = []]) =>
    [label, ...aliases].map((name) => [
      normalizedScopeLabel("facultad", name),
      { code, label }
    ])
  )),
  rama: new Map([
    ["ingenieria industrial", { code: "026", label: "INGENIERIA INDUSTRIAL" }]
  ])
};

function scheduleScopeValue(html, name, requestedLabel, explicitCode = "") {
  const requested = normalizedScopeLabel(name, requestedLabel);
  const options = scheduleScopeOptions(html, name);
  const legacy = options.length === 0
    ? SCHEDULE_SCOPE_FALLBACKS[name]?.get(requested)
    : null;
  if (explicitCode) {
    const exactCode = options.find(({ code }) => code === String(explicitCode));
    return {
      code: String(explicitCode),
      label: exactCode?.label || cleanText(requestedLabel)
    };
  }
  if (!requested) return { code: "", label: "" };
  if (legacy) return legacy;
  const exact = options.filter(
    ({ label }) => normalizedScopeLabel(name, label) === requested
  );
  const candidates = exact.length > 0
    ? exact
    : options.filter(({ label }) => {
        const normalized = normalizedScopeLabel(name, label);
        return normalized.includes(requested) || requested.includes(normalized);
      });
  if (candidates.length !== 1) {
    const error = new Error(
      candidates.length > 1
        ? `Campus schedule scope is ambiguous: ${requestedLabel}`
        : `Campus schedule scope was not found: ${requestedLabel}`
    );
    error.code = candidates.length > 1
      ? "schedule_scope_ambiguous"
      : "schedule_scope_not_found";
    throw error;
  }
  return candidates[0];
}

function scheduleCareerValue(
  html,
  requestedLabel,
  explicitBranchCode = "",
  explicitSpecialtyCode
) {
  const options = scheduleScopeOptions(html, "carrera");
  if (options.length === 0) {
    const legacy = scheduleScopeValue(
      html,
      "rama",
      requestedLabel,
      explicitBranchCode
    );
    return {
      branchCode: legacy.code,
      specialtyCode: String(explicitSpecialtyCode ?? "0"),
      label: legacy.label
    };
  }
  const combinedCode = explicitBranchCode
    ? `${explicitBranchCode}-${explicitSpecialtyCode ?? "0"}`
    : "";
  const option = scheduleScopeValue(
    html,
    "carrera",
    requestedLabel,
    combinedCode
  );
  const match = option.code.match(/^([^-]+)-(.+)$/);
  if (!match) {
    const error = new Error(`Campus schedule career code is invalid: ${option.code}`);
    error.code = "schedule_scope_not_found";
    throw error;
  }
  return {
    branchCode: match[1],
    specialtyCode: match[2],
    label: option.label
  };
}

function scheduleTerm(value) {
  const term = String(value ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!term) {
    const error = new Error("Campus schedule term is invalid");
    error.code = "scrape_failed";
    throw error;
  }
  return { year: term[1], cycle: term[2].padStart(2, "0") };
}

export function scheduleScopeNeedsCatalog(scope) {
  if (!scope) return false;
  return Boolean(
    (scope.academicUnit && !scope.academicUnitCode) ||
    (scope.specialty && !scope.branchCode)
  );
}

export function buildScheduleScopeCatalogForm(query, entryHtml = "") {
  const term = scheduleTerm(query.term);
  const scope = query.academicScope ?? {};
  const academicUnit = scheduleScopeValue(
    entryHtml,
    "facultad",
    scope.academicUnit,
    scope.academicUnitCode
  );
  return {
    accion: "MostrarCriteriosCursoHor",
    cicloano: term.year,
    ciclo: term.cycle,
    tipociclo: "00",
    facultad: academicUnit.code,
    facultaddescri: academicUnit.label,
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
  };
}

export function buildScheduleSearchForm(query, entryHtml = "") {
  const term = scheduleTerm(query.term);
  const courseCodes = [...new Set((query.courseCodes ?? [])
    .map((code) => String(code).trim().toUpperCase())
    .filter(Boolean))];
  const scope = query.academicScope ?? null;
  const academicUnit = scope
    ? scheduleScopeValue(
        entryHtml,
        "facultad",
        scope.academicUnit,
        scope.academicUnitCode
      )
    : { code: "", label: "" };
  const career = scope?.specialty
    ? scheduleCareerValue(
        entryHtml,
        scope.specialty,
        scope.branchCode,
        scope.specialtyCode
      )
    : { branchCode: "", specialtyCode: "", label: "" };
  const stage = scope?.stageCode
    ? scheduleScopeValue(entryHtml, "etapa", scope.stage, scope.stageCode)
    : { code: "", label: "" };
  return {
    accion: "MostrarResultadosCursoHor",
    cicloano: term.year,
    ciclo: term.cycle,
    tipociclo: "00",
    facultad: academicUnit.code,
    facultaddescri: academicUnit.label,
    rama: career.branchCode,
    especialidad: career.specialtyCode,
    especialidaddescri: career.label,
    etapa: stage.code,
    etapadescri: stage.label,
    orden: courseCodes.length > 0 ? "clave" : "checked",
    tiposelec: courseCodes.length > 0 ? "clave" : "uAcad",
    listacursos: courseCodes.join(" "),
    formatedlistacursos: courseCodes.join(" "),
    busquedaAnt: courseCodes.length > 0 ? "" : "0",
    ventanaEmergente: courseCodes.length > 0 ? "0" : "1",
    idGrupoMatricula: ""
  };
}

function cells(row) {
  return [...String(row).matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(
    (match) => ({
      attributes: match[2],
      html: match[3],
      text: cleanText(match[3]),
      rowSpan: Math.max(1, Number(attribute(match[2], "rowspan")) || 1),
      colSpan: Math.max(1, Number(attribute(match[2], "colspan")) || 1)
    })
  );
}

function tableGrid(tableHtml) {
  const rawRows = [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rawRows.length === 0) return [];
  const first = cells(rawRows[0][1]);
  const width = first.reduce((sum, cell) => sum + cell.colSpan, 0);
  if (width === 0) return [];
  let carry = Array(width).fill(null);
  const rows = [];
  for (const rawRow of rawRows) {
    const row = Array(width).fill(null);
    const nextCarry = Array(width).fill(null);
    for (let column = 0; column < width; column += 1) {
      if (!carry[column]) continue;
      row[column] = carry[column].cell;
      if (carry[column].remaining > 1) {
        nextCarry[column] = {
          cell: carry[column].cell,
          remaining: carry[column].remaining - 1
        };
      }
    }
    let column = 0;
    for (const cell of cells(rawRow[1])) {
      while (column < width && row[column]) column += 1;
      for (let offset = 0; offset < cell.colSpan && column + offset < width; offset += 1) {
        row[column + offset] = cell;
        if (cell.rowSpan > 1) {
          nextCarry[column + offset] = {
            cell,
            remaining: cell.rowSpan - 1
          };
        }
      }
      column += cell.colSpan;
    }
    carry = nextCarry;
    rows.push(row);
  }
  return rows;
}

function findColumn(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function scheduleType(value) {
  const text = searchableText(value);
  if (/^(?:cla|teo)|clase|teoria/.test(text)) return "class";
  if (/^(?:pra)|practica/.test(text)) return "practice";
  if (/^(?:exa)|examen/.test(text)) return "exam";
  if (/lab/.test(text)) return "laboratory";
  return text || "other";
}

function parseSessions(cell, fallbackKind, virtualColumn) {
  if (!cell) return [];
  const fragments = String(cell.html)
    .replace(/<\/(?:div|p|li)>/gi, "<br>")
    .split(/<br\s*\/?>/i)
    .map(cleanText)
    .filter(Boolean);
  const sessions = [];
  for (const fragment of fragments) {
    const pattern = /\b(LUN(?:ES)?|MAR(?:TES)?|MI[EÉ](?:RCOLES)?|JUE(?:VES)?|VIE(?:RNES)?|S[AÁ]B(?:ADO)?|DOM(?:INGO)?)\s+(\d{1,2}:\d{2})\s*(?:-|A)\s*(\d{1,2}:\d{2})([\s\S]*?)(?=\b(?:LUN(?:ES)?|MAR(?:TES)?|MI[EÉ](?:RCOLES)?|JUE(?:VES)?|VIE(?:RNES)?|S[AÁ]B(?:ADO)?|DOM(?:INGO)?)\s+\d{1,2}:\d{2}|$)/gi;
    for (const match of fragment.matchAll(pattern)) {
      const dayKey = searchableText(match[1]);
      const dayEntry = [...DAY_NAMES].find(([spanish]) => dayKey.startsWith(spanish));
      if (!dayEntry) continue;
      const room = cleanText(
        match[4]
          .replace(/^\s*(?:\([^)]*\)|[CPELT])\s*/i, "")
      );
      const virtual = /\bvirtual\b/i.test(`${match[0]} ${virtualColumn}`);
      sessions.push({
        day: dayEntry[1],
        start: match[2].padStart(5, "0"),
        end: match[3].padStart(5, "0"),
        kind: fallbackKind,
        room,
        virtual
      });
    }
  }
  return sessions;
}

function isScheduleTypeCell(cell) {
  return /^(?:cla|teo|pra|exa|lab)(?:\.|\s|$)/i.test(cleanText(cell?.text));
}

function alignScheduleRow(row, width, indexes, context) {
  const compact = row.filter(Boolean);
  if (isScheduleTypeCell(compact[0]) && context.length === 3) {
    compact.unshift(...context);
  }
  const { enrolledIndex, professorIndex } = indexes;
  if (
    enrolledIndex >= 0 &&
    professorIndex === enrolledIndex + 1 &&
    compact.length === width - 1
  ) {
    compact.splice(enrolledIndex, 0, {
      attributes: "",
      html: "",
      text: "",
      rowSpan: 1,
      colSpan: 1
    });
  }
  return compact.length === width ? compact : row;
}

function scheduleCurriculumGroup(row) {
  const labels = [...new Set(row.filter(Boolean))]
    .map((cell) => cleanText(cell.text))
    .filter(Boolean);
  if (labels.length !== 1) return null;
  const label = labels[0];
  const level = searchableText(label).match(/^nivel\s*:?\s*(\d+)$/);
  if (level) {
    return {
      curriculumLevel: Number(level[1]),
      curriculumGroup: `Nivel ${Number(level[1])}`
    };
  }
  if (/^(?:cursos?\s+)?electivos?(?:\s+.*)?$/i.test(searchableText(label))) {
    return { curriculumLevel: 0, curriculumGroup: label };
  }
  return null;
}

export function filterScheduleItemsByCurriculumLevel(items, curriculumLevel) {
  if (curriculumLevel === undefined || curriculumLevel === null || curriculumLevel === "") {
    return [...items];
  }
  const requested = Number(curriculumLevel);
  if (!Number.isInteger(requested) || requested < 0) {
    const error = new Error(`Campus curriculum level is invalid: ${curriculumLevel}`);
    error.code = "schedule_level_invalid";
    throw error;
  }
  return items.filter((item) => Number(item.curriculumLevel) === requested);
}

// Kept as an internal compatibility alias for callers outside the public MCP contract.
export function filterScheduleItemsByStage(items, stage) {
  const requested = searchableText(stage);
  const level = requested.match(/^(?:nivel\s*)?(\d+)$/);
  if (level) return filterScheduleItemsByCurriculumLevel(items, Number(level[1]));
  if (/electiv/.test(requested)) return filterScheduleItemsByCurriculumLevel(items, 0);
  return requested ? [] : [...items];
}

export function parseScheduleResultsHtml(html, options = {}) {
  const tables = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const grid = tableGrid(table[0]);
    if (grid.length < 2) continue;
    const headers = grid[0].map((cell) => searchableText(cell?.text ?? ""));
    const codeIndex = findColumn(headers, [/^clave$/, /codigo/]);
    const courseIndex = findColumn(headers, [/nombre del curso/, /^curso$/]);
    const scheduleIndex = findColumn(headers, [/^hor\.?$/, /horario/]);
    const typeIndex = findColumn(headers, [/^tipo$/, /tipo hor/, /tipo de horario/]);
    if ([codeIndex, courseIndex, scheduleIndex, typeIndex].some((index) => index < 0)) {
      continue;
    }
    const creditsIndex = findColumn(headers, [/^cr\.?$/, /creditos/]);
    const associatedIndex = findColumn(headers, [/hor\. aso/, /horario asociado/]);
    const vacanciesIndex = findColumn(headers, [/^vac\.?$/]);
    const unitVacanciesIndex = findColumn(headers, [/vac\.?\s*unid/, /vacunid/]);
    const registrationsIndex = findColumn(headers, [/^ins\.?$/, /inscritos/]);
    const enrolledIndex = findColumn(headers, [/^mat\.?$/, /matriculados/]);
    const professorIndex = findColumn(headers, [/profesor/, /docente/]);
    const surveyIndex = findColumn(headers, [/encuesta docente/, /evaluacion docente/]);
    const sessionsIndex = findColumn(headers, [/^sesiones$/]);
    const virtualIndex = findColumn(headers, [/sesiones virtuales/, /virtual/]);
    const items = [];
    let courseContext = [];
    let curriculum = { curriculumLevel: null, curriculumGroup: null };
    for (const rawRow of grid.slice(1)) {
      const group = scheduleCurriculumGroup(rawRow);
      if (group) {
        curriculum = group;
        courseContext = [];
        continue;
      }
      const row = alignScheduleRow(
        rawRow,
        headers.length,
        { enrolledIndex, professorIndex },
        courseContext
      );
      const courseCode = cleanText(row[codeIndex]?.text).toUpperCase();
      const scheduleId = cleanText(row[scheduleIndex]?.text);
      if (!courseCode || !scheduleId || !/^[A-Z0-9-]{3,15}$/.test(courseCode)) continue;
      courseContext = [row[codeIndex], row[courseIndex], row[creditsIndex]];
      const kind = scheduleType(row[typeIndex]?.text);
      const raw = {
        "Vac.": cleanText(row[vacanciesIndex]?.text),
        "Vac.Unid": cleanText(row[unitVacanciesIndex]?.text),
        "Ins.": cleanText(row[registrationsIndex]?.text),
        "Mat.": cleanText(row[enrolledIndex]?.text)
      };
      items.push({
        courseCode,
        courseName: cleanText(row[courseIndex]?.text),
        credits: numberOrNull(row[creditsIndex]?.text),
        curriculumLevel: curriculum.curriculumLevel,
        curriculumGroup: curriculum.curriculumGroup,
        term: options.term ?? "",
        scheduleType: kind,
        scheduleId,
        associatedScheduleIds: cleanText(row[associatedIndex]?.text)
          .split(/[,/\s]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        capacity: {
          vacancies: numberOrNull(raw["Vac."]),
          unitVacancies: numberOrNull(raw["Vac.Unid"]),
          registrations: numberOrNull(raw["Ins."]),
          enrolled: numberOrNull(raw["Mat."]),
          userPosition: null,
          raw
        },
        professor: cleanText(row[professorIndex]?.text),
        surveyScore: numberOrNull(row[surveyIndex]?.text),
        sessions: parseSessions(
          row[sessionsIndex],
          kind,
          cleanText(row[virtualIndex]?.text)
        ),
        retrievedAt: options.retrievedAt ?? null
      });
    }
    return items.length > 0
      ? { state: "available", items }
      : { state: "available", items: [], reason: "no_results" };
  }
  return { state: "unavailable", items: [], reason: "unsupported_layout" };
}

export function parseEnrollmentImpedimentsText(value, options = {}) {
  const text = cleanText(value);
  if (!text) return { state: "unavailable", items: [], reason: "empty_response" };
  if (
    /\b(?:no presenta|no tiene|sin)\s+(?:ning[uú]n\s+)?impedimento/i.test(text) ||
    /\b(?:se encuentra\s+)?apto\s+para\s+(?:el\s+proceso\s+de\s+)?matr[ií]cula/i.test(text) ||
    /\bpuede\s+matricularse/i.test(text)
  ) {
    return { state: "available", items: [] };
  }
  if (!/impedimento|bloqueo|deuda|pendiente|cuota|pago|cancela/i.test(text)) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  const details = text
    .replace(/^.*?impedimentos?(?:\s+de\s+matr[ií]cula)?\s*:?\s*/i, "")
    .split(/(?:\r?\n|;|\s+\u2022\s+)/)
    .map(cleanText)
    .filter(Boolean);
  const items = (details.length > 0 ? details : [text]).map((title, index) => ({
    id: `enrollment-impediment-${index + 1}`,
    kind: /cuota|pago|deuda|financ/i.test(title)
      ? "financial"
      : /biblioteca|objeto|material/i.test(title)
        ? "obligation"
        : "administrative",
    title,
    status: "blocking",
    blocking: true,
    term: options.term ?? ""
  }));
  return { state: "available", items };
}

export function parseEnrollmentImpedimentsResponse(value, options = {}) {
  const source = String(value ?? "");
  const error = cleanText(
    source.match(/<error\b[^>]*>([\s\S]*?)<\/error>/i)?.[1] ?? ""
  );
  if (error) {
    return { state: "unavailable", items: [], reason: "campus_error" };
  }
  const message = cleanText(
    source.match(/<impedimentos\b[^>]*>([\s\S]*?)<\/impedimentos>/i)?.[1] ?? ""
  );
  if (!message) return { state: "available", items: [] };
  return parseEnrollmentImpedimentsText(message, options);
}

const SESSION_TYPE = new Map([
  ["T", "class"],
  ["P", "practice"],
  ["E", "exam"],
  ["L", "laboratory"],
  ["A", "advising"],
  ["G", "workshop"],
  ["D", "directed_practice"]
]);

function sessionTypes(value) {
  return cleanText(value)
    .split(/[,/\s]+/)
    .map((item) => SESSION_TYPE.get(item.toUpperCase()))
    .filter(Boolean);
}

function yes(value) {
  return /^(?:si|sí|s|1)$/i.test(cleanText(value));
}

function registeredAt(value) {
  const match = cleanText(value).match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!match) return null;
  let hour = Number(match[4]) % 12;
  if (match[6].toUpperCase() === "PM") hour += 12;
  return `${match[3]}-${match[2]}-${match[1]}T${String(hour).padStart(2, "0")}:${match[5]}:00-05:00`;
}

export function parseAllowedCoursesHtml(html, options = {}) {
  const tables = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const grid = tableGrid(table[0]);
    if (grid.length < 2) continue;
    const headers = grid[0].map((cell) => searchableText(cell?.text ?? ""));
    const codeIndex = findColumn(headers, [/^clave$/, /^codigo$/]);
    const nameIndex = findColumn(headers, [/nombre del curso/, /^curso$/]);
    const creditsIndex = findColumn(headers, [/^cred/, /creditos$/]);
    if ([codeIndex, nameIndex, creditsIndex].some((index) => index < 0)) continue;
    const unitIndex = findColumn(headers, [/^u\. curso$/, /unidad/]);
    const typeIndex = findColumn(headers, [/tipo curso/]);
    const levelIndex = findColumn(headers, [/^niv/]);
    const attemptIndex = findColumn(headers, [/^vez$/]);
    const exceptionIndex = findColumn(headers, [/excepcion/]);
    const primaryIndex = findColumn(headers, [/sale a matricula/]);
    const secondaryIndex = findColumn(headers, [/horarios secundarios/]);
    const simultaneousIndex = findColumn(headers, [/cursos simultaneos/]);
    const considerIndex = findColumn(headers, [/considerar simultaneidad/]);
    const registeredIndex = findColumn(headers, [/fecha de registro/]);
    const items = [];
    for (const row of grid.slice(1)) {
      const code = cleanText(row[codeIndex]?.text).toUpperCase();
      if (!/^[A-Z0-9-]{3,15}$/.test(code)) continue;
      const primaryRaw = cleanText(row[primaryIndex]?.text);
      const simultaneousRaw = cleanText(row[simultaneousIndex]?.text);
      items.push({
        code,
        name: cleanText(row[nameIndex]?.text),
        academicUnit: cleanText(row[unitIndex]?.text),
        credits: numberOrNull(row[creditsIndex]?.text),
        courseType: cleanText(row[typeIndex]?.text),
        curriculumLevel: numberOrNull(row[levelIndex]?.text),
        attempt: numberOrNull(row[attemptIndex]?.text),
        exception: yes(row[exceptionIndex]?.text),
        offeredForEnrollment:
          primaryRaw !== "" && !/^(?:no|---)$/i.test(primaryRaw),
        primarySessionTypes: sessionTypes(primaryRaw),
        secondarySessionTypes: sessionTypes(row[secondaryIndex]?.text),
        simultaneousCourses: /^(?:---|no)?$/i.test(simultaneousRaw)
          ? []
          : simultaneousRaw.split(/[,/\s]+/).filter(Boolean),
        considerSimultaneity: yes(row[considerIndex]?.text),
        registeredAt: registeredAt(row[registeredIndex]?.text),
        term: options.term ?? "",
        status: "allowed"
      });
    }
    return { state: "available", items };
  }
  return { state: "unavailable", items: [], reason: "unsupported_layout" };
}

const MONTHS = new Map([
  ["enero", "01"], ["febrero", "02"], ["marzo", "03"],
  ["abril", "04"], ["mayo", "05"], ["junio", "06"],
  ["julio", "07"], ["agosto", "08"], ["septiembre", "09"],
  ["octubre", "10"], ["noviembre", "11"], ["diciembre", "12"]
]);

function calendarDates(value) {
  const normalized = searchableText(value);
  return [...normalized.matchAll(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/g)]
    .map((match) => {
      const month = MONTHS.get(match[2]);
      return month
        ? `${match[3]}-${month}-${String(Number(match[1])).padStart(2, "0")}`
        : null;
    })
    .filter(Boolean);
}

function calendarTimes(value) {
  return [...String(value).matchAll(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|m\.)/gi)]
    .map((match) => {
      const suffix = match[3].toLowerCase();
      let hour = Number(match[1]) % 12;
      if (suffix.startsWith("p")) hour += 12;
      if (suffix.startsWith("m") && Number(match[1]) === 12) hour = 12;
      return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
    });
}

function calendarId(title) {
  const value = searchableText(title);
  if (/publicacion de horarios/.test(value)) return "schedule_publication";
  if (/matricula via campus/.test(value)) return "campus_enrollment";
  if (/cierre temporal/.test(value)) return "temporary_closure";
  if (/vencimiento de la primera cuota/.test(value)) return "first_installment_due";
  if (/publicacion de la primera cuota/.test(value)) return "first_installment_publication";
  return "enrollment_event";
}

function crossUnitVacancyRules(cell) {
  if (!cell) return [];
  const fragments = String(cell.html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr)>/gi, "\n")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);
  return fragments.map((fragment) => {
    const match = fragment.match(/^(.+?):\s*(?:(\d+)|(.+))$/);
    return {
      academicUnit: cleanText(match?.[1] ?? fragment),
      vacancies: match?.[2] ? Number(match[2]) : null,
      note: cleanText(match?.[3] ?? "")
    };
  });
}

function normalizedModality(value) {
  const normalized = searchableText(value);
  if (/semipresencial|hibrid/.test(normalized)) return "hybrid";
  if (/virtual|remot/.test(normalized)) return "virtual";
  if (/presencial/.test(normalized)) return "presential";
  return normalized || "unknown";
}

function crossUnitAcademicUnitKey(value) {
  return searchableText(value)
    .replace(/^unidad academica\s*:?\s*/, "")
    .replace(/^(?:facultad|escuela|departamento)(?:\s+de)?\s+/, "")
    .trim();
}

function crossUnitAcademicUnitHeading(row, academicUnits) {
  const known = academicUnits
    .map((label) => ({ label, key: crossUnitAcademicUnitKey(label) }))
    .filter(({ key }) => key.length >= 4);
  for (const cell of row) {
    const value = cleanText(cell.text)
      .replace(/^unidad acad[eé]mica\s*:?\s*/i, "")
      .trim();
    const key = crossUnitAcademicUnitKey(value);
    if (key.length < 4) continue;
    const match = known.find(
      ({ key: knownKey }) =>
        key === knownKey || key.endsWith(knownKey) || knownKey.endsWith(key)
    );
    if (match) return value;
  }
  return "";
}

export function parseCrossUnitVacanciesHtml(html, options = {}) {
  const source = String(html ?? "");
  const academicUnits = scheduleScopeOptions(source, "cmbUnidad")
    .map(({ label }) => label)
    .filter((label) => searchableText(label) !== "todas");
  const rows = [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  let academicUnit = "";
  let indexes = null;
  let recognized = false;
  const items = [];

  for (const match of rows) {
    const row = cells(match[1]);
    const values = row.map((cell) => cleanText(cell.text));
    const headers = values.map(searchableText);
    const codeIndex = findColumn(headers, [/^clave$/, /^codigo$/]);
    const courseIndex = findColumn(headers, [/nombre del curso/, /^curso$/]);
    const totalIndex = findColumn(headers, [/vac\. total/, /vacantes totales/]);
    const unitIndex = findColumn(headers, [/vac\. unidad/, /vacantes? unidad/]);
    const differentiatedIndex = findColumn(headers, [/vacantes diferenciadas por unidad/]);
    if (
      codeIndex >= 0 &&
      courseIndex >= 0 &&
      totalIndex >= 0 &&
      unitIndex >= 0 &&
      differentiatedIndex >= 0
    ) {
      recognized = true;
      indexes = {
        codeIndex,
        courseIndex,
        creditsIndex: findColumn(headers, [/^cr\.?$/, /creditos/]),
        typeIndex: findColumn(headers, [/tipo hor/, /tipo de horario/]),
        scheduleIndex: findColumn(headers, [/^hor\.?$/, /^horario$/]),
        modalityIndex: findColumn(headers, [/modalidad/]),
        associatedIndex: findColumn(headers, [/hor\. aso/, /horario asociado/]),
        totalIndex,
        unitIndex,
        differentiatedIndex
      };
      continue;
    }

    const possibleCourseCode = indexes
      ? cleanText(row[indexes.codeIndex]?.text).toUpperCase()
      : "";
    const unitHeading = /^[A-Z0-9-]{3,15}$/.test(possibleCourseCode)
      ? ""
      : crossUnitAcademicUnitHeading(row, academicUnits);
    if (unitHeading) {
      academicUnit = unitHeading;
      continue;
    }
    if (!indexes) continue;
    const courseCode = cleanText(row[indexes.codeIndex]?.text).toUpperCase();
    const scheduleId = cleanText(row[indexes.scheduleIndex]?.text);
    if (!/^[A-Z0-9-]{3,15}$/.test(courseCode) || !scheduleId) continue;
    const associatedScheduleIds = cleanText(row[indexes.associatedIndex]?.text)
      .split(/[\s,;/]+/)
      .filter(Boolean);
    items.push({
      term: options.term ?? "",
      academicUnit,
      courseCode,
      courseName: cleanText(row[indexes.courseIndex]?.text),
      credits: numberOrNull(row[indexes.creditsIndex]?.text),
      scheduleType: scheduleType(row[indexes.typeIndex]?.text),
      scheduleId,
      modality: normalizedModality(row[indexes.modalityIndex]?.text),
      associatedScheduleIds,
      capacity: {
        totalVacancies: numberOrNull(row[indexes.totalIndex]?.text),
        unitVacancies: numberOrNull(row[indexes.unitIndex]?.text)
      },
      differentiatedVacancies: crossUnitVacancyRules(
        row[indexes.differentiatedIndex]
      ),
      retrievedAt: options.retrievedAt ?? null
    });
  }

  return recognized
    ? { state: "available", academicUnits, items }
    : {
        state: "unavailable",
        reason: "unsupported_layout",
        academicUnits,
        items: []
      };
}

export function parseEnrollmentCalendarHtml(html, options = {}) {
  const paragraphs = [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const items = [];
  for (const paragraph of paragraphs) {
    const raw = cleanText(paragraph[1]);
    const dates = calendarDates(raw);
    if (dates.length === 0) continue;
    const title = cleanText(paragraph[1].match(/<(?:b|strong|span)\b[^>]*>([\s\S]*?)<\/(?:b|strong|span)>/i)?.[1] ?? raw.split(/(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)/i)[0]);
    const id = calendarId(title);
    if (id === "enrollment_event" && !/matr[ií]cula|cuota|horario/i.test(raw)) continue;
    const times = calendarTimes(raw);
    const startTime = times[0] ?? "00:00";
    const endTime = times.at(-1) ?? "23:59";
    items.push({
      id,
      title,
      term: options.term ?? "",
      start: `${dates[0]}T${startTime}:00-05:00`,
      end: `${dates.at(-1)}T${endTime}:${times.length ? "00" : "59"}-05:00`,
      raw
    });
  }
  return items.length
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "calendar_not_visible" };
}

const SECTION_DEFINITIONS = [
  ["student_data", /datos del alumno/, ["student", "alumno", "datos"]],
  ["courses_schedules", /cursos y horarios/, ["courses", "cursos", "horarios"]],
  ["exceptions", /excepciones/, ["exceptions", "excepciones"]],
  ["insurance_services", /seguros y servicios/, ["services", "seguros", "servicios"]],
  ["contacts", /contactanos/, ["contact", "contactanos"]]
];

const KNOWN_SECTION_ACTIONS = {
  student_data: [
    ["Turno de Matrícula", /turno de matricula/, "read"],
    ["Cursos Permitidos", /cursos permitidos/, "read"],
    ["Notas", /notas\s+\d{4}-\d+/, "read"],
    ["Documentos de Pago", /documentos de pago/, "read"],
    ["Objetos Adeudados", /objetos adeudados/, "read"]
  ],
  courses_schedules: [
    ["Consulta de horarios", /consulta de horarios/, "read"],
    ["Programación del semestre académico", /programacion del semestre academico/, "read"],
    ["Estadística de cursos", /estadistica de cursos/, "read"],
    ["Generador de horarios", /generador de horarios/, "blocked"],
    ["Vacantes que ofrecen otras unidades", /vacantes que ofrecen otras unidades/, "read"],
    ["Cursos ofrecidos Escuela de Posgrado", /cursos ofrecidos escuela de posgrado/, "read"]
  ],
  exceptions: [
    ["Excepciones al reglamento", /excepciones al reglamento/, "read"],
    ["Solicitud de excepciones", /solicitud de excepciones/, "blocked"]
  ],
  insurance_services: [],
  contacts: []
};

function selectedScopeOptions(html, name) {
  const select = [...String(html).matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
    .find((match) => searchableText(attribute(match[1], "name")) === searchableText(name));
  if (!select) return [];
  return [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)]
    .map((match) => ({
      code: cleanText(attribute(match[1], "value")),
      label: cleanText(match[2]),
      selected: /\bselected(?:\s*=\s*["'][^"']*["'])?/i.test(match[1])
    }))
    .filter(({ code, label }) => code && code !== "false" && label && !/^-+$/.test(label));
}

function internalSelectionRef(cell, name) {
  const input = String(cell?.html ?? "").match(
    new RegExp(`<input\\b(?=[^>]*\\bname=["']${name}["'])[^>]*>`, "i")
  )?.[0] ?? "";
  const value = cleanText(attribute(input, "value"));
  return /^[A-Z0-9-]{3,15}[A-Z][A-Z0-9-]{2,15}$/i.test(value)
    ? value.toUpperCase()
    : null;
}

function relativePosition(value, retrievedAt) {
  const raw = cleanText(value);
  if (!raw) {
    return { raw: "", rank: null, population: null, state: "pending", retrievedAt };
  }
  const pair = raw.match(/(\d+)\s*(?:de|\/|-)\s*(\d+)/i);
  const single = raw.match(/^\d+$/);
  return {
    raw,
    rank: pair ? Number(pair[1]) : single ? Number(single[0]) : null,
    population: pair ? Number(pair[2]) : null,
    state: "available",
    retrievedAt
  };
}

function registeredScheduleType(value) {
  return new Map([
    ["T", "class"],
    ["H", "class"],
    ["I", "class"],
    ["P", "practice"],
    ["E", "exam"],
    ["L", "laboratory"],
    ["D", "directed_practice"],
    ["G", "workshop"],
    ["A", "advising"]
  ]).get(cleanText(value).toUpperCase()) ?? scheduleType(value);
}

function parseRegisteredCoursesPayload(value, options = {}) {
  let payload;
  try {
    payload = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return { state: "unavailable", items: [] };
  }
  if (!payload || payload.Exc || payload.error === true || !Array.isArray(payload.data)) {
    return { state: "unavailable", items: [] };
  }
  const retrievedAt = options.retrievedAt ?? null;
  const items = [];
  for (const course of payload.data) {
    const courseCode = cleanText(course?.[0]).toUpperCase();
    if (!/^[A-Z0-9-]{3,15}$/.test(courseCode)) continue;
    for (const schedule of Array.isArray(course?.[3]) ? course[3] : []) {
      const typeCode = cleanText(schedule?.[0]).toUpperCase();
      const scheduleId = cleanText(schedule?.[1]).toUpperCase();
      if (!/^[A-Z0-9-]{1,4}$/.test(typeCode) || !/^[A-Z0-9-]{2,15}$/.test(scheduleId)) continue;
      const principal = cleanText(schedule?.[8]) === "1";
      const rawPosition = cleanText(schedule?.[2]);
      const internalRef = `${courseCode}${typeCode}${scheduleId}`;
      items.push({
        courseCode,
        courseName: cleanText(course?.[1]),
        credits: numberOrNull(course?.[2]),
        scheduleType: registeredScheduleType(typeCode),
        scheduleId,
        status: cleanText(schedule?.[7]),
        position: rawPosition
          ? relativePosition(rawPosition, retrievedAt)
          : {
              raw: "",
              rank: null,
              population: null,
              state: principal ? "pending" : "not_applicable",
              retrievedAt
            },
        professor: cleanText(schedule?.[4]),
        sessions: parseSessions(
          { html: cleanText(schedule?.[5]) },
          registeredScheduleType(typeCode),
          cleanText(schedule?.[6])
        ),
        internalSelectionRef:
          principal && /^[A-Z0-9-]{6,31}$/.test(internalRef)
            ? internalRef
            : null
      });
    }
  }
  return { state: "available", items };
}

function parseRegisteredCourses(html, options) {
  const tables = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const grid = tableGrid(table[0]);
    if (grid.length < 1) continue;
    const headers = grid[0].map((cell) => searchableText(cell?.text ?? ""));
    const codeIndex = findColumn(headers, [/^clave$/, /^codigo$/]);
    const nameIndex = findColumn(headers, [/nombre del curso/, /^curso$/]);
    const scheduleIndex = findColumn(headers, [/^horario$/, /^hor\.?$/]);
    const positionIndex = findColumn(headers, [/posic.*relat/]);
    if ([codeIndex, nameIndex, scheduleIndex, positionIndex].some((index) => index < 0)) continue;
    const creditsIndex = findColumn(headers, [/^cred/]);
    const removeIndex = findColumn(headers, [/eliminar/]);
    const typeIndex = findColumn(headers, [/^tipo$/]);
    const statusIndex = findColumn(headers, [/estado/]);
    const professorIndex = findColumn(headers, [/docente|profesor/]);
    const sessionsIndex = findColumn(headers, [/sesiones/]);
    return grid.slice(1).map((row) => {
      const courseCode = cleanText(row[codeIndex]?.text).toUpperCase();
      const scheduleId = cleanText(row[scheduleIndex]?.text);
      if (!/^[A-Z0-9-]{3,15}$/.test(courseCode) || !scheduleId) return null;
      const kind = scheduleType(row[typeIndex]?.text);
      return {
        courseCode,
        courseName: cleanText(row[nameIndex]?.text),
        credits: numberOrNull(row[creditsIndex]?.text),
        scheduleType: kind,
        scheduleId,
        status: cleanText(row[statusIndex]?.text),
        position: relativePosition(row[positionIndex]?.text, options.retrievedAt ?? null),
        professor: cleanText(row[professorIndex]?.text),
        sessions: parseSessions(row[sessionsIndex], kind, ""),
        internalSelectionRef: internalSelectionRef(row[removeIndex], "cursosEliminar")
      };
    }).filter(Boolean);
  }
  return [];
}

function specialtyScope(option) {
  const decoded = String(option.code).replace(/&quot;/gi, '"').replace(/&#(?:x27|39);/gi, "'");
  try {
    const value = JSON.parse(decoded);
    return {
      label: option.label,
      selected: option.selected,
      academicUnitCode: String(value.facultad ?? ""),
      branchCode: String(value.rama ?? ""),
      specialtyCode: String(value.especialidad ?? ""),
      stageCode: String(value.etapa ?? "")
    };
  } catch {
    return null;
  }
}

function registrationSpecialtyCatalog(html) {
  const literal = String(html).match(
    /(?:document\.)?especialidades\s*=\s*(\[[\s\S]*?\])\s*;/i
  )?.[1];
  if (!literal) return [];
  try {
    const entries = JSON.parse(literal);
    return (Array.isArray(entries) ? entries : []).map((entry) => {
      if (Array.isArray(entry) && entry.length >= 5) {
        return {
          branchCode: cleanText(entry[0]),
          specialtyCode: cleanText(entry[1]),
          stageCode: cleanText(entry[2]),
          academicUnitCode: cleanText(entry[3]),
          label: cleanText(entry[4]),
          selected: false
        };
      }
      if (entry && typeof entry === "object") {
        return {
          branchCode: cleanText(entry.rama ?? entry.branchCode),
          specialtyCode: cleanText(entry.especialidad ?? entry.specialtyCode),
          stageCode: cleanText(entry.etapa ?? entry.stageCode),
          academicUnitCode: cleanText(entry.facultad ?? entry.academicUnitCode),
          label: cleanText(entry.nombre ?? entry.label),
          selected: false
        };
      }
      return null;
    }).filter((item) => item?.label && item.academicUnitCode);
  } catch {
    return [];
  }
}

export function parseRegistrationSearchPayload(value, options = {}) {
  let payload;
  try {
    payload = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  if (payload?.Exc) {
    return { state: "unavailable", items: [], reason: "campus_error" };
  }
  const groups = Number(payload?.mode) === 2
    ? (payload.data ?? []).map((group) => ({
        level: Number.isFinite(Number(group?.[0])) ? Number(group[0]) : null,
        courses: Array.isArray(group?.[2]) ? group[2] : []
      }))
    : [{ level: null, courses: Array.isArray(payload?.data) ? payload.data : [] }];
  const typeMap = new Map([
    ["T", "class"], ["P", "practice"], ["E", "exam"], ["L", "laboratory"],
    ["D", "directed_practice"], ["G", "workshop"], ["A", "advising"]
  ]);
  const items = [];
  for (const group of groups) {
    for (const course of group.courses) {
      const courseCode = cleanText(course?.[0]).toUpperCase();
      if (!/^[A-Z0-9-]{3,15}$/.test(courseCode)) continue;
      for (const schedule of Array.isArray(course?.[3]) ? course[3] : []) {
        const scheduleId = cleanText(schedule?.[0]);
        const typeCode = cleanText(schedule?.[1]).toUpperCase();
        if (!scheduleId || !typeCode) continue;
        const raw = {
          "Vac.": cleanText(schedule?.[8]),
          "Vac.Unid": cleanText(schedule?.[9]),
          "Ins.": cleanText(schedule?.[10]),
          "Mat.": cleanText(schedule?.[12])
        };
        const prematriculated = numberOrNull(schedule?.[11]);
        const matriculated = numberOrNull(schedule?.[12]);
        items.push({
          courseCode,
          courseName: cleanText(course?.[1]),
          credits: numberOrNull(course?.[2]),
          curriculumLevel: group.level,
          curriculumGroup: group.level === null ? null : `Nivel ${group.level}`,
          term: options.term ?? "",
          scheduleType: typeMap.get(typeCode) ?? typeCode.toLowerCase(),
          scheduleId,
          associatedScheduleIds: cleanText(schedule?.[5]).split(/[,/\s]+/).filter(Boolean),
          capacity: {
            vacancies: numberOrNull(schedule?.[8]),
            unitVacancies: numberOrNull(schedule?.[9]),
            registrations: numberOrNull(schedule?.[10]),
            enrolled: prematriculated === null && matriculated === null
              ? null
              : (prematriculated ?? 0) + (matriculated ?? 0),
            userPosition: null,
            raw
          },
          professor: cleanText(schedule?.[6]),
          surveyScore: null,
          sessions: parseSessions({ html: cleanText(schedule?.[7]) }, typeMap.get(typeCode) ?? typeCode.toLowerCase(), cleanText(schedule?.[14])),
          virtual: yes(schedule?.[14]),
          selectable: yes(schedule?.[4]),
          internalSelectionRef: `${courseCode}${typeCode}${scheduleId}`,
          source: "enrollment_portal",
          retrievedAt: options.retrievedAt ?? null
        });
      }
    }
  }
  return { state: "available", items };
}

export function parseRegistrationScopePayload(value) {
  let payload;
  try {
    payload = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return { state: "unavailable", reason: "unsupported_layout", faculties: [], specialties: [] };
  }
  const faculties = (Array.isArray(payload?.facultades) ? payload.facultades : [])
    .map((entry) => {
      if (Array.isArray(entry)) {
        const first = cleanText(entry[0]);
        const second = cleanText(entry[1]);
        const firstIsCode = /^[A-Za-z0-9]{1,4}$/.test(first);
        return {
          code: firstIsCode ? first : second,
          label: firstIsCode ? second : first,
          selected: false
        };
      }
      if (entry && typeof entry === "object") {
        return {
          code: cleanText(entry.codigo ?? entry.code ?? entry.facultad),
          label: cleanText(entry.nombre ?? entry.label),
          selected: false
        };
      }
      return null;
    })
    .filter((item) => item?.code && item.label && item.code !== "false");
  const specialties = (Array.isArray(payload?.especialidades) ? payload.especialidades : [])
    .map((entry) => {
      if (Array.isArray(entry) && entry.length >= 5) {
        return {
          branchCode: cleanText(entry[0]),
          specialtyCode: cleanText(entry[1]),
          stageCode: cleanText(entry[2]),
          academicUnitCode: cleanText(entry[3]),
          label: cleanText(entry[4]),
          selected: false
        };
      }
      if (entry && typeof entry === "object") {
        return {
          branchCode: cleanText(entry.rama ?? entry.branchCode),
          specialtyCode: cleanText(entry.especialidad ?? entry.specialtyCode),
          stageCode: cleanText(entry.etapa ?? entry.stageCode),
          academicUnitCode: cleanText(entry.facultad ?? entry.academicUnitCode),
          label: cleanText(entry.nombre ?? entry.label),
          selected: false
        };
      }
      return null;
    })
    .filter((item) => item?.label && item.academicUnitCode && item.branchCode);
  return faculties.length || specialties.length
    ? { state: "available", faculties, specialties }
    : { state: "unavailable", reason: "unsupported_layout", faculties: [], specialties: [] };
}

function visibleAcademicUnit(value) {
  return searchableText(value).replace(/^facultad(?:\s+de)?\s+/, "");
}

function visibleSpecialty(value) {
  return searchableText(value)
    .replace(/\s*-\s*(?:pregrado|posgrado)(?:\s+en\s+facultad)?\s*$/, "");
}

function uniqueVisibleMatch(items, requested, normalizer = searchableText) {
  const target = normalizer(requested);
  if (!target) return null;
  const exact = items.filter((item) => normalizer(item.label) === target);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((item) => {
    const label = normalizer(item.label);
    return label.includes(target) || target.includes(label);
  });
  return partial.length === 1 ? partial[0] : null;
}

function scopeResolutionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function resolveRegistrationAcademicScope(catalog, requested = {}) {
  const faculties = catalog?.faculties ?? [];
  const specialties = catalog?.specialties ?? [];
  const faculty = uniqueVisibleMatch(faculties, requested.academicUnit, visibleAcademicUnit);
  if (!faculty) {
    throw scopeResolutionError(
      "schedule_scope_not_found",
      `Campus registration faculty was not found or was ambiguous: ${requested.academicUnit}`
    );
  }
  if (requested.curriculumLevel !== undefined && requested.curriculumLevel !== null && !requested.specialty) {
    throw scopeResolutionError(
      "schedule_specialty_required",
      "A specialty is required when filtering schedules by curriculum level"
    );
  }
  const level = requested.curriculumLevel === undefined || requested.curriculumLevel === null
    ? null
    : Number(requested.curriculumLevel);
  if (level !== null && (!Number.isInteger(level) || level < 0)) {
    throw scopeResolutionError(
      "schedule_level_invalid",
      `Campus curriculum level is invalid: ${requested.curriculumLevel}`
    );
  }
  let specialty = null;
  if (requested.specialty) {
    specialty = uniqueVisibleMatch(
      specialties.filter((item) => String(item.academicUnitCode) === String(faculty.code)),
      requested.specialty,
      visibleSpecialty
    );
    if (!specialty) {
      throw scopeResolutionError(
        "schedule_scope_not_found",
        `Campus registration specialty was not found or was ambiguous: ${requested.specialty}`
      );
    }
  }
  return {
    academicUnit: faculty.label,
    specialty: specialty?.label ?? "",
    curriculumLevel: level,
    internal: {
      academicUnitCode: String(faculty.code),
      branchCode: String(specialty?.branchCode ?? ""),
      specialtyCode: String(specialty?.specialtyCode ?? ""),
      programStageCode: String(specialty?.stageCode ?? "")
    }
  };
}

export function parseRegistrationWorkspaceHtml(html, options = {}) {
  const source = String(html);
  const visible = cleanText(source.replace(/<select\b[^>]*\bname=["']ciclo["'][\s\S]*?<\/select>/gi, ""));
  const normalizedVisible = searchableText(visible);
  const enrollmentMode = /matricula extemporanea/.test(normalizedVisible)
    ? "extemporaneous"
    : /inscripcion registrada|busqueda de cursos/.test(normalizedVisible)
      ? "regular"
      : "unknown";
  const termMatch = visible.match(/Ciclo\s*:\s*(\d{4})-(\d{1,2})/i)
    ?? visible.match(/Matr[ií]cula(?:\s+Extempor[aá]nea)?\s+(\d{4})-(\d{1,2})/i);
  if (!termMatch || enrollmentMode === "unknown") {
    return { state: "unavailable", reason: "registration_portal_not_visible", enrollmentMode, activeTerm: null, registered: [], offerings: [] };
  }
  const activeTerm = `${termMatch[1]}-${Number(termMatch[2])}`;
  const turnMatch = visible.match(/Turno\s*:\s*(\d+)\s+de\s+(\d+)/i);
  const payloadRegistered = options.registeredPayload === undefined
    ? { state: "unavailable", items: [] }
    : parseRegisteredCoursesPayload(options.registeredPayload, options);
  const registered = payloadRegistered.state === "available"
    ? payloadRegistered.items
    : parseRegisteredCourses(source, options);
  const offeringTable = [...source.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .map((match) => match[0])
    .find((table) => /<t[hd]\b[^>]*>\s*Agregar\s*<\/t[hd]>/i.test(table)) ?? "";
  const parsedOfferings = parseScheduleResultsHtml(offeringTable, {
    term: activeTerm,
    retrievedAt: options.retrievedAt ?? null
  });
  const addRefs = [...source.matchAll(/<input\b(?=[^>]*\bname=["']cursosAgregar["'])[^>]*>/gi)]
    .map((match) => cleanText(attribute(match[0], "value")).toUpperCase())
    .filter(Boolean);
  const offerings = (parsedOfferings.items ?? []).map((item) => ({
    ...item,
    source: "enrollment_portal",
    internalSelectionRef: addRefs.find((ref) =>
      ref.startsWith(item.courseCode) && ref.endsWith(String(item.scheduleId).toUpperCase())
    ) ?? null
  }));
  const faculties = selectedScopeOptions(source, "facultad").map((option) => ({
    code: option.code,
    label: option.label,
    selected: option.selected
  }));
  const visibleSpecialties = selectedScopeOptions(source, "especialidad")
    .map(specialtyScope)
    .filter(Boolean);
  const specialtyMap = new Map();
  for (const specialty of [...registrationSpecialtyCatalog(source), ...visibleSpecialties]) {
    const key = [
      specialty.academicUnitCode,
      specialty.branchCode,
      specialty.specialtyCode,
      specialty.stageCode
    ].join("|");
    specialtyMap.set(key, specialty);
  }
  const specialties = [...specialtyMap.values()];
  const count = (label) => numberOrNull(visible.match(new RegExp(`${label}\\s*:\\s*(\\d+(?:[.,]\\d+)?)`, "i"))?.[1]);
  return {
    state: "available",
    enrollmentMode,
    activeTerm,
    retrievedAt: options.retrievedAt ?? null,
    turn: turnMatch
      ? { position: Number(turnMatch[1]), population: Number(turnMatch[2]), raw: `${turnMatch[1]} de ${turnMatch[2]}` }
      : null,
    summary: {
      registeredCourses: count("Cursos Inscritos"),
      registeredCredits: count("Cr[eé]ditos Inscritos"),
      prematriculatedCourses: count("Cursos Prematriculados"),
      prematriculatedCredits: count("Cr[eé]ditos Prematriculados")
    },
    scopes: { faculties, specialties },
    registered,
    offerings
  };
}

function blockedAction(label, href) {
  return /inscrib|matricul|confirm|guardar|enviar|solicitar|contratar|pagar|retirar|anular/i.test(
    searchableText(`${label} ${href}`)
  );
}

export function parseEnrollmentPortalHtml(html, baseUrl) {
  const source = String(html);
  const normalized = searchableText(source);
  const sections = [];
  for (const [key, labelPattern, ids] of SECTION_DEFINITIONS) {
    if (!labelPattern.test(normalized)) continue;
    const definitionLabel = cleanText(
      [...source.matchAll(/<(?:a|button|div|td)\b[^>]*>([\s\S]*?)<\/(?:a|button|div|td)>/gi)]
        .map((match) => cleanText(match[1]))
        .find((label) => labelPattern.test(searchableText(label))) ?? key
    );
    let scope = "";
    for (const id of ids) {
      const match = source.match(
        new RegExp(`<section\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/section>`, "i")
      );
      if (match) {
        scope = match[1];
        break;
      }
    }
    const actions = [];
    for (const match of scope.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const label = cleanText(match[2]);
      const rawHref = attribute(match[1], "href");
      const extemporaneous = /matricula extemporanea/.test(searchableText(label));
      const access = extemporaneous
        ? "read"
        : /inscr.bete aqu./i.test(label)
          ? "confirmation_required"
          : blockedAction(label, rawHref) ? "blocked" : "read";
      actions.push({
        label,
        access,
        ...(extemporaneous
          ? { reason: "extemporaneous_compatibility_read_only" }
          : access === "read"
            ? { href: absoluteReadUrl(rawHref, baseUrl) }
          : access === "confirmation_required"
            ? { reason: "prepare_and_confirm_with_mcp" }
            : { reason: "mutation_not_allowed" })
      });
    }
    for (const [label, pattern, access] of KNOWN_SECTION_ACTIONS[key] ?? []) {
      if (!pattern.test(normalized) || actions.some((action) => action.label === label)) continue;
      actions.push({
        label,
        access,
        ...(access === "blocked"
          ? { reason: label === "Generador de horarios" ? "campus_generator_not_used" : "mutation_not_allowed" }
          : {})
      });
    }
    sections.push({ key, label: definitionLabel, state: "available", actions });
  }
  return { state: sections.length ? "available" : "unavailable", sections };
}
