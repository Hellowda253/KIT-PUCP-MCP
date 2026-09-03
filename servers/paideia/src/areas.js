import {
  isPlausibleDashboardPage,
  parseDashboardHtml
} from "./parsers.js";

function normalizedBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function paideiaAreaDefinitions(config) {
  const primary = normalizedBaseUrl(config.baseUrl);
  const continuing = normalizedBaseUrl(config.continuingBaseUrl);
  const areas = [{
    id: "pregrado_posgrado",
    baseUrl: primary,
    required: true
  }];
  if (continuing && continuing !== primary) {
    areas.push({
      id: "educacion_continua",
      baseUrl: continuing,
      required: false
    });
  }
  return areas;
}

export async function collectPaideiaAreaCourses(areas, loadDashboard) {
  const courses = [];
  const seen = new Set();
  const areaStates = [];

  for (const area of areas) {
    try {
      const loaded = await loadDashboard(area);
      let parsed;
      if (Array.isArray(loaded)) {
        parsed = loaded;
      } else {
        if (!isPlausibleDashboardPage(loaded)) {
          const error = new Error(
            `Paideia ${area.id} dashboard was structurally implausible`
          );
          error.code = "scrape_failed";
          throw error;
        }
        parsed = parseDashboardHtml(loaded, area.baseUrl, {
          area: area.id
        });
      }
      for (const course of parsed) {
        if (seen.has(course.id)) continue;
        seen.add(course.id);
        courses.push(course);
      }
      areaStates.push({
        area: area.id,
        state: "available",
        courseCount: parsed.length
      });
    } catch (error) {
      if (area.required) throw error;
      areaStates.push({
        area: area.id,
        state: "unavailable",
        courseCount: 0
      });
    }
  }

  return { courses, areaStates };
}
