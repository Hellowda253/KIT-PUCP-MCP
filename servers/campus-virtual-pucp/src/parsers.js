import { cleanText, decodeHtml, searchableText } from "./text.js";

const MODULE_ORDER = [
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
];

const MODULE_PATTERNS = [
  ["agenda", /\bagenda\b|miagenda/],
  ["documents", /\/document\/dowdocum/],
  ["enrolled_courses", /cursos?\s+(?:matriculad|inscrit)|cursos?\s+y\s+actividades|matricula\/cursos|\/ocr\/ocwmcurs/],
  ["official_grades", /notas?\s+(?:oficial|final|parcial)|calificaciones?\s+oficial/],
  ["academic_history", /historia\s+academic|historial\s+academic/],
  ["academic_performance", /rendimiento\s+academic|craest|orden\s+de\s+merito/],
  ["curriculum", /plan\s+de\s+estudios|consolidado\s+curricular|malla/],
  ["enrollment", /estado\s+de\s+matricula|horario\s+de\s+matricula|turno\s+de\s+matricula|matricula\/estado|\/matricula\/matricula|^matricula$/],
  ["financial", /documentos?\s+de\s+pago|estado\s+financier|economia|finanzas/],
  ["obligations", /obligaciones?/],
  ["requests", /solicitudes?|tramites?/],
  ["documents", /programas?\s+analiticos?|documentos?|certificados?/]
];

const MODULE_LABELS = {
  agenda: "Agenda",
  enrolled_courses: "Cursos matriculados",
  official_grades: "Notas oficiales",
  academic_history: "Historia académica",
  academic_performance: "Rendimiento académico",
  curriculum: "Plan de estudios",
  enrollment: "Matrícula",
  financial: "Estado financiero",
  obligations: "Obligaciones",
  requests: "Solicitudes",
  documents: "Documentos"
};

function attribute(fragment, name) {
  const value = fragment.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i")
  )?.[2] ?? "";
  return decodeHtml(value);
}

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function legacyNavigationTarget(fragment, baseUrl) {
  const rawHref = attribute(fragment, "href");
  const direct = rawHref ? absoluteUrl(rawHref, baseUrl) : "";
  if (direct && rawHref !== "#") return direct;
  const onclick = attribute(fragment, "onclick");
  for (const match of `${rawHref} ${onclick}`.matchAll(/["']([^"']+)["']/g)) {
    const candidate = match[1];
    if (!/^https?:\/\//i.test(candidate) && !candidate.startsWith("/")) {
      continue;
    }
    const resolved = absoluteUrl(candidate, baseUrl);
    if (resolved) return resolved;
  }
  return "";
}

function imageAlt(inner) {
  const image = String(inner).match(/<img\b([^>]*)>/i);
  return image ? cleanText(attribute(image[1], "alt")) : "";
}

function classifyModule(text) {
  const normalized = searchableText(text);
  return MODULE_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] ??
    "other";
}

export function parsePortalModules(html, baseUrl) {
  const found = new Map();
  const navigation = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of String(html).matchAll(navigation)) {
    const href = legacyNavigationTarget(match[2], baseUrl);
    const extractedLabel =
      cleanText(match[3]) ||
      cleanText(attribute(match[2], "title")) ||
      cleanText(attribute(match[2], "aria-label")) ||
      imageAlt(match[3]);
    if (!href) continue;
    const key = classifyModule(
      `${extractedLabel} ${match[2]} ${href}`
    );
    const label = extractedLabel || MODULE_LABELS[key];
    if (!label) continue;
    if (!found.has(key)) {
      found.set(key, { key, label, href, state: key === "other" ? "unsupported" : "supported" });
    }
  }
  return [...found.values()].sort(
    (left, right) => MODULE_ORDER.indexOf(left.key) - MODULE_ORDER.indexOf(right.key)
  );
}

function moduleScope(module, html) {
  const source = String(html);
  const marker = new RegExp(
    `<(section|main|div)\\b[^>]*data-module=["']${module.replaceAll("_", "[-_]")}["'][^>]*>`,
    "i"
  );
  const opening = marker.exec(source);
  if (!opening) return "";
  const tag = opening[1];
  const tokens = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
  tokens.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let token = tokens.exec(source); token; token = tokens.exec(source)) {
    if (token[0].startsWith("</")) {
      depth -= 1;
    } else if (!token[0].endsWith("/>")) {
      depth += 1;
    }
    if (depth === 0) {
      return source.slice(opening.index, tokens.lastIndex);
    }
  }
  return "";
}

function emptyState(html) {
  return (
    /(?:class=["'][^"']*\b(?:empty-state|no-results|sin-resultados)\b[^"']*["']|data-empty=["']true["'])/i.test(
      String(html)
    ) &&
    /\b(?:no hay (?:resultados|registros|datos)|sin (?:resultados|registros)|ning[uú]n resultado)\b/i.test(
      cleanText(html)
    )
  );
}

function hasStudentRoster(html) {
  const text = searchableText(html);
  return /\b(?:lista(?:do)? de alumnos|padron de alumnos|estudiantes matriculados|codigo de alumno)\b/.test(text);
}

function tableRows(html) {
  const table = String(html).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return null;
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length === 0) return { headers: [], rows: [] };
  const cells = (row) =>
    [...row.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map((cell) => ({
      html: cell[3],
      text: cleanText(cell[3])
    }));
  const headers = cells(rows[0][1]).map(({ text }) => searchableText(text));
  const values = rows.slice(1).map((row) => {
    const values = cells(row[1]);
    return Object.fromEntries(
      headers.map((header, index) => [
        header,
        values[index] ?? { text: "", html: "" }
      ])
    );
  });
  return { headers, rows: values };
}

function pick(row, aliases) {
  const key = Object.keys(row).find((header) =>
    aliases.some((alias) => header === alias || header.includes(alias))
  );
  return key ? row[key] : { text: "", html: "" };
}

function number(value) {
  const parsed = Number(
    String(value ?? "")
      .replace(/[^\d,.-]/g, "")
      .replace(/,(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".")
  );
  return Number.isFinite(parsed) ? parsed : null;
}

const EXPECTED_HEADERS = {
  enrolled_courses: [
    ["codigo"], ["curso", "asignatura"], ["semestre", "periodo"],
    ["horario"], ["modalidad"], ["lugar", "aula"], ["estado"]
  ],
  official_grades: [
    ["codigo"], ["curso", "asignatura"], ["evaluacion", "concepto"],
    ["nota", "calificacion"], ["escala"], ["estado"], ["semestre", "periodo"]
  ],
  academic_history: [
    ["semestre", "periodo"], ["codigo"], ["curso", "asignatura"],
    ["creditos"], ["nota", "calificacion"], ["estado"]
  ],
  curriculum: [
    ["codigo"], ["curso", "asignatura"], ["creditos"], ["estado"],
    ["requisitos", "prerrequisitos"]
  ],
  obligations: [
    ["tipo"], ["obligacion", "descripcion"], ["estado"],
    ["fecha limite", "vencimiento"]
  ],
  requests: [
    ["numero", "id"], ["tipo"], ["estado"], ["creada", "fecha de creacion"],
    ["actualizada", "ultima actualizacion"]
  ],
  documents: [
    ["id", "numero"], ["documento", "titulo"], ["categoria", "tipo"],
    ["semestre", "periodo"], ["enlace", "descarga"], ["sensibilidad"]
  ]
};

function hasExpectedLabels(labels, groups) {
  return groups.every((aliases) =>
    labels.some((label) =>
      aliases.some((alias) => label === alias || label.includes(alias))
    )
  );
}

function parseTableModule(module, scope, mapper) {
  if (emptyState(scope)) {
    return { state: "available", items: [] };
  }
  const table = tableRows(scope);
  if (
    table === null ||
    !hasExpectedLabels(table.headers, EXPECTED_HEADERS[module] ?? [])
  ) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  return { state: "available", items: table.rows.map(mapper).filter(Boolean) };
}

function definitionList(html) {
  const result = {};
  const pattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  for (const match of String(html).matchAll(pattern)) {
    result[searchableText(match[1])] = cleanText(match[2]);
  }
  return result;
}

function dlValue(values, aliases) {
  const key = Object.keys(values).find((label) =>
    aliases.some((alias) => label === alias || label.includes(alias))
  );
  return key ? values[key] : "";
}

const tableParsers = {
  enrolled_courses: (row) => ({
    code: pick(row, ["codigo"]).text,
    name: pick(row, ["curso", "asignatura"]).text,
    term: pick(row, ["semestre", "periodo"]).text,
    schedule: pick(row, ["horario"]).text,
    modality: pick(row, ["modalidad"]).text,
    place: pick(row, ["lugar", "aula"]).text,
    status: pick(row, ["estado"]).text
  }),
  official_grades: (row) => ({
    courseCode: pick(row, ["codigo"]).text,
    course: pick(row, ["curso", "asignatura"]).text,
    item: pick(row, ["evaluacion", "concepto"]).text,
    grade: pick(row, ["nota", "calificacion"]).text,
    scale: pick(row, ["escala"]).text,
    status: pick(row, ["estado"]).text,
    term: pick(row, ["semestre", "periodo"]).text
  }),
  academic_history: (row) => ({
    term: pick(row, ["semestre", "periodo"]).text,
    courseCode: pick(row, ["codigo"]).text,
    course: pick(row, ["curso", "asignatura"]).text,
    credits: number(pick(row, ["creditos"]).text),
    grade: pick(row, ["nota", "calificacion"]).text,
    status: pick(row, ["estado"]).text
  }),
  curriculum: (row) => ({
    code: pick(row, ["codigo"]).text,
    name: pick(row, ["curso", "asignatura"]).text,
    credits: number(pick(row, ["creditos"]).text),
    status: pick(row, ["estado"]).text,
    prerequisites: pick(row, ["requisitos", "prerrequisitos"]).text
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }),
  obligations: (row) => ({
    kind: pick(row, ["tipo"]).text,
    title: pick(row, ["obligacion", "descripcion"]).text,
    status: pick(row, ["estado"]).text,
    dueDate: pick(row, ["fecha limite", "vencimiento"]).text
  }),
  requests: (row) => ({
    id: pick(row, ["numero", "id"]).text,
    type: pick(row, ["tipo"]).text,
    status: pick(row, ["estado"]).text,
    createdAt: pick(row, ["creada", "fecha de creacion"]).text,
    updatedAt: pick(row, ["actualizada", "ultima actualizacion"]).text
  })
};

function parsePerformance(scope) {
  if (emptyState(scope)) {
    return { state: "available", items: [] };
  }
  const values = definitionList(scope);
  const term =
    String(scope).match(/\bdata-term=["']([^"']+)["']/i)?.[1] ??
    dlValue(values, ["semestre", "periodo"]);
  if (
    !term ||
    !hasExpectedLabels(Object.keys(values), [
      ["promedio ponderado"],
      ["craest"],
      ["orden de merito"],
      ["poblacion de facultad"]
    ])
  ) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  return {
    state: "available",
    items: [{
      term,
      weightedAverage: number(dlValue(values, ["promedio ponderado"])),
      craest: number(dlValue(values, ["craest"])),
      meritOrder: number(dlValue(values, ["orden de merito"])),
      facultyPopulation: number(dlValue(values, ["poblacion de facultad"]))
    }]
  };
}

function parseEnrollment(scope) {
  if (emptyState(scope)) {
    return { state: "available", value: null };
  }
  const values = definitionList(scope);
  if (
    !hasExpectedLabels(Object.keys(values), [
      ["semestre", "periodo"],
      ["turno"],
      ["estado"],
      ["cursos permitidos"],
      ["resultado"]
    ])
  ) {
    return { state: "unavailable", value: null, reason: "unsupported_layout" };
  }
  return {
    state: "available",
    value: {
      term: dlValue(values, ["semestre", "periodo"]),
      turn: dlValue(values, ["turno"]),
      status: dlValue(values, ["estado"]),
      allowedCourses: number(dlValue(values, ["cursos permitidos"])),
      results: dlValue(values, ["resultado"])
    }
  };
}

function parseFinancial(scope) {
  if (emptyState(scope)) {
    return { state: "available", value: null };
  }
  const values = definitionList(scope);
  if (
    !hasExpectedLabels(Object.keys(values), [
      ["moneda"],
      ["total pendiente", "saldo"],
      ["proximo vencimiento"],
      ["estado"],
      ["documentos"]
    ])
  ) {
    return { state: "unavailable", value: null, reason: "unsupported_layout" };
  }
  return {
    state: "available",
    value: {
      currency: dlValue(values, ["moneda"]),
      totalDue: number(dlValue(values, ["total pendiente", "saldo"])),
      nextDueDate: dlValue(values, ["proximo vencimiento"]),
      status: dlValue(values, ["estado"]),
      documentCount: number(dlValue(values, ["documentos"]))
    }
  };
}

function documentSensitivity(value) {
  const normalized = searchableText(value);
  return /\b(?:academico|silabo|programa analitico|material)\b/.test(normalized)
    ? "academic"
    : "private";
}

function parseDocuments(scope, baseUrl) {
  return parseTableModule("documents", scope, (row) => {
    const linkCell = pick(row, ["enlace", "descarga"]);
    const href = absoluteUrl(
      linkCell.html.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "",
      baseUrl
    );
    const rawSensitivity = pick(row, ["sensibilidad"]).text;
    return {
      id: pick(row, ["id", "numero"]).text,
      title: pick(row, ["documento", "titulo"]).text,
      category: pick(row, ["categoria", "tipo"]).text,
      term: pick(row, ["semestre", "periodo"]).text,
      href,
      sensitivity: documentSensitivity(rawSensitivity || `${linkCell.text} ${pick(row, ["categoria"]).text}`),
      downloadable: Boolean(href)
    };
  });
}

export function parseModuleHtml(module, html, baseUrl) {
  if (
    module === "financial" &&
    /documentos?\s+de\s+pagos?/i.test(cleanText(html))
  ) {
    return parseLegacyFinancialHtml(html);
  }
  if (
    module === "obligations" &&
    /(?:obligaciones?\s+de\s+pago|objetos?\s+adeudados?)/i.test(cleanText(html))
  ) {
    return parseLegacyObligationsHtml(html);
  }
  if (
    module === "requests" &&
    /solicitud/.test(searchableText(html)) &&
    /fecha y hora de registro/.test(searchableText(html))
  ) {
    return parseLegacyRequestHistoryHtml(html);
  }
  if (
    module === "documents" &&
    /documentos?\s+de\s+cursos?\s+y\s+actividades?/i.test(cleanText(html))
  ) {
    return parseLegacyDocumentCoursesHtml(html);
  }
  const scope = moduleScope(module, html);
  if (!scope || hasStudentRoster(scope)) {
    const empty = ["enrollment", "financial"].includes(module)
      ? { state: "unavailable", value: null, reason: "unsupported_layout" }
      : { state: "unavailable", items: [], reason: "unsupported_layout" };
    return empty;
  }
  if (tableParsers[module]) {
    return parseTableModule(module, scope, tableParsers[module]);
  }
  if (module === "academic_performance") return parsePerformance(scope);
  if (module === "enrollment") return parseEnrollment(scope);
  if (module === "financial") return parseFinancial(scope);
  if (module === "documents") return parseDocuments(scope, baseUrl);
  return { state: "unavailable", items: [], reason: "unsupported_module" };
}

function legacyInputValues(html) {
  const values = {};
  for (const match of String(html).matchAll(/<input\b([^>]*)>/gi)) {
    const name = attribute(match[1], "name");
    if (name) values[name] = attribute(match[1], "value");
  }
  return values;
}

function requiredAcademicContext(values) {
  const studentCode =
    values.persona || values.codigoAlumno || values.codAlumno || values.codigo;
  const year =
    values.cicloAnoMatri || values.cicloAnoDict || values.cicloano;
  const cycle = values.cicloMatri || values.cicloDict || values.ciclo;
  const cycleType =
    values.tipoCicloMatri || values.tipoCicloDict || values.tipociclo;
  if (
    !/^\d{6,12}$/.test(studentCode ?? "") ||
    !/^\d{4}$/.test(year ?? "") ||
    !/^\d{2}$/.test(cycle ?? "") ||
    !/^\d{2}$/.test(cycleType ?? "")
  ) {
    return null;
  }
  return { studentCode, year, cycle, cycleType };
}

export function parseLegacyAcademicTargets(html, pageUrl) {
  const context = requiredAcademicContext(legacyInputValues(html));
  if (!context) {
    return {
      state: "unavailable",
      reason: "unsupported_layout",
      term: "",
      partialGradesUrl: "",
      historyUrl: "",
      personalPanelUrl: "",
      studentScheduleUrl: ""
    };
  }
  const base = new URL(pageUrl);
  const query = new URLSearchParams({
    accion: "Ingresar",
    codigo: context.studentCode,
    cicloano: context.year,
    ciclo: context.cycle,
    tipociclo: context.cycleType
  });
  const history = new URLSearchParams({
    accion: "Ingresar",
    codigo: context.studentCode
  });
  const studentSchedule = new URLSearchParams({
    accion: "MostrarResultadosHorAcad",
    alumno: context.studentCode,
    cicloano: context.year,
    ciclo: context.cycle,
    tipociclo: context.cycleType,
    facultad: "",
    rama: "",
    checkclases: "1",
    checkpra: "1",
    checklab: "1",
    checkexaotros: "1",
    indicasesiones: "1",
    formatedlistacursos: ""
  });
  return {
    state: "available",
    term: `${context.year}-${Number(context.cycle)}`,
    partialGradesUrl: new URL(
      `/pucp/notas/nownotpa/nownotpa?${query}`,
      base.origin
    ).href,
    historyUrl: new URL(
      `/pucp/notas/nowhisno/nowhisno?${history}`,
      base.origin
    ).href,
    personalPanelUrl: new URL(
      `/pucp/general/gewpealu/gewpealu?accion=AbrirPanel&codigo=${encodeURIComponent(context.studentCode)}&misdatos=1`,
      base.origin
    ).href,
    studentScheduleUrl: new URL(
      `/pucp/horarios/howhorac/howhorac?${studentSchedule}`,
      base.origin
    ).href
  };
}

const STUDENT_SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

const STUDENT_SCHEDULE_TYPES = {
  A: "advising",
  T: "class",
  D: "directed_practice",
  L: "laboratory",
  P: "practice",
  E: "exam"
};

function legacyRawTableRows(tableHtml) {
  return [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (row) => [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map((cell) => cell[1])
  );
}

function studentScheduleRoom(fragment, scheduleId, rawType) {
  const text = cleanText(fragment);
  const escapedSchedule = scheduleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(`\\b${rawType}\\s+${escapedSchedule}\\s*-\\s*(.+?)\\s+Sec\\.`, "i")
  );
  return cleanText(match?.[1] ?? "");
}

function studentScheduleModality(room) {
  if (/\b(?:virtual|remot|zoom|teams)\b/i.test(room)) return "virtual";
  if (!room || /^-+$/.test(room)) return "unknown";
  return "in_person";
}

function padHour(value) {
  return `${String(value).padStart(2, "0")}:00`;
}

export function parseLegacyStudentScheduleHtml(html) {
  const term = cleanText(html).match(/\b(\d{4})-(\d{1,2})\b/);
  const table = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map((match) => match[1])
    .find((candidate) => {
      const first = legacyRawTableRows(candidate)[0] ?? [];
      const headers = first.map((cell) => searchableText(cleanText(cell)));
      return headers[0] === "hora" && headers.includes("lunes") && headers.includes("domingo");
    });
  if (!table) {
    return { state: "unavailable", reason: "unsupported_layout", term: "", items: [] };
  }

  const rows = legacyRawTableRows(table).slice(1);
  const slots = [];
  const sequencePattern =
    /MostrarFechasSecuencia\(\s*'(\d{4})'\s*,\s*'(\d{2})'\s*,\s*'(\d{2})'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([A-Z])'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/i;
  for (const cells of rows) {
    const time = cleanText(cells[0] ?? "").match(/(\d{1,2}):00\s*-\s*(\d{1,2}):00/);
    if (!time) continue;
    for (let dayIndex = 0; dayIndex < STUDENT_SCHEDULE_DAYS.length; dayIndex += 1) {
      const cell = cells[dayIndex + 1] ?? "";
      const fragments = [...cell.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((match) => match[1]);
      for (const fragment of fragments.length > 0 ? fragments : [cell]) {
        const sequence = fragment.match(sequencePattern);
        if (!sequence) continue;
        const rawType = sequence[6].toUpperCase();
        const scheduleId = cleanText(sequence[5]);
        const room = studentScheduleRoom(fragment, scheduleId, rawType);
        slots.push({
          courseCode: cleanText(sequence[4]).toUpperCase(),
          courseName: cleanText(sequence[9]),
          term: `${sequence[1]}-${Number(sequence[2])}`,
          scheduleId,
          scheduleType: STUDENT_SCHEDULE_TYPES[rawType] ?? "other",
          rawScheduleType: rawType,
          section: cleanText(sequence[7]),
          day: STUDENT_SCHEDULE_DAYS[dayIndex],
          start: padHour(time[1]),
          end: padHour(time[2]),
          room,
          modality: studentScheduleModality(room)
        });
      }
    }
  }

  slots.sort((left, right) =>
    STUDENT_SCHEDULE_DAYS.indexOf(left.day) - STUDENT_SCHEDULE_DAYS.indexOf(right.day) ||
    left.start.localeCompare(right.start) ||
    left.courseCode.localeCompare(right.courseCode) ||
    left.scheduleType.localeCompare(right.scheduleType)
  );
  const items = [];
  for (const slot of slots) {
    const previous = items.at(-1);
    const same = previous && [
      "courseCode", "scheduleId", "scheduleType", "section", "day", "room"
    ].every((key) => previous[key] === slot[key]);
    if (same && previous.end === slot.start) previous.end = slot.end;
    else items.push(slot);
  }
  return {
    state: "available",
    term: term ? `${term[1]}-${Number(term[2])}` : items[0]?.term ?? "",
    items
  };
}

function legacyTableMatrices(html) {
  const tables = [];
  for (const table of String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<(?:th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)>/gi)) {
        const value = cleanText(cell[2]);
        const colspan = Math.max(1, Number(attribute(cell[1], "colspan")) || 1);
        for (let index = 0; index < colspan; index += 1) cells.push(value);
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

function courseIdentity(value) {
  const text = cleanText(value);
  const match = text.match(/^(.+?)\s*\(([A-Z0-9]+)\)\s*$/i);
  return match
    ? { course: cleanText(match[1]), courseCode: match[2].toUpperCase() }
    : null;
}

function partialStatisticsReferences(html) {
  const byCourse = new Map();
  const pattern =
    /ver_estadisticas\(\s*'([^']+)'\s*,\s*'(\d{4})'\s*,\s*'(\d{2})'\s*,\s*'(\d{2})'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/gi;
  for (const match of String(html).matchAll(pattern)) {
    const courseCode = cleanText(match[1]).toUpperCase();
    const reference = {
      kind: "partial",
      courseCode,
      year: match[2],
      cycle: match[3],
      cycleType: match[4],
      evaluationType: match[5],
      evaluationNumber: Number(match[6]),
      schedule: match[7],
      commission: match[8]
    };
    const existing = byCourse.get(courseCode) ?? [];
    existing.push(reference);
    byCourse.set(courseCode, existing);
  }
  return byCourse;
}

function finalStatisticsReferences(html) {
  const byCourseTermSchedule = new Map();
  const pattern =
    /link_estadistica\(\s*'(\d{4})'\s*,\s*'(\d{2})'\s*,\s*'(\d{2})'\s*,\s*'([^']+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'([^']*)'\s*\)/gi;
  for (const match of String(html).matchAll(pattern)) {
    const courseCode = cleanText(match[4]).toUpperCase();
    const term = `${match[1]}-${Number(match[2])}`;
    const schedule = match[7];
    const key = `${term}\0${courseCode}\0${schedule}`;
    const existing = byCourseTermSchedule.get(key) ?? [];
    existing.push({
      kind: "final",
      courseCode,
      year: match[1],
      cycle: match[2],
      cycleType: match[3],
      faculty: match[5],
      meritType: match[6],
      schedule
    });
    byCourseTermSchedule.set(key, existing);
  }
  return byCourseTermSchedule;
}

export function parseLegacyPartialGradesHtml(html) {
  const term = cleanText(html).match(
    /notas\s+parciales\s+del\s+ciclo\s+(\d{4}-\d+)/i
  )?.[1] ?? "";
  const items = [];
  const statisticsByCourse = partialStatisticsReferences(html);
  for (const rows of legacyTableMatrices(html)) {
    const identity = courseIdentity(rows[0]?.[0]);
    if (!identity) continue;
    const statistics = statisticsByCourse.get(identity.courseCode) ?? [];
    let statisticsIndex = 0;
    const formula = cleanText(rows[1]?.[0]).replace(
      /^f[oó]rmula\s+de\s+calificaci[oó]n\s*:\s*/i,
      ""
    );
    const numberIndex = rows.findIndex(
      (row) => searchableText(row[0]) === "nro"
    );
    const gradeIndex = rows.findIndex(
      (row) => searchableText(row[0]) === "nota"
    );
    if (numberIndex < 1 || gradeIndex < 0) continue;
    const groups = rows[numberIndex - 1];
    const numbers = rows[numberIndex];
    const grades = rows[gradeIndex];
    const width = Math.max(numbers.length, grades.length);
    for (let index = 1; index < width; index += 1) {
      const statisticsReference = statistics[statisticsIndex++] ?? null;
      const grade = cleanText(grades[index]);
      if (!grade) continue;
      const assessmentType = cleanText(groups[index]);
      const assessmentNumber = cleanText(numbers[index]);
      const item = {
        ...identity,
        item: cleanText(`${assessmentType} ${assessmentNumber}`),
        assessmentType,
        assessmentNumber,
        grade,
        scale: "0-20",
        status: "No oficial",
        term,
        formula
      };
      if (statisticsReference) item.statistics = statisticsReference;
      items.push(item);
    }
  }
  return items.length > 0 || /notas\s+parciales/i.test(cleanText(html))
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "unsupported_layout" };
}

export function parseLegacyGradeStatisticsHtml(html) {
  const text = cleanText(html);
  const normalized = searchableText(text);
  if (!/estadistica(?:s)?\s+de\s+notas/.test(normalized)) {
    return { state: "unavailable", reason: "unsupported_layout" };
  }

  const title = text.match(
    /\bNotas(?:\s+Finales)?\s+(.+?)\s+(\d{4}-\d+)\b/i
  );
  const numeric = (value) => {
    const raw = cleanText(value);
    return /-?\d+(?:[.,]\d+)?/.test(raw) ? number(raw) : null;
  };
  const result = {
    state: "available",
    course: cleanText(title?.[1]),
    term: cleanText(title?.[2]),
    faculty: "",
    schedule: "",
    evaluationType: "",
    evaluationNumber: null,
    instructors: "",
    approvedPercentage:
      numeric(text.match(/Aprob\.\s*(\d+(?:[.,]\d+)?)\s*%/i)?.[1]),
    failedPercentage:
      numeric(text.match(/Desap\.\s*(\d+(?:[.,]\d+)?)\s*%/i)?.[1]),
    summary: null,
    distribution: [],
    noteTypes: []
  };

  for (const rows of legacyTableMatrices(html)) {
    for (const row of rows) {
      for (let index = 0; index < row.length - 1; index += 2) {
        const label = searchableText(row[index]);
        const value = row[index + 1];
        if (label.startsWith("facultad")) result.faculty = cleanText(value);
        if (label.startsWith("horario")) result.schedule = cleanText(value);
        if (label.startsWith("tipo evaluacion")) {
          result.evaluationType = cleanText(value);
        }
        if (label.startsWith("numero evaluacion")) {
          result.evaluationNumber = numeric(value);
        }
        if (label.includes("docentes de horarios principales")) {
          result.instructors = cleanText(value);
        }
      }
    }

    const headerIndex = rows.findIndex((row) => {
      const headers = row.map(searchableText);
      return (
        headers.includes("tipo de nota") ||
        headers.includes("frecuencia")
      );
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(searchableText);
    if (
      headers.includes("tipo de nota") &&
      headers.includes("media") &&
      rows[headerIndex + 1]
    ) {
      const row = rows[headerIndex + 1];
      result.summary = {
        noteType: cleanText(row[headers.indexOf("tipo de nota")]),
        count: numeric(row[headers.indexOf("cantidad")]),
        mean: numeric(row[headers.indexOf("media")]),
        standardDeviation: numeric(row[headers.indexOf("desv. est.")]),
        median: numeric(row[headers.indexOf("mediana")]),
        minimum: numeric(row[headers.indexOf("minimo")]),
        maximum: numeric(row[headers.indexOf("maximo")])
      };
      continue;
    }

    if (
      headers.includes("nota") &&
      headers.includes("frecuencia") &&
      headers.includes("porcentaje acumulado")
    ) {
      result.distribution = rows
        .slice(headerIndex + 1)
        .filter((row) => searchableText(row[0]) !== "total")
        .map((row) => ({
          grade: numeric(row[headers.indexOf("nota")]),
          frequency: numeric(row[headers.indexOf("frecuencia")]),
          percentage: numeric(row[headers.indexOf("porcentaje")]),
          cumulativePercentage: numeric(
            row[headers.indexOf("porcentaje acumulado")]
          )
        }))
        .filter(({ grade, frequency }) => grade !== null && frequency !== null);
      continue;
    }

    if (
      headers.length === 2 &&
      headers[0] === "tipo de nota" &&
      headers[1] === "cantidad"
    ) {
      result.noteTypes = rows
        .slice(headerIndex + 1)
        .filter((row) => searchableText(row[0]) !== "total")
        .map((row) => ({
          type: cleanText(row[0]),
          count: numeric(row[1])
        }))
        .filter(({ type, count }) => type && count !== null);
    }
  }

  if (
    result.approvedPercentage === null &&
    result.summary?.count > 0 &&
    result.distribution.length > 0
  ) {
    const approved = result.distribution
      .filter(({ grade }) => grade >= 11)
      .reduce((sum, { frequency }) => sum + frequency, 0);
    result.approvedPercentage = Number(
      ((approved / result.summary.count) * 100).toFixed(1)
    );
    result.failedPercentage = Number(
      (100 - result.approvedPercentage).toFixed(1)
    );
    result.passRateSource = "derived_from_distribution";
  } else if (result.approvedPercentage !== null) {
    result.passRateSource = "campus_chart";
  }

  return result.summary
    ? result
    : { state: "unavailable", reason: "unsupported_layout" };
}

function merit(value) {
  const match = cleanText(value).match(/^(\d+)\s*\/\s*(\d+)$/);
  return match
    ? { rank: Number(match[1]), total: Number(match[2]) }
    : null;
}

function headerIndex(headers, aliases) {
  return headers.findIndex((header) =>
    aliases.some((alias) => header === alias || header.includes(alias))
  );
}

export function parseLegacyHistoryHtml(html) {
  const items = [];
  const statisticsByCourse = finalStatisticsReferences(html);
  let term = "";
  let status = "Oficial";
  for (const rows of legacyTableMatrices(html)) {
    const tableText = cleanText(rows.flat().join(" "));
    const cycle = tableText.match(/\bciclo\s*:\s*(\d{4}-\d+)\b/i);
    if (cycle) {
      term = cycle[1];
      status = /\bno\s+oficial\b/i.test(tableText)
        ? "No oficial"
        : "Oficial";
      continue;
    }
    const headers = (rows[0] ?? []).map(searchableText);
    const codeIndex = headerIndex(headers, ["clave", "codigo"]);
    const courseIndex = headerIndex(headers, ["nombre del curso", "curso"]);
    const gradeIndex = headerIndex(headers, ["nota"]);
    if (!term || codeIndex < 0 || courseIndex < 0 || gradeIndex < 0) continue;
    const index = {
      credits: headerIndex(headers, ["cred"]),
      attempt: headerIndex(headers, ["vez"]),
      kind: headerIndex(headers, ["tipo"]),
      schedule: headerIndex(headers, ["horario"]),
      modality: headerIndex(headers, ["modalidad"]),
      ects: headerIndex(headers, ["calificacionects", "ects"]),
      meritApproved: headerIndex(headers, ["merito/aprobados"]),
      meritOverall: headerIndex(headers, ["merito/total"]),
      turn: headerIndex(headers, ["tm"]),
      instructors: headerIndex(headers, ["profesor"])
    };
    for (const row of rows.slice(1)) {
      const courseCode = cleanText(row[codeIndex]);
      const course = cleanText(row[courseIndex]);
      if (!courseCode || !course) continue;
      const schedule = cleanText(row[index.schedule]);
      const statisticsKey = `${term}\0${courseCode.toUpperCase()}\0${schedule}`;
      const statistics = statisticsByCourse.get(statisticsKey)?.shift() ?? null;
      const item = {
        term,
        courseCode,
        course,
        credits: number(row[index.credits]),
        attempt: number(row[index.attempt]),
        kind: cleanText(row[index.kind]),
        schedule,
        modality: cleanText(row[index.modality]),
        grade: cleanText(row[gradeIndex]),
        ects: cleanText(row[index.ects]),
        meritApproved: merit(row[index.meritApproved]),
        meritOverall: merit(row[index.meritOverall]),
        enrollmentTurn: number(row[index.turn]),
        instructors: cleanText(row[index.instructors]),
        status
      };
      if (statistics) item.statistics = statistics;
      items.push(item);
    }
  }
  return items.length > 0
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "unsupported_layout" };
}

function firstMatchNumber(text, pattern) {
  const match = text.match(pattern);
  return match ? number(match[1]) : null;
}

function legacyLabeledValue(html, aliases) {
  for (const rows of legacyTableMatrices(html)) {
    for (const row of rows) {
      const label = searchableText(row[0]);
      if (aliases.some((alias) => label === alias || label.includes(alias))) {
        const value = cleanText(row[1]);
        if (value) return value;
      }
    }
  }
  return "";
}

export function parseLegacyAcademicPerformanceHtml(html) {
  const text = searchableText(cleanText(html));
  if (!/rendimiento\s+academico/i.test(text)) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  const term = text.match(
    /alumnos\s+matriculados[\s\S]*?\ben\s+el\s+ciclo\s+(\d{4}-\d+)/i
  )?.[1] ?? "";
  const meritScopes = [
    ...text.matchAll(
      /orden\s+de\s+merito\s+en\s+(.+?)\s+(\d+)\s+de\s+(\d+)\s*\(([\d.,]+)\s*%\)/gi
    )
  ];
  const faculty = meritScopes[0];
  const specialty = meritScopes[1];
  const item = {
    term,
    weightedAverage: firstMatchNumber(
      text,
      /promedio\s+general\s+ponderado(?!\s+ultimos)\s+([\d.,]+)/i
    ),
    approvedAverage: firstMatchNumber(
      text,
      /promedio\s+general\s+aprobados\s+([\d.,]+)/i
    ),
    lastFourTermsAverage: firstMatchNumber(
      text,
      /promedio\s+general\s+ponderado\s+ultimos\s+4\s+ciclos\s+([\d.,]+)/i
    ),
    craest: firstMatchNumber(text, /cra\s+estandarizado\s+([\d.,]+)/i),
    meritOrder: faculty ? Number(faculty[2]) : null,
    facultyPopulation: faculty ? Number(faculty[3]) : null,
    meritPercent: faculty ? number(faculty[4]) : null,
    specialtyMeritOrder: specialty ? Number(specialty[2]) : null,
    specialtyPopulation: specialty ? Number(specialty[3]) : null,
    specialtyMeritPercent: specialty ? number(specialty[4]) : null,
    historicalEnrolledCredits: firstMatchNumber(
      text,
      /creditos\s+matriculados\s+historico\s+([\d.,]+)/i
    ),
    historicalApprovedCredits: firstMatchNumber(
      text,
      /creditos\s+aprobados\s+historico\s+([\d.,]+)/i
    ),
    currentApprovedCredits: firstMatchNumber(
      text,
      /creditos\s+aprobados\s+actual\s+([\d.,]+)/i
    ),
    processedAt:
      text.match(/proceso\s+realizado\s+el\s+(\d{2}-\d{2}-\d{4})/i)?.[1] ??
      "",
    gradesThroughTerm:
      text.match(/notas\s+registradas\s+hasta\s+el\s+ciclo\s+(\d{4}-\d+)/i)?.[1] ??
      ""
  };
  if (!term || item.craest === null || item.weightedAverage === null) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  return { state: "available", items: [item] };
}

export function parseLegacyCurriculumHtml(html) {
  const text = cleanText(html);
  const normalizedText = searchableText(text);
  if (!/consolidado\s+curricular/i.test(text)) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  const items = [];
  const seen = new Set();
  for (const rows of legacyTableMatrices(html)) {
    const headers = (rows[0] ?? []).map(searchableText);
    const index = {
      code: headerIndex(headers, ["clave", "codigo"]),
      name: headerIndex(headers, ["nombre del curso", "curso"]),
      type: headerIndex(headers, ["tipo"]),
      credits: headerIndex(headers, ["creditos"]),
      attempt: headerIndex(headers, ["vez"]),
      grade: headerIndex(headers, ["nota"]),
      term: headerIndex(headers, ["ciclo"]),
      equivalence: headerIndex(headers, ["equivalencia"]),
      observation: headerIndex(headers, ["observacion"])
    };
    if (index.code < 0 || index.name < 0 || index.credits < 0) continue;
    for (const row of rows.slice(1)) {
      const code = cleanText(row[index.code]).toUpperCase();
      const name = cleanText(row[index.name]);
      if (!/^[A-Z0-9]{3,12}$/.test(code) || !name) continue;
      const term = cleanText(row[index.term]);
      const grade = cleanText(row[index.grade]);
      const numericGrade = grade ? number(grade) : null;
      const key = `${code}\0${term}\0${grade}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        code,
        name,
        type: cleanText(row[index.type]),
        credits: number(row[index.credits]),
        attempt: number(row[index.attempt]),
        grade,
        term,
        equivalence: cleanText(row[index.equivalence]),
        observation: cleanText(row[index.observation]),
        status:
          numericGrade === null
            ? "Pendiente"
            : numericGrade >= 11
              ? "Aprobado"
              : "No aprobado",
        prerequisites: []
      });
    }
  }
  if (items.length === 0) {
    return { state: "unavailable", items: [], reason: "unsupported_layout" };
  }
  return {
    state: "available",
    items,
    summary: {
      academicUnit: legacyLabeledValue(html, ["unidad academica"]),
      specialty: legacyLabeledValue(html, ["especialidad"]),
      stage: legacyLabeledValue(html, ["etapa"]),
      plan: legacyLabeledValue(html, ["plan de estudios"]),
      requiredCredits: firstMatchNumber(
        normalizedText,
        /creditos\s+necesarios\s+para\s+el\s+egreso\s+del\s+alumno\s*:\s*([\d.,]+)/i
      ),
      accumulatedCredits: firstMatchNumber(
        normalizedText,
        /total\s+de\s+creditos\s+acumulados\s*:\s*([\d.,]+)/i
      )
    }
  };
}

function currency(value) {
  const normalized = cleanText(value).toUpperCase();
  if (["S/", "S/.", "PEN"].includes(normalized)) return "PEN";
  if (["$", "USD", "US$"].includes(normalized)) return "USD";
  return normalized;
}

export function parseLegacyFinancialHtml(html) {
  const documents = [];
  for (const rows of legacyTableMatrices(html)) {
    const headers = (rows[0] ?? []).map(searchableText);
    const index = {
      term: headerIndex(headers, ["ciclo"]),
      document: headerIndex(headers, ["documento"]),
      currency: headerIndex(headers, ["u.m.", "moneda"]),
      amount: headerIndex(headers, ["importe", "monto"]),
      status: headerIndex(headers, ["estado"]),
      dueDate: headerIndex(headers, ["vence", "vencimiento"]),
      paidAt: headerIndex(headers, ["pago", "fecha de pago"])
    };
    if (
      index.term < 0 ||
      index.document < 0 ||
      index.amount < 0 ||
      index.status < 0 ||
      index.dueDate < 0
    ) {
      continue;
    }
    for (const row of rows.slice(1)) {
      const document = cleanText(row[index.document]);
      if (!document) continue;
      documents.push({
        term: cleanText(row[index.term]),
        document,
        currency: currency(row[index.currency]),
        amount: number(row[index.amount]),
        status: cleanText(row[index.status]),
        dueDate: cleanText(row[index.dueDate]),
        paidAt: cleanText(row[index.paidAt])
      });
    }
  }
  if (
    documents.length === 0 &&
    !/documentos?\s+de\s+pagos?/i.test(cleanText(html))
  ) {
    return { state: "unavailable", value: null, reason: "unsupported_layout" };
  }
  const pending = documents.filter(
    ({ status }) => !/(?:cancelad|pagad|anulad|transfer)/i.test(status)
  );
  return {
    state: "available",
    value: {
      currency:
        pending.find(({ currency: value }) => value)?.currency ||
        documents.find(({ currency: value }) => value)?.currency ||
        "",
      totalDue: pending.reduce(
        (total, document) => total + (document.amount ?? 0),
        0
      ),
      nextDueDate: pending.find(({ dueDate }) => dueDate)?.dueDate ?? "",
      status: pending.length > 0 ? "Pendiente" : "Al día",
      documentCount: documents.length,
      documents
    }
  };
}

export function parseLegacyObligationsHtml(html) {
  const items = [];
  for (const rows of legacyTableMatrices(html)) {
    const headers = (rows[0] ?? []).map(searchableText);
    const index = {
      kind: headerIndex(headers, ["tipo"]),
      title: headerIndex(headers, ["obligacion", "concepto", "descripcion"]),
      status: headerIndex(headers, ["estado"]),
      dueDate: headerIndex(headers, ["vence", "vencimiento", "fecha limite"]),
      amount: headerIndex(headers, ["importe", "monto"]),
      currency: headerIndex(headers, ["u.m.", "moneda"])
    };
    if (index.title < 0 || index.status < 0) continue;
    for (const row of rows.slice(1)) {
      const title = cleanText(row[index.title]);
      if (!title) continue;
      items.push({
        kind: cleanText(row[index.kind]),
        title,
        status: cleanText(row[index.status]),
        dueDate: cleanText(row[index.dueDate]),
        amount: number(row[index.amount]),
        currency: currency(row[index.currency])
      });
    }
  }
  return items.length > 0 ||
    /(?:obligaciones?\s+de\s+pago|objetos?\s+adeudados?)/i.test(cleanText(html))
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "unsupported_layout" };
}

export function parseLegacyRequestHistoryHtml(html) {
  const items = [];
  let section = "";
  for (const rows of legacyTableMatrices(html)) {
    const tableText = cleanText(rows.flat().join(" "));
    if (
      rows.length === 1 &&
      /\bocurrencia(?:s)?\b/i.test(tableText)
    ) {
      section = cleanText(rows[0][0]);
      continue;
    }
    const headers = (rows[0] ?? []).map(searchableText);
    const index = {
      id: headerIndex(headers, ["n solicitud", "n° solicitud", "numero solicitud"]),
      createdAt: headerIndex(headers, ["fecha y hora de registro", "fecha de registro"]),
      updatedAt: headerIndex(headers, ["fecha y hora de pago", "fecha de pago"]),
      status: headerIndex(headers, ["estado"]),
      detail: headerIndex(headers, ["observacion", "dictamen"])
    };
    if (index.id < 0 || index.createdAt < 0 || index.status < 0) continue;
    for (const rawRow of rows.slice(1)) {
      const row =
        rawRow.length === headers.length + 1
          ? rawRow.slice(1)
          : rawRow;
      const id = cleanText(row[index.id]);
      if (!id) continue;
      items.push({
        id,
        type: section,
        status: cleanText(row[index.status]),
        createdAt: cleanText(row[index.createdAt]),
        updatedAt: cleanText(row[index.updatedAt]),
        detail: cleanText(row[index.detail])
      });
    }
  }
  return items.length > 0 ||
    /(?:b[uú]squeda|seguimiento)\s+de\s+tr[aá]mites/i.test(cleanText(html))
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "unsupported_layout" };
}

export function parseLegacyDocumentCoursesHtml(html) {
  const items = [];
  for (const rows of legacyTableMatrices(html)) {
    const headers = (rows[0] ?? []).map(searchableText);
    const titleIndex = headerIndex(headers, ["nombres", "nombre"]);
    if (titleIndex < 0) continue;
    for (const [rowIndex, row] of rows.slice(1).entries()) {
      const title = cleanText(row[titleIndex]);
      if (!title) continue;
      const term = title.match(/\((\d{4}-\d+)\)\s*$/)?.[1] ?? "";
      items.push({
        id: `course-${rowIndex + 1}`,
        title,
        category: "Curso o actividad",
        term,
        href: "",
        sensitivity: "academic",
        downloadable: false
      });
    }
  }
  return items.length > 0 ||
    /documentos?\s+de\s+cursos?\s+y\s+actividades?/i.test(cleanText(html))
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "unsupported_layout" };
}

export function parseLegacyCourseDocumentTargets(html, pageUrl) {
  const user = legacyInputValues(html).usuario;
  if (!/^\d{6,12}$/.test(user ?? "")) return [];
  const targets = [];
  for (const match of String(html).matchAll(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  )) {
    const call = attribute(match[1], "href").match(
      /Documentos\(['"](\d{8}[A-Z0-9]+)['"],['"]CU['"]\)/i
    );
    if (!call) continue;
    const identifier = call[1].toUpperCase();
    const query = new URLSearchParams({
      accion: "Ingresar",
      codigo: user,
      cicloano: identifier.slice(0, 4),
      ciclo: identifier.slice(4, 6),
      tipociclo: identifier.slice(6, 8),
      clavecurso: identifier.slice(8)
    });
    targets.push({
      title: cleanText(match[2]),
      term: `${identifier.slice(0, 4)}-${Number(identifier.slice(4, 6))}`,
      courseCode: identifier.slice(8),
      href: new URL(
        `/pucp/document/dowdocum/dowdocum?${query}`,
        pageUrl
      ).href
    });
  }
  return targets;
}

export function parseLegacyCourseDocumentsHtml(html, pageUrl) {
  const values = legacyInputValues(html);
  const term =
    /^\d{4}$/.test(values.cicloano ?? "") &&
    /^\d{2}$/.test(values.ciclo ?? "")
      ? `${values.cicloano}-${Number(values.ciclo)}`
      : "";
  const courseCode = cleanText(values.clavecurso).toUpperCase();
  const items = [];
  const source = String(html);
  for (const match of source.matchAll(
    /<a\b([^>]*\bclass=["'][^"']*\bmArchD\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi
  )) {
    const href = attribute(match[1], "href");
    const id =
      href.match(/mArcD\(['"](\d+)['"]\)/i)?.[1] ??
      attribute(match[1], "id").match(/^a(\d+)$/i)?.[1] ??
      "";
    if (!id) continue;
    const before = source.slice(Math.max(0, match.index - 800), match.index);
    const format =
      [...before.matchAll(/alt=["']Documento\s+([^"']+)["']/gi)].at(-1)?.[1]
        ?.trim()
        .toLowerCase() ?? "";
    const label = cleanText(match[2]);
    const sizeMatch = label.match(/^(.*?)\s*\(([\d.,]+\s*(?:[KMGT]?B|bytes?))\)\s*$/i);
    const title = cleanText(sizeMatch?.[1] ?? label);
    items.push({
      id,
      title,
      category: "Material de curso",
      term,
      courseCode,
      format,
      size: cleanText(sizeMatch?.[2] ?? ""),
      href: new URL(
        `/pucp/document/dowdocum/dowdocum?accion=Descargar&documento=${encodeURIComponent(id)}`,
        pageUrl
      ).href,
      sensitivity: "academic",
      downloadable: true
    });
  }
  return /documentos\s+del\s+curso/i.test(cleanText(html))
    ? { state: "available", items }
    : { state: "unavailable", items: [], reason: "unsupported_layout" };
}

function repairMojibake(value) {
  const text = String(value);
  if (!/[ÃÂ]/.test(text)) return text;
  const repaired = Buffer.from(text, "latin1").toString("utf8");
  return repaired.includes("\uFFFD") ? text : repaired;
}

export function decodeAgendaPayload(bytes) {
  if (typeof bytes === "string") return repairMojibake(bytes);
  return repairMojibake(new TextDecoder("iso-8859-1").decode(bytes));
}

function compactDate(value) {
  const text = String(value ?? "");
  return /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : "";
}

function compactTime(value) {
  const text = String(value ?? "").padStart(4, "0");
  return /^\d{4}$/.test(text) ? `${text.slice(0, 2)}:${text.slice(2)}` : "";
}

function parseAgendaDescription(description) {
  const text = cleanText(description);
  const match = text.match(
    /^(.+?)\s+\((\d{4}-\d),\s*([^,]+),\s*HORARIO\s+([^,]+),\s*SESI[OÓ]N\s+([^)]+)\)/i
  );
  const head = match?.[1] ?? text;
  const kind = head.match(/^(.+?)\s+DE\s+(.+)$/i);
  return {
    kind: cleanText(kind?.[1] ?? head).toUpperCase(),
    course: cleanText(kind?.[2] ?? "").toUpperCase(),
    term: cleanText(match?.[2] ?? ""),
    code: cleanText(match?.[3] ?? ""),
    schedule: cleanText(match?.[4] ?? ""),
    modality: cleanText(match?.[5] ?? "").toUpperCase()
  };
}

function normalizeAgendaEvent(raw) {
  const beginDate = compactDate(raw.begin?.date);
  const endDate = compactDate(raw.end?.date);
  const beginTime = compactTime(raw.begin?.time);
  const endTime = compactTime(raw.end?.time);
  const title = cleanText(raw.title || raw.description);
  const description = cleanText(raw.description || title);
  const parsed = parseAgendaDescription(description);
  const place = cleanText(raw.place);
  return {
    id: String(raw.id ?? ""),
    category: String(raw.category ?? ""),
    title,
    description,
    ...parsed,
    place: place === "0000" ? "" : place,
    beginDate,
    endDate,
    beginTime,
    endTime,
    start: beginDate && beginTime ? `${beginDate}T${beginTime}:00-05:00` : "",
    end: endDate && endTime ? `${endDate}T${endTime}:00-05:00` : ""
  };
}

export function parseAgendaPayload(bytes) {
  const text = decodeAgendaPayload(bytes);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    const error = new Error("Campus agenda response did not contain JSON");
    error.code = "scrape_failed";
    throw error;
  }
  const payload = JSON.parse(text.slice(start, end + 1));
  return (payload.events ?? [])
    .map(normalizeAgendaEvent)
    .sort((left, right) =>
      `${left.beginDate} ${left.beginTime}`.localeCompare(
        `${right.beginDate} ${right.beginTime}`
      )
    );
}
