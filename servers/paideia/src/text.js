export function decodeHtml(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

export function cleanText(value = "") {
  return decodeHtml(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(?:p|div|li|tr|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

export function searchableText(value = "") {
  return cleanText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function normalizeCourseName(name = "") {
  return cleanText(name)
    .replace(/^\d{4}-\d+\s+/i, "")
    .replace(/\s+\([^)]+\)\s*$/g, "");
}

export function safeName(value = "") {
  const normalized = cleanText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "Sin nombre";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)
    ? `_${normalized}`
    : normalized;
}

const months = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  setiembre: 8,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11
};

export function parsePaideiaDate(value = "") {
  const normalized = searchableText(value);
  let match = normalized.match(
    /(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4}),?\s*(\d{1,2}):(\d{2})/
  );
  if (match && months[match[2]] !== undefined) {
    return new Date(
      Date.UTC(
        Number(match[3]),
        months[match[2]],
        Number(match[1]),
        Number(match[4]) + 5,
        Number(match[5])
      )
    );
  }
  match = normalized.match(
    /(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (!match) return null;
  return new Date(
    Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] ?? 23) + 5,
      Number(match[5] ?? 59)
    )
  );
}

export function extractDue(value = "") {
  const text = cleanText(value);
  const match = text.match(
    /(?:Fecha de entrega|Due date|Cierre|Cierra|Disponible hasta|Presentaci[oó]n hasta|Subir hasta):?\s*((?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s*)?\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4},?\s*\d{1,2}:\d{2}|(?:Fecha de entrega|Due date|Cierre|Cierra|Disponible hasta|Presentaci[oó]n hasta|Subir hasta):?\s*\d{1,2}[./]\d{1,2}[./]\d{4}(?:\s+\d{1,2}:\d{2})?/i
  );
  if (!match) return { dueDate: "", dueText: "", dueTimestamp: null };
  const dueText = cleanText(match[0]);
  const parsed = parsePaideiaDate(dueText);
  return {
    dueDate: parsed?.toISOString() ?? "",
    dueText,
    dueTimestamp: parsed?.getTime() ?? null
  };
}
