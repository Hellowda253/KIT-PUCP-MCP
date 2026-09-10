import { cleanText } from "./text.js";

const SCHEDULE_ID = /^[A-Z0-9-]{2,15}$/iu;

function decoded(value) {
  try {
    return decodeURIComponent(String(value).replaceAll("+", " "));
  } catch {
    return String(value);
  }
}

function linkedScheduleIds(html) {
  return [...String(html ?? "").matchAll(/(?:[?&]|&amp;)horario=([^&"'\s<>]+)/giu)]
    .map((match) => cleanText(decoded(match[1])).toUpperCase())
    .filter((value) => SCHEDULE_ID.test(value));
}

function directCellText(html) {
  return cleanText(
    String(html ?? "")
      .replace(/<a\b[^>]*>[\s\S]*?<\/a>/giu, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, " ")
  );
}

function visibleLabels(html) {
  return [...String(html ?? "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
}

export function parseScheduleReference(value, { html = "" } = {}) {
  const rawSchedule = cleanText(value);
  const technicalIds = linkedScheduleIds(html);
  const direct = directCellText(html).toUpperCase();
  if (SCHEDULE_ID.test(direct)) technicalIds.unshift(direct);
  const prefix = rawSchedule.match(/^([A-Z0-9-]{2,15})(?:\s+|$)/iu)?.[1]?.toUpperCase() ?? "";
  if (prefix) technicalIds.push(prefix);
  const uniqueIds = [...new Set(technicalIds)];
  const scheduleId = uniqueIds[0] || rawSchedule;
  const linkedLabels = visibleLabels(html);
  const remainder = scheduleId && rawSchedule.toUpperCase().startsWith(scheduleId.toUpperCase())
    ? rawSchedule.slice(scheduleId.length).trim()
    : "";
  const scheduleLabel = [...new Set(linkedLabels)].join(" / ") || remainder;
  return {
    scheduleId,
    scheduleLabel,
    rawSchedule,
    ambiguous: uniqueIds.length > 1
  };
}

export function normalizeScheduleId(value) {
  return parseScheduleReference(value).scheduleId;
}
