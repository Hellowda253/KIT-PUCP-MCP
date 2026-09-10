const KIND_TO_TYPE = new Map([
  ["class", "class"],
  ["cla", "class"],
  ["theory", "class"],
  ["teoria", "class"],
  ["teorica", "class"],
  ["practice", "lab"],
  ["practica", "lab"],
  ["laboratory", "lab"],
  ["laboratorio", "lab"],
  ["lab", "lab"],
  ["directed_practice", "lab"],
  ["workshop", "lab"],
  ["taller", "lab"],
  ["exam", "exam"],
  ["examen", "exam"],
  ["exa", "exam"]
]);

const DAY_TO_NUMBER = new Map([
  ["monday", 1], ["lunes", 1], ["lun", 1],
  ["tuesday", 2], ["martes", 2], ["mar", 2],
  ["wednesday", 3], ["miercoles", 3], ["mie", 3],
  ["thursday", 4], ["jueves", 4], ["jue", 4],
  ["friday", 5], ["viernes", 5], ["vie", 5],
  ["saturday", 6], ["sabado", 6], ["sab", 6]
]);

const SHORT_DAYS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/gu, "_");
}

function sourceError(code, message, details) {
  const error = new TypeError(message);
  error.code = code;
  error.details = details;
  return error;
}

function canonicalType(kind) {
  const normalized = normalizedText(kind);
  const type = KIND_TO_TYPE.get(normalized);
  if (!type) {
    throw sourceError(
      "schedule_session_kind_unsupported",
      `Unsupported Campus schedule session kind: ${String(kind ?? "") || "(empty)"}`,
      { kind }
    );
  }
  return type;
}

function canonicalDay(value) {
  if (Number.isInteger(value) && value >= 1 && value <= 6) return value;
  const day = DAY_TO_NUMBER.get(normalizedText(value));
  if (!day) {
    throw sourceError(
      "schedule_session_day_unsupported",
      `Unsupported Campus schedule day: ${String(value ?? "") || "(empty)"}`,
      { day: value }
    );
  }
  return day;
}

function minutes(value) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/u);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function normalizedTime(value) {
  const total = minutes(value);
  if (!Number.isFinite(total) || total < 0 || total >= 24 * 60) {
    throw sourceError("schedule_session_time_invalid", `Invalid Campus schedule time: ${String(value ?? "")}`, { time: value });
  }
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function roomValues(session) {
  return [...new Set([
    ...(Array.isArray(session?.rooms) ? session.rooms : []),
    session?.room
  ].flatMap((value) => String(value ?? "").split(/\s*[,;|]\s*/u))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function joinedPeople(values) {
  return [...new Set(values.flatMap((value) => String(value ?? "").split(/\s+(?:\/|;|\|)\s+/u))
    .map((value) => value.trim())
    .filter(Boolean))].join(" / ");
}

function normalizeCourseSession(course, sourceSession) {
  const type = canonicalType(sourceSession.kind ?? sourceSession.type);
  const rooms = roomValues(sourceSession);
  const date = sourceSession.date ?? sourceSession.beginDate ?? undefined;
  const result = {
    day: canonicalDay(sourceSession.day),
    start: normalizedTime(sourceSession.start ?? sourceSession.beginTime),
    end: normalizedTime(sourceSession.end ?? sourceSession.endTime),
    type,
    courseCodes: [String(course.courseCode).trim().toUpperCase()],
    scheduleId: String(sourceSession.scheduleId ?? course.scheduleId ?? course.scheduleIds?.[0] ?? ""),
    title: String(course.courseName ?? course.name ?? "").trim(),
    ...(rooms.length > 0 ? { room: rooms.join(", "), rooms } : {}),
    ...(joinedPeople([sourceSession.professor, sourceSession.instructor, course.professor, course.instructor])
      ? { instructor: joinedPeople([sourceSession.professor, sourceSession.instructor, course.professor, course.instructor]) }
      : {}),
    ...(sourceSession.weeksLabel ? { weeksLabel: String(sourceSession.weeksLabel) } : {})
  };
  if (type === "exam") {
    result.examType = ["partial", "final"].includes(sourceSession.examType)
      ? sourceSession.examType
      : "unknown";
    result.datePrecision = sourceSession.datePrecision ?? (date ? "exact_date" : "weekday_time_only");
    if (date) result.date = String(date);
    if (sourceSession.examOccurrenceId ?? sourceSession.sourceOccurrenceId) {
      result.sourceOccurrenceId = String(sourceSession.examOccurrenceId ?? sourceSession.sourceOccurrenceId);
    }
  }
  return result;
}

function regularIdentity(session) {
  return JSON.stringify([
    session.type,
    session.day,
    session.scheduleId,
    session.courseCodes,
    session.room ?? "",
    session.instructor ?? "",
    session.weeksLabel ?? ""
  ]);
}

function mergeAdjacentRegularSessions(sessions) {
  const result = [];
  const sorted = [...sessions].sort((left, right) =>
    left.day - right.day ||
    minutes(left.start) - minutes(right.start) ||
    minutes(left.end) - minutes(right.end)
  );
  for (const session of sorted) {
    const previous = result.at(-1);
    if (
      previous &&
      session.type !== "exam" &&
      previous.type !== "exam" &&
      regularIdentity(previous) === regularIdentity(session) &&
      previous.end === session.start
    ) {
      previous.end = session.end;
      continue;
    }
    result.push({ ...session });
  }
  return result;
}

function examIdentity(session) {
  const occurrence = session.sourceOccurrenceId ?? "";
  return JSON.stringify([
    session.courseCodes,
    session.scheduleId,
    session.examType,
    session.date ?? "",
    occurrence,
    session.day,
    session.start,
    session.end
  ]);
}

function mergeExamRooms(sessions, warnings) {
  const regular = [];
  const exams = new Map();
  const counts = new Map();
  for (const session of sessions) {
    if (session.type !== "exam") {
      regular.push(session);
      continue;
    }
    const key = examIdentity(session);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!exams.has(key)) {
      const { sourceOccurrenceId: _ignored, ...publicSession } = session;
      exams.set(key, publicSession);
      continue;
    }
    const existing = exams.get(key);
    const rooms = [...new Set([...roomValues(existing), ...roomValues(session)])];
    exams.set(key, {
      ...existing,
      ...(rooms.length > 0 ? { room: rooms.join(", "), rooms } : {})
    });
  }
  for (const [key, count] of counts) {
    const exam = exams.get(key);
    if (count > 1 && exam.examType === "unknown" && exam.datePrecision === "weekday_time_only") {
      warnings.push({
        code: "exam_occurrences_ambiguous",
        courseCode: exam.courseCodes[0],
        scheduleId: exam.scheduleId,
        message: "Campus published repeated rows for an undated exam slot. They were consolidated into one neutral exam card without inferring partial or final."
      });
    }
  }
  return [...regular, ...exams.values()];
}

function summary(session) {
  const base = `${SHORT_DAYS[session.day]} ${session.start}–${session.end}`;
  return `${base}${session.room ? ` (${session.room})` : ""}`;
}

function summaries(sessions, type) {
  const values = [...new Set(sessions.filter((session) => session.type === type).map(summary))];
  return values.length > 0 ? values.join("; ") : "—";
}

function examStatus(sessions) {
  const exams = sessions.filter(({ type }) => type === "exam");
  if (exams.length === 0) return "not_published";
  const exact = exams.filter(({ datePrecision, date }) => datePrecision === "exact_date" && date);
  const scheduleOnly = exams.filter(({ datePrecision, date }) => datePrecision === "weekday_time_only" && !date);
  if (exact.length === exams.length) return "published";
  if (scheduleOnly.length === exams.length) return "schedule_only";
  throw sourceError(
    "schedule_exam_evidence_mixed",
    "Campus schedule data mixes exact and undated exam evidence for the same course; refresh the Campus schedule before rendering.",
    { exams }
  );
}

function isRendererData(value) {
  return Array.isArray(value?.courses) && Array.isArray(value?.sessions) &&
    value.courses.every((course) => "code" in course) &&
    value.sessions.every((session) => "type" in session);
}

function canonicalCourses(value) {
  const unwrapped = value?.data && typeof value.data === "object" ? value.data : value;
  if (Array.isArray(unwrapped?.courseDetails)) return { root: unwrapped, courses: unwrapped.courseDetails };
  if (Array.isArray(unwrapped?.courses) && unwrapped.courses.every((course) => "courseCode" in course)) {
    return { root: unwrapped, courses: unwrapped.courses };
  }
  throw sourceError(
    "schedule_source_unsupported",
    "Expected renderer data, a get_student_schedule response, or an evaluated/recommended Campus schedule.",
    { availableKeys: Object.keys(unwrapped ?? {}) }
  );
}

export function prepareScheduleSourceData(value) {
  if (isRendererData(value)) return structuredClone(value);
  const { root, courses: sourceCourses } = canonicalCourses(value);
  const warnings = [];
  const converted = sourceCourses.map((course) => {
    const courseCode = String(course.courseCode ?? "").trim().toUpperCase();
    if (!courseCode) {
      throw sourceError("schedule_course_code_missing", "Campus schedule course is missing its code.", { course });
    }
    const sourceSessions = Array.isArray(course.sessions) ? course.sessions : [];
    const sessions = mergeAdjacentRegularSessions(
      mergeExamRooms(sourceSessions.map((session) => normalizeCourseSession(course, session)), warnings)
    );
    const instructors = joinedPeople(sessions.map(({ instructor }) => instructor));
    const credits = Number(course.credits ?? 0);
    return {
      course: {
        code: courseCode,
        name: String(course.courseName ?? course.name ?? courseCode).trim(),
        credits: Number.isFinite(credits) ? credits : 0,
        scheduleId: String(course.scheduleId ?? course.scheduleIds?.[0] ?? sessions[0]?.scheduleId ?? ""),
        instructor: instructors,
        classes: summaries(sessions, "class"),
        practice: summaries(sessions, "lab"),
        exams: summaries(sessions, "exam"),
        examStatus: examStatus(sessions)
      },
      sessions
    };
  });
  const term = String(root.activeTerm ?? root.term ?? sourceCourses.find(({ term }) => term)?.term ?? "");
  if (!/^\d{4}-[12]$/u.test(term)) {
    throw sourceError("schedule_term_missing", "Campus schedule source is missing a valid academic term.", { term });
  }
  const credits = converted.reduce((sum, item) => sum + item.course.credits, 0);
  return {
    term,
    credits: Math.round(credits * 100) / 100,
    courses: converted.map(({ course }) => course),
    sessions: converted.flatMap(({ sessions }) => sessions),
    ...(warnings.length > 0 ? { warnings } : {})
  };
}
