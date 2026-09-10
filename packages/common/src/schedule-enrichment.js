import { normalizeCampusRoom } from "./schedule-components.js";

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function examTypeFromAgenda(item) {
  const text = normalizedText(`${item?.examType ?? ""} ${item?.kind ?? ""} ${item?.title ?? ""} ${item?.description ?? ""}`);
  if (text.includes("final")) return "final";
  if (text.includes("parcial")) return "partial";
  return null;
}

function weekdayForDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ""))) return "";
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    new Date(`${value}T12:00:00Z`).getUTCDay()
  ];
}

function inferExamPeriod(events) {
  const dates = [...new Set(events.map(({ beginDate }) => beginDate).filter(Boolean))].sort();
  if (dates.length < 2) return () => null;
  let split = null;
  let largestGap = 0;
  for (let index = 0; index < dates.length - 1; index += 1) {
    const gap = (Date.parse(`${dates[index + 1]}T12:00:00Z`) - Date.parse(`${dates[index]}T12:00:00Z`)) / 86_400_000;
    if (gap > largestGap) {
      largestGap = gap;
      split = index;
    }
  }
  if (split === null || largestGap < 14) return () => null;
  const lastPartialDate = dates[split];
  return (date) => date ? (date <= lastPartialDate ? "partial" : "final") : null;
}

function normalizedWeekday(value) {
  const day = normalizedText(value);
  const aliases = {
    domingo: "sunday", dom: "sunday", sunday: "sunday",
    lunes: "monday", lun: "monday", monday: "monday",
    martes: "tuesday", mar: "tuesday", tuesday: "tuesday",
    miercoles: "wednesday", mie: "wednesday", wednesday: "wednesday",
    jueves: "thursday", jue: "thursday", thursday: "thursday",
    viernes: "friday", vie: "friday", friday: "friday",
    sabado: "saturday", sab: "saturday", saturday: "saturday"
  };
  return aliases[day] ?? day;
}

function withExamDatePrecision(session, fallbackKind = "") {
  const kind = normalizedText(session?.kind ?? session?.type ?? fallbackKind);
  if (!kind.includes("exam")) return { ...session };
  return {
    ...session,
    datePrecision: session.datePrecision ??
      (session.date ?? session.beginDate ? "exact_date" : "weekday_time_only")
  };
}

export function mergeExamRooms(sessions = []) {
  const merged = new Map();
  for (const session of sessions) {
    const kind = normalizedText(session.kind ?? session.type ?? "");
    const date = session.date ?? session.beginDate ?? "";
    const examIdentity = kind.includes("exam")
      ? session.agendaEventId
        ? `agenda:${session.agendaEventId}`
        : date
          ? JSON.stringify(["exam", date, session.examType ?? "", session.start ?? "", session.end ?? ""])
          : ""
      : "";
    const key = examIdentity || JSON.stringify([
      "session", kind, session.date ?? session.beginDate ?? "", session.day ?? "",
      session.start ?? session.beginTime ?? "", session.end ?? session.endTime ?? "",
      session.scheduleId ?? "", session.weeks ?? session.weeksLabel ?? ""
    ]);
    const normalizedRooms = [
      ...(Array.isArray(session.rooms) ? session.rooms : []),
      session.room
    ].map((room) => normalizeCampusRoom(room, session.group)).filter(({ room }) => room);
    const rooms = [...new Set(normalizedRooms.map(({ room }) => room))];
    const groups = [...new Set([
      ...(Array.isArray(session.groups) ? session.groups : []),
      ...normalizedRooms.map(({ group }) => group),
      session.group
    ].map((group) => String(group ?? "").trim().toUpperCase()).filter(Boolean))];
    if (!merged.has(key)) {
      merged.set(key, {
        ...session,
        ...(rooms.length > 0 ? { room: rooms.join(", ") } : {}),
        ...(rooms.length > 1 ? { rooms } : {}),
        ...(groups.length === 1 ? { group: groups[0] } : {}),
        ...(groups.length > 0 ? { groups } : {})
      });
      continue;
    }
    const existing = merged.get(key);
    const existingRooms = [
      ...(Array.isArray(existing.rooms) ? existing.rooms : []),
      existing.room
    ].flatMap((room) => String(room ?? "").split(/\s*,\s*/u)).filter(Boolean);
    const combinedRooms = [...new Set([...existingRooms, ...rooms])];
    const combinedGroups = [...new Set([
      ...(existing.groups ?? []), existing.group, ...groups
    ].filter(Boolean))];
    const professors = [...new Set([existing.professor, session.professor].filter(Boolean))];
    merged.set(key, {
      ...existing,
      ...(combinedRooms.length > 0
        ? { room: combinedRooms.join(", "), rooms: combinedRooms }
        : {}),
      ...(combinedGroups.length === 1 ? { group: combinedGroups[0] } : {}),
      ...(combinedGroups.length > 0 ? { groups: combinedGroups } : {}),
      ...(professors.length > 0 ? { professor: professors.join(" / ") } : {})
    });
  }
  return [...merged.values()];
}

function agendaEventIdentity(event) {
  return String(event.id ?? JSON.stringify([
    event.code ?? event.courseCode ?? "",
    event.schedule ?? "",
    event.beginDate ?? "",
    event.beginTime ?? "",
    event.endTime ?? ""
  ]));
}

function matchingExamAgendaEvents(item, session, events) {
  const rowCode = String(item.courseCode ?? "").trim().toUpperCase();
  const rowName = normalizedText(item.courseName ?? item.course ?? "");
  return events.filter((event) => {
    const eventCode = String(event.code ?? event.courseCode ?? "").trim().toUpperCase();
    const eventName = normalizedText(event.course ?? event.courseName ?? "");
    const courseMatches = eventCode && rowCode
      ? eventCode === rowCode
      : Boolean(rowName && eventName && (rowName.includes(eventName) || eventName.includes(rowName)));
    if (!courseMatches) return false;
    if (item.term && event.term && String(item.term) !== String(event.term)) return false;
    if (item.scheduleId && event.schedule && String(item.scheduleId) !== String(event.schedule)) return false;
    return (
      String(session.start ?? "") === String(event.beginTime ?? "") &&
      String(session.end ?? "") === String(event.endTime ?? "")
    );
  });
}

export function enrichScheduleItemsWithAgenda(items, snapshot) {
  const agenda = snapshot?.modules?.agenda;
  if (agenda?.state !== "available") {
    return items.map((item) => ({
      ...structuredClone(item),
      sessions: (item.sessions ?? []).map((session) =>
        withExamDatePrecision(session, item.scheduleType)
      )
    }));
  }
  const events = (agenda.items ?? []).filter((event) =>
    normalizedText(`${event.kind ?? ""} ${event.title ?? ""} ${event.description ?? ""}`).includes("exam")
  );
  const inferredExamPeriod = inferExamPeriod(events);
  const inferredExamPeriodsByTerm = new Map(
    [...new Set(events.map(({ term }) => String(term ?? "")).filter(Boolean))]
      .map((term) => [term, inferExamPeriod(events.filter((event) => String(event.term ?? "") === term))])
  );
  const inferredExamType = (date, term) =>
    (inferredExamPeriodsByTerm.get(String(term ?? "")) ?? inferredExamPeriod)(date);
  return items.map((item) => {
    const sourceSessions = item.sessions ?? [];
    const exactDayClaims = new Set(sourceSessions.flatMap((session) => {
      const sessionKind = normalizedText(`${session.kind ?? ""} ${item.scheduleType ?? ""}`);
      if (!sessionKind.includes("exam") || session.date || session.beginDate) return [];
      return matchingExamAgendaEvents(item, session, events)
        .filter((event) => normalizedWeekday(session.day) === weekdayForDate(event.beginDate))
        .map(agendaEventIdentity);
    }));
    const sessions = sourceSessions.flatMap((session) => {
      const sessionKind = normalizedText(`${session.kind ?? ""} ${item.scheduleType ?? ""}`);
      if (!sessionKind.includes("exam")) return [{ ...session }];
      if (session.date ?? session.beginDate) {
        const date = session.date ?? session.beginDate;
        return [{
          ...session,
          examType: session.examType ?? examTypeFromAgenda(session) ?? inferredExamType(date, item.term),
          datePrecision: "exact_date"
        }];
      }
      const timeCandidates = matchingExamAgendaEvents(item, session, events);
      const dayCandidates = timeCandidates.filter((event) =>
        normalizedWeekday(session.day) === weekdayForDate(event.beginDate)
      );
      const unclaimedCandidates = timeCandidates.filter((event) =>
        !exactDayClaims.has(agendaEventIdentity(event))
      );
      const candidates = dayCandidates.length > 0
        ? dayCandidates
        : unclaimedCandidates.length === 1 ? unclaimedCandidates : [];
      return candidates.length > 0
        ? candidates.map((event) => {
            const agendaDay = weekdayForDate(event.beginDate);
            const dayDiscrepancy = normalizedWeekday(session.day) !== agendaDay;
            return {
              ...session,
              day: agendaDay || session.day,
              ...(dayDiscrepancy ? { scheduleCatalogDay: session.day, dayDiscrepancy: true } : {}),
              date: event.beginDate,
              examType: examTypeFromAgenda(event) ?? inferredExamType(event.beginDate, event.term ?? item.term),
              datePrecision: "exact_date",
              agendaEventId: event.id || undefined
            };
          })
        : [withExamDatePrecision(session, item.scheduleType)];
    });
    return { ...item, sessions: mergeExamRooms(sessions) };
  });
}
