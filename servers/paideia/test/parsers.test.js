import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  parseActivityDetailHtml,
  parseAnnouncementsHtml,
  parseCourseHtml,
  parseDashboardHtml,
  parseGradesHtml,
  isPlausibleCoursePage,
  isPlausibleDashboardPage
} from "../src/parsers.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFile(path.join(fixtureDir, name), "utf8");
const baseUrl = "https://paideia.example.edu";

test("dashboard parser normalizes and deduplicates visible courses", async () => {
  const courses = parseDashboardHtml(await fixture("dashboard.html"), baseUrl);
  assert.deepEqual(courses, [
    {
      id: "202",
      name: "2026-1 Analytics 2 (IND456)",
      shortName: "Analytics 2",
      url: `${baseUrl}/course/view.php?id=202`
    },
    {
      id: "101",
      name: "2026-1 Simulación (IND123)",
      shortName: "Simulación",
      url: `${baseUrl}/course/view.php?id=101`
    }
  ]);
  assert.equal(isPlausibleDashboardPage(await fixture("dashboard.html")), true);
  assert.equal(
    isPlausibleDashboardPage(
      '<body id="page-my-courses"><div data-region="course-content"></div></body>'
    ),
    true
  );
  assert.equal(isPlausibleDashboardPage("<form id=login></form>"), false);
});

test("dashboard parser marks areas and namespaces Educación Continua identifiers", async () => {
  const html = await fixture("dashboard.html");
  const regular = parseDashboardHtml(html, baseUrl, {
    area: "pregrado_posgrado"
  });
  const continuing = parseDashboardHtml(html, "https://paideiaprogramas.pucp.edu.pe", {
    area: "educacion_continua"
  });

  assert.deepEqual(
    {
      id: regular[0].id,
      sourceId: regular[0].sourceId,
      area: regular[0].area,
      areas: regular[0].areas
    },
    {
      id: "202",
      sourceId: "202",
      area: "pregrado_posgrado",
      areas: ["pregrado_posgrado"]
    }
  );
  assert.deepEqual(
    {
      id: continuing[0].id,
      sourceId: continuing[0].sourceId,
      area: continuing[0].area,
      areas: continuing[0].areas
    },
    {
      id: "educacion_continua:202",
      sourceId: "202",
      area: "educacion_continua",
      areas: ["educacion_continua"]
    }
  );
});

test("course parser propagates the Educación Continua area to course content", async () => {
  const course = {
    id: "educacion_continua:101",
    sourceId: "101",
    area: "educacion_continua",
    areas: ["educacion_continua"],
    name: "Programa de especialización",
    shortName: "Programa de especialización",
    url: "https://paideiaprogramas.pucp.edu.pe/course/view.php?id=101"
  };

  const parsed = parseCourseHtml(
    await fixture("course.html"),
    course,
    "https://paideiaprogramas.pucp.edu.pe"
  );

  assert.equal(parsed.activities[0].id, "educacion_continua:501");
  assert.equal(parsed.activities[0].sourceId, "501");
  assert.equal(parsed.activities[0].area, "educacion_continua");
  assert.equal(parsed.sections[0].area, "educacion_continua");
  assert.deepEqual(parsed.sections[0].activityIds, [
    "educacion_continua:501",
    "educacion_continua:502"
  ]);

  const directFile = parseCourseHtml(`
    <li class="section">
      <h3 class="sectionname">Material</h3>
      <a href="/pluginfile.php/101/mod_resource/content/1/guia.pdf">Guía</a>
    </li>
  `, course, "https://paideiaprogramas.pucp.edu.pe");
  assert.equal(directFile.activities[0].id, "educacion_continua:101-1");
});

test("course parser produces sections, activities, pending items, and material metadata", async () => {
  const course = {
    id: "101",
    name: "2026-1 Simulación (IND123)",
    shortName: "Simulación",
    url: `${baseUrl}/course/view.php?id=101`
  };
  const parsed = parseCourseHtml(await fixture("course.html"), course, baseUrl);

  assert.equal(parsed.sections.length, 2);
  assert.deepEqual(
    parsed.activities.map(({ id, type, title, section }) => ({ id, type, title, section })),
    [
      { id: "501", type: "resource", title: "Diapositivas iniciales", section: "S01 y 02 - Introducción" },
      { id: "502", type: "assignment", title: "Tarea 1", section: "S01 y 02 - Introducción" },
      { id: "503", type: "folder", title: "Datasets", section: "Material adicional" },
      { id: "504", type: "url", title: "Video externo", section: "Material adicional" }
    ]
  );
  assert.equal(parsed.pendingItems[0].dueDate, "2026-08-01T04:59:00.000Z");
  assert.deepEqual(parsed.materials.map((item) => item.kind), ["resource", "folder", "url"]);
  assert.equal(isPlausibleCoursePage(await fixture("course.html"), parsed), true);
  assert.equal(isPlausibleCoursePage("<form id=login></form>", {
    sections: [],
    activities: []
  }), false);
  assert.equal(isPlausibleCoursePage("<h1>Error</h1><p>Exception</p>", {
    sections: [],
    activities: []
  }), false);
});

test("safe activity detail parser captures overview state without attempt content", async () => {
  const detail = parseActivityDetailHtml(await fixture("activity-detail.html"), {
    id: "502",
    type: "assignment",
    title: "Tarea 1"
  });
  assert.equal(detail.title, "Tarea 1");
  assert.equal(detail.submissionState, "No entregado");
  assert.equal(detail.dueDate, "2026-08-01T04:59:00.000Z");
  assert.equal("attempt" in detail, false);
});

test("announcement parser extracts only identifiable dedicated forum posts", async () => {
  const announcements = parseAnnouncementsHtml(await fixture("announcements.html"), {
    id: "101",
    shortName: "Simulación"
  }, baseUrl);
  assert.deepEqual(announcements, [{
    id: "91",
    courseId: "101",
    course: "Simulación",
    title: "Cambio de aula",
    author: "Docente del curso",
    publishedAt: "2026-07-20T20:30:00.000Z",
    summary: "La siguiente sesión será en el aula B-101.",
    url: `${baseUrl}/mod/forum/discuss.php?d=91`
  }]);
  assert.deepEqual(parseAnnouncementsHtml("<div class=forum-post>mensaje genérico</div>", { id: "1" }, baseUrl), []);
});

test("grade parser returns student-visible item and category rows and unavailable state", async () => {
  const result = parseGradesHtml(await fixture("grades.html"), { id: "101", shortName: "Simulación" });
  assert.equal(result.state, "available");
  assert.deepEqual(result.items, [
    {
      courseId: "101",
      course: "Simulación",
      name: "Tarea 1",
      category: false,
      rawGrade: "17.50",
      range: "0–20",
      percentage: "87.50 %",
      feedback: "Buen análisis"
    },
    {
      courseId: "101",
      course: "Simulación",
      name: "Prácticas",
      category: true,
      rawGrade: "16.00",
      range: "0–20",
      percentage: "80 %",
      feedback: ""
    }
  ]);
  assert.deepEqual(parseGradesHtml("<p>No disponible</p>", { id: "101" }), {
    state: "unavailable",
    items: []
  });
});
