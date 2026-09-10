export function normalizeCampusRoom(value, fallbackGroup = "") {
  const original = String(value ?? "").replace(/\s+/gu, " ").trim();
  const prefixed = original.match(/^([A-Z])\s+([A-Z]?\d{3,4})$/iu);
  return prefixed
    ? { room: prefixed[2].toUpperCase(), group: prefixed[1].toUpperCase() }
    : { room: original, group: String(fallbackGroup ?? "").trim().toUpperCase() };
}

function sessionRooms(session) {
  const normalized = [
    ...(Array.isArray(session.rooms) ? session.rooms : []),
    session.room
  ].map((room) => normalizeCampusRoom(room, session.group)).filter(({ room }) => room);
  return {
    rooms: [...new Set(normalized.map(({ room }) => room))],
    groups: [...new Set([
      ...(Array.isArray(session.groups) ? session.groups : []),
      ...normalized.map(({ group }) => group),
      session.group
    ].map((group) => String(group ?? "").trim().toUpperCase()).filter(Boolean))]
  };
}

function mergeSessionEvidence(existing, item) {
  const left = sessionRooms(existing);
  const right = sessionRooms(item);
  const rooms = [...new Set([...left.rooms, ...right.rooms])];
  const groups = [...new Set([...left.groups, ...right.groups])];
  const professors = [...new Set([existing.professor, item.professor].filter(Boolean))];
  return {
    ...existing,
    ...(rooms.length > 0 ? { room: rooms.join(", ") } : {}),
    ...(rooms.length > 1 ? { rooms } : {}),
    ...(groups.length === 1 ? { group: groups[0] } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    ...(professors.length > 0 ? { professor: professors.join(" / ") } : {})
  };
}

// A Campus row is a component, not an independently selectable timetable.
export function buildCourseOptions(offerings = []) {
  const courses = new Map();
  for (const row of offerings) {
    const code = String(row.courseCode ?? "").toUpperCase();
    if (!courses.has(code)) courses.set(code, new Map());
    const groups = courses.get(code);
    const key = `${row.term ?? ""}|${row.scheduleId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = new Map();
  for (const [courseCode, groups] of courses) {
    const blocks = [...groups.values()].map((rows) => {
      const root = rows.find((row) => row.scheduleType === "class") ?? rows[0];
      const sessions = new Map();
      for (const row of rows) for (const session of row.sessions ?? []) {
        const kind = session.kind ?? row.scheduleType;
        const exactDate = session.date ?? session.beginDate;
        const normalizedRoom = normalizeCampusRoom(session.room, session.group);
        const item = {
          ...session,
          kind,
          scheduleId: session.scheduleId ?? row.scheduleId,
          professor: session.professor ?? row.professor ?? null,
          modality: session.modality ?? row.modality ?? "",
          room: normalizedRoom.room,
          ...(normalizedRoom.group ? { group: normalizedRoom.group } : {}),
          ...(String(kind ?? "").toLowerCase().includes("exam")
            ? { datePrecision: session.datePrecision ?? (exactDate ? "exact_date" : "weekday_time_only") }
            : {})
        };
        const key = JSON.stringify([
          item.day, item.start, item.end, item.kind,
          item.date, item.beginDate, item.weeks, item.startDate, item.endDate
        ]);
        sessions.set(key, sessions.has(key) ? mergeSessionEvidence(sessions.get(key), item) : item);
      }
      return {
        ...root,
        courseCode,
        professor: [...new Set(rows.map((row) => row.professor).filter(Boolean))].join(" / "),
        componentTypes: [...new Set(rows.map((row) => row.scheduleType).filter(Boolean))],
        associatedScheduleIds: [...new Set(rows.flatMap((row) => row.associatedScheduleIds ?? []).map(String))],
        sessions: [...sessions.values()],
        invalidRows: rows.some((row) => !row.sessions?.length)
      };
    });
    const options = [];
    for (const term of new Set(blocks.map((block) => block.term ?? ""))) {
      const termBlocks = blocks.filter((block) => (block.term ?? "") === term);
      const hasClasses = termBlocks.some((block) => block.componentTypes.includes("class"));
      const referenced = new Set(termBlocks.flatMap((block) => block.associatedScheduleIds));
      const roots = termBlocks.filter((block) =>
        hasClasses ? block.componentTypes.includes("class") : !referenced.has(block.scheduleId)
      );
      for (const root of roots.length ? roots : termBlocks) {
        const selected = new Map();
        const missing = new Set();
        const visit = (block) => {
          if (selected.has(block.scheduleId)) return;
          selected.set(block.scheduleId, block);
          for (const id of block.associatedScheduleIds) {
            const target = termBlocks.find((candidate) => String(candidate.scheduleId) === id);
            // Old enrollment caches exposed capacity (for example "40") here.
            if (target) visit(target);
            else if (id.length >= 4 || /\D/u.test(id)) missing.add(id);
          }
          for (const child of termBlocks.filter((candidate) =>
            !candidate.componentTypes.includes("class") &&
            candidate.associatedScheduleIds.includes(String(block.scheduleId))
          )) visit(child);
        };
        visit(root);
        const components = [...selected.values()];
        const issues = [];
        if (missing.size) {
          issues.push({ reason: "missing_associated_schedules", scheduleIds: [...missing] });
        }
        if (components.some((block) =>
          block.invalidRows || block.sessions.some((session) =>
            !session.day ||
            !/^\d{1,2}:\d{2}$/.test(session.start ?? "") ||
            !/^\d{1,2}:\d{2}$/.test(session.end ?? "")
          )
        )) issues.push({ reason: "missing_or_invalid_sessions" });
        if (components.filter((block) => block.componentTypes.includes("class")).length > 1) {
          issues.push({ reason: "ambiguous_association" });
        }
        options.push({
          ...root,
          components,
          completenessIssues: issues,
          professor: [...new Set(components.map((block) => block.professor).filter(Boolean))].join(" / ")
        });
      }
    }
    result.set(courseCode, options);
  }
  return result;
}

function orderedCourseCodes(items) {
  return [...new Set(items.map(({ courseCode }) =>
    String(courseCode ?? "").trim().toUpperCase()
  ).filter(Boolean))];
}

export function buildCanonicalStudentSchedule(baseItems = [], offerings = []) {
  const courseOptions = buildCourseOptions(offerings);
  const items = [];
  const courseDetails = [];
  for (const courseCode of orderedCourseCodes(baseItems)) {
    const raw = baseItems.filter((item) =>
      String(item.courseCode ?? "").trim().toUpperCase() === courseCode
    );
    const selectedIds = new Set(raw.map(({ scheduleId }) => String(scheduleId ?? "")));
    const selected = (courseOptions.get(courseCode) ?? []).filter((option) =>
      selectedIds.has(String(option.scheduleId)) ||
      option.components?.some(({ scheduleId }) => selectedIds.has(String(scheduleId)))
    );
    const sessions = selected.flatMap(({ sessions = [] }) => sessions);
    if (selected.length === 0 || sessions.length === 0) {
      items.push(...raw);
      courseDetails.push({
        courseCode,
        courseName: raw[0]?.courseName ?? "",
        credits: Number(raw[0]?.credits ?? 0),
        professor: raw[0]?.professor ?? raw[0]?.instructor ?? "",
        term: raw[0]?.term ?? "",
        scheduleIds: [...selectedIds].filter(Boolean),
        components: [],
        sessions: raw.map((item) => ({
          day: item.day,
          start: item.start,
          end: item.end,
          kind: item.scheduleType,
          scheduleId: item.scheduleId,
          professor: item.professor ?? item.instructor ?? null,
          room: item.room ?? "",
          modality: item.modality ?? "",
          date: item.date ?? null,
          examType: item.examType ?? null,
          ...(String(item.scheduleType ?? "").toLowerCase().includes("exam")
            ? { datePrecision: item.datePrecision ?? (item.date ? "exact_date" : "weekday_time_only") }
            : {})
        })),
        missingFields: ["catalog_details"]
      });
      continue;
    }
    const courseName = selected.find(({ courseName }) => courseName)?.courseName ?? raw[0]?.courseName ?? "";
    const term = selected.find(({ term }) => term)?.term ?? raw[0]?.term ?? "";
    for (const session of sessions) {
      items.push({
        courseCode,
        courseName,
        term,
        scheduleId: session.scheduleId ?? selected[0]?.scheduleId ?? raw[0]?.scheduleId ?? "",
        scheduleType: session.kind ?? "",
        professor: session.professor ?? selected[0]?.professor ?? null,
        modality: session.modality ?? selected[0]?.modality ?? raw[0]?.modality ?? "",
        enrichmentSource: "schedule_catalog",
        ...session
      });
    }
    courseDetails.push({
      courseCode,
      courseName,
      credits: Number(selected.find(({ credits }) => credits !== undefined)?.credits ?? raw[0]?.credits ?? 0),
      professor: selected.find(({ professor }) => professor)?.professor ?? raw[0]?.professor ?? raw[0]?.instructor ?? "",
      term,
      scheduleIds: [...new Set(selected.flatMap((option) =>
        option.components?.map(({ scheduleId }) => String(scheduleId)) ?? [String(option.scheduleId)]
      ))],
      components: [...new Set(selected.flatMap(({ componentTypes = [] }) => componentTypes))],
      sessions,
      missingFields: []
    });
  }
  return { items, courseDetails };
}
