import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createReusableSessionManager,
  readJsonCache,
  resolveCourse,
  writeJsonAtomic
} from "@pucp-academic-mcp/common";

import { loadPaideiaConfig } from "./config.js";
import {
  collectPaideiaAreaCourses,
  paideiaAreaDefinitions
} from "./areas.js";
import {
  classifyDownload,
  createDownloadManifest,
  materialDestination,
  resolveSafeWritePath,
  sanitizeDownloadFileName
} from "./downloads.js";
import {
  parseActivityDetailHtml,
  parseAnnouncementsHtml,
  parseCourseHtml,
  parseDashboardHtml,
  parseGradesHtml,
  parseTimelineCourseCatalog,
  isPlausibleCoursePage
} from "./parsers.js";
import { searchableText } from "./text.js";
import { createPaideiaUrlPolicy } from "./url-policy.js";

const manifestLocks = new Map();
const defaultPlaywrightLoader = () => import("playwright");

function paideiaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function disposeResponse(response) {
  if (typeof response?.dispose === "function") {
    await response.dispose().catch(() => {});
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function fileNameFromHeaders(headers, url, title, extension) {
  const disposition = headers["content-disposition"] || "";
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let urlName = "";
  try {
    urlName = decodeURIComponent(path.basename(new URL(url).pathname));
  } catch {
    // A generated safe fallback is used below.
  }
  let raw = encoded ?? plain ?? urlName ?? title ?? "paideia-resource";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Preserve a malformed but sanitized server filename.
  }
  return sanitizeDownloadFileName(raw, extension);
}

async function uniqueTarget(directory, name, { overwrite, skipExisting }) {
  const first = path.join(directory, name);
  if (!existsSync(first) || overwrite) return { path: first, exists: false };
  if (skipExisting) return { path: first, exists: true };
  const parsed = path.parse(name);
  for (let suffix = 2; ; suffix++) {
    const candidate = path.join(directory, `${parsed.name}-${suffix}${parsed.ext}`);
    if (!existsSync(candidate)) return { path: candidate, exists: false };
  }
}

export async function waitForPaideiaLanding(
  page,
  { timeout = 12_000 } = {}
) {
  await page
    .locator(
      'a[href*="/course/view.php?id="], body#page-my-courses, [data-region="course-content"], #username'
    )
    .first()
    .waitFor({ state: "visible", timeout })
    .catch(() => {});
}

export function createLivePaideiaAdapter({
  configLoader = loadPaideiaConfig,
  playwrightLoader = defaultPlaywrightLoader,
  reuseSessions = playwrightLoader === defaultPlaywrightLoader,
  epochNow = () => Date.now(),
  continuingCooldownMs = 30 * 60 * 1000
} = {}) {
  const areaCooldowns = new Map();
  const sessionManager = createReusableSessionManager({
    create: async ({ config, policy }) => {
      const { chromium } = await playwrightLoader();
      const launchOptions = {
        headless: true,
        args: ["--disable-dev-shm-usage", "--disable-gpu"]
      };
      if (config.chromePath && existsSync(config.chromePath)) {
        launchOptions.executablePath = config.chromePath;
      }
      const browser = await chromium.launch(launchOptions);
      let context;
      let page;
      try {
        context = await browser.newContext({
          viewport: { width: 1366, height: 1000 },
          acceptDownloads: true
        });
        if (typeof context.route === "function") {
          await context.route("**/*", (route) => {
            try {
              policy.assertOrigin(route.request().url());
            } catch {
              return route.abort();
            }
            return ["image", "media", "font"].includes(route.request().resourceType())
              ? route.abort()
              : route.continue();
          });
        }
        page = await context.newPage();
        return {
          browser, context, page, config, policy,
          async close() {
            await page?.close().catch(() => {});
            await context?.close().catch(() => {});
            await browser?.close().catch(() => {});
          }
        };
      } catch (error) {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
        throw error;
      }
    },
    authenticate: ({ page, config, policy }) => openAuthenticatedDashboard(
      page,
      `${config.baseUrl}/my/courses.php`,
      config,
      policy
    ),
    isAuthenticationError: (error) => ["authentication_required", "session_expired"]
      .includes(String(error?.code ?? "").toLowerCase())
  });

  async function loadTimelineCatalog(page, area, policy) {
    const method = "core_course_get_enrolled_courses_by_timeline_classification";
    policy.assertNavigation(`${area.baseUrl}/lib/ajax/service.php?info=${method}`);
    try {
      const batches = await page.evaluate(async ({ baseUrl, classifications, methodName }) => {
        const sesskey = globalThis.M?.cfg?.sesskey ||
          document.querySelector('input[name="sesskey"]')?.value || "";
        if (!sesskey) throw new Error("timeline_sesskey_unavailable");
        const endpoint = `${baseUrl}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${encodeURIComponent(methodName)}`;
        const output = [];
        for (const classification of classifications) {
          let offset = 0;
          const courses = [];
          for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
            const response = await fetch(endpoint, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify([{
                index: 0,
                methodname: methodName,
                args: {
                  offset,
                  limit: 0,
                  classification,
                  sort: "fullname",
                  customfieldname: "",
                  customfieldvalue: ""
                }
              }])
            });
            if (!response.ok) throw new Error(`timeline_http_${response.status}`);
            const payload = await response.json();
            const entry = Array.isArray(payload) ? payload[0] : payload;
            if (entry?.error) throw new Error("timeline_service_error");
            const pageCourses = Array.isArray(entry?.data?.courses)
              ? entry.data.courses
              : [];
            courses.push(...pageCourses);
            const nextOffset = Number(entry?.data?.nextoffset);
            if (!Number.isFinite(nextOffset) || nextOffset < 0 || nextOffset <= offset) break;
            offset = nextOffset;
          }
          output.push({ classification, courses });
        }
        return output;
      }, {
        baseUrl: area.baseUrl,
        classifications: ["inprogress", "future", "past"],
        methodName: method
      });
      if (!Array.isArray(batches)) throw new Error("timeline_response_invalid");
      return parseTimelineCourseCatalog(batches, area.baseUrl, { area: area.id });
    } catch {
      return parseDashboardHtml(await page.content(), area.baseUrl, { area: area.id });
    }
  }

  function defaultContentCourse(course) {
    const classifications = course.timelineClassifications ?? [];
    return classifications.length === 0 || classifications.includes("inprogress");
  }
  async function withSession(task, { acceptDownloads = false, idempotent = true } = {}) {
    const config = await configLoader();
    if (!config.user || !config.pass) {
      throw paideiaError(
        "authentication_required",
        "Paideia credentials are required in local .env.local or PAIDEIA_USER/PAIDEIA_PASS"
      );
    }
    const policy = createPaideiaUrlPolicy({
      baseUrl: config.baseUrl,
      readOrigins: [config.continuingBaseUrl],
      authHosts: config.authHosts
    });
    if (reuseSessions) {
      return sessionManager.run({
        key: `${config.baseUrl}|${config.continuingBaseUrl}|${config.user}`,
        descriptor: { config, policy },
        idempotent
      }, ({ browser, context, page }) => task({ browser, context, page, config, policy }));
    }
    let browser;
    let context;
    let page;
    try {
      const { chromium } = await playwrightLoader();
      const launchOptions = {
        headless: true,
        args: ["--disable-dev-shm-usage", "--disable-gpu"]
      };
      if (config.chromePath && existsSync(config.chromePath)) {
        launchOptions.executablePath = config.chromePath;
      }
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext({
        viewport: { width: 1366, height: 1000 },
        acceptDownloads
      });
      if (typeof context.route === "function") {
        await context.route("**/*", (route) => {
          try {
            policy.assertOrigin(route.request().url());
          } catch {
            return route.abort();
          }
          const type = route.request().resourceType();
          return !acceptDownloads && ["image", "media", "font"].includes(type)
            ? route.abort()
            : route.continue();
        });
      }
      page = await context.newPage();
      const dashboardUrl = `${config.baseUrl}/my/courses.php`;
      await openAuthenticatedDashboard(
        page,
        dashboardUrl,
        config,
        policy
      );
      return await task({ browser, context, page, config, policy });
    } finally {
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  function assertNavigationChain(response, policy, options = {}) {
    let request =
      response && typeof response.request === "function"
        ? response.request()
        : null;
    while (request) {
      policy.assertNavigation(request.url(), options);
      request =
        typeof request.redirectedFrom === "function"
          ? request.redirectedFrom()
          : null;
    }
  }

  async function openAuthenticatedDashboard(
    page,
    dashboardUrl,
    config,
    policy
  ) {
    const requestedOrigin = new URL(dashboardUrl).origin;
    policy.assertNavigation(dashboardUrl);
    const dashboardResponse = await page.goto(dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    assertNavigationChain(dashboardResponse, policy, { allowAuth: true });
    policy.assertNavigation(page.url(), { allowAuth: true });
    const loginVisible = (await page.locator("#username").count()) > 0;
    if (loginVisible) {
      policy.assertCredentialOrigin(page.url());
      await page.fill("#username", config.user);
      await page.fill("#password", config.pass);
      const access = page.locator('input[type="button"][value="Acceder"]');
      if ((await access.count()) > 0) {
        const [navigationResponse] = await Promise.all([
          page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 45_000
          }).catch(() => null),
          access.click({ noWaitAfter: true })
        ]);
        assertNavigationChain(navigationResponse, policy, {
          allowAuth: true
        });
      } else {
        const navigation = page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 45_000
        }).catch(() => null);
        await page.press("#password", "Enter");
        const navigationResponse = await navigation;
        assertNavigationChain(navigationResponse, policy, {
          allowAuth: true
        });
      }
      await waitForPaideiaLanding(page);
      policy.assertNavigation(page.url(), { allowAuth: true });
    }
    if (!loginVisible && new URL(page.url()).origin !== new URL(dashboardUrl).origin) {
      // An already authenticated Pandora session can redirect automatically
      // without rendering the credential form. Wait for that passive SSO hop
      // before deciding that the optional Moodle area is unavailable.
      await waitForPaideiaLanding(page);
      policy.assertNavigation(page.url(), { allowAuth: true });
    }
    if (new URL(page.url()).origin !== requestedOrigin) {
      // SSO can finish on the primary Moodle area instead of honoring the
      // requested Education Continua relay target. Reopen the exact dashboard
      // once with the established session so its catalog is never confused
      // with the primary area.
      const retryResponse = await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      assertNavigationChain(retryResponse, policy, { allowAuth: true });
      await waitForPaideiaLanding(page);
      policy.assertNavigation(page.url(), { allowAuth: true });
    }
    if ((await page.locator("#username").count()) > 0) {
      throw paideiaError(
        "authentication_required",
        "Paideia authentication did not complete"
      );
    }
    if (new URL(page.url()).origin !== requestedOrigin) {
      throw paideiaError(
        "session_expired",
        "Paideia did not open the requested course area"
      );
    }
    policy.assertNavigation(page.url());
  }

  async function safeGoto(page, url, policy, options = {}) {
    policy.assertNavigation(url);
    const response = await page.goto(url, options);
    assertNavigationChain(response, policy);
    policy.assertNavigation(page.url());
  }

  async function requestWithPolicy(context, initialUrl, policy) {
    let currentUrl = policy.assertNavigation(initialUrl).href;
    for (let redirects = 0; redirects <= 10; redirects += 1) {
      const response = await context.request.get(currentUrl, {
        maxRedirects: 0,
        timeout: 60_000
      });
      try {
        const responseUrl =
          typeof response.url === "function" ? response.url() : currentUrl;
        policy.assertNavigation(responseUrl);
        if (response.status() >= 300 && response.status() < 400) {
          const location = response.headers().location;
          if (!location) {
            throw paideiaError("download_failed", "Paideia redirect omitted Location");
          }
          currentUrl = policy.assertNavigation(
            new URL(location, responseUrl).href
          ).href;
          await disposeResponse(response);
          continue;
        }
        return response;
      } catch (error) {
        await disposeResponse(response);
        throw error;
      }
    }
    throw paideiaError("download_failed", "Paideia resource redirected too many times");
  }

  async function sync(options = {}) {
    const syncStarted = Date.now();
    return withSession(async ({ context, page, config, policy }) => {
      const retrievedAt = new Date().toISOString();
      const requested = new Set(options.components ?? [
        "catalog",
        "course_content",
        "activity_details",
        "announcements",
        "grades"
      ]);
      requested.add("catalog");
      if (requested.has("activity_details") || requested.has("announcements")) {
        requested.add("course_content");
      }
      const componentOrder = [
        "catalog",
        "course_content",
        "activity_details",
        "announcements",
        "grades"
      ];
      const components = componentOrder.filter((component) => requested.has(component));
      const timings = {};
      const failures = [];
      const stage = async (name, operation) => {
        const started = Date.now();
        try {
          return await operation();
        } finally {
          timings[`${name}Ms`] = Date.now() - started;
        }
      };
      const areas = paideiaAreaDefinitions(config);
      const collected = await stage("catalog", () =>
        collectPaideiaAreaCourses(
          areas,
          async (area) => {
            if (area.required) return loadTimelineCatalog(page, area, policy);
            const cooldownUntil = areaCooldowns.get(area.id) ?? 0;
            if (
              options.retryUnavailableAreas !== true &&
              cooldownUntil > epochNow()
            ) {
              throw paideiaError(
                "area_cooldown",
                "Optional Paideia area is temporarily in cooldown"
              );
            }
            const areaPage = await context.newPage();
            try {
              await openAuthenticatedDashboard(
                areaPage,
                `${area.baseUrl}/my/courses.php`,
                config,
                policy
              );
              areaCooldowns.delete(area.id);
              // Await inside the try so the finally block cannot close the
              // area page while its timeline AJAX request is still running.
              return await loadTimelineCatalog(areaPage, area, policy);
            } catch (error) {
              areaCooldowns.set(area.id, epochNow() + continuingCooldownMs);
              throw error;
            } finally {
              await areaPage.close().catch(() => {});
            }
          }
        )
      );
      const courses = collected.courses;
      const areaStates = collected.areaStates.map((entry) => {
        const cooldownUntil = areaCooldowns.get(entry.area) ?? 0;
        return entry.state === "unavailable" && cooldownUntil > epochNow()
          ? {
              ...entry,
              reason: "cooldown",
              retryAfter: new Date(cooldownUntil).toISOString()
            }
          : entry;
      });
      const courseConcurrency = Math.min(
        Math.max(Number(options.courseConcurrency || 4), 1),
        6
      );
      const selectedContentCourse = options.course ? resolveCourse(courses, options.course) : null;
      const contentCourses = courses.filter((course) => selectedContentCourse
        ? course.id === selectedContentCourse.id
        : defaultContentCourse(course));
      const courseResults = requested.has("course_content")
        ? await stage("courseContent", () => mapLimit(
            contentCourses,
            courseConcurrency,
            async (course) => {
              const coursePage = await context.newPage();
              try {
                await safeGoto(coursePage, course.url, policy, {
                  waitUntil: "domcontentloaded",
                  timeout: 45_000
                });
                const html = await coursePage.content();
                const parsed = parseCourseHtml(
                  html,
                  course,
                  new URL(course.url).origin
                );
                if (!isPlausibleCoursePage(html, parsed)) {
                  throw paideiaError(
                    "scrape_failed",
                    "Paideia course page was structurally implausible"
                  );
                }
                return { course, parsed, failed: false };
              } catch (error) {
                failures.push({
                  stage: "course_content",
                  courseId: course.id,
                  code: typeof error?.code === "string" ? error.code : "operation_failed"
                });
                return { course, parsed: null, failed: true };
              } finally {
                await coursePage.close().catch(() => {});
              }
            }
          ))
        : [];

      const parsedCourses = courseResults.map(({ parsed }) => parsed ?? {
        sections: [],
        activities: [],
        pendingItems: [],
        materials: []
      });
      const failedCourseIds = courseResults
        .filter(({ failed }) => failed)
        .map(({ course }) => course.id);
      const activities = parsedCourses.flatMap((course) => course.activities);
      const pendingItems = parsedCourses.flatMap((course) => course.pendingItems);
      const materials = parsedCourses.flatMap((course) => course.materials);
      const parsedByCourseId = new Map(
        courseResults.map(({ course }, index) => [course.id, parsedCourses[index]])
      );
      const normalizedCourses = courses.map((course) => ({
        ...course,
        sections: parsedByCourseId.get(course.id)?.sections ?? []
      }));
      const contentCourseIds = new Set(contentCourses.map(({ id }) => id));
      const normalizedContentCourses = normalizedCourses.filter(({ id }) =>
        contentCourseIds.has(id)
      );
      const activityDetails = {};
      if (requested.has("activity_details")) {
        await stage("activityDetails", () => mapLimit(
          options.activity
            ? activities.filter(({ id, url }) => [id, url].includes(options.activity))
            : pendingItems,
          Math.min(Math.max(Number(options.detailConcurrency || 5), 1), 8),
          async (activity) => {
            const detailPage = await context.newPage();
            try {
              await safeGoto(detailPage, activity.url, policy, {
                waitUntil: "domcontentloaded",
                timeout: 30_000
              });
              // Only the assignment/quiz overview URL is loaded. No attempt,
              // submission editor, or answer link is clicked.
              activityDetails[activity.id] = parseActivityDetailHtml(
                await detailPage.content(),
                activity
              );
            } catch (error) {
              failures.push({
                stage: "activity_details",
                courseId: activity.courseId,
                activityId: activity.id,
                code: typeof error?.code === "string" ? error.code : "operation_failed"
              });
              activityDetails[activity.id] = {
                id: activity.id,
                state: "unavailable"
              };
            } finally {
              await detailPage.close().catch(() => {});
            }
          }
        ));
      }

      const announcements = {};
      const grades = {};
      if (requested.has("announcements")) {
        await stage("announcements", () => mapLimit(
          normalizedContentCourses,
          Math.min(courseConcurrency, 4),
          async (course) => {
            const courseActivities = activities.filter((item) => item.courseId === course.id);
            const announcementForum = courseActivities.find((item) =>
              item.type === "forum" &&
              /\b(?:avisos?|anuncios?|novedades|noticias|news|announcements?)\b/i.test(
                searchableText(item.title)
              )
            );
            if (!announcementForum) {
              announcements[course.id] = { state: "unavailable", items: [] };
              return;
            }
            const forumPage = await context.newPage();
            try {
              await safeGoto(forumPage, announcementForum.url, policy, {
                waitUntil: "domcontentloaded",
                timeout: 30_000
              });
              announcements[course.id] = {
                state: "available",
                items: parseAnnouncementsHtml(
                  await forumPage.content(),
                  course,
                  new URL(course.url).origin
                )
              };
            } catch (error) {
              failures.push({
                stage: "announcements",
                courseId: course.id,
                code: typeof error?.code === "string" ? error.code : "operation_failed"
              });
              announcements[course.id] = { state: "unavailable", items: [] };
            } finally {
              await forumPage.close().catch(() => {});
            }
          }
        ));
      }
      if (requested.has("grades")) {
        await stage("grades", () => mapLimit(
          normalizedContentCourses,
          Math.min(courseConcurrency, 4),
          async (course) => {
            const gradePage = await context.newPage();
            try {
              await safeGoto(
                gradePage,
                `${new URL(course.url).origin}/grade/report/user/index.php?id=${encodeURIComponent(course.sourceId ?? course.id)}`,
                policy,
                { waitUntil: "domcontentloaded", timeout: 30_000 }
              );
              grades[course.id] = parseGradesHtml(await gradePage.content(), course);
            } catch (error) {
              failures.push({
                stage: "grades",
                courseId: course.id,
                code: typeof error?.code === "string" ? error.code : "operation_failed"
              });
              grades[course.id] = { state: "unavailable", items: [] };
            } finally {
              await gradePage.close().catch(() => {});
            }
          }
        ));
      }

      timings.totalMs = Date.now() - syncStarted;
      return {
        generatedAt: new Date().toISOString(),
        retrievedAt,
        courses: normalizedCourses,
        activities,
        pendingItems,
        materials,
        activityDetails,
        announcements,
        grades,
        failedCourseIds,
        areaStates,
        coverage: {
          components,
          allCourses: !components.some((component) => component !== "catalog") ||
            contentCourses.length === courses.length,
          courseIds: contentCourses.map(({ id }) => id)
        },
        timings,
        failures
      };
    });
  }

  async function collectVisibleLinks(page) {
    return page.evaluate(() =>
      [...document.querySelectorAll('main a[href], [role="main"] a[href], #region-main a[href]')]
        .filter((anchor) => {
          const style = window.getComputedStyle(anchor);
          const rect = anchor.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0 &&
            !anchor.closest("#courseindex")
          );
        })
        .map((anchor) => ({
          url: anchor.href,
          title:
            anchor.innerText ||
            anchor.textContent ||
            anchor.getAttribute("title") ||
            ""
        }))
    );
  }

  async function collectFolderLinks(page) {
    return page.evaluate(() => {
      const root =
        document.querySelector(".foldertree, [data-region='foldertree'], [id^='folder_tree']") ||
        document.querySelector("main, [role='main'], #region-main");
      if (!root) return [];
      return [...root.querySelectorAll('a[href*="pluginfile.php"]')]
        .filter((anchor) => {
          const style = window.getComputedStyle(anchor);
          return style.visibility !== "hidden" && style.display !== "none";
        })
        .map((anchor) => ({
          url: anchor.href,
          title:
            anchor.innerText ||
            anchor.textContent ||
            anchor.getAttribute("title") ||
            ""
        }));
    });
  }

  function folderRelativePath(url, title) {
    try {
      const segments = decodeURIComponent(new URL(url).pathname)
        .split("/")
        .filter(Boolean);
      const content = segments.findIndex((segment) => segment === "content");
      if (
        content > 0 &&
        segments[content - 1] === "mod_folder" &&
        segments.length > content + 2
      ) {
        return segments
          .slice(content + 2)
          .filter((segment) => segment !== "." && segment !== "..")
          .join("/");
      }
      return decodeURIComponent(path.basename(new URL(url).pathname)) || String(title).trim();
    } catch {
      return String(title).trim();
    }
  }

  async function getFolderContents(options) {
    if ((options.resource?.kind || options.resource?.type) !== "folder") {
      throw paideiaError(
        "resource_not_folder",
        "The selected Paideia activity is not a Moodle folder"
      );
    }
    return withSession(async ({ page, policy }) => {
      await safeGoto(page, options.resource.url, policy, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      const links = await collectFolderLinks(page);
      const unique = [];
      const seen = new Set();
      for (const link of links) {
        try {
          const url = policy.assertFileEndpoint(link.url).href;
          if (seen.has(url)) continue;
          seen.add(url);
          const relativePath = folderRelativePath(url, link.title);
          unique.push({
            id: `folder-file-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`,
            title: path.basename(relativePath) || String(link.title).trim(),
            relativePath,
            type: "resource",
            kind: "resource",
            url
          });
        } catch {
          // Ignore navigation, form, and foreign links embedded in the folder page.
        }
      }
      const limit = Math.min(Math.max(Number(options.limit || 100), 1), 500);
      return {
        folder: {
          id: options.resource.id,
          courseId: options.resource.courseId,
          course: options.resource.course,
          section: options.resource.section,
          title: options.resource.title,
          url: options.resource.url
        },
        count: unique.length,
        returnedCount: Math.min(unique.length, limit),
        truncated: unique.length > limit,
        items: unique.slice(0, limit)
      };
    });
  }

  async function downloadResponse(
    context,
    link,
    destination,
    options,
    manifest,
    persist,
    policy
  ) {
    const liveManifestEntry = async (candidate) => {
      for (;;) {
        const entry = manifest.find(candidate);
        if (!entry) return null;
        try {
          const storedPath = await resolveSafeWritePath(entry.path, options.uniRoot);
          const stored = await stat(storedPath);
          if (!stored.isFile()) throw new Error("manifest target is not a file");
          return { ...entry, path: storedPath, size: stored.size };
        } catch {
          manifest.remove(entry);
          await persist();
        }
      }
    };
    const sourceEntry = await liveManifestEntry({ sourceUrl: link.url });
    if (sourceEntry) {
      return {
        status: "skipped",
        reason: "source_url_seen",
        sourceUrl: link.url,
        path: sourceEntry.path,
        size: sourceEntry.size
      };
    }
    const response = await requestWithPolicy(context, link.url, policy);
    try {
      if (!response.ok()) {
        throw paideiaError(
          "download_failed",
          `Paideia resource returned HTTP ${response.status()}`
        );
      }
      const headers = response.headers();
      const classification = classifyDownload({
        url: link.url,
        activityType: "resource",
        contentType: headers["content-type"] || "",
        contentDisposition: headers["content-disposition"] || ""
      });
      if (
        !classification.downloadable &&
        /text\/html/i.test(headers["content-type"] || "")
      ) {
        return { status: "wrapper", sourceUrl: link.url };
      }
      if (!classification.downloadable) {
        throw paideiaError(
          "resource_not_downloadable",
          "Paideia response is not an approved academic file type"
        );
      }
      const maximum = Number(options.maxResponseBytes || 100 * 1024 * 1024);
      const declared = Number(headers["content-length"] || 0);
      if (declared > maximum) {
        throw paideiaError("resource_too_large", "Paideia resource exceeds the configured size limit");
      }
      const buffer = await response.body();
      if (buffer.length > maximum) {
        throw paideiaError("resource_too_large", "Paideia resource exceeds the configured size limit");
      }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const candidate = { sourceUrl: link.url, size: buffer.length, sha256 };
    if (await liveManifestEntry(candidate)) {
      return { status: "skipped", reason: "duplicate_content", ...candidate };
    }
    const name = fileNameFromHeaders(
      headers,
      link.url,
      link.title,
      classification.extension
    );
    const target = await uniqueTarget(destination, name, options);
    const resolvedTarget = await resolveSafeWritePath(
      target.path,
      options.uniRoot
    );
    if (target.exists) {
      const existing = await stat(resolvedTarget);
      return {
        status: "skipped",
        reason: "already_exists",
        path: resolvedTarget,
        size: existing.size,
        sourceUrl: link.url
      };
    }
    await mkdir(path.dirname(resolvedTarget), { recursive: true });
    await writeFile(resolvedTarget, buffer, {
      flag: options.overwrite ? "w" : "wx"
    });
    const entry = {
      ...candidate,
      path: resolvedTarget,
      downloadedAt: new Date().toISOString()
    };
      manifest.add(entry);
      await persist();
      return { status: "downloaded", ...entry };
    } finally {
      await disposeResponse(response);
    }
  }

  async function downloadResourceInSession(
    context,
    resource,
    destination,
    options,
    manifest,
    persist,
    policy
  ) {
    if (["url", "page"].includes(resource.kind || resource.type)) {
      throw paideiaError(
        "resource_not_downloadable",
        "Paideia URL/page activities are not downloadable files"
      );
    }
    const targetDestination = await resolveSafeWritePath(
      materialDestination(resource.course, resource.section, destination),
      options.uniRoot
    );
    const direct = await downloadResponse(
      context,
      { url: resource.url, title: resource.title },
      targetDestination,
      options,
      manifest,
      persist,
      policy
    );
    if (direct.status !== "wrapper") return [direct];

    const page = await context.newPage();
    try {
      await safeGoto(page, resource.url, policy, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      const links = await collectVisibleLinks(page);
      const unique = [
        ...new Map(
          links
            .filter((link) => {
              try {
                policy.assertFileEndpoint(link.url);
                return true;
              } catch {
                return false;
              }
            })
            .map((link) => [link.url, link])
        ).values()
      ];
      if (unique.length === 0) {
        return [{
          status: "skipped",
          reason: "non_downloadable_activity",
          sourceUrl: resource.url
        }];
      }
      const results = [];
      for (const link of unique) {
        const result = await downloadResponse(
          context,
          link,
          targetDestination,
          options,
          manifest,
          persist,
          policy
        );
        if (result.status !== "wrapper") results.push(result);
      }
      return results;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function withManifest(manifestPath, operation) {
    const previous = manifestLocks.get(manifestPath) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    manifestLocks.set(manifestPath, queued);
    await previous;
    try {
      const stored = await readJsonCache(manifestPath, { fallback: { entries: [] } });
      const manifest = createDownloadManifest(stored);
      const persist = () => writeJsonAtomic(manifestPath, manifest.toJSON());
      return await operation(manifest, persist);
    } finally {
      release();
      if (manifestLocks.get(manifestPath) === queued) {
        manifestLocks.delete(manifestPath);
      }
    }
  }

  async function downloadResource(options) {
    return withSession(
      ({ context, config, policy }) =>
        withManifest(options.manifestPath, async (manifest, persist) => {
          const effective = {
            ...options,
            maxResponseBytes:
              options.maxResponseBytes ?? config.maxResponseBytes
          };
          const results = await downloadResourceInSession(
            context,
            options.resource,
            options.destination,
            effective,
            manifest,
            persist,
            policy
          );
          return {
            destination: options.destination,
            downloaded: results.filter((item) => item.status === "downloaded"),
            skipped: results.filter((item) => item.status === "skipped")
          };
        }),
      { acceptDownloads: true, idempotent: false }
    );
  }

  async function downloadCourseMaterials(options) {
    return withSession(
      ({ context, config, policy }) =>
        withManifest(options.manifestPath, async (manifest, persist) => {
          const effective = {
            ...options,
            maxResponseBytes:
              options.maxResponseBytes ?? config.maxResponseBytes
          };
          const materials = (options.materials ?? [])
            .filter((item) => item.courseId === options.course.id)
            .filter((item) => !options.section || searchableText(item.section).includes(searchableText(options.section)))
            .filter((item) => !options.type || item.type === options.type || item.kind === options.type)
            .filter((item) => !options.query || searchableText(item.title).includes(searchableText(options.query)))
            .filter((item) => ["resource", "folder"].includes(item.kind || item.type))
            .slice(0, Math.min(Number(options.limit || 500), 500));
          const downloaded = [];
          const skipped = [];
          for (const material of materials) {
            const results = await downloadResourceInSession(
              context,
              material,
              options.destination,
              effective,
              manifest,
              persist,
              policy
            );
            downloaded.push(...results.filter((item) => item.status === "downloaded"));
            skipped.push(...results.filter((item) => item.status === "skipped"));
          }
          return {
            destination: options.destination,
            matchedActivities: materials.length,
            downloaded,
            skipped
          };
        }),
      { acceptDownloads: true, idempotent: false }
    );
  }

  async function getActivityDetails(activity) {
    return withSession(async ({ context, policy }) => {
      const page = await context.newPage();
      try {
        await safeGoto(page, activity.url, policy, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return parseActivityDetailHtml(await page.content(), activity);
      } finally {
        await page.close().catch(() => {});
      }
    });
  }
  return {
    sync,
    getActivityDetails,
    getFolderContents,
    downloadResource,
    downloadCourseMaterials,
    close: () => sessionManager.close(),
    getSessionMetrics: () => sessionManager.metrics()
  };
}
