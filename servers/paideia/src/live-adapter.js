import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  readJsonCache,
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
  parseGradesHtml,
  isPlausibleCoursePage
} from "./parsers.js";
import { searchableText } from "./text.js";
import { createPaideiaUrlPolicy } from "./url-policy.js";

const manifestLocks = new Map();

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
  playwrightLoader = () => import("playwright")
} = {}) {
  async function withSession(task, { acceptDownloads = false } = {}) {
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
    if ((await page.locator("#username").count()) > 0) {
      throw paideiaError(
        "authentication_required",
        "Paideia authentication did not complete"
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
    return withSession(async ({ context, page, config, policy }) => {
      const retrievedAt = new Date().toISOString();
      const primaryDashboardHtml = await page.content();
      const areas = paideiaAreaDefinitions(config);
      const { courses, areaStates } = await collectPaideiaAreaCourses(
        areas,
        async (area) => {
          if (area.required) return primaryDashboardHtml;
          const areaPage = await context.newPage();
          try {
            await openAuthenticatedDashboard(
              areaPage,
              `${area.baseUrl}/my/courses.php`,
              config,
              policy
            );
            return await areaPage.content();
          } finally {
            await areaPage.close().catch(() => {});
          }
        }
      );
      const courseConcurrency = Math.min(
        Math.max(Number(options.courseConcurrency || 4), 1),
        6
      );
      const courseResults = await mapLimit(
        courses,
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
          } catch {
            return { course, parsed: null, failed: true };
          } finally {
            await coursePage.close().catch(() => {});
          }
        }
      );

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
      const normalizedCourses = courses.map((course, index) => ({
        ...course,
        sections: parsedCourses[index].sections
      }));
      const activityDetails = {};
      await mapLimit(
        pendingItems,
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
          } catch {
            activityDetails[activity.id] = {
              id: activity.id,
              state: "unavailable"
            };
          } finally {
            await detailPage.close().catch(() => {});
          }
        }
      );

      const announcements = {};
      const grades = {};
      await mapLimit(normalizedCourses, Math.min(courseConcurrency, 4), async (course) => {
        const courseActivities = activities.filter((item) => item.courseId === course.id);
        const announcementForum = courseActivities.find((item) =>
          item.type === "forum" &&
          /\b(?:avisos?|anuncios?|novedades|noticias|news|announcements?)\b/i.test(
            searchableText(item.title)
          )
        );
        if (announcementForum) {
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
          } catch {
            announcements[course.id] = { state: "unavailable", items: [] };
          } finally {
            await forumPage.close().catch(() => {});
          }
        } else {
          announcements[course.id] = { state: "unavailable", items: [] };
        }

        const gradePage = await context.newPage();
        try {
          await safeGoto(
            gradePage,
            `${new URL(course.url).origin}/grade/report/user/index.php?id=${encodeURIComponent(course.sourceId ?? course.id)}`,
            policy,
            { waitUntil: "domcontentloaded", timeout: 30_000 }
          );
          grades[course.id] = parseGradesHtml(await gradePage.content(), course);
        } catch {
          grades[course.id] = { state: "unavailable", items: [] };
        } finally {
          await gradePage.close().catch(() => {});
        }
      });

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
        areaStates
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

  async function downloadResponse(
    context,
    link,
    destination,
    options,
    manifest,
    persist,
    policy
  ) {
    if (manifest.has({ sourceUrl: link.url })) {
      return { status: "skipped", reason: "source_url_seen", sourceUrl: link.url };
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
    if (manifest.has(candidate)) {
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
    await mkdir(targetDestination, { recursive: true });
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
      { acceptDownloads: true }
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
      { acceptDownloads: true }
    );
  }

  return { sync, downloadResource, downloadCourseMaterials };
}
