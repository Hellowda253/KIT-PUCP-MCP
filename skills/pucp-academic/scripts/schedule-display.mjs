const SMALL_WORDS = new Set([
  "a", "al", "and", "con", "de", "del", "e", "el", "en", "la", "las",
  "los", "of", "para", "por", "the", "y"
]);

function hasLetters(value) {
  return /\p{L}/u.test(value);
}

function isAllUppercase(value) {
  return hasLetters(value) && !/\p{Ll}/u.test(value);
}

export function readableLabel(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!isAllUppercase(text)) return text;
  let wordIndex = 0;
  return text.toLocaleLowerCase("es-PE").replace(/\p{L}[\p{L}\p{M}]*/gu, (word) => {
    const lower = word.toLocaleLowerCase("es-PE");
    const keepLower = wordIndex > 0 && SMALL_WORDS.has(lower);
    wordIndex += 1;
    return keepLower ? lower : `${lower[0].toLocaleUpperCase("es-PE")}${lower.slice(1)}`;
  });
}

function initials(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word[0].toLocaleUpperCase("es-PE")}.`)
    .join(" ");
}

function compactPerson(value) {
  const comma = value.indexOf(",");
  if (comma < 0 || value.indexOf(",", comma + 1) >= 0) return readableLabel(value);
  const surnames = readableLabel(value.slice(0, comma));
  const originalGivenNames = String(value.slice(comma + 1)).trim();
  const alreadyCompact = originalGivenNames
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => /^\p{L}\.?$/u.test(word));
  const givenNames = alreadyCompact ? originalGivenNames : initials(originalGivenNames);
  return [surnames, givenNames].filter(Boolean).join(", ");
}

export function compactInstructor(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return text;
  const people = text.split(/\s+(?:\/|;|\|)\s+/).filter(Boolean);
  return people.map(compactPerson).join(" / ");
}

function normalizedCourseCode(value) {
  return String(value ?? "").trim().toLocaleUpperCase("es-PE");
}

const EXAM_TYPE_LABELS = {
  partial: "Parcial",
  final: "Final",
  unknown: "Examen"
};

const SHORT_DAYS = ["Dom.", "Lun.", "Mar.", "Mié.", "Jue.", "Vie.", "Sáb."];
const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function isoDateParts(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, day, weekday: date.getUTCDay() };
}

export function formatExamDate(value) {
  const parts = isoDateParts(value);
  return parts ? `${parts.day} ${SHORT_MONTHS[parts.month - 1]}` : "";
}

function examSummary(session) {
  const parts = isoDateParts(session.date);
  const type = EXAM_TYPE_LABELS[session.examType] ?? EXAM_TYPE_LABELS.unknown;
  if (!parts) {
    if (session.datePrecision !== "weekday_time_only") return "";
    const weekday = SHORT_DAYS[Number(session.day)] ?? "Día publicado";
    return `${type}: ${weekday} · ${session.start}–${session.end}${session.room ? ` · ${session.room}` : ""} · Fecha no publicada`;
  }
  return `${type}: ${SHORT_DAYS[parts.weekday]} ${formatExamDate(session.date)} · ${session.start}–${session.end}${session.room ? ` · ${session.room}` : ""}`;
}

function courseExamSummary(courseCode, sessions) {
  const code = normalizedCourseCode(courseCode);
  return sessions
    .filter((session) => session?.type === "exam" &&
      (session.courseCodes ?? []).some((candidate) => normalizedCourseCode(candidate) === code))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .map(examSummary)
    .filter(Boolean)
    .join("; ");
}

function sessionDisplayTitle(session, coursesByCode) {
  if (session?.type !== "exam") return readableLabel(session?.title);
  const courseNames = (Array.isArray(session.courseCodes) ? session.courseCodes : [])
    .map((code) => coursesByCode.get(normalizedCourseCode(code))?.displayName)
    .filter(Boolean);
  return courseNames.length > 0
    ? [...new Set(courseNames)].join(" / ")
    : readableLabel(session?.title);
}

export function prepareScheduleDisplayData(data) {
  const sourceSessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const courses = Array.isArray(data?.courses) ? data.courses.map((course) => ({
    ...course,
    displayName: readableLabel(course.name),
    displayInstructor: compactInstructor(course.instructor),
    displayExams: courseExamSummary(course.code, sourceSessions) || course.exams
  })) : [];
  const coursesByCode = new Map(
    courses
      .map((course) => [normalizedCourseCode(course.code), course])
      .filter(([code]) => Boolean(code))
  );
  return {
    ...data,
    courses,
    sessions: sourceSessions.map((session) => ({
      ...session,
      displayTitle: sessionDisplayTitle(session, coursesByCode),
      displayInstructor: compactInstructor(session.instructor),
      displayExamDate: session.type === "exam"
        ? (formatExamDate(session.date) || (session.datePrecision === "weekday_time_only" ? "Fecha no publicada" : ""))
        : "",
      displayExamType: session.type === "exam"
        ? (EXAM_TYPE_LABELS[session.examType] ?? EXAM_TYPE_LABELS.unknown)
        : ""
    }))
  };
}
