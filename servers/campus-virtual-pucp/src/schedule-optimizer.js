import { searchableText } from "./text.js";

export const DEFAULT_SCHEDULE_PREFERENCES = Object.freeze({
  freeDays: [],
  preferredDays: [],
  earliestStart: "07:00",
  latestEnd: "22:00",
  unavailable: [],
  preferredModality: "any",
  preferredProfessors: [],
  avoidedProfessors: [],
  maxDays: 6,
  maxGapMinutes: 240,
  timePreference: "any",
  weights: Object.freeze({
    vacancySafety: 35,
    fewerGaps: 20,
    fewerDays: 15,
    preferredHours: 15,
    professorSurvey: 10,
    modalityLocation: 5
  })
});

function clone(value) {
  return structuredClone(value ?? {});
}

export function mergeSchedulePreferences(local = {}, overrides = {}) {
  return {
    ...clone(DEFAULT_SCHEDULE_PREFERENCES),
    ...clone(local),
    ...clone(overrides),
    weights: {
      ...DEFAULT_SCHEDULE_PREFERENCES.weights,
      ...(local.weights ?? {}),
      ...(overrides.weights ?? {})
    }
  };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function assessEnrollmentRisk(capacity = {}) {
  const vacancies = finite(capacity.vacancies);
  const registrations = finite(capacity.registrations);
  const userPosition = finite(capacity.userPosition);
  const retrievedAt = capacity.retrievedAt ?? null;
  let level = "unknown";
  let score = 0;
  let reason = "insufficient_capacity_data";
  if (vacancies !== null && vacancies <= 0) {
    level = "critical";
    score = 1;
    reason = "no_published_vacancies";
  } else if (vacancies !== null && userPosition !== null) {
    if (userPosition > vacancies) {
      level = "critical";
      score = 1;
      reason = "personal_position_outside_capacity";
    } else {
      const margin = (vacancies - userPosition) / vacancies;
      if (margin <= 0.1) {
        level = "high";
        score = 0.8;
        reason = "personal_position_near_cutoff";
      } else if (margin <= 0.25) {
        level = "medium";
        score = 0.5;
        reason = "personal_position_reduced_margin";
      } else {
        level = "low";
        score = 0.15;
        reason = "personal_position_has_margin";
      }
    }
  } else if (vacancies !== null && registrations !== null) {
    const pressure = registrations / vacancies;
    if (pressure >= 1) {
      level = "critical";
      score = 1;
      reason = "demand_meets_or_exceeds_capacity";
    } else if (pressure >= 0.85) {
      level = "high";
      score = 0.8;
      reason = "demand_near_capacity";
    } else if (pressure >= 0.65) {
      level = "medium";
      score = 0.5;
      reason = "moderate_demand_pressure";
    } else {
      level = "low";
      score = 0.15;
      reason = "available_capacity_margin";
    }
  }
  return {
    level,
    score,
    reason,
    evidence: { vacancies, registrations, userPosition },
    retrievedAt,
    guaranteed: false
  };
}

function minutes(value) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function overlap(left, right) {
  return (
    left.day === right.day &&
    minutes(left.start) < minutes(right.end) &&
    minutes(right.start) < minutes(left.end)
  );
}

function optionSessions(option) {
  return option.components
    ? option.components.flatMap((component) => component.sessions ?? [])
    : option.sessions ?? [];
}

function optionIds(option) {
  return option.components
    ? option.components.map(({ scheduleId }) => scheduleId)
    : [option.scheduleId];
}

function conflictsFor(options) {
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < options.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < options.length; rightIndex += 1) {
      for (const left of optionSessions(options[leftIndex])) {
        for (const right of optionSessions(options[rightIndex])) {
          if (!overlap(left, right)) continue;
          conflicts.push({
            kind: "overlap",
            day: left.day,
            start: left.start > right.start ? left.start : right.start,
            end: left.end < right.end ? left.end : right.end,
            courses: [options[leftIndex].courseCode, options[rightIndex].courseCode],
            schedules: [optionIds(options[leftIndex]), optionIds(options[rightIndex])]
          });
        }
      }
    }
  }
  return conflicts;
}

function buildCourseOptions(offerings) {
  const byCourse = new Map();
  for (const offering of offerings) {
    const code = String(offering.courseCode ?? "").toUpperCase();
    if (!byCourse.has(code)) byCourse.set(code, []);
    byCourse.get(code).push({ ...offering, courseCode: code });
  }
  const output = new Map();
  for (const [code, rows] of byCourse) {
    const referenced = new Set(rows.flatMap((row) => row.associatedScheduleIds ?? []));
    const roots = rows.filter(
      (row) =>
        (row.associatedScheduleIds?.length ?? 0) > 0 &&
        (row.scheduleType === "class" || !referenced.has(row.scheduleId))
    );
    const options = [];
    const bundled = new Set();
    for (const root of roots) {
      const components = [
        root,
        ...root.associatedScheduleIds
          .map((id) => rows.find((row) => row.scheduleId === id))
          .filter(Boolean)
      ];
      for (const component of components) bundled.add(component.scheduleId);
      options.push({ ...root, components });
    }
    for (const row of rows) {
      if (!bundled.has(row.scheduleId)) options.push(row);
    }
    output.set(code, options);
  }
  return output;
}

function hardConstraintReasons(option, preferences) {
  const reasons = new Set();
  const sessions = optionSessions(option);
  if (sessions.some(({ day }) => preferences.freeDays.includes(day))) reasons.add("free_days");
  if (sessions.some(({ start }) => minutes(start) < minutes(preferences.earliestStart))) {
    reasons.add("earliest_start");
  }
  if (sessions.some(({ end }) => minutes(end) > minutes(preferences.latestEnd))) {
    reasons.add("latest_end");
  }
  if (
    sessions.some((session) =>
      preferences.unavailable.some((blocked) => overlap(session, blocked))
    )
  ) {
    reasons.add("unavailable_intervals");
  }
  if (
    preferences.avoidedProfessors.some((name) =>
      searchableText(option.professor).includes(searchableText(name))
    )
  ) {
    reasons.add("avoided_professors");
  }
  return [...reasons];
}

function scheduleMetrics(options, preferences) {
  const sessions = options.flatMap(optionSessions);
  const byDay = new Map();
  for (const session of sessions) {
    if (!byDay.has(session.day)) byDay.set(session.day, []);
    byDay.get(session.day).push(session);
  }
  let gapMinutes = 0;
  for (const daySessions of byDay.values()) {
    daySessions.sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let index = 1; index < daySessions.length; index += 1) {
      gapMinutes += Math.max(0, minutes(daySessions[index].start) - minutes(daySessions[index - 1].end));
    }
  }
  const risks = options.flatMap((option) =>
    (option.components ?? [option]).map((component) =>
      assessEnrollmentRisk({
        ...(component.capacity ?? {}),
        retrievedAt: component.retrievedAt ?? null
      })
    )
  );
  const knownRisks = risks.filter(({ level }) => level !== "unknown");
  const vacancySafety = knownRisks.length
    ? knownRisks.reduce((sum, risk) => sum + (1 - risk.score), 0) / knownRisks.length
    : null;
  const surveyValues = options
    .flatMap((option) => option.components ?? [option])
    .map(({ surveyScore }) => finite(surveyScore))
    .filter((value) => value !== null);
  let professorSurvey = surveyValues.length
    ? surveyValues.reduce((sum, value) => sum + Math.min(1, Math.max(0, value / 5)), 0) /
      surveyValues.length
    : null;
  const preferredMatches = options.filter((option) =>
    preferences.preferredProfessors.some((name) =>
      searchableText(option.professor).includes(searchableText(name))
    )
  ).length;
  if (preferredMatches > 0) {
    professorSurvey = Math.min(1, (professorSurvey ?? 0.5) + preferredMatches / options.length * 0.15);
  }
  const dayCount = byDay.size;
  const fewerDays = Math.max(0, 1 - Math.max(0, dayCount - 1) / 5);
  const fewerGaps = Math.max(0, 1 - gapMinutes / Math.max(60, preferences.maxGapMinutes));
  const preferredHours = sessions.length
    ? sessions.reduce((sum, session) => {
        const midpoint = (minutes(session.start) + minutes(session.end)) / 2;
        if (preferences.timePreference === "morning") return sum + (midpoint <= 13 * 60 ? 1 : 0.35);
        if (preferences.timePreference === "afternoon") return sum + (midpoint >= 12 * 60 ? 1 : 0.35);
        return sum + (midpoint >= 8 * 60 && midpoint <= 19 * 60 ? 1 : 0.7);
      }, 0) / sessions.length
    : 0;
  const modalityLocation = preferences.preferredModality === "any"
    ? 1
    : sessions.length
      ? sessions.filter(({ virtual }) =>
          preferences.preferredModality === "virtual" ? virtual : !virtual
        ).length / sessions.length
      : 0;
  return {
    vacancySafety,
    fewerGaps,
    fewerDays,
    preferredHours,
    professorSurvey,
    modalityLocation,
    dayCount,
    gapMinutes,
    risks
  };
}

function scored(options, preferences) {
  const metrics = scheduleMetrics(options, preferences);
  const available = Object.entries(preferences.weights).filter(
    ([key, weight]) => Number(weight) > 0 && metrics[key] !== null
  );
  const totalWeight = available.reduce((sum, [, weight]) => sum + Number(weight), 0) || 1;
  const points = Object.fromEntries(
    available.map(([key, weight]) => [
      key,
      Math.round(metrics[key] * Number(weight) / totalWeight * 10_000) / 100
    ])
  );
  const total = Math.round(Object.values(points).reduce((sum, value) => sum + value, 0) * 100) / 100;
  return {
    score: total,
    scoreBreakdown: { ...points, total },
    metrics,
    explanation: [
      `Seguridad de vacante: ${Math.round((metrics.vacancySafety ?? 0) * 100)}%.`,
      `Huecos semanales: ${metrics.gapMinutes} minutos.`,
      `Clases distribuidas en ${metrics.dayCount} días.`
    ]
  };
}

function publicCourse(option) {
  return {
    courseCode: option.courseCode,
    courseName: option.courseName ?? "",
    scheduleId: option.scheduleId,
    associatedScheduleIds: option.components
      ? option.components.slice(1).map(({ scheduleId }) => scheduleId)
      : option.associatedScheduleIds ?? [],
    professor: option.professor ?? "",
    sessions: optionSessions(option),
    risk: (option.components ?? [option]).map((component) =>
      assessEnrollmentRisk({
        ...(component.capacity ?? {}),
        retrievedAt: component.retrievedAt ?? null
      })
    )
  };
}

export function evaluateCourseSchedule({ offerings = [], selections = [], preferences = {} }) {
  const effective = mergeSchedulePreferences({}, preferences);
  const options = buildCourseOptions(offerings);
  const selected = [];
  const missing = [];
  for (const selection of selections) {
    const found = (options.get(String(selection.courseCode).toUpperCase()) ?? []).find(
      (option) => optionIds(option).includes(String(selection.scheduleId))
    );
    if (found) selected.push(found);
    else missing.push(selection);
  }
  const hardReasons = selected.flatMap((option) => hardConstraintReasons(option, effective));
  const conflicts = conflictsFor(selected);
  const result = scored(selected, effective);
  return {
    valid: missing.length === 0 && hardReasons.length === 0 && conflicts.length === 0,
    missing,
    conflicts,
    hardConstraintViolations: [...new Set(hardReasons)],
    courses: selected.map(publicCourse),
    score: result.score,
    scoreBreakdown: result.scoreBreakdown,
    explanation: result.explanation
  };
}

export function recommendCourseSchedules({
  courseCodes = [],
  offerings = [],
  localPreferences = {},
  preferences = {},
  maxResults = 5,
  retrievedAt = null
}) {
  const codes = [...new Set(courseCodes.map((code) => String(code).toUpperCase()))];
  if (codes.length === 0 || codes.length > 10) {
    return {
      status: "invalid_course_count",
      recommendations: [],
      warnings: ["Select between one and ten courses."]
    };
  }
  const effective = mergeSchedulePreferences(localPreferences, preferences);
  const byCourse = buildCourseOptions(offerings);
  const unsatisfied = new Set();
  const candidates = codes.map((code) =>
    (byCourse.get(code) ?? []).filter((option) => {
      const reasons = hardConstraintReasons(option, effective);
      reasons.forEach((reason) => unsatisfied.add(reason));
      return reasons.length === 0;
    })
  );
  const missingCourses = codes.filter((_, index) => candidates[index].length === 0);
  const valid = [];
  if (missingCourses.length === 0) {
    const chosen = [];
    const visit = (index) => {
      if (index === candidates.length) {
        const metrics = scored(chosen, effective);
        valid.push({
          courses: chosen.map(publicCourse),
          conflicts: [],
          score: metrics.score,
          scoreBreakdown: metrics.scoreBreakdown,
          explanation: metrics.explanation,
          risks: metrics.metrics.risks
        });
        return;
      }
      for (const option of candidates[index]) {
        if (conflictsFor([...chosen, option]).length > 0) {
          unsatisfied.add("schedule_overlap");
          continue;
        }
        chosen.push(option);
        visit(index + 1);
        chosen.pop();
      }
    };
    visit(0);
  }
  valid.sort(
    (left, right) =>
      right.score - left.score ||
      left.courses.map(({ scheduleId }) => scheduleId).join("|").localeCompare(
        right.courses.map(({ scheduleId }) => scheduleId).join("|")
      )
  );
  if (valid.length === 0) {
    return {
      status: "no_valid_schedule",
      recommendations: [],
      missingCourses,
      unsatisfiedConstraints: [...unsatisfied].sort(),
      suggestedRelaxations: [...unsatisfied].sort().map((constraint) => ({
        constraint,
        suggestion: `Review or relax ${constraint.replaceAll("_", " ")}.`
      })),
      retrievedAt
    };
  }
  return {
    status: "complete",
    recommendations: valid.slice(0, Math.min(20, Math.max(1, Number(maxResults) || 5))),
    consideredCombinations: valid.length,
    preferences: effective,
    retrievedAt,
    warnings: ["Vacancies are observations, never guarantees of enrollment."]
  };
}
