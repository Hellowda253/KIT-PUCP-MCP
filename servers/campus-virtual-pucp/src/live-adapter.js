import {
  createCampusDocumentDownloader
} from "./downloads.js";
import { loadCampusConfig } from "./config.js";
import {
  parseAgendaPayload,
  parseLegacyAcademicTargets,
  parseLegacyAcademicPerformanceHtml,
  parseLegacyCourseDocumentTargets,
  parseLegacyCourseDocumentsHtml,
  parseLegacyCurriculumHtml,
  parseLegacyGradeStatisticsHtml,
  parseLegacyHistoryHtml,
  parseLegacyPartialGradesHtml,
  parseModuleHtml,
  parsePortalModules
} from "./parsers.js";
import { createCampusUrlPolicy } from "./url-policy.js";
import { cleanText, searchableText } from "./text.js";
import { createHash } from "node:crypto";

import {
  buildScheduleScopeCatalogForm,
  buildScheduleSearchForm,
  filterScheduleItemsByCurriculumLevel,
  parseAllowedCoursesHtml,
  parseCrossUnitVacanciesHtml,
  parseEnrollmentCalendarHtml,
  parseEnrollmentImpedimentsResponse,
  parseEnrollmentImpedimentsText,
  parseEnrollmentPortalHtml,
  parseRegistrationSearchPayload,
  parseRegistrationScopePayload,
  parseRegistrationWorkspaceHtml,
  parseScheduleResultsHtml,
  resolveRegistrationAcademicScope,
  scheduleScopeNeedsCatalog
} from "./enrollment-parsers.js";

export async function prepareScheduleScopeCatalog({
  query,
  readEntryHtml,
  postCatalog
}) {
  if (!scheduleScopeNeedsCatalog(query.academicScope)) return "";
  const scope = query.academicScope ?? {};
  let entryHtml = "";
  let catalogForm;
  try {
    catalogForm = buildScheduleScopeCatalogForm(query, entryHtml);
  } catch (error) {
    if (error.code !== "schedule_scope_not_found") throw error;
    entryHtml = await readEntryHtml();
    catalogForm = buildScheduleScopeCatalogForm(query, entryHtml);
  }
  if (
    (scope.specialty && !scope.branchCode)
  ) {
    return postCatalog(catalogForm);
  }
  return entryHtml;
}

const MODULE_KEYS = [
  "agenda",
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

export function selectAcademicPerformanceReportIndex(html) {
  const rows = [];
  for (const { 0: row } of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    if (!/<input\b[^>]*\bname=["']checkboxes["']/i.test(row)) continue;
    const field = (name) => row.match(
      new RegExp(`<input\\b[^>]*\\bname=["']${name}["'][^>]*\\bvalue=["']?([^"'\\s>]*)`, "i")
    )?.[1] ?? "";
    rows.push({
      index: rows.length,
      reportType: field("tiporend"),
      term: `${field("cicloanho")}${field("ciclo").padStart(2, "0")}`
    });
  }
  return rows
    .filter(({ reportType }) => reportType === "2")
    .sort((left, right) => right.term.localeCompare(left.term) || left.index - right.index)[0]
    ?.index ?? -1;
}

export function registrationChangesApplied(
  workspace,
  { addCourseCodes = [], removeRefs = [] } = {}
) {
  const registered = workspace?.registered ?? [];
  const courseCodes = new Set(
    registered.map(({ courseCode }) => String(courseCode ?? "").toUpperCase()).filter(Boolean)
  );
  const references = new Set(
    registered.map(({ internalSelectionRef }) => internalSelectionRef).filter(Boolean)
  );
  return addCourseCodes.every((courseCode) =>
    courseCodes.has(String(courseCode).toUpperCase())
  ) && removeRefs.every((reference) => !references.has(reference));
}

function adapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function limaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function compactDate(iso) {
  return String(iso).replaceAll("-", "");
}

function cleanGrade(value) {
  return String(value ?? "").trim();
}

function sanitizedPageUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/;jsessionid=[^/;?]+/gi, "");
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:session|sesion|codigo|alumno|persona|usuario)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

function publicReason(error) {
  const code = String(error?.code ?? "").toLowerCase();
  return [
    "mutation_refused",
    "network_error",
    "scrape_failed",
    "url_not_allowed"
  ].includes(code)
    ? code
    : "scrape_failed";
}

function responseValue(response, name, fallback) {
  return typeof response?.[name] === "function"
    ? response[name]()
    : response?.[name] ?? fallback;
}

async function disposeResponse(response) {
  if (typeof response?.dispose === "function") {
    await response.dispose().catch(() => {});
  }
}

export async function readStablePageContent(
  page,
  { timeout = 15_000 } = {}
) {
  try {
    return await page.content();
  } catch (error) {
    if (!/page is navigating and changing the content/i.test(error?.message)) {
      throw error;
    }
    await page.waitForLoadState("domcontentloaded", { timeout });
    return page.content();
  }
}

export async function readScheduleEntryPage({ page, entryUrl, policy, navigate }) {
  policy.assertRequest(entryUrl);
  if (typeof navigate === "function") {
    const entry = await navigate(entryUrl);
    policy.assertFinalUrl(entry.url);
    return (entry.frames?.length ? entry.frames : [entry])
      .map(({ html }) => html ?? "")
      .join("\n");
  }
  const response = await page.goto(entryUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  const finalUrl = page.url();
  policy.assertFinalUrl(finalUrl);
  if (response && typeof response.ok === "function" && !response.ok()) {
    throw adapterError(
      "network_error",
      "Campus schedule entry returned a non-success status"
    );
  }
  await page.waitForFunction(
    () => Boolean(document.querySelector('select[name="facultad"]')),
    undefined,
    { timeout: 45_000 }
  );
  return readStablePageContent(page);
}

export async function readAllowedPageFrames(
  page,
  policy,
  { timeout = 5_000 } = {}
) {
  await page
    .waitForLoadState("networkidle", { timeout })
    .catch(() => {});
  const output = [];
  for (const frame of page.frames()) {
    const url = frame.url();
    try {
      policy.assertFinalUrl(url);
    } catch {
      continue;
    }
    output.push({
      url,
      html: await readStablePageContent(frame)
    });
  }
  return output;
}

export async function waitForCampusLanding(
  page,
  policy,
  { timeout = 15_000 } = {}
) {
  await page.waitForURL(
    (candidate) => {
      try {
        if (
          Array.isArray(policy.serviceOrigins) &&
          policy.serviceOrigins.length > 0 &&
          !policy.serviceOrigins.includes(candidate.origin)
        ) {
          return false;
        }
        policy.assertFinalUrl(candidate.href);
        return true;
      } catch {
        return false;
      }
    },
    { waitUntil: "commit", timeout }
  );
}

export async function requestWithRedirectPolicy({
  request,
  initialUrl,
  policy,
  method = "GET",
  form,
  headers,
  timeout = 45_000,
  maxRedirects = 10,
  legacyRead = false,
  registrationWrite = false,
  activeTerm = "",
  expectedAddRefs = [],
  expectedRemoveRefs = []
}) {
  let currentMethod = String(method).toUpperCase();
  const validate = (value, verb) =>
    registrationWrite && verb === "POST"
      ? policy.assertRegistrationWrite(value, {
          body: new URLSearchParams(form).toString(),
          activeTerm,
          expectedAddRefs,
          expectedRemoveRefs
        })
      : legacyRead && verb === "POST"
      ? policy.assertLegacyReadQuery(value, {
          method: verb,
          body: new URLSearchParams(form).toString()
        })
      : policy.assertRequest(value, {
          method: verb,
          ...(verb === "POST" ? { form } : {})
        });
  let currentUrl = validate(initialUrl, currentMethod).href;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const requestOptions = {
      ...(headers ? { headers } : {}),
      ...(currentMethod === "POST" ? { form } : {}),
      maxRedirects: 0,
      timeout
    };
    const response =
      currentMethod === "POST"
        ? await request.post(currentUrl, requestOptions)
        : await request.get(currentUrl, requestOptions);
    try {
      const responseUrl = responseValue(response, "url", currentUrl);
      validate(responseUrl, currentMethod);
      const status = Number(responseValue(response, "status", 0));
      if (status >= 300 && status < 400) {
        const responseHeaders = responseValue(response, "headers", {});
        const location = responseHeaders?.location;
        if (!location) {
          throw adapterError(
            "network_error",
            "Campus redirect omitted Location"
          );
        }
        const target = new URL(location, responseUrl);
        let nextMethod = currentMethod;
        if (
          currentMethod === "POST" &&
          [301, 302, 303].includes(status)
        ) {
          nextMethod = "GET";
        }
        if (
          currentMethod === "POST" &&
          [307, 308].includes(status) &&
          target.origin !== new URL(responseUrl).origin
        ) {
          throw adapterError(
            "url_not_allowed",
            "Campus agenda POST cannot be forwarded across origins"
          );
        }
        currentUrl = validate(target.href, nextMethod).href;
        currentMethod = nextMethod;
        await disposeResponse(response);
        continue;
      }
      return response;
    } catch (error) {
      await disposeResponse(response);
      throw error;
    }
  }
  throw adapterError(
    "network_error",
    "Campus request redirected too many times"
  );
}

async function createPlaywrightSession({ config, policy }) {
  const { chromium } = await import("playwright");
  const launchOptions = {
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu"]
  };
  if (config.chromePath) launchOptions.executablePath = config.chromePath;
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1366, height: 1000 },
    acceptDownloads: false
  });
  let authenticationActive = true;
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (["image", "media", "font"].includes(request.resourceType())) {
      await route.abort();
      return;
    }
    try {
      if (authenticationActive && request.method().toUpperCase() === "POST") {
        policy.assertAuthRequest(request.url(), { method: request.method() });
      } else if (request.method().toUpperCase() === "POST") {
        policy.assertLegacyReadQuery(request.url(), {
          method: request.method(),
          body: request.postData() ?? ""
        });
      } else {
        policy.assertSubresource(request.url(), request.method());
      }
      await route.continue();
    } catch {
      await route.abort();
    }
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => {
    dialog.dismiss().catch(() => {});
  });

  async function authenticate({ user, pass, entryUrl }) {
    policy.assertRequest(entryUrl);
    await page.goto(entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    const loginVisible =
      (await page.locator("#username, input[name='username']").count()) > 0;
    if (!loginVisible) {
      policy.assertFinalUrl(page.url());
      authenticationActive = false;
      return page.url();
    }
    policy.assertCredentialOrigin(page.url());
    if (!user || !pass) {
      throw adapterError(
        "authentication_required",
        "Campus Virtual credentials are required in local environment variables"
      );
    }
    await page.locator("#username, input[name='username']").first().fill(user);
    await page.locator("#password, input[name='password']").first().fill(pass);
    const access = page.locator(
      'input[type="button"][value="Acceder"], button[type="submit"], input[type="submit"]'
    ).first();
    if ((await access.count()) > 0) {
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 45_000
        }).catch(() => null),
        access.click()
      ]);
    } else {
      await page.locator("#password, input[name='password']").first().press("Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 45_000 });
    }
    try {
      await waitForCampusLanding(page, policy);
    } catch (error) {
      const stillLogin =
        (await page.locator("#username, input[name='username']").count()) > 0;
      if (stillLogin) {
        throw adapterError(
          "authentication_required",
          "Campus Virtual authentication did not complete"
        );
      }
      throw error;
    }
    policy.assertFinalUrl(page.url());
    authenticationActive = false;
    return page.url();
  }

  async function goto(url) {
    policy.assertRequest(url);
    const navigationPage = await context.newPage();
    try {
      const response = await navigationPage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      const finalUrl = navigationPage.url();
      policy.assertFinalUrl(finalUrl);
      if (response && !response.ok()) {
        throw adapterError("network_error", "Campus Virtual returned a non-success page");
      }
      const frames = await readAllowedPageFrames(navigationPage, policy);
      const settledUrl = navigationPage.url();
      policy.assertFinalUrl(settledUrl);
      const main =
        frames.find(({ url }) => url === settledUrl) ??
        frames[0] ??
        { html: await readStablePageContent(navigationPage) };
      return {
        url: settledUrl,
        html: main.html,
        frames
      };
    } finally {
      await navigationPage.close().catch(() => {});
    }
  }

  async function post(url, options) {
    const response = await requestWithRedirectPolicy({
      request: context.request,
      initialUrl: url,
      policy,
      method: "POST",
      form: options.form,
      headers: options.headers,
      legacyRead: options.legacyRead === true,
      registrationWrite: options.registrationWrite === true,
      activeTerm: options.activeTerm ?? "",
      expectedAddRefs: options.expectedAddRefs ?? [],
      expectedRemoveRefs: options.expectedRemoveRefs ?? [],
      timeout: 45_000
    });
    try {
      const finalUrl = response.url();
      if (!options.registrationWrite) policy.assertFinalUrl(finalUrl);
      return {
        status: response.status(),
        finalUrl,
        headers: response.headers(),
        body: await response.body()
      };
    } finally {
      await response.dispose().catch(() => {});
    }
  }

  async function fetchDocument(url) {
    const response = await requestWithRedirectPolicy({
      request: context.request,
      initialUrl: url,
      policy,
      timeout: 45_000
    });
    try {
      const finalUrl = response.url();
      policy.assertFinalUrl(finalUrl);
      return {
        status: response.status(),
        finalUrl,
        headers: response.headers(),
        body: await response.body()
      };
    } finally {
      await response.dispose().catch(() => {});
    }
  }

  async function queryLegacyReadPage(module, url) {
    if (!["academic_performance", "curriculum"].includes(module)) {
      throw adapterError("mutation_refused", "Unknown Campus legacy report query");
    }
    policy.assertRequest(url);
    const reportPage = await context.newPage();
    try {
      await reportPage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      if (module === "academic_performance") {
        const checkboxes = reportPage.locator('input[name="checkboxes"]');
        const reportIndex = selectAcademicPerformanceReportIndex(await reportPage.content());
        if (reportIndex < 0 || reportIndex >= await checkboxes.count()) {
          throw adapterError("scrape_failed", "Campus performance report selector was not found");
        }
        for (let index = 0; index < await checkboxes.count(); index += 1) {
          const checkbox = checkboxes.nth(index);
          if (await checkbox.isChecked()) await checkbox.uncheck();
        }
        await checkboxes.nth(reportIndex).check();
      } else {
        await reportPage.locator("select").evaluateAll((selects) => {
          for (const [index, select] of selects.entries()) {
            const choices = [...select.options].filter((option) => option.value);
            if (choices.length === 0) continue;
            select.value =
              index === selects.length - 1
                ? choices.at(-1).value
                : choices[0].value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        const firstRadio = reportPage.locator('input[type="radio"]').first();
        if ((await firstRadio.count()) > 0) await firstRadio.check();
      }
      const consult = reportPage.getByRole("button", { name: "Consultar" }).first();
      if ((await consult.count()) === 0) {
        throw adapterError("scrape_failed", "Campus report Consultar control was not found");
      }
      await Promise.all([
        reportPage.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 45_000
        }).catch(() => null),
        consult.click()
      ]);
      await reportPage.waitForLoadState("domcontentloaded", {
        timeout: 15_000
      }).catch(() => {});
      const finalUrl = reportPage.url();
      policy.assertFinalUrl(finalUrl);
      return {
        url: finalUrl,
        html: await readStablePageContent(reportPage)
      };
    } finally {
      await reportPage.close().catch(() => {});
    }
  }

  async function queryGradeStatistics(reference, kind, entryUrl) {
    policy.assertRequest(entryUrl);
    const entryResponse = await page.goto(entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    policy.assertFinalUrl(page.url());
    if (entryResponse && !entryResponse.ok()) {
      throw adapterError(
        "network_error",
        "Campus grade view returned a non-success status"
      );
    }
    const functionName =
      kind === "partial" ? "ver_estadisticas" : "link_estadistica";
    const expectedHref =
      kind === "partial"
        ? `javascript:${functionName}('${reference.courseCode}','${reference.year}','${reference.cycle}','${reference.cycleType}','${reference.evaluationType}',${reference.evaluationNumber},'${reference.schedule}','${reference.commission ?? ""}')`
        : `javascript:${functionName}('${reference.year}','${reference.cycle}','${reference.cycleType}','${reference.courseCode}','${reference.faculty}','${reference.meritType}','${reference.schedule}')`;
    const links = page.locator(`a[href^="javascript:${functionName}("]`);
    const hrefs = await links.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href") ?? "")
    );
    const index = hrefs.indexOf(expectedHref);
    if (index < 0) {
      throw adapterError(
        "scrape_failed",
        "Campus grade statistics link was not found in the authenticated grade view"
      );
    }
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 45_000
      }),
      links.nth(index).click()
    ]);
    const finalUrl = page.url();
    policy.assertFinalUrl(finalUrl);
    const frames = await readAllowedPageFrames(page, policy);
    return {
      url: finalUrl,
      html:
        frames.length > 0
          ? frames.map(({ html }) => html).join("\n")
          : await readStablePageContent(page)
    };
  }

  async function queryCourseSchedules(query, entryUrl) {
    policy.assertRequest(entryUrl);
    const endpoint = new URL(entryUrl);
    endpoint.search = "";
    const decodeScheduleResponse = (response) => {
      const contentType = String(response.headers?.["content-type"] ?? "");
      const encoding = /charset\s*=\s*(?:utf-?8)/i.test(contentType)
        ? "utf-8"
        : "windows-1252";
      return new TextDecoder(encoding).decode(response.body);
    };
    const entryHtml = await prepareScheduleScopeCatalog({
      query,
      readEntryHtml: () => readScheduleEntryPage({
        page,
        entryUrl,
        policy
      }),
      postCatalog: async (catalogForm) => {
        const catalogResponse = await post(endpoint.href, {
          form: catalogForm,
          headers: { referer: entryUrl },
          legacyRead: true
        });
        if (catalogResponse.status < 200 || catalogResponse.status >= 300) {
          throw adapterError(
            "network_error",
            "Campus schedule scope catalog returned a non-success status"
          );
        }
        return decodeScheduleResponse(catalogResponse);
      }
    });
    const form = buildScheduleSearchForm(query, entryHtml);
    const response = await post(endpoint.href, {
      form,
      headers: { referer: entryUrl },
      legacyRead: true
    });
    if (response.status < 200 || response.status >= 300) {
      throw adapterError("network_error", "Campus schedule report returned a non-success status");
    }
    return {
      url: response.finalUrl,
      html: decodeScheduleResponse(response)
    };
  }

  async function queryAllowedCourses({ term }) {
    await page.goto(config.portalUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    policy.assertFinalUrl(page.url());
    let portalFrame = null;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const text = await frame.locator("body").innerText().catch(() => "");
      if (/datos del alumno/i.test(text) && /cursos y horarios/i.test(text)) {
        portalFrame = frame;
        break;
      }
    }
    if (!portalFrame) {
      throw adapterError("scrape_failed", "Campus enrollment portal frame was not found");
    }
    const currentText = await portalFrame.locator("body").innerText().catch(() => "");
    if (!/clave\s+u\.\s*curso\s+nombre del curso/i.test(currentText)) {
      const studentMenu = portalFrame.getByText("Datos del Alumno", { exact: true });
      if ((await studentMenu.count()) === 0) {
        throw adapterError("scrape_failed", "Campus enrollment student menu was not found");
      }
      await studentMenu.click();
      const allowedLink = portalFrame.getByText("Cursos Permitidos", { exact: true });
      if ((await allowedLink.count()) === 0) {
        throw adapterError("scrape_failed", "Campus allowed-courses menu was not found");
      }
      await allowedLink.click();
      await portalFrame.waitForFunction(
        () => /Cursos Permitidos/i.test(document.body?.innerText ?? "") &&
          /Nombre del Curso/i.test(document.body?.innerText ?? ""),
        undefined,
        { timeout: 45_000 }
      );
    }
    policy.assertFinalUrl(portalFrame.url());
    return {
      url: sanitizedPageUrl(portalFrame.url()),
      html: await portalFrame.content(),
      term
    };
  }

  async function queryEnrollmentImpediments({ term }) {
    const endpoint = new URL(
      "/pucp/prematri/pmwprinc/pmwprinc?accion=ValidarImpedimentos",
      config.portalUrl
    );
    const response = await post(endpoint.href, {
      form: {},
      headers: { referer: config.portalUrl },
      legacyRead: true
    });
    if (response.status < 200 || response.status >= 300) {
      throw adapterError(
        "network_error",
        "Campus enrollment impediment validation returned a non-success status"
      );
    }
    const contentType = String(response.headers?.["content-type"] ?? "");
    const encoding = /charset\s*=\s*(?:utf-?8)/i.test(contentType)
      ? "utf-8"
      : "windows-1252";
    return {
      url: response.finalUrl,
      body: new TextDecoder(encoding).decode(response.body),
      term
    };
  }

  async function queryCrossUnitVacancies({ term }) {
    const cycle = String(term ?? "").match(/^(\d{4})-(\d{1,2})$/);
    if (!cycle) {
      throw adapterError(
        "scrape_failed",
        "Campus cross-unit vacancy term was not recognized"
      );
    }
    const endpoint = new URL(
      "/pucp/horarios/howvacdi/howvacdi",
      config.portalUrl
    );
    endpoint.search = new URLSearchParams({
      accion: "SeleccionaPaginaConsultaVacantesUnidad",
      cicloano: cycle[1],
      ciclo: cycle[2].padStart(2, "0"),
      tipociclo: "00",
      aplicacionOrigen: "PM"
    }).toString();
    const response = await requestWithRedirectPolicy({
      request: context.request,
      initialUrl: endpoint.href,
      policy,
      method: "GET",
      headers: { referer: config.portalUrl }
    });
    try {
      if (response.status() < 200 || response.status() >= 300) {
        throw adapterError(
          "network_error",
          "Campus cross-unit vacancy report returned a non-success status"
        );
      }
      return {
        url: response.url(),
        html: new TextDecoder("windows-1252").decode(await response.body())
      };
    } finally {
      await response.dispose().catch(() => {});
    }
  }

  async function registrationView({ reload = false } = {}) {
    const entryUrl = new URL(
      "/pucp/prematri/pmwmatrc/pmwmatrc?accion=MostrarInscripcion",
      config.portalUrl
    ).href;
    if (reload || !/pmwmatrc|intranet\.jsp/i.test(page.url())) {
      await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    await page.waitForFunction(
      () => [...document.querySelectorAll("iframe")].some((frame) => {
        try {
          return /inscripci.n registrada|matr.cula extempor.nea/i.test(frame.contentDocument?.body?.innerText ?? "");
        } catch {
          return false;
        }
      }) || /inscripci.n registrada|matr.cula extempor.nea/i.test(document.body?.innerText ?? ""),
      undefined,
      { timeout: 45_000 }
    );
    const candidates = [
      page.mainFrame(),
      ...page.frames().filter((frame) => frame !== page.mainFrame())
    ];
    for (const frame of candidates) {
      const text = await frame.locator("body").innerText().catch(() => "");
      if (/inscripci.n registrada|matr.cula extempor.nea/i.test(text)) {
        policy.assertFinalUrl(frame.url());
        return frame;
      }
    }
    throw adapterError("scrape_failed", "Campus active enrollment frame was not found");
  }

  async function queryRegistrationWorkspace(filters = {}) {
    const frame = await registrationView();
    const html = await frame.content();
    const workspace = parseRegistrationWorkspaceHtml(html, {
      retrievedAt: new Date().toISOString()
    });
    const courseCodes = [...new Set((filters.courseCodes ?? [])
      .map((code) => String(code).trim().toUpperCase())
      .filter(Boolean))];
    const courseName = String(filters.courseName ?? "").trim();
    const scope = filters.academicScope ?? null;
    const term = String(workspace.activeTerm ?? "").match(/^(\d{4})-(\d{1,2})$/);
    if (!term) {
      throw adapterError("scrape_failed", "Campus active registration term was not found");
    }
    const registeredEndpoint = new URL(
      "/pucp/prematri/pmwmatrc/pmwmatrc?accion=BuscarCursosInscritos",
      config.portalUrl
    );
    const registeredResponse = await post(registeredEndpoint.href, {
      form: {
        cicloano: term[1],
        ciclo: term[2].padStart(2, "0"),
        tipociclo: "00"
      },
      headers: { referer: frame.url() },
      legacyRead: true
    });
    if (registeredResponse.status < 200 || registeredResponse.status >= 300) {
      throw adapterError("network_error", "Campus registered-course query failed");
    }
    const registeredPayload = new TextDecoder("windows-1252").decode(
      registeredResponse.body
    );
    const scopeEndpoint = new URL(
      "/pucp/prematri/pmwmatrc/pmwmatrc?accion=BuscarFacultadesEspecialidades",
      config.portalUrl
    );
    const scopeResponse = await post(scopeEndpoint.href, {
      form: {
        cicloano: term[1],
        ciclo: term[2].padStart(2, "0"),
        tipociclo: "00"
      },
      headers: { referer: frame.url() },
      legacyRead: true
    });
    if (scopeResponse.status < 200 || scopeResponse.status >= 300) {
      throw adapterError("network_error", "Campus registration scope catalog failed");
    }
    const scopePayload = new TextDecoder("windows-1252").decode(scopeResponse.body);
    const parsedScopes = parseRegistrationScopePayload(scopePayload);
    const facultyOptions = parsedScopes.state === "available"
      ? parsedScopes.faculties
      : workspace.scopes?.faculties ?? [];
    const specialtyOptions = parsedScopes.state === "available"
      ? parsedScopes.specialties
      : workspace.scopes?.specialties ?? [];
    if (courseCodes.length === 0 && !courseName && !scope?.academicUnit) {
      return {
        url: sanitizedPageUrl(frame.url()),
        html,
        registeredPayload,
        scopePayload
      };
    }
    const resolvedScope = scope
      ? resolveRegistrationAcademicScope(
          { faculties: facultyOptions, specialties: specialtyOptions },
          scope
        )
      : null;
    const endpoint = new URL(
      "/pucp/prematri/pmwmatrc/pmwmatrc?accion=ConsultarHorariosInscripcion",
      config.portalUrl
    );
    const response = await post(endpoint.href, {
      form: {
        cicloano: term[1],
        ciclo: term[2].padStart(2, "0"),
        tipociclo: "00",
        facultad: resolvedScope?.internal.academicUnitCode ?? "",
        nombre: courseName,
        clave: courseCodes.join(" "),
        etapa: resolvedScope?.internal.programStageCode ?? "",
        rama: resolvedScope?.internal.branchCode ?? "",
        especialidad: resolvedScope?.internal.specialtyCode ?? ""
      },
      headers: { referer: frame.url() },
      legacyRead: true
    });
    if (response.status < 200 || response.status >= 300) {
      throw adapterError("network_error", "Campus registration offering search failed");
    }
    return {
      url: sanitizedPageUrl(frame.url()),
      html,
      registeredPayload,
      scopePayload,
      searchPayload: new TextDecoder("windows-1252").decode(response.body)
    };
  }

  async function commitRegistrationChange({
    activeTerm,
    addRefs = [],
    removeRefs = [],
    addCourseCodes = []
  }) {
    const frame = await registrationView({ reload: true });
    const currentResponse = await queryRegistrationWorkspace();
    const workspace = parseRegistrationWorkspaceHtml(currentResponse.html, {
      registeredPayload: currentResponse.registeredPayload,
      retrievedAt: new Date().toISOString()
    });
    if (workspace.enrollmentMode !== "regular") {
      throw adapterError(
        "registration_write_unverified_mode",
        "Registration writes are disabled outside the verified regular enrollment view"
      );
    }
    if (workspace.activeTerm !== activeTerm) {
      throw adapterError("registration_state_changed", "Campus active registration term changed");
    }
    const searched = addCourseCodes.length > 0
      ? await queryRegistrationWorkspace({ courseCodes: addCourseCodes })
      : null;
    const searchedItems = searched?.searchPayload
      ? parseRegistrationSearchPayload(searched.searchPayload, {
          term: activeTerm,
          retrievedAt: new Date().toISOString()
        }).items ?? []
      : workspace.offerings ?? [];
    const availableAdd = new Set(searchedItems.map(({ internalSelectionRef }) => internalSelectionRef));
    const availableRemove = new Set(
      (workspace.registered ?? []).map(({ internalSelectionRef }) => internalSelectionRef)
    );
    if (
      addRefs.some((ref) => !availableAdd.has(ref)) ||
      removeRefs.some((ref) => !availableRemove.has(ref))
    ) {
      throw adapterError(
        "registration_state_changed",
        "A prepared Campus registration selection is no longer available"
      );
    }
    const prepared = await frame.evaluate(({ addRefs: add, removeRefs: remove }) => {
      if (
        typeof window.cadenaCursos !== "function" ||
        typeof window.datosCiclo !== "function"
      ) {
        return { error: "registration_helpers_not_found" };
      }
      document.cursos = { agregar: {}, eliminar: {} };
      for (const ref of add) document.cursos.agregar[ref] = true;
      for (const ref of remove) document.cursos.eliminar[ref] = true;
      const cycle = window.datosCiclo();
      return {
        horariosAgregar: window.cadenaCursos("agregar"),
        horariosEliminar: window.cadenaCursos("eliminar"),
        cicloano: cycle.cicloano,
        tipociclo: cycle.tipociclo,
        ciclo: cycle.ciclo
      };
    }, { addRefs, removeRefs });
    if (prepared.error) {
      throw adapterError(
        "registration_state_changed",
        "A prepared Campus registration selection is no longer available"
      );
    }
    const endpoint = new URL(
      "/pucp/prematri/pmwmatrc/pmwmatrc?accion=ActualizarInscripcion",
      config.portalUrl
    );
    let response;
    try {
      response = await post(endpoint.href, {
        form: prepared,
        headers: { referer: frame.url() },
        registrationWrite: true,
        activeTerm,
        expectedAddRefs: addRefs,
        expectedRemoveRefs: removeRefs
      });
    } catch (error) {
      if (error?.code) throw error;
      throw adapterError(
        "network_error",
        "Campus registration write may have been received but no reliable response was obtained"
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw adapterError("network_error", "Campus registration update returned a non-success status");
    }
    let result;
    try {
      result = JSON.parse(new TextDecoder("windows-1252").decode(response.body));
    } catch {
      throw adapterError("network_error", "Campus registration update response was not recognized");
    }
    if (String(result.code) === "0" || result.Exc) {
      throw adapterError(
        "scrape_failed",
        cleanText(result.message ?? result.Exc ?? "Campus rejected the registration update")
      );
    }
    let finalWorkspace = null;
    let changesApplied = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await registrationView({ reload: true });
      const refreshedResponse = await queryRegistrationWorkspace();
      finalWorkspace = parseRegistrationWorkspaceHtml(refreshedResponse.html, {
        registeredPayload: refreshedResponse.registeredPayload,
        retrievedAt: new Date().toISOString()
      });
      changesApplied = registrationChangesApplied(finalWorkspace, {
        addCourseCodes,
        removeRefs
      });
      const added = new Set(addCourseCodes.map((courseCode) => String(courseCode).toUpperCase()));
      const addedRows = (finalWorkspace.registered ?? [])
        .filter(({ courseCode, position }) =>
          added.has(String(courseCode).toUpperCase()) && position?.state === "available"
        );
      const positionsReady = new Set(
        addedRows.map(({ courseCode }) => String(courseCode).toUpperCase())
      ).size === added.size;
      if (changesApplied && positionsReady) break;
      await page.waitForTimeout(500);
    }
    if (!changesApplied) {
      throw adapterError(
        "registration_reconciliation_required",
        "Campus accepted the update response but the live registration state did not converge"
      );
    }
    return finalWorkspace;
  }

  return {
    authenticate,
    goto,
    post,
    queryGradeStatistics,
    queryCourseSchedules,
    queryAllowedCourses,
    queryEnrollmentImpediments,
    queryCrossUnitVacancies,
    queryRegistrationWorkspace,
    commitRegistrationChange,
    queryLegacyReadPage,
    fetchDocument,
    async close() {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  };
}

async function mapLimit(items, limit, operation) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await operation(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker)
  );
  return output;
}

export function createLiveCampusAdapter({
  loadConfig = loadCampusConfig,
  createSession = createPlaywrightSession,
  now = () => new Date().toISOString()
} = {}) {
  async function withSession(operation, { entryUrl } = {}) {
    const config = await loadConfig();
    const policy = createCampusUrlPolicy(config);
    const session = await createSession({ config, policy });
    try {
      const authenticatedUrl = await session.authenticate({
        user: config.user,
        pass: config.pass,
        entryUrl:
          typeof entryUrl === "function"
            ? entryUrl(config)
            : entryUrl || config.agendaEntryUrl,
        policy
      });
      return await operation({
        config,
        policy,
        session,
        authenticatedUrl
      });
    } finally {
      await session.close().catch(() => {});
    }
  }

  async function sync(options = {}) {
    if (
      options.metadataOnly !== true ||
      options.allowDownloads !== false ||
      options.allowMutations !== false
    ) {
      throw adapterError(
        "mutation_refused",
        "Campus sync is restricted to metadata-only read access"
      );
    }
    return withSession(async ({ config, policy, session }) => {
      const timestamp = now();
      const portal = await session.goto(config.portalUrl);
      policy.assertReadOnlyPage(portal.html, portal.url);
      const catalogByKey = new Map();
      for (const view of portal.frames?.length ? portal.frames : [portal]) {
        for (const module of parsePortalModules(view.html, view.url)) {
          if (!catalogByKey.has(module.key)) {
            catalogByKey.set(module.key, module);
          }
        }
      }
      const catalog = [...catalogByKey.values()];
      const visible = new Map(catalog.map((module) => [module.key, module]));
      const modules = {};
      const start = options.start || limaToday(new Date(timestamp));
      const end = options.end || addDays(start, Number(options.days || 90));

      const enrollmentHtml = (portal.frames?.length ? portal.frames : [portal])
        .map(({ html }) => html)
        .join("\n");
      const enrollmentTermMatch = cleanText(enrollmentHtml).match(/Matr[ií]cula\s+(\d{4})-(\d{1,2})/i);
      const enrollmentTerm = enrollmentTermMatch
        ? `${enrollmentTermMatch[1]}-${Number(enrollmentTermMatch[2])}`
        : "";
      const enrollmentPortal = parseEnrollmentPortalHtml(
        enrollmentHtml,
        config.portalUrl
      );
      modules.enrollment_portal = enrollmentPortal.state === "available"
        ? {
            state: "available",
            value: { sections: enrollmentPortal.sections },
            label: "Portal de matrícula",
            generatedAt: timestamp
          }
        : {
            state: "unavailable",
            value: null,
            reason: enrollmentPortal.reason ?? "role_unavailable",
            generatedAt: timestamp
          };
      const enrollmentCalendar = parseEnrollmentCalendarHtml(enrollmentHtml, {
        term: enrollmentTerm
      });
      modules.enrollment_calendar = {
        ...enrollmentCalendar,
        label: "Calendario de matrícula",
        generatedAt: timestamp
      };
      modules.enrollment_impediments = {
        state: "unavailable",
        items: [],
        reason: /validaImpedimentos|verificar si tienes alg[uú]n impedimento/i.test(enrollmentHtml)
          ? "check_available_not_executed"
          : "role_unavailable",
        generatedAt: timestamp
      };
      if (enrollmentTerm && typeof session.queryEnrollmentImpediments === "function") {
        try {
          const response = await session.queryEnrollmentImpediments({ term: enrollmentTerm });
          modules.enrollment_impediments = {
            ...(
              response.body
                ? parseEnrollmentImpedimentsResponse(response.body, { term: enrollmentTerm })
                : parseEnrollmentImpedimentsText(response.text, { term: enrollmentTerm })
            ),
            label: "Impedimentos de matrícula",
            generatedAt: timestamp
          };
        } catch (error) {
          modules.enrollment_impediments = {
            state: "unavailable",
            items: [],
            reason: publicReason(error),
            generatedAt: timestamp
          };
        }
      }
      if (enrollmentTerm && typeof session.queryAllowedCourses === "function") {
        try {
          const allowedPage = await session.queryAllowedCourses({
            term: enrollmentTerm
          });
          policy.assertFinalUrl(allowedPage.url);
          modules.allowed_courses = {
            ...parseAllowedCoursesHtml(allowedPage.html, { term: enrollmentTerm }),
            label: "Cursos permitidos",
            generatedAt: timestamp
          };
        } catch (error) {
          modules.allowed_courses = {
            state: "unavailable",
            items: [],
            reason: publicReason(error),
            generatedAt: timestamp
          };
        }
      }
      if (
        enrollmentTerm &&
        typeof session.queryCrossUnitVacancies === "function"
      ) {
        try {
          const vacancyPage = await session.queryCrossUnitVacancies({
            term: enrollmentTerm
          });
          policy.assertFinalUrl(vacancyPage.url);
          modules.cross_unit_vacancies = {
            ...parseCrossUnitVacanciesHtml(vacancyPage.html, {
              term: enrollmentTerm,
              retrievedAt: timestamp
            }),
            label: "Vacantes que ofrecen otras unidades",
            generatedAt: timestamp
          };
        } catch (error) {
          modules.cross_unit_vacancies = {
            state: "unavailable",
            items: [],
            reason: publicReason(error),
            generatedAt: timestamp
          };
        }
      }

      if (visible.has("agenda")) {
        try {
          const entry = await session.goto(config.agendaEntryUrl);
          const form = {
            fechaInicio: compactDate(start),
            fechaFin: compactDate(end),
            categoria: "",
            grupo: "00"
          };
          const response = await session.post(config.agendaJsonUrl, {
            form,
            headers: { referer: entry.url }
          });
          if (response.status < 200 || response.status >= 300) {
            throw adapterError("network_error", "Campus agenda returned a non-success status");
          }
          policy.assertFinalUrl(response.finalUrl || config.agendaJsonUrl);
          modules.agenda = {
            state: "available",
            generatedAt: timestamp,
            label: visible.get("agenda").label,
            href: visible.get("agenda").href,
            range: { start, end },
            items: parseAgendaPayload(response.body)
          };
        } catch (error) {
          modules.agenda = {
            state: "unavailable",
            generatedAt: timestamp,
            label: visible.get("agenda").label,
            href: visible.get("agenda").href,
            range: { start, end },
            items: [],
            reason: publicReason(error)
          };
        }
      }

      if (visible.has("enrolled_courses")) {
        const courseHub = visible.get("enrolled_courses");
        try {
          policy.assertRequest(courseHub.href);
          const page = await session.goto(courseHub.href);
          policy.assertReadOnlyPage(page.html, page.url);
          const targets = parseLegacyAcademicTargets(page.html, page.url);
          if (targets.state !== "available") {
            modules.enrolled_courses = {
              state: "unavailable",
              items: [],
              reason: targets.reason,
              label: courseHub.label,
              href: courseHub.href,
              generatedAt: timestamp
            };
          } else {
            try {
              policy.assertRequest(targets.personalPanelUrl);
              const personalPanel = await session.goto(targets.personalPanelUrl);
              for (const discovered of parsePortalModules(
                personalPanel.html,
                personalPanel.url
              )) {
                const personalPreferred = new Set([
                  "academic_performance",
                  "curriculum",
                  "enrollment",
                  "financial",
                  "obligations",
                  "requests",
                  "documents"
                ]).has(discovered.key);
                if (!visible.has(discovered.key) || personalPreferred) {
                  const existing = catalog.findIndex(
                    ({ key }) => key === discovered.key
                  );
                  if (existing >= 0) catalog.splice(existing, 1);
                  catalog.push(discovered);
                  visible.set(discovered.key, discovered);
                }
              }
            } catch {
              // The core course/grade/history fan-out remains usable when the
              // optional personal dashboard is unavailable for the account.
            }
            const [partialResult, historyResult] = await Promise.allSettled([
              (async () => {
                policy.assertRequest(targets.partialGradesUrl);
                const gradesPage = await session.goto(targets.partialGradesUrl);
                // These authenticated GET views include unrelated POST controls
                // (for example, claims or certificate requests). The adapter never
                // submits them and the browser route blocks every post-auth POST.
                return parseLegacyPartialGradesHtml(gradesPage.html);
              })(),
              (async () => {
                policy.assertRequest(targets.historyUrl);
                const historyPage = await session.goto(targets.historyUrl);
                return parseLegacyHistoryHtml(historyPage.html);
              })()
            ]);
            if (partialResult.status === "fulfilled") {
              modules.official_grades = {
                ...partialResult.value,
                label: "Notas del ciclo",
                generatedAt: timestamp
              };
            } else {
              modules.official_grades = {
                state: "unavailable",
                items: [],
                reason: publicReason(partialResult.reason),
                label: "Notas del ciclo",
                generatedAt: timestamp
              };
            }
            if (historyResult.status === "fulfilled") {
              modules.academic_history = {
                ...historyResult.value,
                label: "Historia de notas en la PUCP",
                generatedAt: timestamp
              };
              const finalGrades = historyResult.value.items
                .filter(({ grade }) => cleanGrade(grade))
                .map((item) => ({
                  courseCode: item.courseCode,
                  course: item.course,
                  item: "Nota final",
                  grade: cleanGrade(item.grade),
                  scale: "0-20",
                  status: item.status,
                  term: item.term,
                  ...(item.statistics
                    ? { statistics: item.statistics }
                    : {})
                }));
              if (modules.official_grades.state === "available") {
                modules.official_grades.items.push(...finalGrades);
                modules.official_grades.label = "Notas parciales y finales";
              }
              const currentCourses = historyResult.value.items
                .filter(({ term }) => term === targets.term)
                .map((item) => ({
                  code: item.courseCode,
                  name: item.course,
                  term: item.term,
                  schedule: item.schedule,
                  modality: item.modality,
                  place: "",
                  status: "Matriculado"
                }));
              modules.enrolled_courses = {
                state: "available",
                items: currentCourses,
                label: courseHub.label,
                href: courseHub.href,
                generatedAt: timestamp
              };
              const enrollmentTurn =
                currentCourses.length > 0
                  ? historyResult.value.items.find(
                      ({ term, enrollmentTurn: turn }) =>
                        term === targets.term && turn !== null
                    )?.enrollmentTurn ?? null
                  : null;
              modules.enrollment = {
                state: "available",
                value: {
                  term: targets.term,
                  turn: enrollmentTurn,
                  status:
                    currentCourses.length > 0
                      ? "Matriculado"
                      : "Sin cursos matriculados",
                  allowedCourses: null,
                  results: `${currentCourses.length} ${
                    currentCourses.length === 1 ? "curso matriculado" : "cursos matriculados"
                  }`
                },
                alerts: [
                  "Los cursos permitidos solo se informan cuando el Campus los publica para matrícula."
                ],
                label: "Matrícula",
                generatedAt: timestamp
              };
            } else {
              modules.academic_history = {
                state: "unavailable",
                items: [],
                reason: publicReason(historyResult.reason),
                label: "Historia de notas en la PUCP",
                generatedAt: timestamp
              };
              modules.enrolled_courses = {
                state: "unavailable",
                items: [],
                reason: publicReason(historyResult.reason),
                label: courseHub.label,
                href: courseHub.href,
                generatedAt: timestamp
              };
            }
          }
        } catch (error) {
          modules.enrolled_courses = {
            state: "unavailable",
            items: [],
            reason: publicReason(error),
            label: courseHub.label,
            href: courseHub.href,
            generatedAt: timestamp
          };
        }
      }

      const pageModules = catalog.filter(
        ({ key }) =>
          !["agenda", "enrolled_courses", "other"].includes(key) &&
          !modules[key]
      );
      const results = await mapLimit(
        pageModules,
        Math.min(Math.max(Number(options.moduleConcurrency || 3), 1), 4),
        async (module) => {
          try {
            policy.assertRequest(module.href);
            const page =
              ["academic_performance", "curriculum"].includes(module.key)
                ? await session.queryLegacyReadPage(module.key, module.href)
                : await session.goto(module.href);
            const pageUrl = new URL(page.url);
            const knownFinancialRead =
              module.key === "financial" &&
              pageUrl.pathname === "/pucp/cobralum/cawdocpg/cawdocpg" &&
              pageUrl.searchParams.get("accion")?.toLowerCase() === "buscar";
            const knownRequestRead =
              module.key === "requests" &&
              pageUrl.pathname === "/pucp/solservi/sowtraca/sowtraca" &&
              pageUrl.searchParams.get("accion")?.toLowerCase() ===
                "mostrarbusquedasolicitudes";
            const knownDocumentIndexRead =
              module.key === "documents" &&
              pageUrl.pathname === "/pucp/document/dowdocum/dowdocum" &&
              pageUrl.searchParams.get("accion")?.toLowerCase() === "vercursos";
            if (
              !knownFinancialRead &&
              !knownRequestRead &&
              !knownDocumentIndexRead &&
              !["academic_performance", "curriculum"].includes(module.key)
            ) {
              policy.assertReadOnlyPage(page.html, page.url);
            }
            const parsed =
              module.key === "academic_performance"
                ? parseLegacyAcademicPerformanceHtml(page.html)
                : module.key === "curriculum"
                  ? parseLegacyCurriculumHtml(page.html)
                  : module.key === "documents" && knownDocumentIndexRead
                    ? {
                        state: "available",
                        items: (
                          await mapLimit(
                            parseLegacyCourseDocumentTargets(page.html, page.url),
                            3,
                            async (target) => {
                              try {
                                policy.assertRequest(target.href);
                                const coursePage = await session.goto(target.href);
                                const result = parseLegacyCourseDocumentsHtml(
                                  coursePage.html,
                                  coursePage.url
                                );
                                return result.state === "available"
                                  ? result.items
                                  : [];
                              } catch {
                                return [];
                              }
                            }
                          )
                        ).flat()
                      }
                  : parseModuleHtml(module.key, page.html, config.baseUrl);
            return [
              module.key,
              {
                ...parsed,
                label: module.label,
                href: module.href,
                generatedAt: timestamp
              }
            ];
          } catch (error) {
            return [
              module.key,
              {
                state: "unavailable",
            ...(new Set(["enrollment", "financial", "enrollment_portal"]).has(module.key)
                  ? { value: null }
                  : { items: [] }),
                reason: publicReason(error),
                label: module.label,
                href: module.href,
                generatedAt: timestamp
              }
            ];
          }
        }
      );
      Object.assign(modules, Object.fromEntries(results));

      for (const key of MODULE_KEYS) {
        if (!modules[key]) {
          modules[key] = {
            state: "unavailable",
            ...(new Set(["enrollment", "financial", "enrollment_portal"]).has(key)
              ? { value: null }
              : { items: [] }),
            reason: "role_unavailable",
            generatedAt: timestamp
          };
        }
      }
      if (visible.has("other")) {
        modules.other = {
          state: "unavailable",
          items: [],
          reason: "unsupported_module",
          generatedAt: timestamp,
          label: visible.get("other").label,
          href: visible.get("other").href,
          alerts: catalog
            .filter(({ key }) => key === "other")
            .map(({ label }) => `Unsupported visible module: ${label}`)
        };
      }
      return {
        generatedAt: timestamp,
        retrievedAt: timestamp,
        modules
      };
    });
  }

  async function downloadDocument({ document, manifestPath }) {
    return withSession(async ({ config, policy, session }) => {
      const downloader = createCampusDocumentDownloader({
        uniRoot: config.uniRoot,
        privateRoot: config.privateRoot,
        manifestPath,
        policy,
        maxResponseBytes: config.maxResponseBytes,
        fetchDocument: (url) => session.fetchDocument(url),
        now
      });
      return downloader.download(document);
    });
  }

  function statisticsEndpoint(config, kind) {
    const pathname =
      kind === "partial"
        ? "/pucp/estadist/eswnotpa/eswnotpa"
        : "/pucp/estadist/eswnotfi/eswnotfi";
    const statisticsHost = config.readHosts.find(
      (host) => String(host).toLowerCase() === "ares.pucp.edu.pe"
    );
    const origin = statisticsHost
      ? `https://${statisticsHost}`
      : config.portalUrl;
    return new URL(pathname, origin).href;
  }

  function statisticsEntryUrl(config, reference, kind) {
    const base = statisticsEndpoint(config, kind);
    const pathname =
      kind === "partial"
        ? "/pucp/notas/nownotpa/nownotpa"
        : "/pucp/notas/nowhisno/nowhisno";
    const query = new URLSearchParams({
      accion: "Ingresar",
      codigo: config.user
    });
    if (kind === "partial") {
      query.set("cicloano", reference.year);
      query.set("ciclo", reference.cycle);
      query.set("tipociclo", reference.cycleType);
    }
    return new URL(`${pathname}?${query}`, base).href;
  }

  async function queryGradeStatistics(reference, kind) {
    if (reference?.kind !== kind) {
      throw adapterError(
        "scrape_failed",
        `Campus ${kind} grade statistics reference is invalid`
      );
    }
    return withSession(async ({ config, policy, session }) => {
      const entryUrl = statisticsEntryUrl(config, reference, kind);
      const response = await session.queryGradeStatistics(
        reference,
        kind,
        entryUrl
      );
      policy.assertFinalUrl(response.url);
      const statisticsHtml = response.html;
      const parsed = parseLegacyGradeStatisticsHtml(statisticsHtml);
      if (parsed.state !== "available") {
        throw adapterError(
          "scrape_failed",
          "Campus grade statistics layout was not recognized"
        );
      }
      return {
        ...parsed,
        kind,
        courseCode: reference.courseCode,
        retrievedAt: now()
      };
    }, {
      entryUrl: (config) =>
        statisticsEntryUrl(config, reference, kind)
    });
  }

  async function searchScheduleCatalog(options = {}) {
    if (
      options.metadataOnly !== true ||
      options.allowDownloads !== false ||
      options.allowMutations !== false ||
      options.useCampusGenerator !== false
    ) {
      throw adapterError(
        "mutation_refused",
        "Campus schedule search is restricted to the direct read-only report"
      );
    }
    return withPublicSession(async ({ config, policy, session }) => {
      const entryUrl = new URL(
        "/pucp/horarios/howcurho/howcurho?accion=Ingresar",
        config.portalUrl
      ).href;
      const response = await session.queryCourseSchedules(options, entryUrl);
      policy.assertFinalUrl(response.url);
      const firstParsed = parseScheduleResultsHtml(response.html, {
        term: options.term,
        retrievedAt: now()
      });
      const first = {
        ...firstParsed,
        items: filterScheduleItemsByCurriculumLevel(
          firstParsed.items ?? [],
          options.academicScope?.curriculumLevel
        )
      };
      const requested = [...new Set((options.courseCodes ?? [])
        .map((code) => String(code).trim().toUpperCase())
        .filter(Boolean))];
      const present = new Set((first.items ?? []).map(({ courseCode }) => courseCode));
      const missing = requested.filter((code) => !present.has(code));
      if (requested.length > 1 && missing.length > 0) {
        const individual = await mapLimit(missing, 3, async (courseCode) => {
          const itemResponse = await session.queryCourseSchedules({
            ...options,
            courseCodes: [courseCode],
            academicScope: null
          }, entryUrl);
          policy.assertFinalUrl(itemResponse.url);
          return {
            courseCode,
            parsed: (() => {
              const parsed = parseScheduleResultsHtml(itemResponse.html, {
                term: options.term,
                retrievedAt: now()
              });
              return {
                ...parsed,
                items: filterScheduleItemsByCurriculumLevel(
                  parsed.items ?? [],
                  options.academicScope?.curriculumLevel
                )
              };
            })()
          };
        });
        const items = [...(first.items ?? [])];
        const unavailableCourses = [];
        for (const result of individual) {
          if (result.parsed.state === "available") {
            items.push(...result.parsed.items);
          } else {
            unavailableCourses.push(result.courseCode);
          }
        }
        if (items.length > 0 || unavailableCourses.length === 0) {
          return {
            state: "available",
            items,
            ...(unavailableCourses.length > 0 ? { unavailableCourses } : {}),
            source: "schedule_catalog",
            sourcesUsed: ["schedule_catalog"],
            retrievedAt: now()
          };
        }
      }
      return {
        ...first,
        source: "schedule_catalog",
        sourcesUsed: ["schedule_catalog"],
        retrievedAt: now()
      };
    });
  }

  async function withPublicSession(operation) {
    const config = await loadConfig();
    const policy = createCampusUrlPolicy(config);
    const session = await createSession({ config, policy });
    try {
      return await operation({ config, policy, session });
    } finally {
      await session.close().catch(() => {});
    }
  }

  function registrationEntryUrl(config) {
    return new URL(
      "/pucp/prematri/pmwmatrc/pmwmatrc?accion=MostrarInscripcion",
      config.portalUrl
    ).href;
  }

  async function readRegistrationWorkspace(options = {}) {
    if (
      options.metadataOnly !== true ||
      options.allowDownloads !== false ||
      options.allowMutations !== false
    ) {
      throw adapterError(
        "mutation_refused",
        "Campus registration workspace reads must be metadata-only"
      );
    }
    return withSession(async ({ config, policy, session }) => {
      if (typeof session.queryRegistrationWorkspace !== "function") {
        throw adapterError("scrape_failed", "Campus registration workspace reader is unavailable");
      }
      const response = await session.queryRegistrationWorkspace({
        courseCodes: options.courseCodes ?? [],
        courseName: options.courseName ?? "",
        academicScope: options.academicScope ?? null
      });
      policy.assertFinalUrl(response.url);
      const workspace = parseRegistrationWorkspaceHtml(response.html, {
        registeredPayload: response.registeredPayload,
        retrievedAt: now()
      });
      workspace.accountBinding = createHash("sha256")
        .update(String(config.user ?? ""), "utf8")
        .digest("hex");
      if (response.scopePayload) {
        const scopes = parseRegistrationScopePayload(response.scopePayload);
        if (scopes.state === "available") {
          const selectedFaculties = new Set(
            (workspace.scopes?.faculties ?? []).filter(({ selected }) => selected).map(({ code }) => code)
          );
          const selectedSpecialties = new Set(
            (workspace.scopes?.specialties ?? []).filter(({ selected }) => selected).map((item) =>
              [item.academicUnitCode, item.branchCode, item.specialtyCode, item.stageCode].join("|")
            )
          );
          workspace.scopes = {
            faculties: scopes.faculties.map((item) => ({
              ...item,
              selected: selectedFaculties.has(item.code)
            })),
            specialties: scopes.specialties.map((item) => ({
              ...item,
              selected: selectedSpecialties.has(
                [item.academicUnitCode, item.branchCode, item.specialtyCode, item.stageCode].join("|")
              )
            }))
          };
        }
      }
      if (response.searchPayload) {
        const searched = parseRegistrationSearchPayload(response.searchPayload, {
          term: workspace.activeTerm,
          retrievedAt: now()
        });
        if (searched.state === "available") {
          const positions = new Map();
          for (const item of workspace.registered ?? []) {
            const baseKey = `${item.courseCode}|${item.scheduleId}`;
            positions.set(`${baseKey}|${item.scheduleType}`, item.position);
            const existing = positions.get(baseKey);
            if (!existing || item.position?.state === "available") {
              positions.set(baseKey, item.position);
            }
          }
          workspace.offerings = searched.items.map((item) => {
            const baseKey = `${item.courseCode}|${item.scheduleId}`;
            const position =
              positions.get(`${baseKey}|${item.scheduleType}`) ??
              positions.get(baseKey) ??
              null;
            return position
              ? {
                  ...item,
                  position,
                  capacity: { ...item.capacity, userPosition: position.rank }
                }
              : item;
          });
        }
      }
      return workspace;
    }, { entryUrl: registrationEntryUrl });
  }

  async function searchCurrentCourseSchedules(options = {}) {
    if (
      options.metadataOnly !== true ||
      options.allowDownloads !== false ||
      options.allowMutations !== false ||
      options.useCampusGenerator !== false
    ) {
      throw adapterError("mutation_refused", "Current schedules must use read-only Campus sources");
    }
    const workspace = await readRegistrationWorkspace(options);
    const wanted = new Set((options.courseCodes ?? []).map((code) => String(code).trim().toUpperCase()));
    let items = (workspace.offerings ?? []).filter((item) =>
      (wanted.size === 0 || wanted.has(String(item.courseCode).toUpperCase())) &&
      (!options.courseName || searchableText(`${item.courseCode} ${item.courseName}`).includes(searchableText(options.courseName)))
    );
    items = filterScheduleItemsByCurriculumLevel(
      items,
      options.academicScope?.curriculumLevel
    );
    const present = new Set(items.map(({ courseCode }) => String(courseCode).toUpperCase()));
    const missing = [...wanted].filter((code) => !present.has(code));
    const sourcesUsed = ["enrollment_portal"];
    const differences = [];
    if (wanted.size > 0) {
      try {
        const fallback = await searchScheduleCatalog({
          ...options,
          term: workspace.activeTerm,
          courseCodes: [...wanted],
          academicScope: null
        });
        if (fallback.state === "available") {
          const portalByKey = new Map(items.map((item) => [
            `${item.courseCode}|${item.scheduleId}|${item.scheduleType ?? ""}`,
            item
          ]));
          const fallbackOnly = [];
          for (const supplement of fallback.items ?? []) {
            const key = `${supplement.courseCode}|${supplement.scheduleId}|${supplement.scheduleType ?? ""}`;
            const primary = portalByKey.get(key);
            if (!primary) {
              fallbackOnly.push(supplement);
              continue;
            }
            for (const field of ["vacancies", "unitVacancies", "registrations", "enrolled"]) {
              const portalValue = primary.capacity?.[field];
              const fallbackValue = supplement.capacity?.[field];
              if (portalValue != null && fallbackValue != null && portalValue !== fallbackValue) {
                differences.push({
                  courseCode: primary.courseCode,
                  scheduleId: primary.scheduleId,
                  field,
                  enrollmentPortal: portalValue,
                  scheduleCatalog: fallbackValue
                });
              }
            }
            const capacity = { ...(supplement.capacity ?? {}) };
            for (const [field, value] of Object.entries(primary.capacity ?? {})) {
              if (value != null) capacity[field] = value;
            }
            portalByKey.set(key, {
              ...supplement,
              ...primary,
              professor: primary.professor || supplement.professor,
              surveyScore: primary.surveyScore ?? supplement.surveyScore,
              sessions: primary.sessions?.length ? primary.sessions : supplement.sessions,
              capacity,
              source: "enrollment_portal",
              sourcesUsed: ["enrollment_portal", "schedule_catalog"]
            });
          }
          items = [...portalByKey.values(), ...fallbackOnly];
          sourcesUsed.push("schedule_catalog");
        }
      } catch (error) {
        if (missing.length > 0) throw error;
      }
    }
    return {
      state: "available",
      enrollmentMode: workspace.enrollmentMode,
      activeTerm: workspace.activeTerm,
      source: "enrollment_portal",
      sourcesUsed,
      differences,
      items,
      retrievedAt: now()
    };
  }

  async function searchHistoricalCourseSchedules(options = {}) {
    if (
      options.metadataOnly !== true ||
      options.allowDownloads !== false ||
      options.allowMutations !== false ||
      options.useCampusGenerator !== false
    ) {
      throw adapterError("mutation_refused", "Historical schedules must use the read-only schedule catalog");
    }
    return searchScheduleCatalog(options);
  }

  async function commitCourseRegistration(options = {}) {
    if (
      options.allowMutations !== true ||
      !options.confirmationToken ||
      !(options.addRefs?.length || options.removeRefs?.length)
    ) {
      throw adapterError(
        "mutation_refused",
        "A confirmed one-use token and an exact prepared registration change are required"
      );
    }
    return withSession(async ({ session }) => {
      if (typeof session.commitRegistrationChange !== "function") {
        throw adapterError("scrape_failed", "Campus registration writer is unavailable");
      }
      return session.commitRegistrationChange({
        activeTerm: options.activeTerm,
        addRefs: [...(options.addRefs ?? [])],
        removeRefs: [...(options.removeRefs ?? [])],
        addCourseCodes: [...(options.addCourseCodes ?? [])]
      });
    }, { entryUrl: registrationEntryUrl });
  }

  async function getAllowedCourses(options = {}) {
    if (
      options.metadataOnly !== true ||
      options.allowDownloads !== false ||
      options.allowMutations !== false
    ) {
      throw adapterError(
        "mutation_refused",
        "Campus allowed courses are restricted to the read-only report"
      );
    }
    return withSession(async ({ config, policy, session }) => {
      const response = await session.queryAllowedCourses({ term: options.term });
      policy.assertFinalUrl(response.url);
      const parsed = parseAllowedCoursesHtml(response.html, { term: options.term });
      if (parsed.state !== "available") {
        throw adapterError("scrape_failed", "Campus allowed-courses layout was not recognized");
      }
      return { ...parsed, retrievedAt: now() };
    }, { entryUrl: (config) => config.portalUrl });
  }

  return {
    downloadDocument,
    getFinalGradeStatistics: (reference) =>
      queryGradeStatistics(reference, "final"),
    getAllowedCourses,
    getPartialGradeStatistics: (reference) =>
      queryGradeStatistics(reference, "partial"),
    readRegistrationWorkspace,
    searchCurrentCourseSchedules,
    searchHistoricalCourseSchedules,
    commitCourseRegistration,
    searchScheduleCatalog,
    sync
  };
}
