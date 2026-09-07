import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  McpToolError,
  TTL_SECONDS,
  createEnvelope,
  readJsonCache,
  resolveCourse,
  resolveAllowedPath,
  shouldRefresh,
  writeJsonAtomic
} from "@pucp-academic-mcp/common";

import {
  courseDestination,
  validateDownloadDestination
} from "./downloads.js";
import { searchableText } from "./text.js";

const SOURCE = "paideia";
const EMPTY = Object.freeze({
  courses: [],
  activities: [],
  pendingItems: [],
  materials: [],
  activityDetails: {},
  announcements: {},
  grades: {}
});

const SYNC_COMPONENTS = Object.freeze([
  "catalog",
  "course_content",
  "activity_details",
  "announcements",
  "grades"
]);

const SYNC_SCOPES = Object.freeze({
  full: SYNC_COMPONENTS,
  catalog: ["catalog"],
  materials: ["catalog", "course_content"],
  activities: ["catalog", "course_content", "activity_details"],
  announcements: ["catalog", "course_content", "announcements"],
  grades: ["catalog", "grades"]
});

function clamp(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : fallback, maximum));
}

function sortText(items, selector) {
  return [...items].sort((left, right) =>
    selector(left).localeCompare(selector(right), "es", {
      numeric: true,
      sensitivity: "base"
    })
  );
}

function matches(value, query) {
  return !query || searchableText(value).includes(searchableText(query));
}

function belongsToCourse(snapshot, item, query) {
  return !query || String(item.courseId) === String(resolveCourse(snapshot.courses, query).id);
}

function syncComponents(options = {}) {
  const requested = Array.isArray(options.components)
    ? options.components
    : SYNC_SCOPES[options.scope ?? "full"];
  if (!requested) {
    throw new McpToolError("sync_scope_invalid", "Unknown Paideia synchronization scope");
  }
  const wanted = new Set(["catalog", ...requested]);
  return SYNC_COMPONENTS.filter((component) => wanted.has(component));
}

function safeJobError(error) {
  let normalizedCode =
    typeof error?.code === "string"
      ? error.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")
      : "";
  if (!normalizedCode && /timeout/i.test(String(error?.name ?? ""))) {
    normalizedCode = "timeout";
  }
  const knownCode = [
      "area_cooldown",
      "activity_detail_unavailable",
      "authentication_required",
      "download_failed",
      "download_limit_reached",
      "network_error",
      "path_not_allowed",
      "resource_not_downloadable",
      "resource_not_folder",
      "resource_too_large",
      "scrape_failed",
      "timeout",
      "transient_error",
      "unsupported_layout",
      "url_not_allowed"
    ].includes(normalizedCode);
  const publicCode = knownCode ? normalizedCode : "operation_failed";
  const messages = {
    area_cooldown: "An optional Paideia area is temporarily in cooldown",
    activity_detail_unavailable: "Paideia did not publish safe overview details for this activity",
    authentication_required: "Paideia authentication is required",
    download_failed: "The Paideia download failed",
    download_limit_reached: "The Paideia download concurrency limit was reached",
    network_error: "Paideia returned a network error",
    path_not_allowed: "The Paideia download path is not allowed",
    resource_not_downloadable: "The Paideia resource is not downloadable",
    resource_not_folder: "The selected Paideia activity is not a Moodle folder",
    resource_too_large: "The Paideia resource exceeds the configured size limit",
    scrape_failed: "The Paideia page could not be extracted safely",
    timeout: "The Paideia operation timed out",
    transient_error: "Paideia returned a transient error",
    unsupported_layout: "The Paideia page layout is not supported",
    url_not_allowed: "The Paideia URL is not allowed"
  };
  const result = {
    code: publicCode,
    message: messages[publicCode] ?? "The Paideia background operation failed",
    retryable: ["network_error", "operation_failed", "timeout", "transient_error"].includes(publicCode)
  };
  if (/^[a-z0-9_.-]{1,80}$/i.test(String(error?.stage ?? ""))) {
    result.stage = error.stage;
  }
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599) {
    result.httpStatus = error.httpStatus;
  }
  return result;
}

function summarizeJobResult(result) {
  if (!result || typeof result !== "object") return result;
  if (!Array.isArray(result.downloaded) && !Array.isArray(result.skipped)) {
    return result;
  }
  return {
    ...(result.destination ? { destination: result.destination } : {}),
    ...(Number.isFinite(result.matchedActivities)
      ? { matchedActivities: result.matchedActivities }
      : {}),
    downloadedCount: result.downloaded?.length ?? 0,
    skippedCount: result.skipped?.length ?? 0,
    errorCount: result.errors?.length ?? 0,
    errors: (result.errors ?? []).slice(0, 10)
  };
}

function materialMap(items = []) {
  return Object.fromEntries(
    items.map((item) => [
      item.url || item.id,
      {
        courseId: item.courseId,
        section: item.section,
        title: item.title,
        type: item.type
      }
    ])
  );
}

function summarizeMaterialChanges(previous = [], current = []) {
  const before = materialMap(previous);
  const after = materialMap(current);
  const added = Object.keys(after).filter((key) => !Object.hasOwn(before, key)).sort();
  const removed = Object.keys(before).filter((key) => !Object.hasOwn(after, key)).sort();
  const changed = Object.keys(after)
    .filter((key) =>
      Object.hasOwn(before, key) &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key])
    )
    .sort();
  return {
    changed: added.length > 0 || removed.length > 0 || changed.length > 0,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    added,
    removed,
    updated: changed
  };
}

function mergeUnavailableMap(previous = {}, current = {}, failed = new Set()) {
  const merged = { ...current };
  for (const [key, prior] of Object.entries(previous)) {
    const next = current[key];
    if (
      next === undefined ||
      next?.state === "unavailable" ||
      next?.state === "error" ||
      failed.has(key)
    ) {
      merged[key] = prior;
    }
  }
  return merged;
}

function mergeSyncSnapshot(previous, current) {
  const coverage = current.coverage;
  const generatedAt = current.generatedAt ?? previous?.generatedAt;
  const previousComponentGeneratedAt = previous?.componentGeneratedAt ?? Object.fromEntries(
    SYNC_COMPONENTS.map((component) => [component, previous?.generatedAt ?? null])
  );
  const refreshedComponents = coverage?.components ?? SYNC_COMPONENTS;
  const componentGeneratedAt = {
    ...previousComponentGeneratedAt,
    ...Object.fromEntries(refreshedComponents.filter(c => !coverage || coverage.allCourses || c === 'catalog').map((component) => [component, generatedAt]))
  };
  const courseComponentGeneratedAt = structuredClone(previous?.courseComponentGeneratedAt ?? {});
  for (const id of coverage?.courseIds ?? (current.courses ?? []).map(c => c.id)) {
    if ((current.failedCourseIds ?? []).includes(id)) continue;
    courseComponentGeneratedAt[id] = { ...(courseComponentGeneratedAt[id] ?? {}),
      ...Object.fromEntries(refreshedComponents.map(c => [c, generatedAt])) };
  }
  if (!previous) {
    const { coverage: _coverage, failedCourseIds: _failedCourseIds, ...cleanCurrent } = current;
    return {
      ...cleanCurrent,
      componentGeneratedAt,
      courseComponentGeneratedAt,
      lastSyncCoverage: coverage ?? { components: SYNC_COMPONENTS, allCourses: true }
    };
  }
  const failed = new Set(current.failedCourseIds ?? []);
  if (coverage) {
    const components = new Set(refreshedComponents);
    const areaStates = current.areaStates ?? previous.areaStates ?? [];
    const availableAreas = new Set(
      areaStates.filter(({ state }) => state === "available").map(({ area }) => area)
    );
    const currentCourses = current.courses ?? [];
    const previousById = new Map((previous.courses ?? []).map((course) => [course.id, course]));
    const currentById = new Map(currentCourses.map((course) => [course.id, course]));
    let courses = components.has("catalog")
      ? [
          ...currentCourses,
          ...(previous.courses ?? []).filter((course) => !availableAreas.has(course.area))
        ]
      : [...(previous.courses ?? [])];
    courses = [...new Map(courses.map((course) => [course.id, course])).values()]
      .map((course) => {
        const prior = previousById.get(course.id);
        const refreshed = currentById.get(course.id);
        if (
          components.has("course_content") &&
          refreshed &&
          (coverage.allCourses || coverage.courseIds?.includes(course.id)) &&
          !failed.has(course.id)
        ) {
          return refreshed;
        }
        return prior ? { ...course, sections: prior.sections ?? [] } : course;
      });
    const activeCourseIds = new Set(courses.map(({ id }) => id));
    const coveredCourseIds = new Set(coverage.courseIds ?? []);
    const refreshedCourseIds = new Set(
      currentCourses
        .filter((course) =>
          availableAreas.has(course.area) &&
          !failed.has(course.id) &&
          (coverage.allCourses || coveredCourseIds.has(course.id))
        )
        .map(({ id }) => id)
    );
    const mergeRows = (field) => {
      const rows = components.has("course_content")
        ? [
            ...(current[field] ?? []).filter((item) => refreshedCourseIds.has(item.courseId)),
            ...(previous[field] ?? []).filter((item) => !refreshedCourseIds.has(item.courseId))
          ]
        : [...(previous[field] ?? [])];
      return rows.filter((item) => activeCourseIds.has(item.courseId));
    };
    const activities = mergeRows("activities");
    const activeActivityIds = new Set(activities.map(({ id }) => id));
    const activityDetails = components.has("activity_details")
      ? mergeUnavailableMap(previous.activityDetails, current.activityDetails)
      : { ...(previous.activityDetails ?? {}) };
    const announcements = components.has("announcements")
      ? mergeUnavailableMap(previous.announcements, current.announcements, failed)
      : { ...(previous.announcements ?? {}) };
    const grades = components.has("grades")
      ? mergeUnavailableMap(previous.grades, current.grades, failed)
      : { ...(previous.grades ?? {}) };
    const { coverage: _coverage, failedCourseIds: _failedCourseIds, ...cleanCurrent } = current;
    return {
      ...previous,
      ...cleanCurrent,
      courses,
      activities,
      pendingItems: mergeRows("pendingItems"),
      materials: mergeRows("materials"),
      activityDetails: Object.fromEntries(
        Object.entries(activityDetails).filter(([id]) => activeActivityIds.has(id))
      ),
      announcements: Object.fromEntries(
        Object.entries(announcements).filter(([courseId]) => activeCourseIds.has(courseId))
      ),
      grades: Object.fromEntries(
        Object.entries(grades).filter(([courseId]) => activeCourseIds.has(courseId))
      ),
      areaStates,
      componentGeneratedAt,
      courseComponentGeneratedAt,
      lastSyncCoverage: coverage
    };
  }
  const mergeCourseRows = (field) => [
    ...(current[field] ?? []).filter((item) => !failed.has(item.courseId)),
    ...(previous[field] ?? []).filter((item) => failed.has(item.courseId))
  ];
  const currentCourses = current.courses ?? [];
  const courses = [
    ...currentCourses.filter((course) => !failed.has(course.id)),
    ...(previous.courses ?? []).filter((course) => failed.has(course.id))
  ];
  const activityDetails = { ...(current.activityDetails ?? {}) };
  for (const [id, prior] of Object.entries(previous.activityDetails ?? {})) {
    const next = activityDetails[id];
    if (!next || next.state === "unavailable" || next.state === "error") {
      activityDetails[id] = prior;
    }
  }
  const { failedCourseIds: _failedCourseIds, ...cleanCurrent } = current;
  return {
    ...cleanCurrent,
    courses,
    activities: mergeCourseRows("activities"),
    pendingItems: mergeCourseRows("pendingItems"),
    materials: mergeCourseRows("materials"),
    activityDetails,
    announcements: mergeUnavailableMap(
      previous.announcements,
      current.announcements,
      failed
    ),
    grades: mergeUnavailableMap(previous.grades, current.grades, failed),
    componentGeneratedAt,
    courseComponentGeneratedAt,
    lastSyncCoverage: { components: SYNC_COMPONENTS, allCourses: true }
  };
}

function findOne(items, query, fields, kind) {
  if (kind === 'course') return resolveCourse(items, query);
  const raw = String(query ?? "").trim();
  const exact = items.filter((item) =>
    fields.some((field) => String(item[field] ?? "") === raw)
  );
  const candidates = exact.length
    ? exact
    : items.filter((item) =>
        fields.some((field) => matches(item[field], raw))
      );
  if (candidates.length === 0) {
    throw new McpToolError(`${kind}_not_found`, `No ${kind} matched the query`, {
      details: { query: raw }
    });
  }
  if (candidates.length > 1) {
    throw new McpToolError(`${kind}_ambiguous`, `More than one ${kind} matched the query`, {
      details: { query: raw, matches: candidates.map((item) => item.id) }
    });
  }
  return candidates[0];
}

function resourceRows(snapshot) {
  const rows = [
    ...(snapshot.activities ?? []).filter(({ type }) =>
      ["resource", "folder", "url", "page"].includes(type)
    ),
    ...(snapshot.materials ?? [])
  ];
  return [...new Map(rows.map((item) => [item.id || item.url, item])).values()];
}

function optionalResource(snapshot, query) {
  try {
    return findOne(resourceRows(snapshot), query, ["id", "url", "title"], "resource");
  } catch (error) {
    if (error?.code === "resource_not_found") return null;
    throw error;
  }
}

export function createPaideiaService({
  cachePath,
  historyPath,
  manifestPath,
  adapter,
  now = () => new Date().toISOString(),
  uniRoot = path.resolve("downloads", "Paideia"),
  maxActiveDownloads = 2,
  jobTtlSeconds = 60 * 60,
  maxRetainedJobs = 100
}) {
  if (!cachePath || !historyPath || !manifestPath) {
    throw new TypeError("Paideia cache, history, and manifest paths are required");
  }
  const jobs = new Map();
  const jobPromises = new Set();
  let activeSyncJobId = "";

  function pruneJobs() {
    const currentEpoch = Date.parse(now());
    for (const [jobId, job] of jobs) {
      if (
        ["completed", "failed"].includes(job.status) &&
        Number.isFinite(currentEpoch) &&
        Number.isFinite(Date.parse(job.completedAt)) &&
        currentEpoch - Date.parse(job.completedAt) >= jobTtlSeconds * 1_000
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
    const snapshot = await readJsonCache(
      cachePath,
      optional ? { fallback: null } : {}
    ).catch((error) => {
      if (error.code === "ENOENT" && optional) return null;
      if (error.code === "ENOENT") {
        throw new McpToolError(
          "cache_unavailable",
          "No Paideia cache is available; run sync_paideia first",
          { retryable: true }
        );
      }
      throw error;
    });
    return snapshot;
  }

  function startJob(kind, operation, { dedupeKey = "" } = {}) {
    pruneJobs();
    const jobId = `${kind}-${randomUUID()}`;
    const queuedAt = now();
    const job = {
      jobId,
      kind,
      status: "queued",
      queuedAt,
      startedAt: "",
      completedAt: "",
      result: null,
      error: null,
      dedupeKey
    };
    jobs.set(jobId, job);
    const promise = Promise.resolve()
      .then(async () => {
        job.status = "running";
        job.startedAt = now();
        try {
          job.result = summarizeJobResult(await operation(jobId));
          job.status = "completed";
        } catch (error) {
          job.status = "failed";
          job.error = safeJobError(error);
        } finally {
          job.completedAt = now();
          if (activeSyncJobId === jobId) activeSyncJobId = "";
          pruneJobs();
        }
      })
      .finally(() => jobPromises.delete(promise));
    jobPromises.add(promise);
    return job;
  }

  async function recordSync(jobId, previous, current) {
    const history = await readJsonCache(historyPath, { fallback: [] });
    const summary = summarizeMaterialChanges(
      previous?.materials ?? [],
      current.materials ?? []
    );
    const event = {
      jobId,
      syncedAt: current.generatedAt,
      summary
    };
    await writeJsonAtomic(historyPath, [...history, event].slice(-50));
    return event;
  }

  async function refreshSnapshot(jobId, options = {}) {
    const previous = await readSnapshot({ optional: true });
    const components = syncComponents(options);
    const scraped = await adapter.sync({
      ...options,
      components,
      previousSnapshot: previous,
      metadataOnly: true
    });
    const current = mergeSyncSnapshot(previous, scraped);
    const normalized = {
      ...EMPTY,
      ...current,
      generatedAt: current.generatedAt ?? now(),
      retrievedAt: current.retrievedAt ?? current.generatedAt ?? now()
    };
    await writeJsonAtomic(cachePath, normalized);
    const history = await recordSync(jobId, previous, normalized);
    return { snapshot: normalized, scraped, components, history };
  }

  function startSync(options = {}) {
    if (activeSyncJobId && ["queued", "running"].includes(jobs.get(activeSyncJobId)?.status)) {
      return jobs.get(activeSyncJobId);
    }
    const job = startJob("sync", async (jobId) => {
      const { snapshot: normalized, scraped, components, history } =
        await refreshSnapshot(jobId, options);
      return {
        generatedAt: normalized.generatedAt,
        courseCount: normalized.courses.length,
        activityCount: normalized.activities.length,
        pendingCount: normalized.pendingItems.length,
        materialCount: normalized.materials.length,
        components,
        ...(scraped.timings ? { timings: scraped.timings } : {}),
        ...(scraped.failures ? { failures: scraped.failures } : {}),
        changes: history.summary
      };
    });
    job.syncOptions = {
      scope: options.scope ?? "full",
      components: syncComponents(options),
      ...(options.course ? { course: options.course } : {}),
      reason: options.reason ?? ""
    };
    activeSyncJobId = job.jobId;
    return job;
  }

  async function envelope(snapshot, data, {
    ttlSeconds = TTL_SECONDS.academic,
    generatedAt = snapshot.generatedAt,
    warnings = []
  } = {}) {
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

  async function query(options, select, {
    ttlSeconds = TTL_SECONDS.academic,
    components = SYNC_COMPONENTS
  } = {}) {
    const snapshot = await readSnapshot();
    const normalizedComponents = syncComponents({ components });
    const freshnessComponent = normalizedComponents.find((component) => component !== "catalog") ?? "catalog";
    const courseId = options.course ? resolveCourse(snapshot.courses, options.course).id : null;
    const generatedAt = (courseId ? snapshot.courseComponentGeneratedAt?.[courseId]?.[freshnessComponent] : null)
      ?? snapshot.componentGeneratedAt?.[freshnessComponent] ?? snapshot.generatedAt;
    const refresh = shouldRefresh({
      forceRefresh: Boolean(options.forceRefresh),
      generatedAt,
      now: now(),
      ttlSeconds
    });
    const job = refresh
      ? startSync({
          reason: options.forceRefresh ? "forced" : "stale",
          components: normalizedComponents,
          ...(courseId ? { course: courseId } : {})
        })
      : null;
    const data = await select(snapshot);
    if (job) data.refreshJobId = job.jobId;
    return envelope(snapshot, data, {
      ttlSeconds,
      generatedAt,
      warnings: job
        ? ["Cached data was returned while a Paideia metadata refresh runs in the background."]
        : []
    });
  }

  async function listCourses(options = {}) {
    return query(options, async (snapshot) => {
      const courses = sortText(
        snapshot.courses.filter((course) =>
          matches(
            `${course.id} ${course.name} ${course.shortName} ${course.area ?? ""}`,
            options.query
          )
        ),
        (course) => course.shortName || course.name
      )
        .slice(0, clamp(options.limit, 50, 100))
        .map((course) => ({
          id: course.id,
          name: course.name,
          shortName: course.shortName,
          url: course.url,
          sourceId: course.sourceId ?? course.id,
          area: course.area ?? "pregrado_posgrado",
          areas: course.areas ?? [course.area ?? "pregrado_posgrado"],
          timelineClassifications: course.timelineClassifications ?? [],
          sectionCount: (course.sections ?? []).length,
          activityCount: snapshot.activities.filter((item) => item.courseId === course.id).length
        }));
      return {
        count: courses.length,
        courses,
        areaStates: snapshot.areaStates ?? []
      };
    }, { components: SYNC_SCOPES.catalog });
  }

  async function getCourseOutline(options) {
    return query(options, async (snapshot) => {
      const course = findOne(
        snapshot.courses,
        options.course,
        ["id", "name", "shortName"],
        "course"
      );
      const maxSections = clamp(options.maxSections, 12, 60);
      const sampleLimit = clamp(options.sampleLimit, 5, 20);
      const allSections = course.sections ?? [];
      const sections = allSections.slice(0, maxSections).map((section) => ({
        ...section,
        activities: snapshot.activities
          .filter((item) =>
            item.courseId === course.id &&
            (section.activityIds?.includes(item.id) || item.section === section.title)
          )
          .slice(0, sampleLimit)
      }));
      return {
        course: {
          ...course,
          sections,
          returnedSectionCount: sections.length,
          sectionCount: allSections.length,
          truncated: allSections.length > sections.length
        }
      };
    }, { components: SYNC_SCOPES.materials });
  }

  async function listActivities(options = {}) {
    return query(options, async (snapshot) => {
      const items = sortText(
        snapshot.activities
          .filter((item) => belongsToCourse(snapshot, item, options.course))
          .filter((item) => matches(item.section, options.section))
          .filter((item) => !options.type || item.type === options.type)
          .filter((item) => matches(`${item.title} ${item.type}`, options.query)),
        (item) => `${item.course} ${item.section} ${item.title}`
      ).slice(0, clamp(options.limit, 50, 200));
      return { count: items.length, items };
    }, { components: SYNC_SCOPES.materials });
  }

  async function getActivityDetails(options) {
    const snapshot = await readSnapshot();
    const activity = findOne(snapshot.activities, options.activity, ["id", "url", "title"], "activity");
    const cached = snapshot.activityDetails?.[activity.id];
    if (!options.forceRefresh && cached?.state !== "unavailable" && cached?.state !== "error" && cached) {
      return envelope(snapshot, { state: "available", activity, detail: cached });
    }
    const activeJob = [...jobs.values()].find((candidate) =>
      candidate.kind === "activity-detail" &&
      candidate.dedupeKey === activity.id &&
      ["queued", "running"].includes(candidate.status)
    );
    const job = activeJob ?? startJob("activity-detail", async () => {
      const detail = typeof adapter.getActivityDetails === "function"
        ? await adapter.getActivityDetails(activity)
        : (await adapter.sync({ components: SYNC_SCOPES.activities, course: activity.courseId,
            activity: activity.id, previousSnapshot: snapshot, metadataOnly: true })).activityDetails?.[activity.id];
      if (!detail) throw new McpToolError("activity_detail_unavailable", "Paideia did not publish activity details");
      const latest = await readSnapshot();
      await writeJsonAtomic(cachePath, { ...latest, activityDetails: { ...(latest.activityDetails ?? {}), [activity.id]: detail } });
      return detail;
    }, { dedupeKey: activity.id });
    return envelope(snapshot, { state: "pending", jobId: job.jobId, activity,
      detail: { state: "pending", id: activity.id, jobId: job.jobId } },
      { warnings: ["The activity overview is being fetched without opening an attempt or submission form."] });
  }

  async function listPendingItems(options = {}) {
    return query(options, async (snapshot) => {
      const items = sortText(
        snapshot.pendingItems
          .filter((item) => belongsToCourse(snapshot, item, options.course))
          .filter((item) => matches(item.section, options.section))
          .filter((item) => !options.type || item.type === options.type)
          .filter((item) => matches(item.title, options.query)),
        (item) => `${item.dueDate || "9999"} ${item.course} ${item.title}`
      ).slice(0, clamp(options.limit, 40, 100));
      return { count: items.length, items };
    }, { components: SYNC_SCOPES.materials });
  }

  async function listNextPendingItems(options = {}) {
    return query(options, async (snapshot) => {
      const current = Date.parse(now());
      const items = snapshot.pendingItems
        .filter((item) => Number.isFinite(item.dueTimestamp))
        .filter((item) => options.includePast || item.dueTimestamp >= current)
        .filter((item) => belongsToCourse(snapshot, item, options.course))
        .sort((left, right) =>
          left.dueTimestamp - right.dueTimestamp ||
          left.title.localeCompare(right.title, "es", { sensitivity: "base" })
        )
        .slice(0, clamp(options.limit, 5, 30));
      return { count: items.length, items };
    }, { components: SYNC_SCOPES.materials });
  }

  async function listAnnouncements(options) {
    return query(options, async (snapshot) => {
      const course = findOne(snapshot.courses, options.course, ["id", "name", "shortName"], "course");
      const result = snapshot.announcements?.[course.id] ?? {
        state: "unavailable",
        items: []
      };
      return {
        courseId: course.id,
        state: result.state ?? "available",
        items: (result.items ?? [])
          .filter((item) => matches(`${item.title} ${item.summary}`, options.query))
          .slice(0, clamp(options.limit, 30, 100))
      };
    }, { components: SYNC_SCOPES.announcements });
  }

  async function listCourseGrades(options) {
    return query(options, async (snapshot) => {
      const course = findOne(snapshot.courses, options.course, ["id", "name", "shortName"], "course");
      const result = snapshot.grades?.[course.id] ?? {
        state: "unavailable",
        items: []
      };
      return {
        courseId: course.id,
        state: result.state ?? "available",
        items: (result.items ?? []).filter((item) =>
          matches(`${item.name} ${item.category}`, options.query)
        )
      };
    }, { components: SYNC_SCOPES.grades });
  }

  async function searchMaterials(options = {}) {
    return query(options, async (snapshot) => {
      const items = sortText(
        snapshot.materials
          .filter((item) => belongsToCourse(snapshot, item, options.course))
          .filter((item) => matches(item.section, options.section))
          .filter((item) => !options.type || item.type === options.type || item.kind === options.type)
          .filter((item) => matches(`${item.title} ${item.section} ${item.type}`, options.query)),
        (item) => `${item.course} ${item.section} ${item.title}`
      ).slice(0, clamp(options.limit, 30, 80));
      return { count: items.length, items };
    }, {
      ttlSeconds: TTL_SECONDS.materialAdmin,
      components: SYNC_SCOPES.materials
    });
  }

  async function listMaterialChanges(options = {}) {
    const snapshot = await readSnapshot();
    const history = await readJsonCache(historyPath, { fallback: [] });
    return envelope(snapshot, {
      syncs: history.slice(-clamp(options.limit, 10, 50)).reverse()
    }, { ttlSeconds: TTL_SECONDS.materialAdmin });
  }

  async function getStatus() {
    pruneJobs();
    const snapshot = await readSnapshot({ optional: true });
    const generatedAt = snapshot?.generatedAt ?? now();
    return createEnvelope({
      source: SOURCE,
      retrievedAt: snapshot?.retrievedAt ?? generatedAt,
      generatedAt,
      ttlSeconds: TTL_SECONDS.academic,
      now: now(),
      data: {
        cacheAvailable: Boolean(snapshot),
        generatedAt: snapshot?.generatedAt ?? null,
        componentGeneratedAt: snapshot?.componentGeneratedAt ?? null,
        lastSyncCoverage: snapshot?.lastSyncCoverage ?? null,
        areaStates: snapshot?.areaStates ?? [],
        activeJobId: activeSyncJobId || null,
        jobs: [...jobs.values()].reduce((counts, job) => {
          counts[job.status] = (counts[job.status] ?? 0) + 1;
          return counts;
        }, {})
      },
      warnings: snapshot ? [] : ["No Paideia cache is available."]
    });
  }

  async function syncPaideia(options = {}) {
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

  async function getJobStatus({ jobId }) {
    pruneJobs();
    const job = jobs.get(jobId);
    if (!job) {
      throw new McpToolError("job_not_found", "Paideia job was not found", {
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

  async function startDownload(kind, options, itemOrCourse) {
    const snapshot = await readSnapshot();
    const course = typeof itemOrCourse === "string"
      ? findOne(snapshot.courses, itemOrCourse, ["id", "name", "shortName"], "course")
      : findOne(snapshot.courses, itemOrCourse.courseId, ["id"], "course");
    const destination = resolveDownloadDestination(course, options.destination);
    const dedupeKey = JSON.stringify({
      kind,
      target:
        typeof itemOrCourse === "string"
          ? course.id
          : itemOrCourse.id || itemOrCourse.url,
      section: options.section || "",
      type: options.type || "",
      query: options.query || "",
      limit: options.limit || "",
      destination,
      overwrite: Boolean(options.overwrite),
      skipExisting: options.skipExisting !== false
    });
    const equivalent = [...jobs.values()].find(
      (job) =>
        job.dedupeKey === dedupeKey &&
        ["queued", "running"].includes(job.status)
    );
    if (equivalent) {
      return envelope(snapshot, {
        jobId: equivalent.jobId,
        status: equivalent.status,
        destination
      }, { ttlSeconds: TTL_SECONDS.materialAdmin });
    }
    const activeDownloads = [...jobs.values()].filter(
      (job) =>
        job.kind.startsWith("download-") &&
        ["queued", "running"].includes(job.status)
    ).length;
    if (activeDownloads >= maxActiveDownloads) {
      throw new McpToolError(
        "download_limit_reached",
        "Too many Paideia download jobs are active",
        { retryable: true }
      );
    }
    const job = startJob(kind, async () => {
      const method = kind === "download-course"
        ? adapter.downloadCourseMaterials
        : adapter.downloadResource;
      const operation = method ?? adapter.download;
      if (typeof operation !== "function") {
        throw new McpToolError("download_unavailable", "Paideia download adapter is unavailable");
      }
      return operation.call(adapter, {
        ...options,
        course,
        resource: typeof itemOrCourse === "string" ? undefined : itemOrCourse,
        materials: snapshot.materials,
        destination,
        overwrite: Boolean(options.overwrite),
        skipExisting: options.skipExisting !== false,
        manifestPath,
        uniRoot
      });
    }, { dedupeKey });
    return envelope(snapshot, {
      jobId: job.jobId,
      status: job.status,
      destination
    }, { ttlSeconds: TTL_SECONDS.materialAdmin });
  }

  function resolveDownloadDestination(course, requested) {
    const defaultDestination = courseDestination(course.shortName || course.name, uniRoot);
    const requestedDestination = requested || defaultDestination;
    try {
      validateDownloadDestination(
        path.isAbsolute(requestedDestination)
          ? requestedDestination
          : path.resolve(uniRoot, requestedDestination),
        uniRoot
      );
      return resolveAllowedPath(requestedDestination, [path.resolve(uniRoot)]);
    } catch (error) {
      throw new McpToolError(
        "path_not_allowed",
        "Paideia download destination is outside the safe allowlist",
        { details: { reason: error.message } }
      );
    }
  }

  function assertDownloadCapacity() {
    const activeDownloads = [...jobs.values()].filter(
      (job) =>
        job.kind.startsWith("download-") &&
        ["queued", "running"].includes(job.status)
    ).length;
    if (activeDownloads >= maxActiveDownloads) {
      throw new McpToolError(
        "download_limit_reached",
        "Too many Paideia download jobs are active",
        { retryable: true }
      );
    }
  }

  async function startDeferredResourceDownload(options, initialSnapshot) {
    if (options.destination) {
      // Validate an explicit path before any remote work starts.
      resolveDownloadDestination({ name: "Paideia" }, options.destination);
    }
    const dedupeKey = JSON.stringify({
      kind: "download-resource",
      target: String(options.resource),
      destination: options.destination || "",
      overwrite: Boolean(options.overwrite),
      skipExisting: options.skipExisting !== false
    });
    const equivalent = [...jobs.values()].find(
      (job) => job.dedupeKey === dedupeKey && ["queued", "running"].includes(job.status)
    );
    if (equivalent) {
      return envelope(initialSnapshot, {
        jobId: equivalent.jobId,
        status: equivalent.status,
        destination: options.destination || null
      }, { ttlSeconds: TTL_SECONDS.materialAdmin });
    }
    assertDownloadCapacity();
    const job = startJob("download-resource", async (jobId) => {
      const { snapshot: refreshed } = await refreshSnapshot(jobId, {
        reason: "resource_not_cached",
        components: SYNC_SCOPES.materials
      });
      const material = findOne(
        resourceRows(refreshed),
        options.resource,
        ["id", "url", "title"],
        "resource"
      );
      if (["url", "page"].includes(material.kind || material.type)) {
        throw new McpToolError(
          "resource_not_downloadable",
          "The selected Paideia activity is a link or page, not a downloadable file"
        );
      }
      const course = findOne(refreshed.courses, material.courseId, ["id"], "course");
      const destination = resolveDownloadDestination(course, options.destination);
      if (typeof adapter.downloadResource !== "function") {
        throw new McpToolError("download_unavailable", "Paideia download adapter is unavailable");
      }
      return adapter.downloadResource({
        ...options,
        course,
        resource: material,
        materials: refreshed.materials,
        destination,
        overwrite: Boolean(options.overwrite),
        skipExisting: options.skipExisting !== false,
        manifestPath,
        uniRoot
      });
    }, { dedupeKey });
    return envelope(initialSnapshot, {
      jobId: job.jobId,
      status: job.status,
      destination: options.destination || null
    }, {
      ttlSeconds: TTL_SECONDS.materialAdmin,
      warnings: ["The resource was not in the local cache; a focused Paideia refresh will resolve it before downloading."]
    });
  }

  async function downloadResource(options) {
    const snapshot = await readSnapshot();
    const material = optionalResource(snapshot, options.resource);
    if (!material) return startDeferredResourceDownload(options, snapshot);
    if (["url", "page"].includes(material.kind || material.type)) {
      throw new McpToolError(
        "resource_not_downloadable",
        "The selected Paideia activity is a link or page, not a downloadable file"
      );
    }
    return startDownload("download-resource", options, material);
  }

  async function getFolderContents(options) {
    const snapshot = await readSnapshot();
    const cached = optionalResource(snapshot, options.folder);
    const job = startJob("folder-contents", async (jobId) => {
      let current = snapshot;
      let folder = cached;
      if (!folder) {
        const refreshed = await refreshSnapshot(jobId, {
          reason: "folder_not_cached",
          components: SYNC_SCOPES.materials
        });
        current = refreshed.snapshot;
        folder = findOne(
          resourceRows(current),
          options.folder,
          ["id", "url", "title"],
          "resource"
        );
      }
      if ((folder.kind || folder.type) !== "folder") {
        throw new McpToolError(
          "resource_not_folder",
          "The selected Paideia activity is not a Moodle folder"
        );
      }
      if (typeof adapter.getFolderContents !== "function") {
        throw new McpToolError(
          "folder_inspection_unavailable",
          "Paideia folder inspection is unavailable"
        );
      }
      return adapter.getFolderContents({
        resource: folder,
        limit: clamp(options.limit, 100, 500)
      });
    }, { dedupeKey: JSON.stringify({ kind: "folder-contents", folder: options.folder }) });
    return envelope(snapshot, {
      jobId: job.jobId,
      status: job.status
    }, {
      ttlSeconds: TTL_SECONDS.materialAdmin,
      warnings: cached ? [] : ["The folder was not in the local cache; a focused refresh will resolve it first."]
    });
  }

  async function downloadCourseMaterials(options) {
    return startDownload("download-course", options, options.course);
  }

  return {
    downloadCourseMaterials,
    downloadResource,
    getActivityDetails,
    getCourseOutline,
    getFolderContents,
    getJobStatus,
    getStatus,
    listActivities,
    listAnnouncements,
    listCourseGrades,
    listCourses,
    listMaterialChanges,
    listNextPendingItems,
    listPendingItems,
    searchMaterials,
    syncPaideia,
    async waitForIdle() {
      await Promise.all([...jobPromises]);
    }
  };
}
