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
  const courses = Array.isArray(data?.courses) ? data.courses.map((course) => ({
    ...course,
    displayName: readableLabel(course.name),
    displayInstructor: compactInstructor(course.instructor)
  })) : [];
  const coursesByCode = new Map(
    courses
      .map((course) => [normalizedCourseCode(course.code), course])
      .filter(([code]) => Boolean(code))
  );
  return {
    ...data,
    courses,
    sessions: Array.isArray(data?.sessions) ? data.sessions.map((session) => ({
      ...session,
      displayTitle: sessionDisplayTitle(session, coursesByCode),
      displayInstructor: compactInstructor(session.instructor)
    })) : []
  };
}
