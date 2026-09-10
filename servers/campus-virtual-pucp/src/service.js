import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  buildCanonicalStudentSchedule,
  buildCourseOptions,
  McpToolError,
  TTL_SECONDS,
  createEnvelope,
  enrichScheduleItemsWithAgenda,
  readJsonCache,
  shouldRefresh,
  writeJsonAtomic
} from "@pucp-academic-mcp/common";

import { searchableText } from "./text.js";
import { normalizeScheduleId } from "./schedule-reference.js";
import {
  DEFAULT_SCHEDULE_PREFERENCES,
  assessEnrollmentRisk,
  evaluateCourseSchedule as evaluateScheduleLocally,
  mergeSchedulePreferences,
  recommendCourseSchedules as recommendSchedulesLocally
} from "./schedule-optimizer.js";

const SOURCE = "campus_virtual_pucp";
const MODULE_KEYS = [
  "agenda",
  "student_schedule",
  "enrolled_courses",
  "official_grades",
  "academic_history",
  "academic_performance",
  "curriculum",
  "enrollment",
  "enrollment_calendar",
  "enrollment_impediments",
  "allowed_courses",
  "cross_unit_vacancies",
  "enrollment_portal",
  "financial",
  "obligations",
  "requests",
  "documents"
];
const PUBLIC_MODULE_KEYS = new Set([...MODULE_KEYS, "other"]);
const VALUE_MODULES = new Set(["enrollment", "financial", "enrollment_portal"]);
const ADMIN_MODULES = new Set([
  "financial",
  "obligations",
  "requests",
  "documents",
  "enrollment_calendar",
  "enrollment_portal",
  "other"
]);
const PRESERVE_REASONS = new Set([
  "unsupported_layout",
  "scrape_failed",
  "network_error",
  "mutation_refused",
  "extractor_unavailable",
  "transient_error"
]);

function ttlFor(module, snapshot, isEnrollmentActive) {
  if (["agenda", "student_schedule"].includes(module)) return TTL_SECONDS.agenda;
  if (["enrollment_calendar", "enrollment_portal"].includes(module)) {
    return 12 * 60 * 60;
  }
  if (["enrollment", "enrollment_impediments", "allowed_courses"].includes(module)) {
    return isEnrollmentActive(snapshot) ? 15 * 60 : TTL_SECONDS.academic;
  }
  if (module === "cross_unit_vacancies") {
    return isEnrollmentActive(snapshot) ? 5 * 60 : 30 * 60;
  }
  if (ADMIN_MODULES.has(module)) return TTL_SECONDS.materialAdmin;
  return TTL_SECONDS.academic;
}

function clamp(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  return Math.max(
    1,
    Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : fallback, maximum)
  );
}

function matches(value, query) {
  return !query || searchableText(value).includes(searchableText(query));
}

function unavailable(module, reason = "not_visible") {
  return VALUE_MODULES.has(module)
    ? { state: "unavailable", value: null, reason }
    : { state: "unavailable", items: [], reason };
}

function cleanUnavailable(module, entry) {
  const result = unavailable(module, entry?.reason ?? "not_visible");
  if (entry?.alerts?.length) result.alerts = [...entry.alerts];
  return result;
}

function safeJobError(error) {
  let normalized =
    typeof error?.code === "string"
      ? error.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")
      : "";
  if (!normalized && /timeout/i.test(String(error?.name ?? ""))) {
    normalized = "timeout";
  }
  const known = new Set([
    "authentication_required",
    "campus_agenda_refresh_failed",
    "campus_sync_degraded",
    "current_term_unavailable",
    "document_not_downloadable",
    "document_too_large",
    "download_failed",
    "mutation_refused",
    "network_error",
    "path_not_allowed",
    "registration_portal_not_visible",
    "registration_portal_unavailable",
    "scrape_failed",
    "schedule_scope_ambiguous",
    "schedule_scope_not_found",
    "schedule_catalog_unavailable",
    "timeout",
    "transient_error",
    "unsupported_layout",
    "url_not_allowed"
  ]);
  const code = known.has(normalized) ? normalized : "operation_failed";
  const messages = {
    authentication_required: "Campus Virtual authentication is required",
    campus_agenda_refresh_failed: "The Campus agenda refresh failed and the last valid cache was preserved",
    campus_sync_degraded: "Campus Virtual returned a broadly degraded snapshot and the last valid cache was preserved",
    current_term_unavailable: "The active Campus term is unavailable",
    network_error: "Campus Virtual returned a network error",
    registration_portal_not_visible: "The Campus registration view is not visible",
    registration_portal_unavailable: "The Campus registration view is unavailable",
    schedule_catalog_unavailable: "The Campus schedule catalog is unavailable",
    timeout: "The Campus Virtual operation timed out",
    transient_error: "Campus Virtual returned a transient error",
    unsupported_layout: "The Campus Virtual page layout is not supported"
  };
  const result = {
    code,
    message: messages[code] ?? "The Campus Virtual background operation failed",
    retryable: [
      "campus_agenda_refresh_failed",
      "campus_sync_degraded",
      "network_error",
      "operation_failed",
      "timeout",
      "transient_error"
    ].includes(code)
  };
  if (/^[a-z0-9_.-]{1,80}$/i.test(String(error?.stage ?? ""))) {
    result.stage = error.stage;
  }
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599) {
    result.httpStatus = error.httpStatus;
  }
  return result;
}

function itemKey(item, index) {
  return String(
    item.id ??
      item.code ??
      [item.term, item.courseCode, item.item].filter(Boolean).join("|") ??
      item.title ??
      index
  ) || String(index);
}

function moduleMap(entry) {
  if (entry?.state !== "available") {
    return { __state: `${entry?.state ?? "unavailable"}:${entry?.reason ?? ""}` };
  }
  if (Object.hasOwn(entry, "value")) return { __value: entry.value };
  return Object.fromEntries(
    (entry.items ?? []).map((item, index) => [itemKey(item, index), item])
  );
}

function summarizeModule(previous, current) {
  const before = moduleMap(previous);
  const after = moduleMap(current);
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort();
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort();
  const updated = [...afterKeys]
    .filter(
      (key) =>
        beforeKeys.has(key) &&
        JSON.stringify(before[key]) !== JSON.stringify(after[key])
    )
    .sort();
  return {
    changed: added.length > 0 || removed.length > 0 || updated.length > 0,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: updated.length,
    added,
    removed,
    updated
  };
}

function agendaRange(entry) {
  const start = String(entry?.range?.start ?? "");
  const end = String(entry?.range?.end ?? "");
  return /^\d{4}-\d{2}-\d{2}$/u.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(end) && start <= end
    ? { start, end }
    : null;
}

function agendaRanges(entry) {
  const candidates = Array.isArray(entry?.ranges)
    ? entry.ranges
    : [entry?.range];
  return candidates
    .map((range) => agendaRange({ range }))
    .filter(Boolean)
    .sort((left, right) =>
      left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
    );
}

function nextIsoDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function addIsoDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function mergeAgendaRanges(...groups) {
  const ranges = groups.flat().filter(Boolean).sort((left, right) =>
    left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
  );
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (!last || range.start > nextIsoDate(last.end)) {
      merged.push({ ...range });
      continue;
    }
    if (range.end > last.end) last.end = range.end;
  }
  return merged;
}

function mergeAgendaEntries(previous, current, generatedAt) {
  if (previous?.state !== "available" || current?.state !== "available") {
    return { ...current, generatedAt: current?.generatedAt ?? generatedAt };
  }
  const priorRanges = agendaRanges(previous);
  const currentRanges = agendaRanges(current);
  if (currentRanges.length === 0) {
    return { ...current, generatedAt: current.generatedAt ?? generatedAt };
  }
  const insideCurrentScope = (item) => {
    const date = agendaItemDate(item);
    return Boolean(date && currentRanges.some(({ start, end }) => date >= start && date <= end));
  };
  const items = [
    ...(previous.items ?? []).filter((item) => !insideCurrentScope(item)),
    ...(current.items ?? [])
  ];
  const deduplicated = [...new Map(
    items.map((item, index) => [itemKey(item, index), item])
  ).values()].sort((left, right) =>
    `${agendaItemDate(left) ?? ""} ${left.beginTime ?? ""} ${itemKey(left, 0)}`.localeCompare(
      `${agendaItemDate(right) ?? ""} ${right.beginTime ?? ""} ${itemKey(right, 0)}`
    )
  );
  const ranges = mergeAgendaRanges(priorRanges, currentRanges);
  return {
    ...previous,
    ...current,
    generatedAt: current.generatedAt ?? generatedAt,
    items: deduplicated,
    ranges,
    lastRefreshRange: currentRanges.length === 1
      ? { ...currentRanges[0] }
      : current.range ?? null,
    range: ranges.length > 0
      ? { start: ranges[0].start, end: ranges.at(-1).end }
      : current.range ?? previous.range ?? null
  };
}

function agendaItemDate(item) {
  const value = item?.beginDate ?? item?.date ?? item?.start ?? item?.at ?? "";
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : null;
}

function emptyChange(scope) {
  return {
    changed: false,
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    added: [],
    removed: [],
    updated: [],
    scope
  };
}

function summarizeAgenda(previous, current) {
  const before = agendaRange(previous);
  const after = agendaRange({ range: current?.lastRefreshRange }) ?? agendaRange(current);
  if (!before && !after) {
    return {
      ...summarizeModule(previous, current),
      scope: { previous: null, current: null, compared: null, mode: "unscoped" }
    };
  }
  if (!before || !after) {
    return emptyChange({
      previous: before,
      current: after,
      compared: null,
      mode: "scope_unavailable"
    });
  }
  const compared = {
    start: before.start > after.start ? before.start : after.start,
    end: before.end < after.end ? before.end : after.end
  };
  if (compared.start > compared.end) {
    return emptyChange({
      previous: before,
      current: after,
      compared: null,
      mode: "disjoint"
    });
  }
  const sameRange = before.start === after.start && before.end === after.end;
  const withinComparedRange = (item) => {
    const date = agendaItemDate(item);
    return date && date >= compared.start && date <= compared.end;
  };
  const prior = sameRange
    ? previous
    : { ...previous, items: (previous?.items ?? []).filter(withinComparedRange) };
  const next = sameRange
    ? current
    : { ...current, items: (current?.items ?? []).filter(withinComparedRange) };
  return {
    ...summarizeModule(prior, next),
    scope: {
      previous: before,
      current: after,
      compared,
      mode: sameRange ? "same_range" : "intersection"
    }
  };
}

function normalizeHistoryEvent(event) {
  const agenda = event?.modules?.agenda;
  if (!agenda || agenda.scope) return event;
  return {
    ...event,
    modules: {
      ...event.modules,
      agenda: {
        ...emptyChange({
          previous: null,
          current: null,
          compared: null,
          mode: "legacy_unscoped"
        }),
        reason: "legacy_scope_unknown"
      }
    }
  };
}

function mergeModules(previous = {}, current = {}, generatedAt) {
  const keys = new Set([...MODULE_KEYS, ...Object.keys(current)]);
  const modules = {};
  for (const key of keys) {
    const prior = previous[key];
    const next = current[key];
    if (!next) {
      modules[key] = prior
        ? {
            ...prior,
            lastSyncState: "unavailable",
            lastSyncReason: "not_discovered"
          }
        : unavailable(key, "not_visible");
      continue;
    }
    if (
      next.state !== "available" &&
      prior?.state === "available" &&
      PRESERVE_REASONS.has(next.reason)
    ) {
      modules[key] = {
        ...prior,
        lastSyncState: next.state,
        lastSyncReason: next.reason
      };
      continue;
    }
    if (key === "agenda" && next.state === "available") {
      modules[key] = mergeAgendaEntries(prior, next, generatedAt);
      continue;
    }
    modules[key] = {
      ...next,
      generatedAt: next.generatedAt ?? generatedAt
    };
  }
  return modules;
}

const SYNC_HEALTH_MODULES = [
  "agenda",
  "student_schedule",
  "enrolled_courses",
  "official_grades",
  "academic_history",
  "curriculum"
];

function broadSyncAccessFailure(previous = {}, current = {}) {
  const previouslyAvailable = SYNC_HEALTH_MODULES.filter(
    (key) => previous[key]?.state === "available"
  );
  if (previouslyAvailable.length < 3) return false;
  const currentlyAvailable = SYNC_HEALTH_MODULES.filter(
    (key) => current[key]?.state === "available"
  );
  if (currentlyAvailable.length > 0) return false;
  const accessFailureReasons = new Set([
    "authentication_required",
    "role_unavailable",
    "session_expired"
  ]);
  return previouslyAvailable.every((key) =>
    accessFailureReasons.has(current[key]?.reason)
  );
}

function parseIsoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) {
    throw new McpToolError("invalid_date", `${name} must use YYYY-MM-DD`);
  }
  const epoch = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new McpToolError("invalid_date", `${name} is not a valid date`);
  }
  return String(value);
}

function findDocument(items, query) {
  const raw = String(query ?? "").trim();
  const exact = items.filter(
    (item) => item.id === raw || item.href === raw || item.title === raw
  );
  const candidates =
    exact.length > 0
      ? exact
      : items.filter((item) =>
          matches(`${item.id} ${item.title} ${item.category}`, raw)
        );
  if (candidates.length === 0) {
    throw new McpToolError(
      "document_not_found",
      "No cached Campus document matched the query",
      { details: { query: raw } }
    );
  }
  if (candidates.length > 1) {
    throw new McpToolError(
      "document_ambiguous",
      "More than one cached Campus document matched the query",
      { details: { query: raw, matches: candidates.map(({ id }) => id) } }
    );
  }
  return candidates[0];
}

export function createCampusService({
  cachePath,
  historyPath,
  manifestPath,
  statisticsPath = path.join(
    path.dirname(cachePath),
    "grade-statistics.json"
  ),
  schedulePath = path.join(
    path.dirname(cachePath),
    "course-schedules.json"
  ),
  preferencesPath = path.join(
    path.dirname(cachePath),
    "schedule-preferences.local.json"
  ),
  adapter,
  academicCalendarContext,
  now = () => new Date().toISOString(),
  maxActiveDownloads = 2,
  jobTtlSeconds = 60 * 60,
  maxRetainedJobs = 100
}) {
  if (!cachePath || !historyPath || !manifestPath) {
    throw new TypeError("Campus cache, history, and manifest paths are required");
  }
  if (!adapter) throw new TypeError("Campus adapter is required");

  const jobs = new Map();
  const registrationTokens = new Map();
  const jobPromises = new Set();
  let activeSyncJobId = "";
  let statisticsWrite = Promise.resolve();
  let scheduleWrite = Promise.resolve();

  function publicRegistrationItem(item) {
    if (!item || typeof item !== "object") return item;
    const { internalSelectionRef: _internalSelectionRef, ...safe } = item;
    return safe;
  }

  function registrationFingerprint(workspace, targetRefs = []) {
    const wanted = new Set(targetRefs);
    const registration = (workspace.registered ?? []).map((item) => ({
      ref: item.internalSelectionRef ?? "",
      courseCode: item.courseCode,
      scheduleId: item.scheduleId,
      status: item.status ?? "",
      position: item.position?.raw ?? ""
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const offerings = (workspace.offerings ?? [])
      .filter((item) => wanted.has(item.internalSelectionRef))
      .map((item) => ({
        ref: item.internalSelectionRef,
        vacancies: item.capacity?.vacancies ?? null,
        unitVacancies: item.capacity?.unitVacancies ?? null,
        registrations: item.capacity?.registrations ?? null,
        enrolled: item.capacity?.enrolled ?? null
      }))
      .sort((left, right) => left.ref.localeCompare(right.ref));
    return JSON.stringify({
      accountBinding: workspace.accountBinding ?? "",
      activeTerm: workspace.activeTerm,
      registration,
      offerings
    });
  }

  function pruneRegistrationTokens() {
    const current = Date.parse(now());
    for (const [token, entry] of registrationTokens) {
      if (!Number.isFinite(current) || current >= Date.parse(entry.expiresAt) || entry.used) {
        registrationTokens.delete(token);
      }
    }
  }

  function pruneJobs() {
    const current = Date.parse(now());
    for (const [jobId, job] of jobs) {
      if (
        ["completed", "failed"].includes(job.status) &&
        Number.isFinite(current) &&
        Number.isFinite(Date.parse(job.completedAt)) &&
        current - Date.parse(job.completedAt) >= jobTtlSeconds * 1000
      ) {
        jobs.delete(jobId);
      }
    }
    const completed = [...jobs.values()]
      .filter((job) => ["completed", "failed"].includes(job.status))
      .sort((left, right) =>
        left.completedAt.localeCompare(right.completedAt) ||
        left.jobId.localeCompare(right.jobId)
      );
    while (completed.length > maxRetainedJobs) {
      jobs.delete(completed.shift().jobId);
    }
  }

  async function readSnapshot({ optional = false } = {}) {
    return readJsonCache(
      cachePath,
      optional ? { fallback: null } : {}
    ).catch((error) => {
      if (error.code === "ENOENT" && optional) return null;
      if (error.code === "ENOENT") {
        throw new McpToolError(
          "cache_unavailable",
          "No Campus Virtual cache is available; run sync_campus_virtual first",
          { retryable: true }
        );
      }
      throw error;
    });
  }

  function startJob(kind, operation, { dedupeKey = "" } = {}) {
    pruneJobs();
    if (dedupeKey) {
      const existing = [...jobs.values()].find(
        (job) =>
          job.kind === kind &&
          job.dedupeKey === dedupeKey &&
          ["queued", "running"].includes(job.status)
      );
      if (existing) return existing;
    }
    const job = {
      jobId: `${kind}-${randomUUID()}`,
      kind,
      status: "queued",
      queuedAt: now(),
      startedAt: "",
      completedAt: "",
      result: null,
      error: null,
      dedupeKey
    };
    jobs.set(job.jobId, job);
    const promise = Promise.resolve()
      .then(async () => {
        job.status = "running";
        job.startedAt = now();
        try {
          job.result = await operation(job.jobId);
          job.status = "completed";
        } catch (error) {
          job.status = "failed";
          job.error = safeJobError(error);
        } finally {
          job.completedAt = now();
          if (activeSyncJobId === job.jobId) activeSyncJobId = "";
          pruneJobs();
        }
      })
      .finally(() => jobPromises.delete(promise));
    jobPromises.add(promise);
    return job;
  }

  async function waitForJobDispatch(job) {
    while (
      job &&
      (job.status === "queued" ||
        (job.status === "running" && !job.dispatchedAt))
    ) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async function recordChanges(jobId, previous, current) {
    const keys = new Set([
      ...MODULE_KEYS,
      ...Object.keys(previous?.modules ?? {}),
      ...Object.keys(current.modules ?? {})
    ]);
    const modules = Object.fromEntries(
      [...keys].map((key) => [
        key,
        key === "agenda"
          ? summarizeAgenda(previous?.modules?.[key], current.modules[key])
          : summarizeModule(previous?.modules?.[key], current.modules[key])
      ])
    );
    const history = await readJsonCache(historyPath, { fallback: [] });
    const event = {
      jobId,
      syncedAt: current.generatedAt,
      modules
    };
    await writeJsonAtomic(historyPath, [...history, event].slice(-50));
    return event;
  }

  function startSync(options = {}) {
    if (
      activeSyncJobId &&
      ["queued", "running"].includes(jobs.get(activeSyncJobId)?.status)
    ) {
      const active = jobs.get(activeSyncJobId);
      const requestedStart = options.start ?? "";
      const requestedEnd = options.end ?? requestedStart;
      const activeStart = active.syncOptions?.start ?? "";
      const activeEnd = active.syncOptions?.end ?? activeStart;
      const requestedScope = options.moduleScope ?? "all";
      const activeScope = active.syncOptions?.moduleScope ?? "all";
      const activeCoversScope = activeScope === "all" || activeScope === requestedScope;
      const activeCoversRequest =
        !requestedStart ||
        (!activeStart && !activeEnd) ||
        (activeStart <= requestedStart && activeEnd >= requestedEnd);
      if (activeCoversScope && activeCoversRequest) return active;
    }
    const job = startJob("sync", async (jobId) => {
      const previous = await readSnapshot({ optional: true });
      const activeJob = jobs.get(jobId);
      if (activeJob) activeJob.dispatchedAt = now();
      const scraped = await adapter.sync({
        ...options,
        previousSnapshot: previous,
        metadataOnly: true,
        allowDownloads: false,
        allowMutations: false
      });
      const generatedAt = scraped.generatedAt ?? now();
      const moduleScope = options.moduleScope ?? "all";
      if (
        moduleScope === "agenda" &&
        previous?.modules?.agenda?.state === "available" &&
        scraped.modules?.agenda?.state !== "available"
      ) {
        throw new McpToolError(
          "campus_agenda_refresh_failed",
          "Campus did not return a usable agenda; the previous cache was left untouched",
          { retryable: true }
        );
      }
      if (
        moduleScope === "all" &&
        broadSyncAccessFailure(previous?.modules, scraped.modules)
      ) {
        throw new McpToolError(
          "campus_sync_degraded",
          "Campus returned a broad access failure; the previous cache was left untouched",
          { retryable: true }
        );
      }
      const modules = moduleScope === "agenda"
        ? {
            ...(previous?.modules ?? {}),
            agenda: mergeAgendaEntries(
              previous?.modules?.agenda,
              scraped.modules?.agenda,
              generatedAt
            )
          }
        : mergeModules(previous?.modules, scraped.modules, generatedAt);
      const current = {
        generatedAt,
        retrievedAt: scraped.retrievedAt ?? generatedAt,
        modules
      };
      await writeJsonAtomic(cachePath, current);
      const event = await recordChanges(jobId, previous, current);
      return {
        generatedAt,
        modules: Object.fromEntries(
          Object.entries(current.modules).map(([key, value]) => [
            key,
            {
              state: value.state,
              count: value.items?.length ?? (value.value ? 1 : 0)
            }
          ])
        ),
        changes: event.modules
      };
    });
    job.syncOptions = {
      start: options.start ?? "",
      end: options.end ?? options.start ?? "",
      reason: options.reason ?? "",
      moduleScope: options.moduleScope ?? "all"
    };
    activeSyncJobId = job.jobId;
    return job;
  }

  function envelope(snapshot, generatedAt, data, ttlSeconds, warnings = []) {
    return createEnvelope({
      source: SOURCE,
      retrievedAt: snapshot.retrievedAt ?? snapshot.generatedAt,
      generatedAt,
      ttlSeconds,
      data,
      warnings,
      now: now()
    });
  }

  async function queryModule(module, options, select) {
    const snapshot = await readSnapshot();
    const entry = snapshot.modules?.[module] ?? unavailable(module);
    const generated = entry.generatedAt ?? snapshot.generatedAt;
    const ttlSeconds = ttlFor(module, snapshot, activeEnrollment);
    const refresh = shouldRefresh({
      forceRefresh: Boolean(options.forceRefresh),
      generatedAt: generated,
      now: now(),
      ttlSeconds
    });
    const job = refresh
      ? startSync({ reason: options.forceRefresh ? "forced" : "stale" })
      : null;
    const data =
      entry.state === "available"
        ? await select(entry, snapshot)
        : cleanUnavailable(module, entry);
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      snapshot,
      generated,
      data,
      ttlSeconds,
      job
        ? ["Cached data was returned while a Campus Virtual metadata refresh runs in the background."]
        : []
    );
  }

  function listItems(module, options, filter, maximum = 200) {
    return queryModule(module, options, async (entry) => {
      const items = [...(entry.items ?? [])]
        .filter((item) => filter(item))
        .slice(0, clamp(options.limit, 80, maximum));
      return { state: "available", count: items.length, items };
    });
  }

  function requestedGradeStatisticsScope(options = {}) {
    const scope = options.scope ?? (options.schedule ? "schedule" : "student_schedule");
    if (!["student_schedule", "schedule", "all"].includes(scope)) {
      throw new McpToolError(
        "grade_statistics_scope_invalid",
        "Grade statistics scope must be student_schedule, schedule, or all"
      );
    }
    if (scope === "schedule" && !options.schedule) {
      throw new McpToolError(
        "grade_statistics_schedule_required",
        "Provide schedule when grade statistics scope is schedule"
      );
    }
    if (options.scope && scope !== "schedule" && options.schedule) {
      throw new McpToolError(
        "grade_statistics_scope_conflict",
        "Do not provide schedule unless grade statistics scope is schedule"
      );
    }
    return scope;
  }

  function gradeStatisticsReference(kind, options, snapshot) {
    const scope = requestedGradeStatisticsScope(options);
    const normalizedType = searchableText(options.evaluationType);
    const courseGrades = (snapshot.modules?.official_grades?.items ?? [])
      .filter((item) =>
        matches(`${item.courseCode} ${item.course}`, options.course)
      )
      .filter((item) => item.term === options.term);
    const matchingAssessments = courseGrades.filter((item) =>
      kind === "partial"
        ? (
          searchableText(item.statistics?.evaluationType ?? item.assessmentType) === normalizedType &&
          Number(item.statistics?.evaluationNumber ?? item.assessmentNumber) ===
            Number(options.evaluationNumber)
        )
        : item.statistics?.kind === "final" || searchableText(item.item) === "nota final"
    );
    let candidates = matchingAssessments
      .filter((item) => item.statistics?.kind === kind)
      .filter((item) => kind !== "final" || /^\d+(?:[.,]\d+)?$/u.test(String(item.grade ?? "").trim()));
    if (scope === "schedule") {
      candidates = candidates.filter((item) => item.statistics.schedule === options.schedule);
    } else if (scope === "student_schedule" && candidates.length > 1) {
      const enrolledSchedules = new Set(
        (snapshot.modules?.enrolled_courses?.items ?? [])
          .filter((item) => matches(`${item.code} ${item.name}`, options.course))
          .filter((item) => !item.term || item.term === options.term)
          .map((item) => String(item.schedule ?? "").trim())
          .filter(Boolean)
      );
      const enrolledCandidates = candidates.filter((item) =>
        enrolledSchedules.has(String(item.statistics.schedule ?? "").trim())
      );
      if (enrolledCandidates.length > 0) candidates = enrolledCandidates;
    }
    if (candidates.length === 0) {
      return {
        state: "unavailable",
        reason: matchingAssessments.length > 0
          ? "statistics_not_published"
          : kind === "partial"
            ? "evaluation_not_found"
            : "final_grade_not_found"
      };
    }
    if (candidates.length > 1 && scope !== "all") {
      throw new McpToolError(
        "grade_statistics_ambiguous",
        "More than one cached Campus grade matches; specify schedule",
        {
          details: {
            schedules: [
              ...new Set(
                candidates.map(({ statistics }) => statistics.schedule)
              )
            ]
          }
        }
      );
    }
    const selected = [...candidates].sort((left, right) =>
      String(left.statistics.schedule ?? "").localeCompare(String(right.statistics.schedule ?? ""))
    )[0].statistics;
    return {
      state: "available",
      reference: { ...selected, statisticsScope: scope }
    };
  }

  function gradeStatisticsKey(reference) {
    const parts = [
      reference.kind,
      reference.year,
      reference.cycle,
      reference.cycleType,
      reference.courseCode
    ];
    // Keep the legacy key for per-schedule reports so existing installations do
    // not discard valid cache entries. Only the institutional aggregate needs a
    // separate namespace because it is a genuinely different population.
    if (reference.statisticsScope === "all") parts.push("all");
    parts.push(
      reference.schedule,
      reference.evaluationType ?? "",
      reference.evaluationNumber ?? "",
      reference.faculty ?? ""
    );
    return parts.join("|");
  }

  async function readGradeStatisticsCache() {
    const cache = await readJsonCache(statisticsPath, {
      fallback: { entries: {} }
    });
    return {
      entries:
        cache && typeof cache.entries === "object" && cache.entries
          ? cache.entries
          : {}
    };
  }

  async function persistGradeStatistics(key, entry) {
    statisticsWrite = statisticsWrite.catch(() => {}).then(async () => {
      const cache = await readGradeStatisticsCache();
      await writeJsonAtomic(statisticsPath, {
        entries: {
          ...cache.entries,
          [key]: entry
        }
      });
    });
    await statisticsWrite;
  }

  function activeEnrollment(snapshot) {
    const current = Date.parse(now());
    if (!Number.isFinite(current)) return false;
    return (snapshot.modules?.enrollment_calendar?.items ?? []).some((item) => {
      if (!/matr[ií]cula v[ií]a campus virtual/i.test(item.title ?? "")) return false;
      const start = Date.parse(item.start ?? item.date ?? "");
      const end = Date.parse(item.end ?? item.start ?? item.date ?? "");
      return Number.isFinite(start) && Number.isFinite(end) && current >= start && current <= end;
    });
  }

  function registrationWindowState(snapshot) {
    const current = Date.parse(now());
    if (!Number.isFinite(current)) return "unknown";
    const activeTerm = enrollmentTerm({}, snapshot);
    const windows = (snapshot?.modules?.enrollment_calendar?.items ?? [])
      .filter((item) => /matr[ií]cula v[ií]a campus virtual|matr[ií]cula extempor[aá]nea/i.test(item.title ?? ""))
      .filter((item) => !activeTerm || !item.term || String(item.term) === activeTerm)
      .map((item) => ({
        start: Date.parse(item.start ?? item.date ?? ""),
        end: Date.parse(item.end ?? item.start ?? item.date ?? "")
      }))
      .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end));
    if (windows.length === 0) return "unknown";
    if (windows.some(({ start, end }) => current >= start && current <= end)) return "open";
    if (current > Math.max(...windows.map(({ end }) => end))) return "closed";
    if (current < Math.min(...windows.map(({ start }) => start))) return "upcoming";
    return "between_windows";
  }

  function scheduleTtl(snapshot) {
    return activeEnrollment(snapshot) ? 5 * 60 : 30 * 60;
  }

  function enrollmentTerm(options, snapshot, { historical = false, scheduleCache = null } = {}) {
    if (historical) return String(options.term ?? "").trim();
    const candidates = [
      snapshot.modules?.enrollment?.value?.term,
      snapshot.modules?.student_schedule?.term,
      ...(snapshot.modules?.enrolled_courses?.items ?? []).map(({ term }) => term),
      ...(snapshot.modules?.agenda?.items ?? []).map(({ term }) => term),
      ...(scheduleCache?.entries ?? [])
        .filter((entry) => entry.query?.mode !== "historical")
        .flatMap((entry) => [
          entry.activeTerm,
          entry.query?.term === "active" ? "" : entry.query?.term,
          ...(entry.items ?? []).map(({ term }) => term)
        ])
    ].filter((term) => /^\d{4}-\d{1,2}$/.test(String(term ?? "")));
    return candidates.sort((left, right) => String(right).localeCompare(String(left)))[0] ?? "";
  }

  function registrationPortalExpected(snapshot) {
    const sections = snapshot.modules?.enrollment_portal?.value?.sections ?? [];
    const actions = sections.flatMap((section) => section.actions ?? []);
    const regularAdvertised = actions.some((action) =>
      /inscr[ií]bete aqu[ií]/i.test(action.label ?? "") &&
      action.access !== "blocked"
    );
    const extemporaneousAdvertised = actions.some((action) =>
      /matr[ií]cula extempor[aá]nea/i.test(action.label ?? "") &&
      action.access !== "blocked"
    );
    const windowState = registrationWindowState(snapshot);
    if (windowState === "open") return true;
    if (windowState === "closed") return false;
    if (windowState === "upcoming") {
      return regularAdvertised;
    }
    return regularAdvertised || extemporaneousAdvertised || windowState === "unknown";
  }

  function registrationGuardWorkspace(snapshot, {
    source,
    sourcesUsed,
    academicContext = null
  }) {
    const retrievedAt = now();
    return {
      state: "unavailable",
      portalState: "unavailable",
      reason: "outside_registration_window",
      enrollmentMode: "closed_or_unavailable",
      activeTerm: enrollmentTerm({}, snapshot) || null,
      turn: null,
      summary: {},
      registered: [],
      offerings: [],
      scopes: { faculties: [], specialties: [] },
      fallbackTools: ["list_enrolled_courses", "get_student_schedule", "search_course_schedules"],
      source,
      sourcesUsed,
      retrievedAt,
      ttlSeconds: 24 * 60 * 60,
      ...(academicContext ? { academicContext } : {}),
      warnings: ["The live registration portal probe was skipped because the enrollment window is closed. Use forceProbe only for a confirmed exceptional reopening."]
    };
  }

  async function registrationProbeGuard(snapshot, { forceProbe = false } = {}) {
    if (forceProbe || !snapshot) return null;
    const windowState = registrationWindowState(snapshot);
    if (windowState === "open") return null;
    if (windowState === "closed") {
      return registrationGuardWorkspace(snapshot, {
        source: "enrollment_calendar_guard",
        sourcesUsed: ["enrollment_calendar"]
      });
    }
    const sections = snapshot.modules?.enrollment_portal?.value?.sections ?? [];
    const liveActionAdvertised = sections.some((section) =>
      (section.actions ?? []).some((action) =>
        /inscr[ií]bete aqu[ií]|matr[ií]cula extempor[aá]nea/i.test(action.label ?? "") &&
        action.access !== "blocked"
      )
    );
    if (liveActionAdvertised || typeof academicCalendarContext !== "function") return null;
    const term = enrollmentTerm({}, snapshot);
    let context;
    try {
      context = await academicCalendarContext({ ...(term ? { term } : {}) });
      if (["calendar_ambiguous", "scope_required"].includes(context?.state)) {
        const courseKeys = [
          ...(snapshot.modules?.enrolled_courses?.items ?? []).map((item) =>
            item.code ?? item.courseCode
          ),
          ...(snapshot.modules?.student_schedule?.items ?? []).map((item) =>
            item.courseCode ?? item.code
          )
        ].map((value) => String(value ?? "").trim()).filter(Boolean);
        for (const course of [...new Set(courseKeys)]) {
          const scoped = await academicCalendarContext({
            ...(term ? { term } : {}),
            course
          });
          if (scoped?.state === "available") {
            context = scoped;
            break;
          }
        }
      }
    } catch {
      return null;
    }
    if (context?.state !== "available" || !Number.isInteger(context.currentWeek) || context.currentWeek <= 1) {
      return null;
    }
    return registrationGuardWorkspace(snapshot, {
      source: "academic_calendar_guard",
      sourcesUsed: ["academic_calendar"],
      academicContext: {
        state: context.state,
        calendarId: context.calendarId ?? null,
        term: context.term || term || null,
        currentDate: context.currentDate ?? null,
        currentWeek: context.currentWeek,
        kind: context.kind ?? null
      }
    });
  }

  function scheduleQuery(options, snapshot, { historical = false, scheduleCache = null } = {}) {
    const term = enrollmentTerm(options, snapshot, { historical, scheduleCache });
    const courseCodes = [...new Set((options.courseCodes ?? []).map((code) =>
      String(code).trim().toUpperCase()
    ).filter(Boolean))].sort();
    const academicScope = options.academicScope
      ? {
          academicUnit: String(options.academicScope.academicUnit ?? "").trim(),
          specialty: String(options.academicScope.specialty ?? "").trim(),
          ...(options.academicScope.curriculumLevel === undefined
            ? {}
            : { curriculumLevel: Number(options.academicScope.curriculumLevel) })
        }
      : null;
    if (historical && !term) {
      throw new McpToolError(
        "enrollment_term_required",
        "A historical schedule term is required"
      );
    }
    if (courseCodes.length === 0 && !academicScope?.academicUnit) {
      throw new McpToolError(
        "schedule_scope_required",
        "Provide courseCodes or academicScope.academicUnit to avoid an unbounded Campus query"
      );
    }
    if (!historical && !term) {
      throw new McpToolError(
        "current_term_unavailable",
        "The active Campus term is unavailable; refresh Campus metadata first"
      );
    }
    if (academicScope?.curriculumLevel !== undefined && !academicScope.specialty) {
      throw new McpToolError(
        "schedule_specialty_required",
        "Provide academicScope.specialty when filtering schedules by curriculumLevel"
      );
    }
    return {
      mode: historical ? "historical" : "current",
      term,
      courseCodes,
      courseName: String(options.courseName ?? "").trim(),
      academicScope
    };
  }

  function scheduleQueryKey(query) {
    return JSON.stringify({
      mode: query.mode ?? "legacy",
      term: query.term,
      courseCodes: [...(query.courseCodes ?? [])].sort(),
      courseName: query.courseName ?? "",
      academicScope: query.academicScope ?? null
    });
  }

  function normalizedScheduleSource(source) {
    return ["public_schedule", "authenticated_schedule_report"].includes(source)
      ? "schedule_catalog"
      : source;
  }

  function normalizeScheduleCacheEntry(entry) {
    const source = normalizedScheduleSource(entry.source);
    const sourcesUsed = [...new Set((entry.sourcesUsed ?? [source])
      .map(normalizedScheduleSource)
      .filter(Boolean))];
    const differences = (entry.differences ?? []).map((difference) => {
      if (!Object.hasOwn(difference, "authenticatedScheduleReport")) return difference;
      const { authenticatedScheduleReport, ...rest } = difference;
      return { ...rest, scheduleCatalog: authenticatedScheduleReport };
    });
    return { ...entry, source, sourcesUsed, differences };
  }

  async function readScheduleCache() {
    const cache = await readJsonCache(schedulePath, {
      fallback: { entries: [] }
    });
    return {
      entries: Array.isArray(cache?.entries)
        ? cache.entries.map(normalizeScheduleCacheEntry)
        : []
    };
  }

  async function persistScheduleEntry(key, entry) {
    scheduleWrite = scheduleWrite.catch(() => {}).then(async () => {
      const cache = await readScheduleCache();
      const entries = cache.entries.filter(
        (candidate) => scheduleQueryKey(candidate.query ?? {}) !== key
      );
      entries.push(entry);
      await writeJsonAtomic(schedulePath, { entries: entries.slice(-50) });
    });
    await scheduleWrite;
  }

  async function invalidateCurrentScheduleCache() {
    scheduleWrite = scheduleWrite.catch(() => {}).then(async () => {
      const cache = await readScheduleCache();
      const entries = cache.entries.filter((entry) => entry.query?.mode === "historical");
      await writeJsonAtomic(schedulePath, { entries });
    });
    await scheduleWrite;
  }

  function startScheduleSearch(query, { preferRegistrationPortal = true } = {}) {
    const key = scheduleQueryKey(query);
    return startJob(
      "course-schedules",
      async (jobId) => {
        const activeJob = jobs.get(jobId);
        if (activeJob) activeJob.dispatchedAt = now();
        const operation = query.mode === "historical"
          ? adapter.searchHistoricalCourseSchedules ?? adapter.searchScheduleCatalog
          : adapter.searchCurrentCourseSchedules ?? adapter.searchScheduleCatalog;
        if (typeof operation !== "function") {
          throw new McpToolError(
            "scrape_failed",
            `The Campus adapter does not support ${query.mode} course schedule search`
          );
        }
        let result = await operation.call(adapter, {
          ...query,
          ...(query.mode === "current" ? { preferRegistrationPortal } : {}),
          metadataOnly: true,
          allowDownloads: false,
          allowMutations: false,
          useCampusGenerator: false
        });
        if ((query.courseCodes?.length ?? 0) > 1) {
          const present = new Set((result.items ?? []).map(({ courseCode }) =>
            String(courseCode ?? "").toUpperCase()
          ));
          const omitted = query.courseCodes.filter((courseCode) => !present.has(courseCode));
          const recovered = [];
          const unavailableCourses = [];
          for (const courseCode of omitted) {
            try {
              const individual = await operation.call(adapter, {
                ...query,
                courseCodes: [courseCode],
                ...(query.mode === "current" ? { preferRegistrationPortal } : {}),
                metadataOnly: true,
                allowDownloads: false,
                allowMutations: false,
                useCampusGenerator: false
              });
              if (individual.state === "available" && (individual.items?.length ?? 0) > 0) {
                recovered.push(...individual.items);
              } else {
                unavailableCourses.push(courseCode);
              }
            } catch {
              unavailableCourses.push(courseCode);
            }
          }
          const unique = new Map([...(result.items ?? []), ...recovered].map((item) => [
            `${item.term ?? ""}|${item.courseCode ?? ""}|${item.scheduleId ?? ""}|${item.scheduleType ?? ""}`,
            item
          ]));
          result = {
            ...result,
            items: [...unique.values()],
            ...(unavailableCourses.length > 0 ? { unavailableCourses } : {})
          };
        }
        const generatedAt = result.retrievedAt ?? now();
        const entry = {
          generatedAt,
          retrievedAt: generatedAt,
          query,
          state: result.state ?? "available",
          items: result.items ?? [],
          source: normalizedScheduleSource(
            result.source ?? (query.mode === "historical" ? "schedule_catalog" : "enrollment_portal")
          ),
          sourcesUsed: (result.sourcesUsed ?? [
            result.source ?? (query.mode === "historical" ? "schedule_catalog" : "enrollment_portal")
          ]).map(normalizedScheduleSource),
          activeTerm: result.activeTerm ?? query.term,
          enrollmentMode: result.enrollmentMode ?? null,
          differences: result.differences ?? [],
          warnings: result.warnings ?? [],
          ...(result.reason ? { reason: result.reason } : {})
        };
        await persistScheduleEntry(key, entry);
        return {
          generatedAt,
          state: entry.state,
          count: entry.items.length,
          query
        };
      },
      { dedupeKey: key }
    );
  }

  function matchingScheduleItems(cache, { term, courseCodes = [], course, schedule } = {}) {
    const wantedSchedule = schedule ? normalizeScheduleId(schedule) : "";
    const wanted = new Set(
      [...courseCodes, course].filter(Boolean).map((code) => String(code).toUpperCase())
    );
    const found = new Map();
    for (const entry of cache.entries) {
      for (const item of entry.items ?? []) {
        if (entry.query?.mode === "historical") continue;
        if (term && term !== "active" && item.term && item.term !== term) continue;
        if (wanted.size > 0 && !wanted.has(String(item.courseCode).toUpperCase())) continue;
        if (wantedSchedule && String(item.scheduleId) !== wantedSchedule) continue;
        const key = `${item.term}|${item.courseCode}|${item.scheduleId}|${item.scheduleType ?? ""}`;
        found.set(key, item);
      }
    }
    return [...found.values()].sort(
      (left, right) =>
        String(left.courseCode).localeCompare(String(right.courseCode)) ||
        String(left.scheduleId).localeCompare(String(right.scheduleId))
    );
  }

  function newestScheduleEntry(cache, query) {
    const key = scheduleQueryKey(query);
    const exact = cache.entries.filter((entry) => scheduleQueryKey(entry.query ?? {}) === key);
    const compatibleLegacy = query.mode === "current"
      ? cache.entries.filter((entry) => {
          const candidate = entry.query ?? {};
          const legacyCurrent =
            (!candidate.mode && String(candidate.term ?? "") === query.term) ||
            (
              candidate.mode === "current" &&
              candidate.term === "active" &&
              [entry.activeTerm, ...(entry.items ?? []).map(({ term }) => term)]
                .filter(Boolean)
                .every((term) => term === query.term)
            );
          return legacyCurrent &&
            JSON.stringify([...(candidate.courseCodes ?? [])].sort()) === JSON.stringify([...(query.courseCodes ?? [])].sort()) &&
            JSON.stringify(candidate.academicScope ?? null) === JSON.stringify(query.academicScope ?? null);
        })
      : [];
    return [...exact, ...compatibleLegacy]
      .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)))[0] ?? null;
  }

  function statisticsWithScope(data, reference, options = {}) {
    const requested = requestedGradeStatisticsScope(options);
    if (requested === "all") {
      return {
        ...data,
        schedule: "",
        scope: {
          requested: "all",
          resolved: "all",
          requestedSchedule: null,
          resolvedSchedule: null,
          reportSchedule: null,
          reportLabel: String(data?.reportLabel ?? data?.schedule ?? "Todos").trim() || "Todos",
          kind: "all"
        }
      };
    }
    const reportSchedule = String(data?.schedule ?? "").trim() || null;
    const resolvedSchedule = reportSchedule || String(reference?.schedule ?? "").trim() || null;
    return {
      ...data,
      schedule: resolvedSchedule ?? "",
      scope: {
        requestedSchedule: String(options.schedule ?? "").trim() || null,
        resolvedSchedule,
        reportSchedule,
        kind: resolvedSchedule ? "schedule" : "course"
      }
    };
  }

  async function getGradeStatistics(kind, options) {
    const scope = requestedGradeStatisticsScope(options);
    options = {
      ...options,
      scope,
      ...(options.schedule ? { schedule: normalizeScheduleId(options.schedule) } : {})
    };
    const snapshot = await readSnapshot();
    const lookup = gradeStatisticsReference(kind, options, snapshot);
    if (lookup.state !== "available") {
      return envelope(
        snapshot,
        snapshot.modules?.official_grades?.generatedAt ?? snapshot.generatedAt,
        {
          state: "unavailable",
          reason: lookup.reason,
          query: {
            kind,
            course: options.course,
            term: options.term,
            scope,
            ...(options.schedule ? { schedule: options.schedule } : {}),
            ...(kind === "partial"
              ? {
                  evaluationType: options.evaluationType,
                  evaluationNumber: options.evaluationNumber
                }
              : {})
          }
        },
        TTL_SECONDS.academic
      );
    }
    const reference = lookup.reference;
    const key = gradeStatisticsKey(reference);
    const cache = await readGradeStatisticsCache();
    const cached = cache.entries[key] ?? null;
    const stale =
      !cached ||
      shouldRefresh({
        forceRefresh: Boolean(options.forceRefresh),
        generatedAt: cached.generatedAt,
        now: now(),
        ttlSeconds: TTL_SECONDS.academic
      });
    if (!stale) {
      return envelope(
        snapshot,
        cached.generatedAt,
        statisticsWithScope(cached.data, reference, options),
        TTL_SECONDS.academic
      );
    }

    const job = startJob(
      "grade-statistics",
      async () => {
        const result =
          kind === "partial"
            ? await adapter.getPartialGradeStatistics(reference)
            : await adapter.getFinalGradeStatistics(reference);
        const generatedAt = result.retrievedAt ?? now();
        const data = statisticsWithScope({
          ...result,
          state: "available",
          reference: {
            kind,
            courseCode: reference.courseCode,
            term: `${reference.year}-${Number(reference.cycle)}`,
            schedule: reference.schedule,
            ...(kind === "partial"
              ? {
                  evaluationType: reference.evaluationType,
                  evaluationNumber: reference.evaluationNumber
                }
              : {})
          }
        }, reference, options);
        await persistGradeStatistics(key, { generatedAt, data });
        return data;
      },
      { dedupeKey: key }
    );

    if (cached) {
      return envelope(
        snapshot,
        cached.generatedAt,
        { ...statisticsWithScope(cached.data, reference, options), refreshJobId: job.jobId },
        TTL_SECONDS.academic,
        [
          "Cached grade statistics were returned while Campus refreshes this exact institutional report."
        ]
      );
    }
    return envelope(
      snapshot,
      snapshot.generatedAt,
      {
        state: "pending",
        jobId: job.jobId,
        query: {
          kind,
          course: options.course,
          term: options.term,
          scope,
          ...(options.schedule ? { schedule: options.schedule } : {}),
          ...(kind === "partial"
            ? {
                evaluationType: options.evaluationType,
                evaluationNumber: options.evaluationNumber
              }
            : {})
        }
      },
      TTL_SECONDS.academic,
      [
        "The exact Campus grade statistics report is being fetched; query get_campus_job_status with jobId."
      ]
    );
  }

  async function listCampusModules(options = {}) {
    const snapshot = await readSnapshot();
    const generated = snapshot.generatedAt;
    const refresh = shouldRefresh({
      forceRefresh: Boolean(options.forceRefresh),
      generatedAt: generated,
      now: now(),
      ttlSeconds: TTL_SECONDS.materialAdmin
    });
    const job = refresh ? startSync({ reason: options.forceRefresh ? "forced" : "stale" }) : null;
    const modules = Object.entries(snapshot.modules ?? {})
      .filter(([key]) => PUBLIC_MODULE_KEYS.has(key))
      .map(([key, entry]) => ({
        key,
        label: entry.label ?? key,
        state: entry.state ?? "unavailable",
        reason: entry.reason ?? "",
        alerts: entry.alerts ?? []
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
    const data = { count: modules.length, modules };
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      snapshot,
      generated,
      data,
      TTL_SECONDS.materialAdmin,
      job ? ["Cached module status was returned while metadata refresh runs."] : []
    );
  }

  async function getCampusAgenda(options = {}) {
    const snapshot = await readSnapshot();
    const activeTerm = enrollmentTerm({}, snapshot) || null;
    const entry = snapshot.modules?.agenda ?? unavailable("agenda");
    const generated = entry.generatedAt ?? snapshot.generatedAt;
    const start = options.start
      ? parseIsoDate(options.start, "start")
      : entry.range?.start ?? "0000-01-01";
    const end = options.end
      ? parseIsoDate(options.end, "end")
      : entry.range?.end ?? start;
    if (start > end) {
      throw new McpToolError("invalid_date", "start must not be after end");
    }

    const cachedRanges = agendaRanges(entry);
    const rangeCovered = cachedRanges.some((range) =>
      start >= range.start && end <= range.end
    );
    const rangeOverlaps = cachedRanges.some((range) =>
      start <= range.end && end >= range.start
    );
    const stale = shouldRefresh({
      forceRefresh: Boolean(options.forceRefresh),
      generatedAt: generated,
      now: now(),
      ttlSeconds: TTL_SECONDS.agenda
    });
    const needsRefresh = stale || !rangeCovered;
    const reason = !rangeCovered
      ? "range_not_cached"
      : options.forceRefresh
        ? "forced"
        : "stale";
    const job = needsRefresh
      ? startSync({ reason, start, end, moduleScope: "agenda" })
      : null;
    if (job) await waitForJobDispatch(job);
    const warnings = [];
    if (!rangeCovered) {
      warnings.push(
        rangeOverlaps
          ? "Only the overlapping cached agenda range is returned while the full requested range refreshes."
          : "The requested agenda range is not cached; a range-specific refresh is running."
      );
    } else if (job) {
      warnings.push(
        "Cached agenda data was returned while a Campus Virtual metadata refresh runs in the background."
      );
    }

    if (entry.state !== "available" || (!rangeCovered && !rangeOverlaps)) {
      const data =
        entry.state === "available"
          ? {
              state: "unavailable",
              reason: "range_not_cached",
              activeTerm,
              authoritative: false,
              range: entry.range ?? null,
              ranges: cachedRanges,
              query: {
                start,
                end,
                course: options.course ?? "",
                kind: options.kind ?? ""
              },
              count: 0,
              items: []
            }
          : {
              ...cleanUnavailable("agenda", entry),
              activeTerm,
              authoritative: false,
              range: entry.range ?? null,
              ranges: cachedRanges,
              query: {
                start,
                end,
                course: options.course ?? "",
                kind: options.kind ?? ""
              }
            };
      if (job) data.refreshJobId = job.jobId;
      return envelope(
        snapshot,
        generated,
        data,
        TTL_SECONDS.agenda,
        warnings
      );
    }

    const kinds = String(options.kind ?? "")
      .split(",")
      .map((value) => searchableText(value))
      .filter(Boolean);
    const items = [...(entry.items ?? [])]
      .filter((item) => item.beginDate >= start && item.beginDate <= end)
      .filter((item) => matches(`${item.course} ${item.title}`, options.course))
      .filter(
        (item) =>
          kinds.length === 0 ||
          kinds.some((kind) => searchableText(item.kind).includes(kind))
      )
      .sort((left, right) =>
        `${left.beginDate} ${left.beginTime}`.localeCompare(
          `${right.beginDate} ${right.beginTime}`
        )
      )
      .slice(0, clamp(options.limit, 80, 200));
    const data = {
      state: "available",
      activeTerm,
      authoritative: rangeCovered,
      range: entry.range ?? null,
      ranges: cachedRanges,
      query: { start, end, course: options.course ?? "", kind: options.kind ?? "" },
      count: items.length,
      items
    };
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      snapshot,
      generated,
      data,
      TTL_SECONDS.agenda,
      warnings
    );
  }

  async function getCampusDay(options) {
    const date = parseIsoDate(options.date, "date");
    const response = await getCampusAgenda({
      ...options,
      start: addIsoDays(date, -1),
      end: addIsoDays(date, 1)
    });
    const items = (response.data.items ?? []).filter((item) =>
      agendaItemDate(item) === date
    );
    response.data = {
      ...response.data,
      query: {
        start: date,
        end: date,
        course: options.course ?? "",
        kind: options.kind ?? ""
      },
      count: items.length,
      items
    };
    return response;
  }

  const listEnrolledCourses = (options = {}) =>
    listItems(
      "enrolled_courses",
      options,
      (item) =>
        matches(`${item.code} ${item.name}`, options.query) &&
        matches(item.term, options.term) &&
        matches(item.status, options.status),
      100
    );

  async function listCourseParticipants(options = {}) {
    if (typeof adapter.getCourseParticipants !== "function") {
      throw new McpToolError(
        "course_roster_unavailable",
        "The Campus adapter does not support the authenticated course roster"
      );
    }
    const result = await adapter.getCourseParticipants({
      course: String(options.course ?? "").trim(),
      schedule: String(options.schedule ?? "").trim(),
      query: String(options.query ?? "").trim(),
      includeEmail: options.includeEmail === true,
      limit: clamp(options.limit, 200, 200),
      metadataOnly: true,
      allowDownloads: false,
      allowMutations: false
    });
    const timestamp = result.retrievedAt ?? now();
    return createEnvelope({
      source: SOURCE,
      retrievedAt: timestamp,
      generatedAt: timestamp,
      ttlSeconds: 0,
      now: now(),
      data: {
        state: result.state,
        source: "campus_course_roster",
        courseCode: result.courseCode,
        courseName: result.courseName,
        activeTerm: result.term || null,
        scope: options.schedule ? "course_schedule" : "whole_course",
        schedule: options.schedule || null,
        total: result.total,
        count: result.count,
        truncated: result.truncated,
        people: result.items
      },
      warnings: options.includeEmail === true
        ? ["Institutional email addresses were included because includeEmail was explicitly enabled."]
        : []
    });
  }
  const listOfficialGrades = (options = {}) =>
    listItems(
      "official_grades",
      options,
      (item) =>
        matches(`${item.courseCode} ${item.course} ${item.item}`, options.query) &&
        matches(item.term, options.term) &&
        matches(item.status, options.status),
      200
    );
  const getAcademicHistory = (options = {}) =>
    listItems(
      "academic_history",
      options,
      (item) =>
        matches(`${item.courseCode} ${item.course}`, options.query) &&
        matches(item.term, options.term) &&
        matches(item.status, options.status),
      500
    );
  const getAcademicPerformance = (options = {}) =>
    listItems(
      "academic_performance",
      options,
      (item) => matches(item.term, options.term),
      100
    );
  const getCurriculumProgress = (options = {}) =>
    queryModule("curriculum", options, async (entry, snapshot) => {
      const enrolled = snapshot.modules?.enrolled_courses?.items ?? [];
      const items = [...(entry.items ?? [])]
        .map(item => item.status === "Sin calificar" && enrolled.some(course =>
          String(course.code ?? course.courseCode).toUpperCase() === String(item.code).toUpperCase() &&
          (!item.term || !course.term || item.term === course.term))
          ? { ...item, status: "En curso" }
          : item)
        .filter(
          (item) =>
            matches(`${item.code} ${item.name}`, options.query) &&
            matches(item.status, options.status)
        )
        .slice(0, clamp(options.limit, 80, 500));
      return {
        state: "available",
        summary: entry.summary ?? null,
        count: items.length,
        items
      };
    });
  const listObligations = (options = {}) =>
    listItems(
      "obligations",
      options,
      (item) =>
        matches(`${item.kind} ${item.title}`, options.query) &&
        matches(item.status, options.status),
      200
    );
  const listRequests = (options = {}) =>
    listItems(
      "requests",
      options,
      (item) =>
        matches(`${item.id} ${item.type}`, options.query) &&
        matches(item.status, options.status),
      200
    );
  const searchCampusDocuments = (options = {}) =>
    listItems(
      "documents",
      options,
      (item) =>
        matches(`${item.id} ${item.title} ${item.category}`, options.query) &&
        matches(item.category, options.category) &&
        matches(item.term, options.term),
      200
    );

  const getEnrollmentStatus = (options = {}) =>
    queryModule("enrollment", options, async (entry, snapshot) => {
      const calendar = snapshot.modules?.enrollment_calendar;
      const impediments = snapshot.modules?.enrollment_impediments;
      const allowed = snapshot.modules?.allowed_courses;
      const nextDates = (calendar?.state === "available" ? calendar.items ?? [] : [])
        .filter((item) => !options.term || !item.term || item.term === options.term)
        .sort((left, right) => Date.parse(left.start ?? "") - Date.parse(right.start ?? ""))
        .slice(0, 10);
      return {
        state: "available",
        value: {
          ...entry.value,
          activeWindow: activeEnrollment(snapshot),
          allowedCourseCount:
            allowed?.state === "available" ? (allowed.items ?? []).length : null,
          impedimentCount:
            impediments?.state === "available" ? (impediments.items ?? []).length : null,
          nextDates
        },
        alerts: [
          ...(entry.alerts ?? []),
          ...(impediments?.state === "available" && (impediments.items ?? []).length > 0
            ? ["Campus reports enrollment impediments; inspect get_enrollment_eligibility for details."]
            : [])
        ]
      };
    });

  async function getEnrollmentEligibility(options = {}) {
    const snapshot = await readSnapshot();
    const sourceKeys = [
      "enrollment",
      "enrollment_calendar",
      "enrollment_impediments",
      "allowed_courses",
      "enrollment_portal"
    ];
    const entries = Object.fromEntries(
      sourceKeys.map((key) => [key, snapshot.modules?.[key] ?? unavailable(key)])
    );
    const availableSources = sourceKeys.filter((key) => entries[key].state === "available");
    const generatedAt = availableSources
      .map((key) => entries[key].generatedAt ?? snapshot.generatedAt)
      .sort()[0] ?? snapshot.generatedAt;
    const ttlSeconds = Math.min(
      ...sourceKeys.map((key) => ttlFor(key, snapshot, activeEnrollment))
    );
    const refresh = Boolean(options.forceRefresh) || sourceKeys.some((key) =>
      shouldRefresh({
        forceRefresh: false,
        generatedAt: entries[key].generatedAt ?? snapshot.generatedAt,
        now: now(),
        ttlSeconds: ttlFor(key, snapshot, activeEnrollment)
      })
    );
    const job = refresh
      ? startSync({ reason: options.forceRefresh ? "forced" : "stale" })
      : null;
    const enrollment = entries.enrollment;
    const calendar = entries.enrollment_calendar;
    const impediments = entries.enrollment_impediments;
    const allowed = entries.allowed_courses;
    const portal = entries.enrollment_portal;
    const calendarItems = (calendar.state === "available" ? calendar.items ?? [] : [])
      .sort((left, right) => Date.parse(left.start ?? "") - Date.parse(right.start ?? ""))
      .slice(0, 20);
    const impedimentItems = impediments.state === "available"
      ? impediments.items ?? []
      : [];
    const complete = sourceKeys.every((key) => entries[key].state === "available");
    const data = {
      state: availableSources.length > 0 ? "available" : "unavailable",
      activeTerm: enrollment.value?.term ?? enrollmentTerm({}, snapshot) ?? null,
      value: {
        ...(enrollment.state === "available" && enrollment.value
          ? enrollment.value
          : {}),
        eligibilityState: complete ? "complete" : availableSources.length > 0 ? "partial" : "unavailable",
        eligibilityReason: enrollment.state === "available"
          ? null
          : enrollment.reason ?? "not_visible",
        activeWindow: activeEnrollment(snapshot),
        portalState: portal.state,
        allowedCourseCount: allowed.state === "available" ? (allowed.items ?? []).length : null,
        impedimentCount: impediments.state === "available" ? impedimentItems.length : null
      },
      calendar: {
        state: calendar.state,
        ...(calendar.reason ? { reason: calendar.reason } : {}),
        generatedAt: calendar.generatedAt ?? null,
        count: calendarItems.length,
        items: calendarItems
      },
      impediments: {
        state: impediments.state,
        ...(impediments.reason ? { reason: impediments.reason } : {}),
        generatedAt: impediments.generatedAt ?? null,
        count: impedimentItems.length,
        items: impedimentItems
      },
      allowedCourses: {
        state: allowed.state,
        ...(allowed.reason ? { reason: allowed.reason } : {}),
        generatedAt: allowed.generatedAt ?? null,
        count: allowed.state === "available" ? (allowed.items ?? []).length : 0
      },
      portal: {
        state: portal.state,
        ...(portal.reason ? { reason: portal.reason } : {}),
        generatedAt: portal.generatedAt ?? null
      },
      sourceStates: Object.fromEntries(
        sourceKeys.map((key) => [key, {
          state: entries[key].state,
          ...(entries[key].reason ? { reason: entries[key].reason } : {}),
          generatedAt: entries[key].generatedAt ?? null
        }])
      ),
      sourcesUsed: availableSources,
      alerts: [
        ...(enrollment.alerts ?? []),
        ...(impedimentItems.length > 0
          ? ["Campus reports enrollment impediments in this response."]
          : [])
      ]
    };
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      snapshot,
      generatedAt,
      data,
      ttlSeconds,
      job
        ? ["Cached enrollment eligibility was returned while Campus refreshes its component modules."]
        : []
    );
  }

  const getEnrollmentCalendar = (options = {}) =>
    listItems(
      "enrollment_calendar",
      options,
      (item) => !options.term || !item.term || item.term === options.term,
      200
    );

  const getEnrollmentImpediments = (options = {}) =>
    listItems(
      "enrollment_impediments",
      options,
      (item) => !options.term || !item.term || item.term === options.term,
      200
    );

  const listAllowedCourses = (options = {}) =>
    listItems(
      "allowed_courses",
      options,
      (item) => !options.term || !item.term || item.term === options.term,
      500
    );

  async function getStudentSchedule(options = {}) {
    const snapshot = await readSnapshot();
    const entry = snapshot.modules?.student_schedule ?? unavailable("student_schedule");
    if (entry.state !== "available") {
      return queryModule("student_schedule", options, async () => ({}));
    }
    const term = entry.term || enrollmentTerm(options, snapshot);
    const baseItems = entry.items ?? [];
    const courseCodes = [...new Set(baseItems.map(({ courseCode }) =>
      String(courseCode ?? "").trim().toUpperCase()
    ).filter(Boolean))].sort();
    const cache = await readScheduleCache();
    const offerings = enrichScheduleItemsWithAgenda(
      matchingScheduleItems(cache, { term, courseCodes }),
      snapshot
    );
    const attempted = new Set(cache.entries
      .filter(({ query }) => query?.mode !== "historical" && (!term || query.term === term || query.term === "active"))
      .flatMap(({ query }) => query?.courseCodes ?? [])
      .map((code) => String(code).toUpperCase()));
    const missingCourses = courseCodes.filter((courseCode) => !attempted.has(courseCode));
    const staleCourses = courseCodes.filter((courseCode) => {
      const latest = cache.entries
        .filter(({ query }) => query?.mode !== "historical" && (query.courseCodes ?? [])
          .some((code) => String(code).toUpperCase() === courseCode))
        .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)))[0];
      return latest && shouldRefresh({
        forceRefresh: Boolean(options.forceRefresh),
        generatedAt: latest.generatedAt,
        now: now(),
        ttlSeconds: scheduleTtl(snapshot)
      });
    });
    const refreshCodes = [...new Set([...missingCourses, ...staleCourses])];
    const scheduleJob = refreshCodes.length > 0
      ? startScheduleSearch(scheduleQuery({ courseCodes: refreshCodes }, snapshot, { scheduleCache: cache }), {
          preferRegistrationPortal: registrationPortalExpected(snapshot)
        })
      : null;
    if (scheduleJob) await waitForJobDispatch(scheduleJob);

    const { items, courseDetails: details } = buildCanonicalStudentSchedule(
      baseItems,
      offerings
    );
    const missingExamDetails = details.flatMap((detail) =>
      detail.sessions
        .filter((session) => searchableText(session.kind).includes("exam"))
        .filter((session) => !(session.date ?? session.beginDate) || !session.examType)
        .map((session) => ({
          courseCode: detail.courseCode,
          scheduleId: session.scheduleId ?? detail.scheduleIds?.[0] ?? "",
          day: session.day ?? "",
          start: session.start ?? "",
          end: session.end ?? "",
          missing: [
            ...((session.date ?? session.beginDate) ? [] : ["date"]),
            ...(session.examType ? [] : ["examType"])
          ]
        }))
    );
    let agendaJob = null;
    if (
      !scheduleJob &&
      missingExamDetails.length > 0 &&
      typeof academicCalendarContext === "function"
    ) {
      let context = await academicCalendarContext({ ...(term ? { term } : {}) });
      if (["calendar_ambiguous", "scope_required"].includes(context?.state) && courseCodes[0]) {
        context = await academicCalendarContext({
          ...(term ? { term } : {}),
          course: courseCodes[0]
        });
      }
      const fullRange = agendaRange({
        range: { start: context?.startDate, end: context?.endDate }
      });
      const covered = fullRange && agendaRanges(snapshot.modules?.agenda).some((range) =>
        range.start <= fullRange.start && range.end >= fullRange.end
      );
      if (fullRange && !covered) {
        agendaJob = startSync({
          reason: "schedule_exam_enrichment",
          start: fullRange.start,
          end: fullRange.end,
          moduleScope: "agenda"
        });
        await waitForJobDispatch(agendaJob);
      }
    }
    const refreshJob = scheduleJob ?? agendaJob;
    const pending = missingCourses.length > 0 || Boolean(agendaJob);
    const temporalCompleteness = missingExamDetails.length === 0
      ? "complete"
      : agendaJob ? "pending" : "partial";
    const answerReady = !pending && missingExamDetails.length === 0;
    return envelope(
      snapshot,
      entry.generatedAt ?? snapshot.generatedAt,
      {
        state: pending ? "pending_enrichment" : answerReady ? "available" : "available_partial",
        weeklyPatternReady: true,
        answerReady,
        activeTerm: term ?? null,
        source: "student_schedule_page",
        sourcesUsed: offerings.length > 0
          ? ["student_schedule_page", "schedule_catalog"]
          : ["student_schedule_page"],
        count: items.length,
        items,
        courseDetails: details,
        temporalCompleteness,
        ...(missingExamDetails.length > 0 ? { missingExamDetails } : {}),
        ...(missingCourses.length > 0 ? { missingCourses } : {}),
        ...(refreshJob ? { refreshJobId: refreshJob.jobId } : {})
      },
      scheduleTtl(snapshot),
      pending
        ? [agendaJob
            ? "The personal weekly pattern is available, but the full academic-term agenda is being refreshed to date its published exams. Query get_campus_job_status, then call get_student_schedule again before presenting exam dates."
            : "The personal schedule is authoritative, but course details are being fetched in one batch. Query get_campus_job_status, then call get_student_schedule again before answering with professors, rooms, practices or exams."]
        : missingExamDetails.length > 0
          ? ["Campus publishes the listed exam slots without enough date/type evidence. The weekly schedule is usable, but those exam details remain explicitly partial."]
        : details.some(({ missingFields }) => missingFields.length > 0)
          ? ["The personal schedule remains authoritative; only the listed catalog detail fields are unavailable."]
          : []
    );
  }

  async function readLiveRegistrationWorkspace(filters = {}) {
    const snapshot = filters.snapshot ?? await readSnapshot({ optional: true });
    const guarded = await registrationProbeGuard(snapshot, {
      forceProbe: filters.forceProbe === true
    });
    if (guarded) return guarded;
    if (typeof adapter.readRegistrationWorkspace !== "function") {
      throw new McpToolError(
        "registration_portal_unavailable",
        "The Campus adapter does not support the live Inscríbete aquí workspace"
      );
    }
    let workspace;
    try {
      workspace = await adapter.readRegistrationWorkspace({
        metadataOnly: true, allowDownloads: false, allowMutations: false,
        courseCodes: filters.courseCodes ?? [], courseName: filters.courseName ?? "",
        academicScope: filters.academicScope ?? null
      });
    } catch (error) {
      const code = String(error?.code ?? "").toLowerCase();
      if (["registration_portal_not_visible", "role_unavailable", "not_visible"].includes(code)) {
        return { state: "unavailable", reason: code, enrollmentMode: "closed_or_unavailable",
          activeTerm: null, registered: [], scopes: { faculties: [], specialties: [] }, retrievedAt: now() };
      }
      throw error;
    }
    if (workspace?.state !== "available" || !workspace.activeTerm) {
      return { state: "unavailable", reason: workspace?.reason ?? "registration_portal_unavailable",
        enrollmentMode: "closed_or_unavailable", activeTerm: null, registered: [],
        scopes: { faculties: [], specialties: [] }, retrievedAt: workspace?.retrievedAt ?? now() };
    }
    return {
      ...workspace,
      enrollmentMode: workspace.enrollmentMode ?? "regular"
    };
  }

  function enrollmentModeWarnings(workspace) {
    return workspace.enrollmentMode === "extemporaneous"
      ? ["Matrícula extemporánea is available in read-only compatibility mode; registration writes remain disabled until its live form is verified."]
      : workspace.enrollmentMode === "unknown"
        ? ["The active enrollment mode is unknown; only read-only schedule fallbacks are safe."]
        : [];
  }

  async function getRegistrationPortalStatus() {
    const snapshot = await readSnapshot();
    const workspace = await readLiveRegistrationWorkspace();
    return envelope(
      { ...snapshot, retrievedAt: workspace.retrievedAt ?? now() },
      workspace.retrievedAt ?? now(),
      {
        state: workspace.state,
        reason: workspace.reason ?? null,
        enrollmentMode: workspace.enrollmentMode,
        activeTerm: workspace.activeTerm,
        turn: workspace.turn ?? null,
        summary: workspace.summary ?? {},
        source: "enrollment_portal",
        sourcesUsed: ["enrollment_portal"]
      },
      5 * 60,
      enrollmentModeWarnings(workspace)
    );
  }

  async function getRegistrationStatus(options = {}) {
    const snapshot = await readSnapshot();
    const workspace = await readLiveRegistrationWorkspace({
      snapshot,
      forceProbe: options.forceProbe === true
    });
    const source = workspace.source ?? "enrollment_portal";
    return envelope(
      { ...snapshot, retrievedAt: workspace.retrievedAt ?? now() },
      workspace.retrievedAt ?? now(),
      {
        state: workspace.state,
        portalState: workspace.state,
        reason: workspace.reason ?? null,
        enrollmentMode: workspace.enrollmentMode,
        activeTerm: workspace.activeTerm,
        turn: workspace.turn ?? null,
        summary: workspace.summary ?? {},
        registered: (workspace.registered ?? []).map(publicRegistrationItem),
        fallbackTools: workspace.state === "available" ? [] : (workspace.fallbackTools ?? ["list_enrolled_courses", "get_student_schedule", "search_course_schedules"]),
        source,
        sourcesUsed: workspace.sourcesUsed ?? [source],
        ...(workspace.academicContext ? { academicContext: workspace.academicContext } : {})
      },
      workspace.ttlSeconds ?? 5 * 60,
      [...(workspace.warnings ?? []), ...enrollmentModeWarnings(workspace)]
    );
  }

  async function listScheduleScopes() {
    const snapshot = await readSnapshot();
    const workspace = await readLiveRegistrationWorkspace();
    const facultyNames = new Map(
      (workspace.scopes?.faculties ?? []).map((item) => [String(item.code), item.label])
    );
    return envelope(
      { ...snapshot, retrievedAt: workspace.retrievedAt ?? now() },
      workspace.retrievedAt ?? now(),
      {
        state: workspace.state,
        reason: workspace.reason ?? null,
        enrollmentMode: workspace.enrollmentMode,
        activeTerm: workspace.activeTerm,
        faculties: (workspace.scopes?.faculties ?? []).map((item) => ({
          academicUnit: item.label
        })),
        specialties: (workspace.scopes?.specialties ?? []).map((item) => ({
          academicUnit: facultyNames.get(String(item.academicUnitCode)) ?? "",
          specialty: item.label
        })),
        source: "enrollment_portal",
        sourcesUsed: ["enrollment_portal"]
      },
      12 * 60 * 60
    );
  }

  function requestedRegistrationSelections(values = []) {
    return values.map((item) => ({
      courseCode: String(item.courseCode ?? "").trim().toUpperCase(),
      scheduleId: normalizeScheduleId(item.scheduleId),
      scheduleType: String(item.scheduleType ?? "").trim().toLowerCase()
    }));
  }

  function findRegistrationItem(items, selection, operation) {
    let candidates = (items ?? []).filter((item) =>
      String(item.courseCode).toUpperCase() === selection.courseCode &&
      String(item.scheduleId) === selection.scheduleId &&
      (!selection.scheduleType || String(item.scheduleType).toLowerCase() === selection.scheduleType)
    );
    if (candidates.length > 1 && !selection.scheduleType) {
      const classes = candidates.filter(({ scheduleType }) => scheduleType === "class");
      if (classes.length === 1) candidates = classes;
    }
    if (candidates.length !== 1 || !candidates[0].internalSelectionRef) {
      throw new McpToolError(
        "registration_selection_not_found",
        `Campus ${operation} selection was not found: ${selection.courseCode}/${selection.scheduleId}`,
        { details: { operation, ...selection } }
      );
    }
    return candidates[0];
  }

  function registrationItemIdentity(item) {
    return [
      String(item?.courseCode ?? "").toUpperCase(),
      String(item?.scheduleType ?? "").toLowerCase(),
      String(item?.scheduleId ?? ""),
      String(item?.internalSelectionRef ?? "")
    ].join("|");
  }

  function expandRegistrationGroup(items, seeds) {
    const selected = new Map(seeds.map((item) => [registrationItemIdentity(item), item]));
    const queue = [...seeds];
    while (queue.length > 0) {
      const item = queue.shift();
      const associated = new Set((item.associatedScheduleIds ?? []).map(String));
      for (const candidate of items ?? []) {
        const candidateIdentity = registrationItemIdentity(candidate);
        if (
          String(candidate.courseCode).toUpperCase() !== String(item.courseCode).toUpperCase() ||
          selected.has(candidateIdentity)
        ) continue;
        const reverse = new Set((candidate.associatedScheduleIds ?? []).map(String));
        if (
          String(candidate.scheduleId) === String(item.scheduleId) ||
          associated.has(String(candidate.scheduleId)) ||
          reverse.has(String(item.scheduleId))
        ) {
          selected.set(candidateIdentity, candidate);
          queue.push(candidate);
        }
      }
    }
    return [...selected.values()];
  }

  async function prepareCourseRegistration(options = {}) {
    const snapshot = await readSnapshot();
    const add = requestedRegistrationSelections(options.add ?? []);
    const remove = requestedRegistrationSelections(options.remove ?? []);
    if (add.length + remove.length === 0) {
      throw new McpToolError(
        "registration_change_required",
        "Provide at least one course schedule to add or remove"
      );
    }
    const workspace = await readLiveRegistrationWorkspace({
      courseCodes: add.map(({ courseCode }) => courseCode)
    });
    if (workspace.state !== "available") throw new McpToolError("registration_portal_unavailable", "Registration is closed or unavailable");
    if (workspace.enrollmentMode !== "regular") {
      throw new McpToolError(
        "registration_write_unverified_mode",
        "Registration writes are disabled outside the verified regular enrollment view"
      );
    }
    const addItems = expandRegistrationGroup(
      workspace.offerings,
      add.map((selection) => findRegistrationItem(workspace.offerings, selection, "add"))
    );
    const removeItems = expandRegistrationGroup(
      workspace.registered,
      remove.map((selection) => findRegistrationItem(workspace.registered, selection, "remove"))
    );
    const removeItemIdentities = new Set(removeItems.map(registrationItemIdentity));
    const finalItems = [
      ...(workspace.registered ?? []).filter((item) =>
        !removeItemIdentities.has(registrationItemIdentity(item))
      ),
      ...addItems
    ];
    const validationSelections = [...new Map(finalItems.map((item) => [
      String(item.courseCode).toUpperCase(),
      { courseCode: item.courseCode, scheduleId: item.scheduleId }
    ])).values()];
    const analysis = evaluateScheduleLocally({
      offerings: finalItems,
      selections: validationSelections
    });
    if (analysis.conflicts.length > 0) {
      throw new McpToolError(
        "registration_schedule_conflict",
        "The proposed registration contains schedule conflicts",
        { details: { conflicts: analysis.conflicts } }
      );
    }
    pruneRegistrationTokens();
    const confirmationToken = randomUUID();
    const issuedAt = now();
    const expiresAt = new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString();
    const addRefs = addItems.map(({ internalSelectionRef }) => internalSelectionRef);
    const removedRefs = [...new Set(
      removeItems.map(({ internalSelectionRef }) => internalSelectionRef).filter(Boolean)
    )];
    const targetRefs = [...addRefs, ...removedRefs];
    registrationTokens.set(confirmationToken, {
      confirmationToken,
      issuedAt,
      expiresAt,
      used: false,
      activeTerm: workspace.activeTerm,
      addRefs,
      removeRefs: removedRefs,
      addCourseCodes: add.map(({ courseCode }) => courseCode),
      fingerprint: registrationFingerprint(workspace, targetRefs)
    });
    return envelope(
      { ...snapshot, retrievedAt: workspace.retrievedAt ?? issuedAt },
      workspace.retrievedAt ?? issuedAt,
      {
        state: "prepared",
        confirmationRequired: true,
        confirmationToken,
        expiresAt,
        activeTerm: workspace.activeTerm,
        before: (workspace.registered ?? []).map(publicRegistrationItem),
        add: addItems.map(publicRegistrationItem),
        remove: removeItems.map(publicRegistrationItem),
        after: finalItems.map(publicRegistrationItem),
        warnings: analysis.hardConstraintViolations ?? [],
        confirmationPrompt: "Confirma explícitamente este cambio exacto antes de llamar commit_course_registration."
      },
      0
    );
  }

  async function commitCourseRegistration(options = {}) {
    const snapshot = await readSnapshot();
    pruneRegistrationTokens();
    const token = registrationTokens.get(String(options.confirmationToken ?? ""));
    if (!token || token.used) {
      throw new McpToolError(
        "confirmation_token_invalid",
        "The registration confirmation token is invalid, expired, or used"
      );
    }
    token.used = true;
    registrationTokens.delete(token.confirmationToken);
    if (options.confirmed !== true) {
      throw new McpToolError(
        "registration_confirmation_required",
        "The registration token was consumed because the change was not explicitly confirmed"
      );
    }
    const workspace = await readLiveRegistrationWorkspace({
      courseCodes: token.addCourseCodes
    });
    if (workspace.state !== "available") throw new McpToolError("registration_portal_unavailable", "Registration is closed or unavailable");
    if (workspace.enrollmentMode !== "regular") {
      throw new McpToolError(
        "registration_write_unverified_mode",
        "The enrollment mode changed and is not verified for registration writes"
      );
    }
    const targetRefs = [...token.addRefs, ...token.removeRefs];
    if (
      workspace.activeTerm !== token.activeTerm ||
      registrationFingerprint(workspace, targetRefs) !== token.fingerprint
    ) {
      throw new McpToolError(
        "registration_state_changed",
        "The live Campus registration state changed; prepare and confirm a new preview"
      );
    }
    if (typeof adapter.commitCourseRegistration !== "function") {
      throw new McpToolError(
        "registration_write_unavailable",
        "The Campus adapter does not support confirmed registration writes"
      );
    }
    let result;
    try {
      result = await adapter.commitCourseRegistration({
        activeTerm: token.activeTerm,
        addRefs: token.addRefs,
        removeRefs: token.removeRefs,
        addCourseCodes: token.addCourseCodes,
        allowMutations: true,
        confirmationToken: token.confirmationToken
      });
    } catch (error) {
      if (["network_error", "transient_error"].includes(String(error?.code ?? "").toLowerCase())) {
        throw new McpToolError(
          "registration_reconciliation_required",
          "Campus may have received the write but its result is unknown; inspect get_registration_status and do not retry automatically"
        );
      }
      throw error;
    }
    const finalWorkspace = result?.state === "available"
      ? result
      : await readLiveRegistrationWorkspace();
    await invalidateCurrentScheduleCache();
    return envelope(
      { ...snapshot, retrievedAt: finalWorkspace.retrievedAt ?? now() },
      finalWorkspace.retrievedAt ?? now(),
      {
        state: "committed",
        activeTerm: finalWorkspace.activeTerm,
        registered: (finalWorkspace.registered ?? []).map(publicRegistrationItem),
        source: "enrollment_portal",
        sourcesUsed: ["enrollment_portal"]
      },
      0
    );
  }

  async function searchCourseSchedules(options = {}) {
    const snapshot = await readSnapshot();
    const cache = await readScheduleCache();
    const query = scheduleQuery(options, snapshot, { scheduleCache: cache });
    const cached = newestScheduleEntry(cache, query);
    const ttlSeconds = scheduleTtl(snapshot);
    const stale =
      !cached ||
      shouldRefresh({
        forceRefresh: Boolean(options.forceRefresh),
        generatedAt: cached.generatedAt,
        now: now(),
        ttlSeconds
      });
    const registrationGuard = await registrationProbeGuard(snapshot);
    const preferRegistrationPortal = !registrationGuard && registrationPortalExpected(snapshot);
    const job = stale
      ? startScheduleSearch(query, { preferRegistrationPortal })
      : null;
    if (job) await waitForJobDispatch(job);
    if (!cached) {
      return envelope(
        snapshot,
        snapshot.generatedAt,
        { state: "pending", jobId: job.jobId, query },
        ttlSeconds,
        [preferRegistrationPortal
          ? "Current schedules are being fetched from the Campus registration view; query get_campus_job_status with jobId."
          : "Current schedules are being fetched from the PUCP schedule catalog because the published registration window ended; query get_campus_job_status with jobId."]
      );
    }
    const page = clamp(options.page, 1, 1000);
    const pageSize = clamp(options.pageSize, 100, 500);
    const start = (page - 1) * pageSize;
    const enrichedItems = enrichScheduleItemsWithAgenda(cached.items, snapshot);
    const data = {
      state: cached.state ?? "available",
      query,
      activeTerm: cached.activeTerm ?? query.term,
      enrollmentMode: cached.enrollmentMode ?? null,
      source: cached.source ?? "enrollment_portal",
      sourcesUsed: cached.sourcesUsed ?? [cached.source ?? "enrollment_portal"],
      differences: cached.differences ?? [],
      page,
      pageSize,
      total: enrichedItems.length,
      items: enrichedItems.slice(start, start + pageSize)
    };
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      { ...snapshot, retrievedAt: cached.retrievedAt },
      cached.generatedAt,
      data,
      ttlSeconds,
      [
        ...(cached.warnings ?? []),
        ...(job ? ["Cached schedules were returned while Campus refreshes this exact query."] : [])
      ]
    );
  }

  async function searchHistoricalCourseSchedules(options = {}) {
    const snapshot = await readSnapshot();
    const query = scheduleQuery(options, snapshot, { historical: true });
    const cache = await readScheduleCache();
    const cached = newestScheduleEntry(cache, query);
    const ttlSeconds = 30 * 60;
    const stale = !cached || shouldRefresh({
      forceRefresh: Boolean(options.forceRefresh),
      generatedAt: cached.generatedAt,
      now: now(),
      ttlSeconds
    });
    const job = stale ? startScheduleSearch(query) : null;
    if (job) await waitForJobDispatch(job);
    if (!cached) {
      return envelope(
        snapshot,
        snapshot.generatedAt,
        { state: "pending", jobId: job.jobId, query, source: "schedule_catalog", sourcesUsed: ["schedule_catalog"] },
        ttlSeconds,
        ["Historical schedules are being fetched from the shared PUCP schedule catalog."]
      );
    }
    const page = clamp(options.page, 1, 1000);
    const pageSize = clamp(options.pageSize, 100, 500);
    const start = (page - 1) * pageSize;
    const enrichedItems = enrichScheduleItemsWithAgenda(cached.items, snapshot);
    const data = {
      state: cached.state ?? "available",
      query,
      source: "schedule_catalog",
      sourcesUsed: ["schedule_catalog"],
      page,
      pageSize,
      total: enrichedItems.length,
      items: enrichedItems.slice(start, start + pageSize)
    };
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      { ...snapshot, retrievedAt: cached.retrievedAt },
      cached.generatedAt,
      data,
      ttlSeconds,
      [
        ...(cached.warnings ?? []),
        ...(job ? ["Cached historical schedules were returned while the schedule catalog refreshes."] : [])
      ]
    );
  }

  async function scheduleLookup(options, select) {
    const snapshot = await readSnapshot();
    const cache = await readScheduleCache();
    const term = enrollmentTerm(options, snapshot, { scheduleCache: cache });
    const cachedItems = matchingScheduleItems(cache, {
      term,
      course: options.course,
      schedule: options.schedule
    });
    const newest = cache.entries
      .filter((entry) => (entry.items ?? []).some((item) => cachedItems.includes(item)))
      .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)))[0] ?? null;
    const items = enrichScheduleItemsWithAgenda(cachedItems, snapshot);
    const query = scheduleQuery({ courseCodes: [options.course] }, snapshot, { scheduleCache: cache });
    const stale =
      items.length === 0 ||
      shouldRefresh({
        forceRefresh: Boolean(options.forceRefresh),
        generatedAt: newest?.generatedAt,
        now: now(),
        ttlSeconds: scheduleTtl(snapshot)
      });
    const job = stale
      ? startScheduleSearch(query, {
          preferRegistrationPortal: registrationPortalExpected(snapshot)
        })
      : null;
    if (job) await waitForJobDispatch(job);
    if (items.length === 0) {
      return envelope(
        snapshot,
        snapshot.generatedAt,
        { state: "pending", jobId: job.jobId, query },
        scheduleTtl(snapshot),
        ["The requested course schedule is not cached and is being fetched from Campus."]
      );
    }
    const data = await select(items, snapshot);
    if (job) data.refreshJobId = job.jobId;
    return envelope(
      { ...snapshot, retrievedAt: newest?.retrievedAt ?? snapshot.retrievedAt },
      newest?.generatedAt ?? snapshot.generatedAt,
      data,
      scheduleTtl(snapshot),
      [
        ...(newest?.warnings ?? []),
        ...(job ? ["Cached course schedule data was returned while this course refreshes."] : [])
      ]
    );
  }

  async function getCourseScheduleDetails(options) {
    options = {
      ...options,
      ...(options.schedule ? { schedule: normalizeScheduleId(options.schedule) } : {})
    };
    const snapshot = await readSnapshot();
    let liveOfferings = [];
    let liveWarning = "";
    if (registrationPortalExpected(snapshot)) {
      try {
        const workspace = await readLiveRegistrationWorkspace({
          courseCodes: [options.course]
        });
        const requestedTerm = options.term || enrollmentTerm(options, snapshot);
        if (!options.term || requestedTerm === workspace.activeTerm) {
          liveOfferings = (workspace.offerings ?? []).filter((item) =>
            String(item.courseCode).toUpperCase() === String(options.course).toUpperCase()
          );
        }
      } catch {
        liveWarning = "Live enrollment capacity is unavailable; cached schedule evidence was returned.";
      }
    }
    const result = await scheduleLookup(options, async (items) => {
      const enrich = (item) => {
        const live = liveOfferings.find((candidate) =>
          String(candidate.scheduleId) === String(item.scheduleId) &&
          (
            !candidate.scheduleType ||
            !item.scheduleType ||
            candidate.scheduleType === item.scheduleType
          )
        );
        const capacity = live?.capacity ?? item.capacity ?? null;
        return {
          ...item,
          capacity,
          risk: assessEnrollmentRisk({
            ...(capacity ?? {}),
            retrievedAt: live?.retrievedAt ?? item.retrievedAt ?? null
          })
        };
      };
      const enriched = items.map(enrich);
      return {
        state: "available",
        count: enriched.length,
        items: enriched,
        item: enriched[0],
        linkedItems: enriched.slice(1)
      };
    });
    return liveWarning
      ? { ...result, warnings: [...result.warnings, liveWarning] }
      : result;
  }

  async function getCourseEnrollmentStatistics(options) {
    let liveWarning = "";
    try {
      const snapshot = await readSnapshot();
      const workspace = await readLiveRegistrationWorkspace({
        courseCodes: [options.course]
      });
      const activeTerm = workspace.activeTerm;
      const requestedTerm = options.term || enrollmentTerm(options, snapshot);
      if (!options.term || requestedTerm === activeTerm) {
        const items = (workspace.offerings ?? []).filter((item) =>
          String(item.courseCode).toUpperCase() === String(options.course).toUpperCase() &&
          (!options.schedule || String(item.scheduleId) === String(options.schedule))
        );
        if (items.length > 0) {
          const retrievedAt = workspace.retrievedAt ?? now();
          return envelope(
            { ...snapshot, retrievedAt },
            retrievedAt,
            {
              state: "available",
              count: items.length,
              items: items.map((item) => ({
                courseCode: item.courseCode,
                scheduleId: item.scheduleId,
                capacity: item.capacity ?? null,
                risk: assessEnrollmentRisk({
                  ...(item.capacity ?? {}),
                  retrievedAt: item.retrievedAt ?? retrievedAt
                })
              }))
            },
            5 * 60,
            enrollmentModeWarnings(workspace)
          );
        }
      }
    } catch {
      liveWarning = "Live personal position is unavailable; cached schedule capacity was returned.";
    }
    const cached = await scheduleLookup(options, async (items) => ({
      state: "available",
      count: items.length,
      items: items.map((item) => ({
        courseCode: item.courseCode,
        scheduleId: item.scheduleId,
        capacity: item.capacity ?? null,
        risk: assessEnrollmentRisk({
          ...(item.capacity ?? {}),
          retrievedAt: item.retrievedAt ?? null
        })
      }))
    }));
    return liveWarning
      ? { ...cached, warnings: [...cached.warnings, liveWarning] }
      : cached;
  }

  const listCrossUnitVacancies = (options = {}) =>
    listItems(
      "cross_unit_vacancies",
      options,
      (item) =>
        (!options.term || !item.term || item.term === options.term) &&
        (!options.course || matches(`${item.courseCode} ${item.courseName}`, options.course)) &&
        (!options.academicUnit || matches(item.academicUnit, options.academicUnit)),
      500
    );

  async function getSchedulePreferences() {
    const snapshot = await readSnapshot();
    const local = await readJsonCache(preferencesPath, { fallback: {} });
    const effective = mergeSchedulePreferences(local, {});
    return envelope(
      snapshot,
      snapshot.generatedAt,
      { defaults: DEFAULT_SCHEDULE_PREFERENCES, local, effective },
      TTL_SECONDS.materialAdmin
    );
  }

  async function localScheduleContext(options, operation) {
    const snapshot = await readSnapshot();
    const courseCodes = options.courseCodes ?? options.selections?.map(({ courseCode }) => courseCode) ?? [];
    const cache = await readScheduleCache();
    const term = enrollmentTerm(options, snapshot, { scheduleCache: cache });
    const offerings = enrichScheduleItemsWithAgenda(
      matchingScheduleItems(cache, { term, courseCodes }),
      snapshot
    );
    const normalizedCodes = [...new Set(courseCodes.map((code) => String(code).toUpperCase()))];
    const present = new Set(offerings.map(({ courseCode }) => String(courseCode).toUpperCase()));
    const missing = normalizedCodes
      .filter((code) => !present.has(code));
    const evidence = normalizedCodes.map(courseCode => ({
      courseCode,
      entry: cache.entries.filter(entry => entry.query?.mode !== "historical" &&
        (entry.items ?? []).some(item => String(item.courseCode).toUpperCase() === courseCode &&
          (!term || term === "active" || !item.term || item.term === term)))
        .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)))[0] ?? null
    }));
    const staleCodes = evidence.filter(({ entry }) => entry && shouldRefresh({
      forceRefresh: Boolean(options.forceRefresh), generatedAt: entry.generatedAt,
      now: now(), ttlSeconds: scheduleTtl(snapshot)
    })).map(({ courseCode }) => courseCode);
    const refreshCodes = [...new Set([...missing, ...staleCodes])];
    const job = refreshCodes.length > 0
      ? startScheduleSearch(
          scheduleQuery({ courseCodes: refreshCodes }, snapshot, { scheduleCache: cache }),
          { preferRegistrationPortal: registrationPortalExpected(snapshot) }
        )
      : null;
    if (job) await waitForJobDispatch(job);
    if (missing.length > 0) {
      const query = scheduleQuery({ courseCodes: missing }, snapshot, { scheduleCache: cache });
      return envelope(
        snapshot,
        snapshot.generatedAt,
        { state: "pending", jobId: job.jobId, missingCourses: missing, query },
        scheduleTtl(snapshot),
        ["Missing course schedules are being fetched before local evaluation."]
      );
    }
    const local = await readJsonCache(preferencesPath, { fallback: {} });
    const data = await operation({ offerings, local, term, snapshot });
    data.evidence = evidence.map(({ courseCode, entry }) => ({
      courseCode, generatedAt: entry?.generatedAt ?? null, retrievedAt: entry?.retrievedAt ?? null,
      stale: !entry || staleCodes.includes(courseCode)
    }));
    if (job) data.refreshJobId = job.jobId;
    const availableEvidence = evidence.map(({ entry }) => entry).filter(Boolean)
      .sort((left, right) => String(left.generatedAt).localeCompare(String(right.generatedAt)));
    const oldest = availableEvidence[0];
    return envelope(
      { ...snapshot, retrievedAt: oldest?.retrievedAt ?? snapshot.retrievedAt },
      oldest?.generatedAt ?? snapshot.generatedAt,
      data,
      scheduleTtl(snapshot),
      job ? ["Cached schedules were used while the complete requested course batch refreshes."] : []
    );
  }

  const recommendCourseSchedules = (options) =>
    localScheduleContext(options, async ({ offerings, local }) =>
      recommendSchedulesLocally({
        courseCodes: options.courseCodes,
        offerings,
        localPreferences: local,
        preferences: options.preferences ?? {},
        maxResults: options.maxResults ?? 5,
        retrievedAt: now()
      })
    );

  const evaluateCourseSchedule = (options) =>
    localScheduleContext(options, async ({ offerings, local }) =>
      evaluateScheduleLocally({
        offerings,
        selections: options.selections,
        preferences: mergeSchedulePreferences(local, options.preferences ?? {})
      })
    );

  async function listEnrollmentPortalSections(options = {}) {
    return queryModule("enrollment_portal", options, async (entry) => ({
      state: "available",
      sections: entry.value?.sections ?? []
    }));
  }

  async function getEnrollmentPortalSection(options) {
    return queryModule("enrollment_portal", options, async (entry) => {
      const section = (entry.value?.sections ?? []).find(({ key }) => key === options.section);
      if (!section) {
        return { state: "unavailable", reason: "section_not_visible", section: options.section };
      }
      const visible = structuredClone(section);
      if (options.section === "student_data" && options.includeSensitive !== true && visible.data) {
        visible.data = { state: "redacted", reason: "includeSensitive_required" };
      }
      return { state: "available", section: visible };
    });
  }
  const getFinancialStatus = (options = {}) =>
    queryModule("financial", options, async (entry) => ({
      state: "available",
      value: entry.value
    }));
  const getFinalGradeStatistics = (options) =>
    getGradeStatistics("final", options);
  const getPartialGradeStatistics = (options) =>
    getGradeStatistics("partial", options);

  async function getCampusStatus() {
    pruneJobs();
    const snapshot = await readSnapshot({ optional: true });
    const timestamp = snapshot?.generatedAt ?? now();
    const modules = Object.fromEntries(
      Object.entries(snapshot?.modules ?? {})
        .filter(([key]) => PUBLIC_MODULE_KEYS.has(key))
        .map(([key, entry]) => [
        key,
        {
          state: entry.state ?? "unavailable",
          alerts: entry.alerts ?? []
        }
      ])
    );
    return createEnvelope({
      source: SOURCE,
      retrievedAt: snapshot?.retrievedAt ?? timestamp,
      generatedAt: timestamp,
      ttlSeconds: TTL_SECONDS.academic,
      now: now(),
      data: {
        cacheAvailable: Boolean(snapshot),
        generatedAt: snapshot?.generatedAt ?? null,
        activeJobId: activeSyncJobId || null,
        modules,
        jobs: [...jobs.values()].reduce((counts, job) => {
          counts[job.status] = (counts[job.status] ?? 0) + 1;
          return counts;
        }, {})
      },
      warnings: snapshot ? [] : ["No Campus Virtual cache is available."]
    });
  }

  async function syncCampusVirtual(options = {}) {
    const job = startSync(options);
    const timestamp = now();
    return createEnvelope({
      source: SOURCE,
      retrievedAt: timestamp,
      generatedAt: timestamp,
      ttlSeconds: TTL_SECONDS.academic,
      now: timestamp,
      data: { jobId: job.jobId, status: job.status },
      warnings: []
    });
  }

  async function getCampusJobStatus({ jobId }) {
    pruneJobs();
    const job = jobs.get(jobId);
    if (!job) {
      throw new McpToolError("job_not_found", "Campus Virtual job was not found", {
        details: { jobId }
      });
    }
    const timestamp = now();
    return createEnvelope({
      source: SOURCE,
      retrievedAt: timestamp,
      generatedAt: job.completedAt || job.startedAt || job.queuedAt,
      ttlSeconds: 0,
      now: timestamp,
      data: { ...job },
      warnings: []
    });
  }

  async function downloadCampusDocument(options) {
    const snapshot = await readSnapshot();
    const entry = snapshot.modules?.documents;
    if (entry?.state !== "available") {
      throw new McpToolError(
        "document_not_found",
        "Campus document metadata is unavailable"
      );
    }
    const document = findDocument(entry.items ?? [], options.document);
    if (!document.downloadable) {
      throw new McpToolError(
        "document_not_downloadable",
        "Cached Campus document is not downloadable"
      );
    }
    const existing = [...jobs.values()].find(
      (job) =>
        job.kind === "download" &&
        job.dedupeKey === document.id &&
        ["queued", "running"].includes(job.status)
    );
    if (existing) {
      const timestamp = now();
      return createEnvelope({
        source: SOURCE,
        retrievedAt: timestamp,
        generatedAt: timestamp,
        ttlSeconds: 0,
        now: timestamp,
        data: { jobId: existing.jobId, status: existing.status },
        warnings: []
      });
    }
    const activeDownloads = [...jobs.values()].filter(
      (job) =>
        job.kind === "download" && ["queued", "running"].includes(job.status)
    ).length;
    if (activeDownloads >= maxActiveDownloads) {
      throw new McpToolError(
        "download_limit_reached",
        "Campus Virtual download concurrency limit reached",
        { retryable: true }
      );
    }
    const job = startJob(
      "download",
      () =>
        adapter.downloadDocument({
          document,
          manifestPath
        }),
      { dedupeKey: document.id }
    );
    const timestamp = now();
    return createEnvelope({
      source: SOURCE,
      retrievedAt: timestamp,
      generatedAt: timestamp,
      ttlSeconds: 0,
      now: timestamp,
      data: { jobId: job.jobId, status: job.status },
      warnings: []
    });
  }

  async function listCampusChanges(options = {}) {
    const snapshot = await readSnapshot();
    const history = await readJsonCache(historyPath, { fallback: [] });
    const syncs = history
      .slice(-clamp(options.limit, 10, 50))
      .reverse()
      .map(normalizeHistoryEvent)
      .map((event) =>
        options.module
          ? {
              ...event,
              modules: {
                [options.module]: event.modules?.[options.module] ?? {
                  changed: false,
                  addedCount: 0,
                  removedCount: 0,
                  changedCount: 0,
                  added: [],
                  removed: [],
                  updated: []
                }
              }
            }
          : event
      );
    return envelope(
      snapshot,
      snapshot.generatedAt,
      { syncs },
      TTL_SECONDS.materialAdmin
    );
  }

  async function waitForIdle() {
    await Promise.allSettled([...jobPromises]);
  }

  async function close() {
    await waitForIdle();
    await adapter.close?.();
  }

  return {
    downloadCampusDocument,
    getAcademicHistory,
    getAcademicPerformance,
    getCampusAgenda,
    getCampusDay,
    getCampusJobStatus,
    getCampusStatus,
    getCurriculumProgress,
    getCourseEnrollmentStatistics,
    getCourseScheduleDetails,
    getEnrollmentEligibility,
    getEnrollmentCalendar,
    getEnrollmentImpediments,
    getEnrollmentPortalSection,
    getEnrollmentStatus,
    getFinancialStatus,
    getFinalGradeStatistics,
    getPartialGradeStatistics,
    getRegistrationPortalStatus,
    getRegistrationStatus,
    getSchedulePreferences,
    getStudentSchedule,
    evaluateCourseSchedule,
    listAllowedCourses,
    listCampusChanges,
    listCampusModules,
    listCrossUnitVacancies,
    listEnrolledCourses,
    listCourseParticipants,
    listEnrollmentPortalSections,
    listObligations,
    listOfficialGrades,
    listRequests,
    listScheduleScopes,
    prepareCourseRegistration,
    commitCourseRegistration,
    recommendCourseSchedules,
    searchCampusDocuments,
    searchCourseSchedules,
    searchHistoricalCourseSchedules,
    syncCampusVirtual,
    waitForIdle,
    close
  };
}
