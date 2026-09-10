import {
  buildCanonicalStudentSchedule,
  McpToolError,
  TTL_SECONDS,
  createEnvelope,
  enrichScheduleItemsWithAgenda,
  readJsonCache,
  resolveCourse
} from "@pucp-academic-mcp/common";

const SOURCE = "pucp_academic_overview";

function searchableText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function parseDate(value, name) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw new McpToolError("invalid_date", `${name} must use YYYY-MM-DD`);
  }
  const parsed = Date.parse(`${text}T12:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== text
  ) {
    throw new McpToolError("invalid_date", `${name} is not a valid date`);
  }
  return text;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clamp(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  return Math.max(
    1,
    Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : fallback, maximum)
  );
}

function itemDate(item) {
  return item.at || item.dueDate || `${item.date ?? ""}T${item.start ?? "00:00"}:00-05:00`;
}

function sortUpcoming(left, right) {
  return (
    Date.parse(itemDate(left)) - Date.parse(itemDate(right)) ||
    left.source.localeCompare(right.source) ||
    String(left.id).localeCompare(String(right.id))
  );
}

function courseMatches(value, query) {
  return searchableText(value).includes(searchableText(query));
}

async function optionalJson(filePath, fallback = null) {
  return readJsonCache(filePath, { fallback });
}

function sourceStatus(snapshot, ttlSeconds, now) {
  if (!snapshot) return { available: false, generatedAt: null, stale: true };
  const envelope = createEnvelope({
    source: "status",
    retrievedAt: snapshot.retrievedAt ?? snapshot.generatedAt,
    generatedAt: snapshot.generatedAt,
    ttlSeconds,
    data: null,
    now
  });
  return {
    available: true,
    generatedAt: snapshot.generatedAt,
    retrievedAt: snapshot.retrievedAt ?? snapshot.generatedAt,
    stale: envelope.cache.stale,
    ageSeconds: envelope.cache.ageSeconds
  };
}

function campusItems(campus, module) {
  const entry = campus?.modules?.[module];
  return entry?.state === "available" ? entry.items ?? [] : [];
}

function campusValue(campus, module) {
  const entry = campus?.modules?.[module];
  return entry?.state === "available" ? entry.value ?? null : null;
}

function currentScheduleOfferings(cache, courseCode, term) {
  const code = String(courseCode ?? "").trim().toUpperCase();
  const entries = [...(cache?.entries ?? [])]
    .filter(({ query }) => query?.mode !== "historical")
    .filter(({ query }) => !term || !query?.term || query.term === "active" || query.term === term)
    .sort((left, right) => String(right.generatedAt ?? "").localeCompare(String(left.generatedAt ?? "")));
  const latest = entries.find(({ items = [] }) => items.some((item) =>
    String(item.courseCode ?? "").trim().toUpperCase() === code
  ));
  return (latest?.items ?? []).filter((item) =>
    String(item.courseCode ?? "").trim().toUpperCase() === code
  );
}

function buildUpcoming(paideia, campus, start, end) {
  const agenda = campusItems(campus, "agenda")
    .filter((item) => item.beginDate >= start && item.beginDate <= end)
    .map((item) => ({
      id: item.id,
      source: "campus_virtual_pucp",
      kind: item.kind,
      course: item.course,
      title: item.title,
      at: `${item.beginDate}T${item.beginTime || "00:00"}:00-05:00`,
      endTime: item.endTime ?? "",
      modality: item.modality ?? "",
      place: item.place ?? ""
    }));
  const pending = (paideia?.pendingItems ?? [])
    .filter((item) => {
      const date = String(item.dueDate ?? "").slice(0, 10);
      return date >= start && date <= end;
    })
    .map((item) => ({
      id: item.id,
      source: "paideia",
      kind: item.type,
      course: item.course,
      title: item.title,
      at: item.dueDate,
      section: item.section ?? ""
    }));
  const enrollment = campusItems(campus, "enrollment_calendar")
    .filter((item) => {
      const date = String(item.start ?? item.date ?? "").slice(0, 10);
      return date >= start && date <= end;
    })
    .map((item) => ({
      id: item.id,
      source: "campus_virtual_pucp",
      kind: "enrollment",
      course: "",
      title: item.title,
      at: item.start,
      endAt: item.end ?? "",
      term: item.term ?? ""
    }));
  return [...agenda, ...pending, ...enrollment].sort(sortUpcoming);
}

function scheduleRiskLevel(capacity = {}) {
  const vacancies = Number(capacity.vacancies);
  const registrations = Number(capacity.registrations);
  const position = Number(capacity.userPosition);
  if (!Number.isFinite(vacancies)) return "unknown";
  if (vacancies <= 0) return "critical";
  if (Number.isFinite(position) && position > 0) {
    if (position > vacancies) return "critical";
    if (position >= vacancies * 0.9) return "high";
    if (position >= vacancies * 0.75) return "medium";
    return "low";
  }
  if (!Number.isFinite(registrations) || registrations < 0) return "unknown";
  const pressure = registrations / vacancies;
  if (pressure > 1.1) return "critical";
  if (pressure >= 0.9) return "high";
  if (pressure >= 0.7) return "medium";
  return "low";
}

function buildAlerts(campus, scheduleCache) {
  const alerts = [];
  const enrollment = campusValue(campus, "enrollment");
  if (enrollment?.status) {
    alerts.push({
      kind: "enrollment",
      status: enrollment.status,
      term: enrollment.term ?? ""
    });
  }
  const financial = campusValue(campus, "financial");
  if (financial?.status || Number(financial?.totalDue) > 0) {
    alerts.push({
      kind: "financial",
      status: financial?.status ?? "unknown",
      hasOutstandingBalance: Number(financial?.totalDue) > 0,
      nextDueDate: financial?.nextDueDate ?? ""
    });
  }
  const obligations = campusItems(campus, "obligations").filter(
    (item) => !/atendid|complet|cerrad|pagad/iu.test(item.status ?? "")
  );
  if (obligations.length) {
    alerts.push({
      kind: "obligations",
      status: "attention_required",
      count: obligations.length
    });
  }
  const requests = campusItems(campus, "requests").filter(
    (item) => !/atendid|complet|cerrad/iu.test(item.status ?? "")
  );
  if (requests.length) {
    alerts.push({
      kind: "requests",
      status: "in_progress",
      count: requests.length
    });
  }
  const impediments = campusItems(campus, "enrollment_impediments");
  if (impediments.length) {
    alerts.push({
      kind: "enrollment_impediments",
      status: "attention_required",
      count: impediments.length,
      blockingCount: impediments.filter(({ blocking }) => blocking === true).length
    });
  }
  const latestSchedules = [...(scheduleCache?.entries ?? [])]
    .filter((entry) => entry.query?.mode !== "historical")
    .sort((left, right) => String(right.retrievedAt ?? right.generatedAt).localeCompare(
      String(left.retrievedAt ?? left.generatedAt)
    ));
  const seen = new Set();
  const risky = [];
  for (const entry of latestSchedules) {
    for (const item of entry.items ?? []) {
      const key = `${item.courseCode}|${item.scheduleId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const level = scheduleRiskLevel(item.capacity);
      if (["high", "critical"].includes(level)) risky.push({ level });
    }
  }
  if (risky.length) {
    alerts.push({
      kind: "schedule_risk",
      status: "high_risk",
      count: risky.length,
      criticalCount: risky.filter(({ level }) => level === "critical").length,
      retrievedAt: latestSchedules[0]?.retrievedAt ?? latestSchedules[0]?.generatedAt ?? null
    });
  }
  return alerts;
}

export function createOverviewService({
  paideiaCachePath,
  campusCachePath,
  campusSchedulePath,
  paideiaHistoryPath,
  campusHistoryPath,
  now = () => new Date().toISOString()
}) {
  if (!paideiaCachePath || !campusCachePath) {
    throw new TypeError("Overview cache paths are required");
  }

  async function loadSources() {
    const [paideia, campus, campusSchedules] = await Promise.all([
      optionalJson(paideiaCachePath),
      optionalJson(campusCachePath),
      campusSchedulePath ? optionalJson(campusSchedulePath) : null
    ]);
    if (!paideia && !campus) {
      throw new McpToolError(
        "cache_unavailable",
        "Neither Paideia nor Campus Virtual has a local cache",
        { retryable: true }
      );
    }
    const warnings = [];
    if (!paideia) warnings.push("Paideia cache is unavailable.");
    if (!campus) warnings.push("Campus Virtual cache is unavailable.");
    return { paideia, campus, campusSchedules, warnings };
  }

  function wrap({ paideia, campus, warnings }, data) {
    const timestamps = [paideia?.generatedAt, campus?.generatedAt]
      .filter(Boolean)
      .sort();
    const retrieved = [
      paideia?.retrievedAt ?? paideia?.generatedAt,
      campus?.retrievedAt ?? campus?.generatedAt
    ]
      .filter(Boolean)
      .sort()
      .at(-1);
    return createEnvelope({
      source: SOURCE,
      retrievedAt: retrieved,
      generatedAt: timestamps[0],
      ttlSeconds: TTL_SECONDS.academic,
      data,
      warnings,
      now: now()
    });
  }

  function range(options = {}) {
    const today = now().slice(0, 10);
    const start = options.start ? parseDate(options.start, "start") : today;
    const end = options.end
      ? parseDate(options.end, "end")
      : addDays(start, Number(options.days ?? 7));
    if (start > end) {
      throw new McpToolError("invalid_date", "start must not be after end");
    }
    return { start, end };
  }

  async function getAcademicOverview(options = {}) {
    const sources = await loadSources();
    const { start, end } = range(options);
    const upcoming = buildUpcoming(sources.paideia, sources.campus, start, end)
      .slice(0, clamp(options.limit, 30, 100));
    return wrap(sources, {
      range: { start, end },
      upcoming,
      officialGrades: campusItems(sources.campus, "official_grades").slice(0, 20),
      announcements: Object.values(sources.paideia?.announcements ?? {})
        .flatMap((entry) => (entry.state === "available" ? entry.items ?? [] : []))
        .slice(0, 10),
      materials: (sources.paideia?.materials ?? []).slice(0, 10),
      alerts: buildAlerts(sources.campus, sources.campusSchedules)
    });
  }

  async function getCourseWorkspace(options) {
    const sources = await loadSources();
    let paideiaCourse;
    try { paideiaCourse = resolveCourse(sources.paideia?.courses ?? [], options.course); }
    catch (error) { if (error.code !== 'course_not_found') throw error; }
    let campusCourse;
    try { campusCourse = resolveCourse(campusItems(sources.campus, "enrolled_courses"), options.course); }
    catch (error) { if (error.code !== 'course_not_found') throw error; }
    if (!paideiaCourse && !campusCourse) {
      throw new McpToolError(
        "course_not_found",
        `No cached course matched: ${options.course}`
      );
    }
    const names = [
      paideiaCourse?.name,
      paideiaCourse?.shortName,
      campusCourse?.name,
      campusCourse?.code
    ].filter(Boolean);
    const belongs = (item) => (paideiaCourse && String(item.courseId) === String(paideiaCourse.id)) ||
      (campusCourse && String(item.courseCode ?? item.code ?? '').toUpperCase() === String(campusCourse.code ?? '').toUpperCase()) ||
      names.some((name) => searchableText(item.course) === searchableText(name));
    const scheduleModule = sources.campus?.modules?.student_schedule;
    const agendaModule = sources.campus?.modules?.agenda;
    const courseId = paideiaCourse?.id;
    const announcements = courseId
      ? sources.paideia?.announcements?.[courseId]?.items ?? []
      : [];
    const paideiaGrades = courseId
      ? sources.paideia?.grades?.[courseId]?.items ?? []
      : [];
    const rawSchedule = campusItems(sources.campus, "student_schedule").filter(belongs);
    const scheduleOfferings = campusCourse
      ? enrichScheduleItemsWithAgenda(
          currentScheduleOfferings(
            sources.campusSchedules,
            campusCourse.code,
            campusCourse.term ?? scheduleModule?.term
          ),
          sources.campus
        )
      : [];
    const canonicalSchedule = buildCanonicalStudentSchedule(
      rawSchedule,
      scheduleOfferings
    );
    return wrap(sources, {
      course: {
        id: paideiaCourse?.id ?? campusCourse?.code,
        code: campusCourse?.code ?? "",
        name: campusCourse?.name ?? paideiaCourse?.shortName ?? paideiaCourse?.name,
        term: campusCourse?.term ?? ""
      },
      pendingItems: (sources.paideia?.pendingItems ?? []).filter(belongs),
      materials: (sources.paideia?.materials ?? []).filter(belongs),
      announcements,
      paideiaGrades,
      officialGrades: campusItems(sources.campus, "official_grades").filter(belongs),
      schedule: canonicalSchedule.items,
      scheduleStatus: {
        state: scheduleModule?.state ?? "unavailable",
        source: "student_schedule_page",
        representation: scheduleOfferings.length > 0
          ? "canonical_enriched"
          : "student_schedule_page",
        generatedAt: scheduleModule?.generatedAt ?? null,
        reason: scheduleModule?.reason ?? null
      },
      agenda: campusItems(sources.campus, "agenda").filter(belongs),
      agendaStatus: {
        state: agendaModule?.state ?? "unavailable",
        source: "campus_agenda",
        generatedAt: agendaModule?.generatedAt ?? null,
        reason: agendaModule?.reason ?? null
      }
    });
  }

  async function listUpcomingAcademicItems(options = {}) {
    const sources = await loadSources();
    const { start, end } = range(options);
    const items = buildUpcoming(sources.paideia, sources.campus, start, end)
      .filter((item) => !options.course || courseMatches(item.course, options.course))
      .slice(0, clamp(options.limit, 50, 200));
    return wrap(sources, {
      range: { start, end },
      count: items.length,
      items
    });
  }

  async function listRecentAcademicChanges(options = {}) {
    const sources = await loadSources();
    const [paideiaHistory, campusHistory] = await Promise.all([
      optionalJson(paideiaHistoryPath, []),
      optionalJson(campusHistoryPath, [])
    ]);
    const items = [
      ...paideiaHistory.map((item) => ({ source: "paideia", ...item })),
      ...campusHistory.map((item) => ({
        source: "campus_virtual_pucp",
        ...item
      }))
    ]
      .sort((left, right) =>
        String(right.syncedAt ?? right.generatedAt).localeCompare(
          String(left.syncedAt ?? left.generatedAt)
        )
      )
      .slice(0, clamp(options.limit, 20, 100));
    return wrap(sources, { count: items.length, items });
  }

  async function getAcademicDataStatus() {
    const [paideia, campus] = await Promise.all([
      optionalJson(paideiaCachePath),
      optionalJson(campusCachePath)
    ]);
    const warnings = [];
    if (!paideia) warnings.push("Paideia cache is unavailable.");
    if (!campus) warnings.push("Campus Virtual cache is unavailable.");
    const available = paideia || campus;
    if (!available) {
      throw new McpToolError(
        "cache_unavailable",
        "Neither academic cache is available",
        { retryable: true }
      );
    }
    return wrap(
      { paideia, campus, warnings },
      {
        sources: {
          paideia: sourceStatus(paideia, TTL_SECONDS.academic, now()),
          campus_virtual_pucp: sourceStatus(
            campus,
            TTL_SECONDS.academic,
            now()
          )
        }
      }
    );
  }

  return {
    getAcademicOverview,
    getCourseWorkspace,
    listUpcomingAcademicItems,
    listRecentAcademicChanges,
    getAcademicDataStatus
  };
}
