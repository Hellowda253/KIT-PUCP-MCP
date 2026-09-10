import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPaideiaService } from "../src/service.js";
import {
  classifyDownload,
  courseDestination,
  createDownloadManifest,
  materialDestination,
  resolveSafeWritePath,
  sanitizeDownloadFileName,
  validateDownloadDestination
} from "../src/downloads.js";
import { safeName } from "../src/text.js";

const generatedAt = "2026-07-24T10:00:00.000Z";
const now = "2026-07-24T13:00:00.000Z";
const snapshot = {
  generatedAt,
  retrievedAt: generatedAt,
  areaStates: [
    { area: "pregrado_posgrado", state: "available", courseCount: 1 },
    { area: "educacion_continua", state: "available", courseCount: 1 }
  ],
  courses: [
    { id: "2", sourceId: "2", area: "educacion_continua", areas: ["educacion_continua"], name: "2026-1 Beta (B)", shortName: "Beta", url: "https://example/course?id=2", sections: [] },
    { id: "1", sourceId: "1", area: "pregrado_posgrado", areas: ["pregrado_posgrado"], name: "2026-1 Álgebra (A)", shortName: "Álgebra", url: "https://example/course?id=1", sections: [] }
  ],
  activities: [
    { id: "a2", courseId: "2", course: "Beta", section: "S2", type: "quiz", title: "Quiz", url: "https://example/quiz?id=a2" },
    { id: "a1", courseId: "1", course: "Álgebra", section: "S1", type: "assignment", title: "Tarea", url: "https://example/assign?id=a1" }
  ],
  pendingItems: [
    { id: "a2", courseId: "2", course: "Beta", section: "S2", type: "quiz", title: "Quiz", dueDate: "2026-08-03T10:00:00.000Z", dueTimestamp: 1785751200000 },
    { id: "a1", courseId: "1", course: "Álgebra", section: "S1", type: "assignment", title: "Tarea", dueDate: "2026-07-30T10:00:00.000Z", dueTimestamp: 1785405600000 }
  ],
  materials: [
    { id: "m2", courseId: "2", course: "Beta", section: "S2", type: "resource", kind: "resource", title: "Lecture", url: "https://example/file?id=2" },
    { id: "m1", courseId: "1", course: "Álgebra", section: "S1", type: "folder", kind: "folder", title: "Datos", url: "https://example/folder?id=1" }
  ],
  activityDetails: { a1: { id: "a1", title: "Tarea", instructions: "Resolver." } },
  announcements: { "1": { state: "available", items: [{ id: "n1", courseId: "1", course: "Álgebra", title: "Aviso" }] } },
  grades: { "1": { state: "available", items: [{ courseId: "1", course: "Álgebra", name: "Tarea", rawGrade: "18" }] } }
};

async function setup(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paideia-service-"));
  const cachePath = path.join(dir, "cache.json");
  await writeFile(cachePath, JSON.stringify(options.snapshot ?? snapshot));
  const calls = [];
  const adapter = options.adapter ?? {
    async sync() {
      calls.push("sync");
      return { ...snapshot, generatedAt: now, retrievedAt: now };
    },
    async download() {
      calls.push("download");
      return { downloaded: [] };
    }
  };
  const service = createPaideiaService({
    cachePath,
    historyPath: path.join(dir, "history.json"),
    manifestPath: path.join(dir, "manifest.json"),
    adapter,
    now: options.now ?? (() => now),
    uniRoot: path.join(dir, ".UNI V2"),
    ...(options.serviceOptions ?? {})
  });
  return { service, calls, dir, cachePath };
}

test("all cached queries use the five-field Paideia envelope and deterministic filtering", async () => {
  const { service } = await setup();
  const result = await service.listCourses({ query: "alge", limit: 10 });
  assert.deepEqual(Object.keys(result), ["source", "retrievedAt", "cache", "data", "warnings"]);
  assert.equal(result.source, "paideia");
  assert.equal(result.cache.stale, true);
  assert.deepEqual(result.data.courses.map((course) => course.id), ["1"]);
  assert.equal(result.data.courses[0].area, "pregrado_posgrado");
  assert.deepEqual(result.data.courses[0].areas, ["pregrado_posgrado"]);
  assert.equal(result.data.courses[0].sourceId, "1");
  assert.deepEqual(result.data.areaStates, snapshot.areaStates);

  assert.deepEqual((await service.listActivities({ type: "quiz" })).data.items.map((item) => item.id), ["a2"]);
  assert.equal((await service.getCourseOutline({ course: "1" })).data.course.id, "1");
  assert.equal((await service.getActivityDetails({ activity: "a1" })).data.detail.title, "Tarea");
  assert.deepEqual((await service.listNextPendingItems({ limit: 2 })).data.items.map((item) => item.id), ["a1", "a2"]);
  assert.equal((await service.listAnnouncements({ course: "Álgebra" })).data.state, "available");
  assert.equal((await service.listCourseGrades({ course: "1" })).data.items[0].rawGrade, "18");
  assert.equal((await service.searchMaterials({ query: "datos" })).data.items[0].id, "m1");
});

test("course outline uses a canonical name and omits empty unnamed sections by default", async () => {
  const current = structuredClone(snapshot);
  current.courses = [{
    id: "1", sourceId: "1", area: "pregrado_posgrado", areas: ["pregrado_posgrado"],
    name: "El curso es destacado Nombre del curso 2026-2 CONTROL DE GESTIÓN INDUSTRIAL (IND275-0734) 2026-2 CONTROL DE GESTIÓN INDUSTRIAL (IND275-0734)",
    shortName: "CONTROL DE GESTIÓN INDUSTRIAL",
    url: "https://example/course?id=1",
    sections: [
      { id: "empty", courseId: "1", title: "Sin sección", activityIds: [] },
      { id: "real", courseId: "1", title: "Semana 1", activityIds: ["a1"] }
    ]
  }];
  const { service } = await setup({ snapshot: current, now: () => generatedAt });

  const result = await service.getCourseOutline({ course: "1" });
  const diagnostic = await service.getCourseOutline({ course: "1", includeEmptySections: true });

  assert.equal(result.data.course.name, "2026-2 CONTROL DE GESTIÓN INDUSTRIAL (IND275-0734)");
  assert.deepEqual(result.data.course.sections.map(({ id }) => id), ["real"]);
  assert.equal(result.data.course.omittedEmptySectionCount, 1);
  assert.deepEqual(diagnostic.data.course.sections.map(({ id }) => id), ["empty", "real"]);
});

test("stale query returns last good cache while starting one background refresh", async () => {
  let resolveSync;
  let syncCount = 0;
  const { service } = await setup({
    adapter: {
      sync() {
        syncCount += 1;
        return new Promise((resolve) => { resolveSync = resolve; });
      }
    }
  });

  const first = await service.listCourses({ forceRefresh: true });
  const second = await service.listCourses({ forceRefresh: true });
  assert.equal(syncCount, 1);
  assert.equal(first.data.courses.length, 2);
  assert.match(first.warnings[0], /refresh/i);
  assert.equal(first.data.refreshJobId, second.data.refreshJobId);
  resolveSync({ ...snapshot, generatedAt: now, retrievedAt: now });
  await service.waitForIdle();
  assert.equal((await service.getJobStatus({ jobId: first.data.refreshJobId })).data.status, "completed");
});

test("force refresh selects only the Paideia components needed by each query", async () => {
  const calls = [];
  const { service } = await setup({
    adapter: {
      async sync(input) {
        calls.push(input);
        return { ...snapshot, generatedAt: now, retrievedAt: now };
      }
    }
  });

  await service.searchMaterials({ forceRefresh: true, query: "datos" });
  await service.waitForIdle();
  await service.listCourseGrades({ forceRefresh: true, course: "1" });
  await service.waitForIdle();
  await service.listCourses({ forceRefresh: true });
  await service.waitForIdle();

  assert.deepEqual(calls.map(({ components }) => components), [
    ["catalog", "course_content"],
    ["catalog", "grades"],
    ["catalog"]
  ]);
});

test("course queries pass their course selector to focused background refreshes", async () => {
  const calls = [];
  const { service } = await setup({
    adapter: {
      async sync(input) {
        calls.push(input);
        return { ...snapshot, generatedAt: now, retrievedAt: now };
      }
    }
  });

  await service.getCourseOutline({ course: "1", forceRefresh: true });
  await service.waitForIdle();

  assert.equal(calls[0].course, "1");
  assert.deepEqual(calls[0].components, ["catalog", "course_content"]);
});

test("empty stale course materials return pending and reuse the cached catalog", async () => {
  const historicalSnapshot = structuredClone(snapshot);
  historicalSnapshot.generatedAt = "2026-01-01T10:00:00.000Z";
  historicalSnapshot.retrievedAt = historicalSnapshot.generatedAt;
  historicalSnapshot.courses.push({
    id: "303",
    sourceId: "303",
    area: "pregrado_posgrado",
    areas: ["pregrado_posgrado"],
    name: "2023-1 FUNDAMENTOS DE CÁLCULO (1MAT05-I103)",
    shortName: "FUNDAMENTOS DE CÁLCULO",
    url: "https://example/course?id=303",
    sections: []
  });
  const calls = [];
  let resolveSync;
  let markSyncStarted;
  const syncStarted = new Promise((resolve) => { markSyncStarted = resolve; });
  const { service } = await setup({
    snapshot: historicalSnapshot,
    adapter: {
      sync(input) {
        calls.push(input);
        markSyncStarted();
        return new Promise((resolve) => { resolveSync = resolve; });
      }
    }
  });

  const result = await service.searchMaterials({ course: "1MAT05-I103" });

  assert.equal(result.data.state, "pending");
  assert.equal(result.data.count, 0);
  assert.match(result.data.refreshJobId, /^sync-/u);
  assert.match(result.warnings[0], /no cached matching data.*get_paideia_job_status.*repeat/iu);
  await syncStarted;
  assert.equal(calls[0].course, "303");
  assert.equal(calls[0].reuseCatalog, true);
  resolveSync({
    ...historicalSnapshot,
    generatedAt: now,
    retrievedAt: now,
    coverage: { components: ["course_content"], allCourses: false, courseIds: ["303"] }
  });
  await service.waitForIdle();
  const completed = await service.getJobStatus({ jobId: result.data.refreshJobId });
  assert.deepEqual(completed.data.result.components, ["course_content"]);
});

test("empty stale course outline is marked incomplete while its focused refresh runs", async () => {
  const historicalSnapshot = structuredClone(snapshot);
  historicalSnapshot.generatedAt = "2026-01-01T10:00:00.000Z";
  historicalSnapshot.retrievedAt = historicalSnapshot.generatedAt;
  historicalSnapshot.courses = [{
    id: "303",
    sourceId: "303",
    area: "pregrado_posgrado",
    areas: ["pregrado_posgrado"],
    name: "2023-1 FUNDAMENTOS DE CÁLCULO (1MAT05-I103)",
    shortName: "FUNDAMENTOS DE CÁLCULO",
    url: "https://example/course?id=303",
    sections: []
  }];
  let resolveSync;
  let started;
  const syncStarted = new Promise((resolve) => { started = resolve; });
  const { service } = await setup({
    snapshot: historicalSnapshot,
    adapter: {
      sync() {
        started();
        return new Promise((resolve) => { resolveSync = resolve; });
      }
    }
  });

  const result = await service.getCourseOutline({ course: "1MAT05-I103" });

  assert.equal(result.data.state, "pending");
  assert.equal(result.data.incomplete, true);
  assert.equal(result.data.course.sectionCount, 0);
  assert.match(result.warnings.join(" "), /no cached matching data|incomplete|refresh/iu);
  await syncStarted;
  resolveSync({ ...historicalSnapshot, generatedAt: now, retrievedAt: now });
  await service.waitForIdle();
});

test("component refresh preserves unrelated Paideia cache slices", async () => {
  const refreshedMaterial = {
    ...snapshot.materials[0],
    id: "m3",
    title: "Material actualizado"
  };
  const { service, cachePath } = await setup({
    adapter: {
      async sync() {
        return {
          generatedAt: now,
          retrievedAt: now,
          areaStates: snapshot.areaStates,
          courses: snapshot.courses.map((course) => ({ ...course, sections: [] })),
          activities: snapshot.activities,
          pendingItems: snapshot.pendingItems,
          materials: [refreshedMaterial],
          failedCourseIds: [],
          coverage: {
            components: ["catalog", "course_content"],
            allCourses: true
          }
        };
      }
    }
  });

  await service.searchMaterials({ forceRefresh: true });
  await service.waitForIdle();
  const updated = JSON.parse(await readFile(cachePath, "utf8"));

  assert.deepEqual(updated.materials.map(({ id }) => id), ["m3"]);
  assert.deepEqual(updated.announcements, snapshot.announcements);
  assert.deepEqual(updated.grades, snapshot.grades);
  assert.equal(updated.componentGeneratedAt.course_content, now);
  assert.equal(updated.componentGeneratedAt.grades, generatedAt);
});

test("sync and download operations return jobs immediately and authentication errors stay structured", async () => {
  const { service } = await setup({
    adapter: {
      async sync() {
        const error = new Error("missing credentials");
        error.code = "authentication_required";
        throw error;
      },
      async download() {
        return { downloaded: [{ path: "safe" }] };
      }
    }
  });
  const sync = await service.syncPaideia({});
  assert.equal(sync.data.status, "queued");
  await service.waitForIdle();
  const failed = await service.getJobStatus({ jobId: sync.data.jobId });
  assert.equal(failed.data.status, "failed");
  assert.equal(failed.data.error.code, "authentication_required");

  const download = await service.downloadCourseMaterials({ course: "1" });
  assert.equal(download.data.status, "queued");
});

test("download jobs dedupe equivalents and enforce the active concurrency cap", async () => {
  const resolvers = [];
  const { service } = await setup({
    adapter: {
      async sync() { return snapshot; },
      downloadCourseMaterials() {
        return new Promise((resolve) => { resolvers.push(resolve); });
      }
    },
    serviceOptions: { maxActiveDownloads: 2 }
  });
  const first = await service.downloadCourseMaterials({ course: "1", section: "S1" });
  const duplicate = await service.downloadCourseMaterials({ course: "1", section: "S1" });
  const second = await service.downloadCourseMaterials({ course: "1", section: "S2" });
  assert.equal(duplicate.data.jobId, first.data.jobId);
  assert.notEqual(second.data.jobId, first.data.jobId);
  await assert.rejects(
    service.downloadCourseMaterials({ course: "1", section: "S3" }),
    (error) => error.code === "download_limit_reached"
  );
  for (const resolve of resolvers) resolve({ downloaded: [], skipped: [] });
  await service.waitForIdle();
});

test("completed jobs are pruned and large download payloads are summarized", async () => {
  let clock = "2026-07-24T10:00:00.000Z";
  const { service } = await setup({
    now: () => clock,
    adapter: {
      async sync() { return { ...snapshot, generatedAt: clock, retrievedAt: clock }; },
      async downloadCourseMaterials() {
        return {
          downloaded: Array.from({ length: 100 }, (_, index) => ({ path: `file-${index}` })),
          skipped: []
        };
      }
    },
    serviceOptions: { jobTtlSeconds: 1, maxRetainedJobs: 2 }
  });
  const download = await service.downloadCourseMaterials({ course: "1" });
  await service.waitForIdle();
  const completed = await service.getJobStatus({ jobId: download.data.jobId });
  assert.equal(completed.data.result.downloadedCount, 100);
  assert.equal(Array.isArray(completed.data.result.downloaded), false);
  clock = "2026-07-24T10:00:02.000Z";
  await service.getStatus();
  await assert.rejects(
    service.getJobStatus({ jobId: download.data.jobId }),
    (error) => error.code === "job_not_found"
  );
});

test("background job errors expose normalized lowercase public codes", async () => {
  const { service } = await setup({
    adapter: {
      async sync() {
        const error = new Error("junction escape");
        error.code = "PATH_NOT_ALLOWED";
        throw error;
      }
    }
  });
  const queued = await service.syncPaideia({});
  await service.waitForIdle();
  const failed = await service.getJobStatus({ jobId: queued.data.jobId });
  assert.equal(failed.data.error.code, "path_not_allowed");
});

test("Paideia timeout diagnostics expose a safe category and stage without secrets", async () => {
  const { service } = await setup({
    adapter: {
      async sync() {
        const error = new Error("Timeout at https://paideia.invalid/?token=secret password=hunter2");
        error.name = "TimeoutError";
        error.stage = "course_content.navigation";
        throw error;
      }
    }
  });

  const queued = await service.syncPaideia({});
  await service.waitForIdle();
  const failed = await service.getJobStatus({ jobId: queued.data.jobId });

  assert.equal(failed.data.error.code, "timeout");
  assert.equal(failed.data.error.stage, "course_content.navigation");
  assert.equal(failed.data.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(failed.data.error), /secret|hunter2|https:\/\//i);
});

test("material changes summarize sync history without losing the last good snapshot", async () => {
  const { service, cachePath } = await setup();
  const job = await service.syncPaideia({});
  await service.waitForIdle();
  const updated = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(updated.generatedAt, now);
  const changes = await service.listMaterialChanges({ limit: 10 });
  assert.equal(changes.data.syncs.length, 1);
  assert.equal(changes.data.syncs[0].jobId, job.data.jobId);
});

test("sync preserves last good course slices and unavailable extracted views", async () => {
  const degraded = {
    ...snapshot,
    generatedAt: now,
    retrievedAt: now,
    activities: snapshot.activities.filter((item) => item.courseId !== "1"),
    pendingItems: snapshot.pendingItems.filter((item) => item.courseId !== "1"),
    materials: snapshot.materials.filter((item) => item.courseId !== "1"),
    activityDetails: { a1: { id: "a1", state: "unavailable" } },
    announcements: { "1": { state: "available", items: [] } },
    grades: { "1": { state: "error", items: [] } },
    failedCourseIds: ["1"]
  };
  const { service, cachePath } = await setup({
    adapter: { async sync() { return degraded; } }
  });
  await service.syncPaideia({});
  await service.waitForIdle();
  const updated = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(updated.activities.some((item) => item.id === "a1"), true);
  assert.equal(updated.pendingItems.some((item) => item.id === "a1"), true);
  assert.equal(updated.materials.some((item) => item.id === "m1"), true);
  assert.equal(updated.activityDetails.a1.instructions, "Resolver.");
  assert.equal(updated.announcements["1"].state, "available");
  assert.equal(updated.announcements["1"].items[0].title, "Aviso");
  assert.equal(updated.grades["1"].state, "available");
  assert.equal(updated.grades["1"].items[0].rawGrade, "18");
});

test("available empty announcement and grade views clear stale cached items", async () => {
  const refreshed = {
    ...snapshot,
    generatedAt: now,
    retrievedAt: now,
    announcements: { "1": { state: "available", items: [] } },
    grades: { "1": { state: "available", items: [] } }
  };
  const { service, cachePath } = await setup({
    adapter: { async sync() { return refreshed; } }
  });
  await service.syncPaideia({});
  await service.waitForIdle();
  const updated = JSON.parse(await readFile(cachePath, "utf8"));
  assert.deepEqual(updated.announcements["1"].items, []);
  assert.deepEqual(updated.grades["1"].items, []);
});

test("explicit unsafe download destinations return path_not_allowed", async () => {
  const { service, dir } = await setup();
  await assert.rejects(
    service.downloadCourseMaterials({
      course: "1",
      destination: path.join(dir, "outside")
    }),
    (error) => error.code === "path_not_allowed"
  );
});

test("folder downloads resolve stale references with a focused metadata refresh", async () => {
  const folder = {
    id: "3256941",
    courseId: "1",
    course: "Álgebra",
    section: "Semana 1",
    type: "folder",
    kind: "folder",
    title: "CLASE",
    url: "https://example/mod/folder/view.php?id=3256941"
  };
  const calls = [];
  const { service, cachePath } = await setup({
    adapter: {
      async sync(input) {
        calls.push({ operation: "sync", input });
        return {
          ...snapshot,
          generatedAt: now,
          retrievedAt: now,
          activities: [...snapshot.activities, folder],
          materials: [...snapshot.materials, folder],
          coverage: {
            components: ["catalog", "course_content"],
            allCourses: true
          }
        };
      },
      async downloadResource(input) {
        calls.push({ operation: "download", input });
        return { destination: input.destination, downloaded: [], skipped: [] };
      }
    }
  });

  const queued = await service.downloadResource({ resource: "3256941" });
  assert.equal(queued.data.status, "queued");
  await service.waitForIdle();

  const completed = await service.getJobStatus({ jobId: queued.data.jobId });
  assert.equal(completed.data.status, "completed");
  assert.deepEqual(calls.map(({ operation }) => operation), ["sync", "download"]);
  assert.deepEqual(calls[0].input.components, ["catalog", "course_content"]);
  assert.equal(calls[1].input.resource.id, "3256941");
  assert.equal(calls[1].input.resource.kind, "folder");
  assert.equal(
    JSON.parse(await readFile(cachePath, "utf8")).materials.some(({ id }) => id === "3256941"),
    true
  );
});

test("folder contents are inspected on demand and folder-only activities remain resolvable", async () => {
  const folder = {
    id: "folder-only",
    courseId: "1",
    course: "Álgebra",
    section: "Semana 2",
    type: "folder",
    title: "Lecturas",
    url: "https://example/mod/folder/view.php?id=44"
  };
  const folderOnlySnapshot = {
    ...snapshot,
    activities: [...snapshot.activities, folder]
  };
  const calls = [];
  const { service, cachePath } = await setup({
    adapter: {
      async sync() { throw new Error("not called"); },
      async getFolderContents(input) {
        calls.push(input);
        return {
          folder: input.resource,
          count: 2,
          items: [
            { title: "Semana 1.pdf", relativePath: "Semana 1.pdf" },
            { title: "Tablas.pdf", relativePath: "Anexos/Tablas.pdf" }
          ]
        };
      }
    }
  });
  await writeFile(cachePath, JSON.stringify(folderOnlySnapshot));

  const queued = await service.getFolderContents({ folder: "folder-only" });
  assert.equal(queued.data.status, "queued");
  await service.waitForIdle();
  const completed = await service.getJobStatus({ jobId: queued.data.jobId });

  assert.equal(completed.data.status, "completed");
  assert.equal(completed.data.result.count, 2);
  assert.equal(calls[0].resource.id, "folder-only");
});

test("download classification, safe course mapping, and manifest deduplication cover visible file types", async () => {
  assert.equal(classifyDownload({ url: "https://x/file.pdf" }).downloadable, true);
  assert.equal(classifyDownload({ contentDisposition: "attachment; filename=slides.pptx" }).extension, ".pptx");
  assert.equal(classifyDownload({ contentType: "application/octet-stream", contentDisposition: "attachment; filename=data.7z" }).extension, ".7z");
  assert.equal(classifyDownload({ url: "https://x/scan.tiff" }).extension, ".tiff");
  assert.equal(classifyDownload({ url: "https://x/mod/url/view.php?id=4", activityType: "url" }).downloadable, false);
  assert.equal(classifyDownload({ url: "https://x/malware.exe", contentType: "application/octet-stream" }).downloadable, false);
  assert.equal(classifyDownload({ url: "https://x/malware.exe", contentType: "application/pdf" }).downloadable, false);
  assert.equal(classifyDownload({ url: "https://x/script.js", contentType: "text/javascript" }).downloadable, false);
  assert.equal(classifyDownload({ url: "https://x/no-extension", activityType: "resource" }).downloadable, false);
  for (const [name, contentType] of [
    ["notes.doc", "application/msword"],
    ["slides.ppt", "application/vnd.ms-powerpoint"],
    ["slides.pps", "application/vnd.ms-powerpoint"],
    ["sheet.xls", "application/vnd.ms-excel"],
    ["archive.rar", "application/x-rar-compressed"],
    ["archive.rar", "application/x-rar"],
    ["archive.rar", "application/vnd.rar"],
    ["archive.7z", "application/x-7z-compressed"],
    ["archive.zip", "application/x-zip-compressed"],
    ["icon.ico", "image/x-icon"],
    ["scan.tiff", "image/tiff"]
  ]) {
    assert.equal(
      classifyDownload({ url: `https://x/${name}`, contentType }).downloadable,
      true,
      `${name} ${contentType}`
    );
  }

  const root = "C:\\Users\\student\\OneDrive\\.UNI V2";
  assert.equal(courseDestination("SIMULACIÓN", root), path.join(root, "SIMULACION"));
  assert.equal(courseDestination("Curso ambiguo", root), path.join(root, "Curso ambiguo"));
  assert.equal(
    materialDestination("SIMULACIÓN", "Semana 1", path.join(root, "SIMULACION")),
    path.join(root, "SIMULACION", "Semana 1")
  );
  assert.equal(
    materialDestination("FUNDAMENTOS DE LA CADENA DE SUMINISTROS", "S06b - Inventarios", path.join(root, "FUNDAMENTOS DE LA CADENA DE SUMINISTROS")),
    path.join(root, "FUNDAMENTOS DE LA CADENA DE SUMINISTROS", "S06b - Inventarios")
  );
  assert.equal(
    courseDestination("Curso", "C:\\Users\\student\\OneDrive\\UNI"),
    path.join("C:\\Users\\student\\OneDrive\\UNI", "Curso")
  );
  assert.doesNotThrow(() =>
    validateDownloadDestination(path.join(root, "Curso", "SILABOS MD"), root)
  );
  assert.throws(
    () => validateDownloadDestination(path.resolve(root, "..", "escape"), root),
    /outside/i
  );

  const manifest = createDownloadManifest({
    entries: [
      { sourceUrl: "https://x/a", size: 10, sha256: "one" },
      { sourceUrl: "https://x/b", size: 20, sha256: "two" }
    ]
  });
  assert.equal(manifest.has({ sourceUrl: "https://x/a" }), true);
  assert.equal(manifest.has({ sourceUrl: "https://new", size: 20, sha256: "two" }), true);
  assert.equal(manifest.has({ sourceUrl: "https://new", size: 20, sha256: "different" }), false);
});

test("Windows filenames and existing reparse ancestors fail closed", async () => {
  assert.equal(safeName("CON."), "_CON");
  assert.equal(safeName("LPT1 "), "_LPT1");
  assert.equal(safeName("report. "), "report");
  assert.equal(sanitizeDownloadFileName("CON.pdf", ".pdf"), "_CON.pdf");
  assert.equal(sanitizeDownloadFileName("payload.exe", ".pdf"), "payload.pdf");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "paideia-reparse-"));
  const root = path.join(temporary, ".UNI V2");
  const inside = path.join(root, "inside");
  const linked = path.join(root, "linked");
  await mkdir(inside, { recursive: true });
  await symlink(inside, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    resolveSafeWritePath(path.join(linked, "file.pdf"), root),
    (error) => error.code === "path_not_allowed"
  );
});
