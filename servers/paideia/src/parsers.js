import {
  canonicalCourseDisplayName,
  cleanText,
  extractDue,
  normalizeCourseName
} from "./text.js";

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function attribute(fragment, name) {
  return fragment.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "";
}

function idFromUrl(url, fallback = "") {
  try {
    return new URL(url).searchParams.get("id") ?? fallback;
  } catch {
    return fallback;
  }
}

function scopedEntityId(sourceId, area) {
  return area && area !== "pregrado_posgrado"
    ? `${area}:${sourceId}`
    : sourceId;
}

function areaMetadata(value) {
  if (!value?.area) return {};
  return {
    area: value.area,
    areas: Array.isArray(value.areas) ? value.areas : [value.area]
  };
}

function removeAccessHide(value) {
  return String(value).replace(
    /<[^>]*class=["'][^"']*\b(?:accesshide|sr-only)\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi,
    " "
  );
}

function classifyActivity(url) {
  const match = url.match(/\/mod\/([^/]+)\//i);
  const module = match?.[1]?.toLowerCase();
  if (module === "assign") return "assignment";
  if (module === "quiz") return "quiz";
  if (["folder", "url", "forum", "page", "resource"].includes(module)) return module;
  if (/pluginfile\.php/i.test(url)) return "resource";
  return "other";
}

function sectionSlices(html) {
  const starts = [];
  const pattern = /<(?:li|div)\b[^>]*class=["'][^"']*\b(?:section|course-section)\b[^"']*["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    starts.push(match.index);
  }
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

function activityRows(sectionHtml) {
  const anchors = [];
  const pattern = /<a\b([^>]*)href=["']([^"']*(?:\/mod\/|pluginfile\.php)[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of sectionHtml.matchAll(pattern)) {
    anchors.push({
      index: match.index,
      attrs: `${match[1]} href="${match[2]}" ${match[3]}`,
      inner: match[4]
    });
  }
  return anchors.map((anchor, index) => ({
    ...anchor,
    context: sectionHtml.slice(anchor.index, anchors[index + 1]?.index ?? sectionHtml.length)
  }));
}

export function parseDashboardHtml(html, baseUrl, { area } = {}) {
  const found = new Map();
  const pattern = /<a\b([^>]*href=["'][^"']*\/course\/view\.php\?[^"']*\bid=\d+[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const url = absoluteUrl(attribute(match[1], "href"), baseUrl);
    const name = canonicalCourseDisplayName(match[2]);
    const sourceId = idFromUrl(url);
    if (sourceId && name) {
      const course = {
        id: scopedEntityId(sourceId, area),
        name,
        shortName: normalizeCourseName(name),
        url
      };
      if (area) {
        course.sourceId = sourceId;
        course.area = area;
        course.areas = [area];
      }
      found.set(sourceId, course);
    }
  }
  return [...found.values()].sort((left, right) =>
    left.shortName.localeCompare(right.shortName, "es", { sensitivity: "base" })
  );
}

export function parseTimelineCourseCatalog(batches, baseUrl, { area } = {}) {
  const found = new Map();
  for (const batch of Array.isArray(batches) ? batches : []) {
    const classification = String(batch?.classification || "").trim();
    for (const raw of Array.isArray(batch?.courses) ? batch.courses : []) {
      const fallbackId = String(raw?.id ?? "").trim();
      const url = absoluteUrl(
        raw?.viewurl || raw?.courseviewurl || (fallbackId ? `/course/view.php?id=${fallbackId}` : ""),
        baseUrl
      );
      const sourceId = String(raw?.id ?? idFromUrl(url)).trim();
      const name = cleanText(raw?.fullname || raw?.displayname || raw?.shortname || "");
      if (!sourceId || !name || !url) continue;
      const previous = found.get(sourceId);
      const timelineClassifications = [
        ...(previous?.timelineClassifications ?? []),
        ...(classification ? [classification] : [])
      ].filter((value, index, values) => values.indexOf(value) === index);
      const course = {
        id: scopedEntityId(sourceId, area),
        name,
        shortName: normalizeCourseName(name),
        url,
        timelineClassifications
      };
      if (area) {
        course.sourceId = sourceId;
        course.area = area;
        course.areas = [area];
      }
      found.set(sourceId, previous ? { ...previous, ...course } : course);
    }
  }
  return [...found.values()].sort((left, right) =>
    left.shortName.localeCompare(right.shortName, "es", { sensitivity: "base" })
  );
}

export function isPlausibleDashboardPage(html) {
  const source = String(html);
  if (
    /(?:id|name)=["'](?:login|username|password)["']/i.test(source) ||
    /\b(?:exception|error code|stack trace|invalid login)\b/i.test(
      cleanText(source)
    )
  ) {
    return false;
  }
  return (
    /\bid=["']page-my-courses["']/i.test(source) ||
    /\bdata-region=["'](?:course-content|courses-view)["']/i.test(source) ||
    /\bclass=["'][^"']*\bblock_myoverview\b/i.test(source) ||
    /\/course\/view\.php\?[^"']*\bid=\d+/i.test(source)
  );
}

export function parseCourseHtml(html, course, baseUrl) {
  const sections = [];
  const activities = [];
  for (const sectionHtml of sectionSlices(String(html))) {
    const titleMatch = sectionHtml.match(
      /<(?:h2|h3|h4|span|div)\b[^>]*class=["'][^"']*(?:sectionname|section-title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h2|h3|h4|span|div)>/i
    );
    const section = cleanText(titleMatch?.[1] ?? "Sin sección");
    const sectionActivities = [];
    for (const row of activityRows(sectionHtml)) {
      const url = absoluteUrl(attribute(row.attrs, "href"), baseUrl);
      const title = cleanText(removeAccessHide(row.inner))
        .replace(/\s+(Archivo|Carpeta|URL|Tarea|Cuestionario|Foro|Página)$/i, "")
        .trim();
      if (!url || !title) continue;
      const type = classifyActivity(url);
      const sourceId = idFromUrl(
        url,
        `${course.sourceId ?? course.id}-${activities.length + 1}`
      );
      const item = {
        id: scopedEntityId(sourceId, course.area),
        courseId: course.id,
        course: course.shortName,
        section,
        type,
        title,
        url,
        ...(course.area ? { sourceId } : {}),
        ...areaMetadata(course),
        ...extractDue(row.context)
      };
      activities.push(item);
      sectionActivities.push(item.id);
    }
    sections.push({
      id: `${course.id}-${sections.length + 1}`,
      courseId: course.id,
      title: section,
      activityIds: sectionActivities,
      ...areaMetadata(course)
    });
  }
  const pendingItems = activities.filter(({ type }) =>
    type === "assignment" || type === "quiz"
  );
  const materials = activities
    .filter(({ type }) => ["resource", "folder", "url", "page"].includes(type))
    .map((item) => ({ ...item, kind: item.type }));
  return { sections, activities, pendingItems, materials };
}

export function isPlausibleCoursePage(html, parsed) {
  const source = String(html);
  if (
    /(?:id|name)=["'](?:login|username|password)["']/i.test(source) ||
    /\b(?:exception|error code|stack trace|invalid login)\b/i.test(
      cleanText(source)
    )
  ) {
    return false;
  }
  return (
    (parsed?.sections?.length ?? 0) > 0 ||
    (parsed?.activities?.length ?? 0) > 0
  );
}

export function parseActivityDetailHtml(html, activity) {
  const text = cleanText(html);
  const heading = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const intro = String(html).match(
    /<[^>]*class=["'][^"']*\b(?:intro|activity-description)\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  )?.[1];
  const state = text.match(
    /Estado de la entrega\s*(No entregado|Entregado|Enviado para calificar|Borrador|Calificado)/i
  )?.[1] ?? "";
  return {
    id: activity.id,
    type: activity.type,
    title: cleanText(heading ?? activity.title),
    instructions: cleanText(intro ?? ""),
    submissionState: cleanText(state),
    ...areaMetadata(activity),
    ...extractDue(text)
  };
}

export function parseAnnouncementsHtml(html, course, baseUrl) {
  const posts = [];
  const pattern = /<(article|div)\b[^>]*(?:data-region=["']post["']|class=["'][^"']*\bforum-post\b[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const body = match[2];
    const title = cleanText(
      body.match(/<h[234]\b[^>]*(?:class=["'][^"']*subject[^"']*["'])?[^>]*>([\s\S]*?)<\/h[234]>/i)?.[1] ?? ""
    );
    const linkMatch = body.match(
      /<a\b([^>]*href=["'][^"']*\/mod\/forum\/discuss\.php\?[^"']*\bd=\d+[^"']*["'][^>]*)>/i
    );
    if (!title || !linkMatch) continue;
    const url = absoluteUrl(attribute(linkMatch[1], "href"), baseUrl);
    const timeValue = body.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? "";
    const summary = cleanText(
      body.match(/<[^>]*class=["'][^"']*\b(?:posting|fullpost)\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ?? ""
    );
    const author = cleanText(
      body.match(/<[^>]*class=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ?? ""
    );
    const sourceId = new URL(url).searchParams.get("d") ?? url;
    posts.push({
      id: scopedEntityId(sourceId, course.area),
      courseId: course.id,
      course: course.shortName ?? course.name ?? "",
      title,
      author,
      publishedAt: timeValue ? new Date(timeValue).toISOString() : "",
      summary,
      url,
      ...(course.area ? { sourceId } : {}),
      ...areaMetadata(course)
    });
  }
  return posts.sort((left, right) =>
    (right.publishedAt || "").localeCompare(left.publishedAt || "") ||
    left.title.localeCompare(right.title)
  );
}

export function parseGradesHtml(html, course) {
  if (!/<table\b[^>]*(?:id=["']user-grade["']|class=["'][^"']*user-grade)/i.test(html)) {
    return { state: "unavailable", items: [] };
  }
  const items = [];
  const rowPattern = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  for (const match of String(html).matchAll(rowPattern)) {
    const attrs = match[1];
    if (!/\b(?:gradeitem|category)\b/i.test(attribute(attrs, "class"))) continue;
    const cells = {};
    const cellPattern = /<(?:th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)>/gi;
    for (const cell of match[2].matchAll(cellPattern)) {
      const className = attribute(cell[1], "class");
      for (const key of ["item", "grade", "range", "percentage", "feedback"]) {
        if (className.split(/\s+/).includes(key)) cells[key] = cleanText(cell[2]);
      }
    }
    if (!cells.item) continue;
    items.push({
      courseId: course.id,
      course: course.shortName ?? course.name ?? "",
      name: cells.item,
      category: /\bcategory\b/i.test(attribute(attrs, "class")),
      rawGrade: cells.grade ?? "",
      range: cells.range ?? "",
      percentage: cells.percentage ?? "",
      feedback: cells.feedback ?? "",
      ...areaMetadata(course)
    });
  }
  return { state: "available", items };
}
