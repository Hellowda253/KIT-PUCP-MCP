import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, "skills", "pucp-academic");
const templatePath = path.join(skillRoot, "assets", "horario-pucp.html");
const rendererPath = path.join(skillRoot, "scripts", "render-schedule.mjs");
const layoutPath = path.join(skillRoot, "scripts", "schedule-layout.mjs");
const displayPath = path.join(skillRoot, "scripts", "schedule-display.mjs");
const sourcePath = path.join(skillRoot, "scripts", "schedule-source.mjs");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function campusScheduleEnvelope() {
  return {
    data: {
      state: "available",
      answerReady: true,
      activeTerm: "2026-2",
      courseDetails: [{
        courseCode: "1IND95",
        courseName: "SUPPLY CHAIN ANALYTICS",
        credits: 3,
        scheduleIds: ["1031"],
        sessions: [{
          day: "thursday", start: "15:00", end: "17:00", kind: "class",
          scheduleId: "1031", room: "G103", professor: "Atoche, W."
        }, {
          day: "thursday", start: "17:00", end: "19:00", kind: "laboratory",
          scheduleId: "1031", room: "S G103", professor: "Fernandez, M."
        }]
      }, {
        courseCode: "1IND52",
        courseName: "DISEÑO DE LA CADENA DE SUMINISTROS Y OPERACIONES",
        credits: 4,
        scheduleIds: ["0732"],
        sessions: [{
          day: "thursday", start: "20:00", end: "21:00", kind: "practice",
          scheduleId: "0732", room: "S E115", professor: "Rojas, J."
        }, {
          day: "thursday", start: "21:00", end: "22:00", kind: "laboratory",
          scheduleId: "0732", room: "S E115", professor: "Rojas, J."
        }]
      }, {
        courseCode: "IND275",
        courseName: "CONTROL DE GESTIÓN INDUSTRIAL",
        credits: 4.5,
        scheduleIds: ["0734"],
        sessions: [
          { day: "tuesday", start: "08:00", end: "11:00", kind: "exam", examType: "partial", date: "2026-10-13", scheduleId: "0734", room: "A402" },
          { day: "tuesday", start: "08:00", end: "11:00", kind: "exam", examType: "partial", date: "2026-10-13", scheduleId: "0734", room: "A607" },
          { day: "tuesday", start: "08:00", end: "11:00", kind: "exam", examType: "final", date: "2026-12-01", scheduleId: "0734", room: "A402" },
          { day: "tuesday", start: "08:00", end: "11:00", kind: "exam", examType: "final", date: "2026-12-01", scheduleId: "0734", room: "A607" }
        ]
      }]
    }
  };
}

test("Campus schedule source maps kinds deterministically and merges compatible fragments", async () => {
  assert.equal(await exists(sourcePath), true, "schedule source adapter must exist");
  const { prepareScheduleSourceData } = await import(pathToFileURL(sourcePath));
  const data = prepareScheduleSourceData(campusScheduleEnvelope());

  assert.equal(data.term, "2026-2");
  assert.equal(data.credits, 11.5);
  assert.deepEqual(
    data.sessions.filter(({ courseCodes }) => courseCodes.includes("1IND95")).map(({ type, start, end }) => ({ type, start, end })),
    [{ type: "class", start: "15:00", end: "17:00" }, { type: "lab", start: "17:00", end: "19:00" }]
  );
  assert.deepEqual(
    data.sessions.filter(({ courseCodes }) => courseCodes.includes("1IND52")).map(({ type, start, end }) => ({ type, start, end })),
    [{ type: "lab", start: "20:00", end: "22:00" }]
  );
});

test("Campus schedule source keeps partial and final separate while merging their rooms", async () => {
  const { prepareScheduleSourceData } = await import(pathToFileURL(sourcePath));
  const data = prepareScheduleSourceData(campusScheduleEnvelope());
  const exams = data.sessions.filter(({ courseCodes, type }) => type === "exam" && courseCodes.includes("IND275"));

  assert.equal(exams.length, 2);
  assert.deepEqual(exams.map(({ examType, date, rooms }) => ({ examType, date, rooms })), [{
    examType: "partial", date: "2026-10-13", rooms: ["A402", "A607"]
  }, {
    examType: "final", date: "2026-12-01", rooms: ["A402", "A607"]
  }]);
});

test("Campus schedule source collapses repeated undated exam rows without inventing partial or final", async () => {
  const { prepareScheduleSourceData } = await import(pathToFileURL(sourcePath));
  const source = campusScheduleEnvelope();
  const course = source.data.courseDetails.find(({ courseCode }) => courseCode === "IND275");
  course.sessions = ["A402", "A607", "A402", "A607"].map((room) => ({
    day: "tuesday",
    start: "08:00",
    end: "11:00",
    kind: "exam",
    scheduleId: "0734",
    room
  }));

  const data = prepareScheduleSourceData(source);
  const exams = data.sessions.filter(({ courseCodes, type }) => type === "exam" && courseCodes.includes("IND275"));

  assert.equal(exams.length, 1);
  assert.equal(exams[0].examType, "unknown");
  assert.equal(exams[0].datePrecision, "weekday_time_only");
  assert.deepEqual(exams[0].rooms, ["A402", "A607"]);
  assert.equal(data.warnings.filter(({ code }) => code === "exam_occurrences_ambiguous").length, 1);
});

test("Campus schedule source rejects unknown kinds instead of silently treating them as classes", async () => {
  const { prepareScheduleSourceData } = await import(pathToFileURL(sourcePath));
  const source = campusScheduleEnvelope();
  source.data.courseDetails[0].sessions[1].kind = "mystery_component";

  assert.throws(
    () => prepareScheduleSourceData(source),
    (error) => error.code === "schedule_session_kind_unsupported" && /mystery_component/u.test(error.message)
  );
});

test("schedule renderer accepts the canonical get_student_schedule response without agent transcription", async () => {
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-campus-schedule-"));
  const outputPath = path.join(outputDir, "horario.html");
  try {
    await renderScheduleTemplate({ templatePath, outputPath, data: campusScheduleEnvelope() });
    const html = await readFile(outputPath, "utf8");
    const embedded = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/u)?.[1];
    const rendered = JSON.parse(embedded);

    assert.equal(rendered.courses.length, 3);
    assert.equal(rendered.sessions.filter(({ type }) => type === "exam").length, 2);
    assert.equal(rendered.sessions.find(({ start }) => start === "17:00").type, "lab");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("schedule renderer uses one canonical output location when no custom path is requested", async () => {
  const { defaultScheduleOutputPath } = await import(pathToFileURL(rendererPath));
  const output = defaultScheduleOutputPath(campusScheduleEnvelope(), path.join("C:\\", "workspace"));

  assert.equal(output, path.resolve("C:\\workspace", "Horarios_PUCP", "Horario_PUCP_2026-2.html"));
});

test("PUCP Academic bundles one UTF-8 responsive and printable schedule template", async () => {
  assert.equal(await exists(templatePath), true, "schedule template must exist");
  const html = await readFile(templatePath, "utf8");

  assert.match(html, /<meta charset="UTF-8">/);
  assert.doesNotMatch(html, /(?:Ã.|Â.|â€|ðŸ)/u);
  assert.match(html, /id="schedule-data"/);
  assert.match(html, /class="mobile-agenda"/);
  assert.match(html, /@media \(max-width: 760px\)/);
  assert.match(html, /@page\s*{[^}]*size:\s*A4 landscape/s);
  assert.match(html, /@media print\s*{[\s\S]*body\.theme-dark\s*{[^}]*--bg-surface:\s*#fff/);
  assert.doesNotMatch(html, /\.event-box\s*{[^}]*position:\s*static\s*!important/s);
  assert.doesNotMatch(html, /[🌙☀️]/u);

  const scripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]);
  assert.ok(scripts.length > 0, "template must contain its standalone renderer");
  for (const script of scripts) new Function(script);
});

test("schedule template offers an icon-only HTML download after the PDF action", async () => {
  const html = await readFile(templatePath, "utf8");

  assert.match(html, /id="print-button"[\s\S]*id="download-html-button"/u);
  assert.match(html, /id="download-html-button"[^>]*aria-label="Descargar horario en HTML"/u);
  assert.match(html, /id="download-html-button"[\s\S]*<svg[^>]*aria-hidden="true"/u);
  assert.doesNotMatch(html, /id="download-html-button"[^>]*>\s*Descargar/u);
  assert.match(html, /new Blob\(\[html\],\s*\{\s*type:\s*"text\/html;charset=utf-8"\s*\}\)/u);
  assert.match(html, /download\s*=\s*`Horario_PUCP_\$\{safeTerm\}\.html`/u);
});

test("schedule layout assigns horizontal lanes to every overlapping activity", async () => {
  assert.equal(await exists(layoutPath), true, "schedule layout module must exist");
  const { layoutDaySessions } = await import(pathToFileURL(layoutPath));
  const toMinutes = (value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const sessions = [
    { id: "isolated", start: "08:00", end: "09:00" },
    { id: "long", start: "10:00", end: "12:00" },
    { id: "early", start: "10:00", end: "11:00" },
    { id: "reuses", start: "11:00", end: "13:00" },
    { id: "three-a", start: "14:00", end: "16:00" },
    { id: "three-b", start: "14:00", end: "15:00" },
    { id: "three-c", start: "14:30", end: "15:30" }
  ];

  const placed = layoutDaySessions(sessions, toMinutes);
  const byId = Object.fromEntries(placed.map((item) => [item.session.id, item]));

  assert.deepEqual({ lane: byId.isolated.lane, lanes: byId.isolated.lanes }, { lane: 0, lanes: 1 });
  assert.equal(byId.long.lanes, 2);
  assert.equal(byId.early.lanes, 2);
  assert.equal(byId.reuses.lanes, 2);
  assert.equal(byId.reuses.lane, byId.early.lane, "a free lane should be reused");
  assert.equal(byId["three-a"].lanes, 3);
  assert.equal(byId["three-b"].lanes, 3);
  assert.equal(byId["three-c"].lanes, 3);
  assert.equal(new Set([byId["three-a"].lane, byId["three-b"].lane, byId["three-c"].lane]).size, 3);
});

test("schedule overlap uses direct half-open time intersections", async () => {
  const { sessionsOverlap } = await import(pathToFileURL(layoutPath));
  const toMinutes = (value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const base = { start: "10:00", end: "12:00" };

  assert.equal(typeof sessionsOverlap, "function");
  assert.equal(sessionsOverlap(base, { start: "11:30", end: "13:00" }, toMinutes), true);
  assert.equal(sessionsOverlap(base, { start: "10:30", end: "11:00" }, toMinutes), true);
  assert.equal(sessionsOverlap(base, { start: "12:00", end: "13:00" }, toMinutes), false);
  assert.equal(sessionsOverlap(base, { start: "08:00", end: "10:00" }, toMinutes), false);
});

test("schedule modes recalculate overlap lanes using only visible activities", async () => {
  const html = await readFile(templatePath, "utf8");

  assert.doesNotMatch(
    html,
    /body\.mode-(?:classes|exams)\s+\.event-box\s*{[^}]*width:\s*calc\(100%/s,
    "filtered modes must not override lane widths with CSS"
  );
  assert.match(html, /let activeMode = "all";/);
  assert.match(html, /let activeExamType = "partial";/);
  assert.match(html, /function sessionIsVisible\(session\)/);
  assert.match(html, /validSession\(session\) && sessionIsVisible\(session\)/);
  assert.match(html, /function setMode\(mode\)[\s\S]*activeMode = mode;[\s\S]*renderDesktop\(\);/);
});

test("schedule modes distinguish partial and final exams without treating dates as weekly duplicates", async () => {
  const html = await readFile(templatePath, "utf8");

  assert.match(html, /id="exam-type-control"[^>]*hidden/u);
  assert.match(html, /data-exam-type="partial"[^>]*>Parciales</u);
  assert.match(html, /data-exam-type="final"[^>]*>Finales</u);
  assert.match(html, /activeMode === "all"[\s\S]*session\.examType !== "final"/u);
  assert.match(html, /activeMode === "exams"[\s\S]*session\.examType === activeExamType/u);
  assert.doesNotMatch(html, /activeMode === "exams"[^\n]*examType === "unknown"/u);
  assert.match(html, /function setExamType\(examType\)[\s\S]*renderDesktop\(\);[\s\S]*renderMobile\(\);/u);
  assert.match(html, /exam-type-control[\s\S]*mode-control/u, "exam selector must precede the main view selector");
});

test("print layout keeps the desktop timetable visible and vertically aligned", async () => {
  const html = await readFile(templatePath, "utf8");
  const printBlock = html.match(/@media print\s*{([\s\S]*?)\n\s*}\n\s*<\/style>/)?.[1] ?? "";

  assert.match(printBlock, /:root\s*{\s*--hour-height:\s*38px;/);
  assert.match(printBlock, /\.timetable-card\s*{[^}]*display:\s*block\s*!important;/s);
  assert.match(printBlock, /\.event-content\s*{[^}]*padding:\s*2px 4px;/s);
  assert.match(printBlock, /\.event-title\s*{[^}]*-webkit-line-clamp:\s*2;/s);
  assert.match(printBlock, /\.event-details\s*{[^}]*-webkit-line-clamp:\s*2;/s);
  assert.match(printBlock, /\.event-box\.event-short\s+\.event-details\s*{[^}]*-webkit-line-clamp:\s*1;/s);
  assert.doesNotMatch(html, /const HOUR_HEIGHT\s*=/);
  assert.match(html, /const topPercent\s*=/);
  assert.match(html, /const heightPercent\s*=/);
  assert.match(html, /event\.style\.top\s*=\s*`calc\(\$\{topPercent\}% \+ 2px\)`/);
  assert.match(html, /event\.style\.height\s*=\s*`calc\(\$\{heightPercent\}% - 4px\)`/);
});

test("schedule template expands its visible hours for official sessions outside 07:00-22:00", async () => {
  const template = await readFile(templatePath, "utf8");

  assert.match(template, /function scheduleBounds\(/u);
  assert.match(template, /const \{ startMinutes: START_MINUTES, endMinutes: END_MINUTES \} = scheduleBounds\(sessions\)/u);
  assert.doesNotMatch(template, /for \(let hour = 7; hour < 22;/u);
});

test("schedule renderer rejects courses whose declared exams are missing from sessions", async () => {
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-schedule-missing-exam-"));
  const outputPath = path.join(outputDir, "horario.html");
  const data = {
    term: "2026-1",
    credits: 4,
    courses: [{
      code: "1ECO18",
      name: "Economía Pública",
      credits: 4,
      scheduleId: "0721",
      instructor: "Barrantes, Roxana",
      classes: "Lun 08:00–10:00",
      practice: "—",
      exams: "Lun 08:00–10:00"
    }],
    sessions: [{
      day: 1,
      start: "08:00",
      end: "10:00",
      type: "class",
      courseCodes: ["1ECO18"],
      scheduleId: "0721",
      title: "Economía Pública",
      room: "J210",
      instructor: "Barrantes, Roxana"
    }]
  };

  try {
    await assert.rejects(
      renderScheduleTemplate({ templatePath, outputPath, data }),
      /missing official exam sessions.*1ECO18.*get_course_schedule_details.*do not replace.*exams.*-/is
    );
    assert.equal(await exists(outputPath), false, "an incomplete schedule must not be written");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("schedule renderer refuses an empty exams shortcut without an explicit official status", async () => {
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-schedule-exam-shortcut-"));
  const outputPath = path.join(outputDir, "horario.html");
  const data = {
    term: "2026-2",
    credits: 4,
    courses: [{
      code: "1IND52",
      name: "Diseño de la Cadena de Suministros y Operaciones",
      credits: 4,
      scheduleId: "0732",
      instructor: "Docente",
      classes: "Lun 10:00–13:00",
      practice: "—",
      exams: "-"
    }],
    sessions: [{
      day: 1,
      start: "10:00",
      end: "13:00",
      type: "class",
      courseCodes: ["1IND52"]
    }]
  };

  try {
    await assert.rejects(
      renderScheduleTemplate({ templatePath, outputPath, data }),
      /examStatus.*required.*1IND52.*not_published.*Campus/is
    );
    assert.equal(await exists(outputPath), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("schedule renderer distinguishes confirmed not-published exams from unknown data", async () => {
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-schedule-exam-status-"));
  const outputPath = path.join(outputDir, "horario.html");
  const base = {
    term: "2026-2",
    credits: 3.5,
    courses: [{
      code: "MAT101",
      name: "Cálculo",
      credits: 3.5,
      scheduleId: "0101",
      instructor: "Docente",
      classes: "Lun 08:00–10:00",
      practice: "—",
      exams: "—",
      examStatus: "not_published"
    }],
    sessions: [{
      day: 1,
      start: "08:00",
      end: "10:00",
      type: "class",
      courseCodes: ["MAT101"]
    }]
  };

  try {
    await renderScheduleTemplate({ templatePath, outputPath, data: base });
    assert.equal(await exists(outputPath), true);
    await assert.rejects(
      renderScheduleTemplate({
        templatePath,
        outputPath,
        data: {
          ...base,
          courses: [{ ...base.courses[0], examStatus: "unknown" }]
        }
      }),
      /exam information is unknown.*MAT101.*get_course_schedule_details/is
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("desktop events expand on hover or keyboard focus and obscure only crossed peers", async () => {
  const html = await readFile(templatePath, "utf8");

  assert.match(html, /@media screen[^{]*{[\s\S]*\.event-box\.event-expanded\s*{[^}]*width:\s*calc\(100% - 6px\)\s*!important;/);
  assert.match(html, /@media screen[^{]*{[\s\S]*\.event-box\.event-obscured\s*{[^}]*opacity:\s*0;/);
  assert.match(html, /function sessionsOverlap\(left, right\)/);
  assert.match(html, /function activateEventFocus\(event\)/);
  assert.match(html, /function clearEventFocus\(dayColumn\)/);
  assert.match(html, /event\.dataset\.startMinutes\s*=\s*String\(start\)/);
  assert.match(html, /event\.dataset\.endMinutes\s*=\s*String\(end\)/);
  assert.match(html, /event\.classList\.toggle\("event-short",\s*end - start <= 60\)/);
  assert.match(html, /event\.tabIndex\s*=\s*0/);
  assert.match(html, /event\.addEventListener\("pointerenter",[\s\S]*activateEventFocus\(event\)/);
  assert.match(html, /event\.addEventListener\("pointerleave",[\s\S]*clearEventFocus\(dayColumn\)/);
  assert.match(html, /event\.addEventListener\("focus",[\s\S]*activateEventFocus\(event\)/);
  assert.match(html, /event\.addEventListener\("blur",[\s\S]*clearEventFocus\(dayColumn\)/);
  assert.match(html, /event\.dataset\.baseHeight/);
  assert.match(html, /event\.scrollHeight/);
  assert.match(html, /event\.style\.height/);
});

test("schedule display keeps official values and derives readable labels", async () => {
  assert.equal(await exists(displayPath), true, "schedule display formatter must exist");
  const { prepareScheduleDisplayData } = await import(pathToFileURL(displayPath));
  const input = {
    term: "2026-2",
    credits: 4,
    courses: [{
      code: "1IND52",
      name: "DISEÑO DE LA CADENA DE SUMINISTROS Y OPERACIONES",
      instructor: "ROJAS POLO, JONATAN EDWARD"
    }],
    sessions: [{
      day: 1,
      start: "10:00",
      end: "13:00",
      type: "class",
      title: "DISEÑO DE LA CADENA DE SUMINISTROS Y OPERACIONES",
      instructor: "ROJAS POLO, JONATAN EDWARD"
    }]
  };

  const result = prepareScheduleDisplayData(input);
  assert.equal(result.courses[0].name, input.courses[0].name, "official course name must remain unchanged");
  assert.equal(result.courses[0].instructor, input.courses[0].instructor, "official instructor must remain unchanged");
  assert.equal(result.courses[0].displayName, "Diseño de la Cadena de Suministros y Operaciones");
  assert.equal(result.courses[0].displayInstructor, "Rojas Polo, J. E.");
  assert.equal(result.sessions[0].title, input.sessions[0].title, "official session title must remain unchanged");
  assert.equal(result.sessions[0].displayTitle, "Diseño de la Cadena de Suministros y Operaciones");
  assert.equal(result.sessions[0].displayInstructor, "Rojas Polo, J. E.");
});

test("exam cards derive their display title from the associated course", async () => {
  const { prepareScheduleDisplayData } = await import(pathToFileURL(displayPath));
  const input = {
    term: "2026-2",
    credits: 4,
    courses: [{
      code: "1IND52",
      name: "DISEÑO DE LA CADENA DE SUMINISTROS Y OPERACIONES"
    }],
    sessions: [{
      day: 3,
      start: "08:00",
      end: "11:00",
      type: "exam",
      examType: "partial",
      date: "2026-10-14",
      courseCodes: ["1IND52"],
      title: "Examen"
    }]
  };

  const result = prepareScheduleDisplayData(input);
  assert.equal(result.sessions[0].title, "Examen", "the original Campus value must be preserved");
  assert.equal(result.sessions[0].displayTitle, "Diseño de la Cadena de Suministros y Operaciones");
  assert.equal(result.sessions[0].displayExamDate, "14 oct");
  assert.equal(result.sessions[0].displayExamType, "Parcial");
});

test("schedule display builds unambiguous partial and final summaries from dated sessions", async () => {
  const { prepareScheduleDisplayData } = await import(pathToFileURL(displayPath));
  const result = prepareScheduleDisplayData({
    term: "2026-2",
    credits: 4,
    courses: [{ code: "1IND52", name: "Diseño", exams: "legacy ambiguous text" }],
    sessions: [{
      day: 3, start: "08:00", end: "11:00", type: "exam", examType: "partial",
      date: "2026-10-14", courseCodes: ["1IND52"], room: "E309"
    }, {
      day: 5, start: "08:00", end: "11:00", type: "exam", examType: "final",
      date: "2026-12-11", courseCodes: ["1IND52"], room: "E309"
    }]
  });

  assert.equal(
    result.courses[0].displayExams,
    "Parcial: Mié. 14 oct · 08:00–11:00 · E309; Final: Vie. 11 dic · 08:00–11:00 · E309"
  );
});

test("schedule renderer validates exam type, ISO date, weekday and true duplicates", async () => {
  const { validateDeclaredExamSessions } = await import(pathToFileURL(rendererPath));
  const course = {
    code: "1IND52", name: "Diseño", exams: "Parcial y final", examStatus: "published"
  };
  const partial = {
    day: 3, start: "08:00", end: "11:00", type: "exam", examType: "partial",
    date: "2026-10-14", courseCodes: ["1IND52"], room: "E309"
  };
  const final = {
    ...partial, day: 5, examType: "final", date: "2026-12-11"
  };

  assert.doesNotThrow(() => validateDeclaredExamSessions({ courses: [course], sessions: [partial, final] }));
  assert.throws(
    () => validateDeclaredExamSessions({ courses: [course], sessions: [{ ...partial, examType: undefined }] }),
    (error) => error.code === "schedule_exam_metadata_required"
  );
  assert.throws(
    () => validateDeclaredExamSessions({ courses: [course], sessions: [{ ...partial, date: "2026-10-15" }] }),
    (error) => error.code === "schedule_exam_date_day_mismatch"
  );
  assert.throws(
    () => validateDeclaredExamSessions({ courses: [course], sessions: [partial, { ...partial }] }),
    (error) => error.code === "schedule_exam_duplicate"
  );
  assert.doesNotThrow(() => validateDeclaredExamSessions({
    courses: [course],
    sessions: [partial, { ...partial, examType: "final", date: "2026-12-09" }]
  }));
});

test("schedule renderer preserves catalog exams when Campus publishes only weekday and time", async () => {
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-schedule-catalog-exam-"));
  const outputPath = path.join(outputDir, "horario.html");
  const data = {
    term: "2026-2",
    credits: 3,
    courses: [{
      code: "1ING15",
      name: "Ética y Responsabilidad Social",
      credits: 3,
      scheduleId: "0901",
      instructor: "Docente",
      classes: "Lun 10:00–12:00",
      practice: "—",
      exams: "Lun 15:00–18:00",
      examStatus: "schedule_only"
    }],
    sessions: [{
      day: 1,
      start: "10:00",
      end: "12:00",
      type: "class",
      courseCodes: ["1ING15"],
      scheduleId: "0901"
    }, {
      day: 1,
      start: "15:00",
      end: "18:00",
      type: "exam",
      examType: "unknown",
      datePrecision: "weekday_time_only",
      courseCodes: ["1ING15"],
      scheduleId: "0901",
      room: "A207"
    }]
  };

  try {
    await renderScheduleTemplate({ templatePath, outputPath, data });
    const html = await readFile(outputPath, "utf8");
    const embedded = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/u)?.[1];
    const rendered = JSON.parse(embedded);

    assert.equal(rendered.sessions[1].date, undefined);
    assert.equal(rendered.sessions[1].datePrecision, "weekday_time_only");
    assert.equal(rendered.sessions[1].displayExamDate, "Fecha no publicada");
    assert.match(rendered.courses[0].displayExams, /fecha no publicada/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("schedule renderer combines multiple rooms for one exam into one card", async () => {
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-schedule-exam-rooms-"));
  const outputPath = path.join(outputDir, "horario.html");
  const course = {
    code: "1IND52",
    name: "Diseño de la Cadena de Suministros y Operaciones",
    credits: 4,
    scheduleId: "0732",
    instructor: "Docente",
    classes: "Lun 10:00–13:00",
    practice: "—",
    exams: "Parcial: Mié 14 oct · 08:00–11:00",
    examStatus: "published"
  };
  const baseExam = {
    day: 3,
    start: "08:00",
    end: "11:00",
    type: "exam",
    examType: "partial",
    date: "2026-10-14",
    courseCodes: ["1IND52"],
    scheduleId: "0732",
    title: course.name
  };

  try {
    await renderScheduleTemplate({
      templatePath,
      outputPath,
      data: {
        term: "2026-2",
        credits: 4,
        courses: [course],
        sessions: [
          { ...baseExam, room: "A402" },
          { ...baseExam, room: "A607" }
        ]
      }
    });
    const html = await readFile(outputPath, "utf8");
    const embedded = html.match(/<script id="schedule-data" type="application\/json">([\s\S]*?)<\/script>/u)?.[1];
    const rendered = JSON.parse(embedded);

    assert.equal(rendered.sessions.length, 1);
    assert.equal(rendered.sessions[0].room, "A402, A607");
    assert.deepEqual(rendered.sessions[0].rooms, ["A402", "A607"]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("schedule display compacts explicitly separated multiple instructors", async () => {
  const { compactInstructor } = await import(pathToFileURL(displayPath));
  assert.equal(
    compactInstructor("ATOCHE DIAZ, WILMER JHONNY / FERNANDEZ PEREZ, MIGUEL ANGEL"),
    "Atoche Diaz, W. J. / Fernandez Perez, M. A."
  );
  assert.equal(compactInstructor("Cornejo, C"), "Cornejo, C");
  assert.equal(compactInstructor("Barrantes, Roxana"), "Barrantes, R.");
  assert.equal(compactInstructor("Távara, José / Vásquez, Arturo"), "Távara, J. / Vásquez, A.");
});

test("schedule renderer embeds normalized data into a standalone HTML file", async () => {
  assert.equal(await exists(rendererPath), true, "schedule renderer must exist");
  const { renderScheduleTemplate } = await import(pathToFileURL(rendererPath));
  const outputDir = await mkdtemp(path.join(tmpdir(), "pucp-schedule-"));
  const outputPath = path.join(outputDir, "horario.html");
  const data = {
    term: "2026-2",
    credits: 3.5,
    courses: [{
      code: "MAT101",
      name: "Cálculo <I> $&",
      credits: 3.5,
      scheduleId: "0101",
      instructor: "Docente",
      classes: "Lun 08:00–10:00",
      practice: "—",
      exams: "—",
      examStatus: "not_published"
    }],
    sessions: [{
      day: 1,
      start: "08:00",
      end: "10:00",
      type: "class",
      courseCodes: ["MAT101"],
      scheduleId: "0101",
      title: "Cálculo <I> $&",
      room: "A101",
      instructor: "Docente"
    }]
  };

  try {
    await renderScheduleTemplate({ templatePath, outputPath, data });
    const html = await readFile(outputPath, "utf8");
    assert.match(html, /"term": "2026-2"/);
    assert.match(html, /Cálculo \\u003cI> \$&/);
    assert.doesNotMatch(html, /PUCP_SCHEDULE_DATA_PLACEHOLDER/);
    assert.doesNotMatch(html, /(?:Ã.|Â.|â€|ðŸ)/u);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("schedule header summarizes credits and course count", async () => {
  const html = await readFile(templatePath, "utf8");

  assert.match(html, /function formatScheduleSummary\(data\)/);
  assert.match(html, /data\.courses\.length/);
  assert.match(html, /credits-badge"[^>]*>0 créditos \/ 0 cursos</);
  assert.match(html, /document\.title\s*=\s*`Horario \$\{data\.term \|\| "PUCP"\} \(\$\{summary\}\)`/);
  assert.match(html, /getElementById\("credits-badge"\)\.textContent\s*=\s*summary/);
});

test("PUCP Academic points agents to the bundled schedule renderer", async () => {
  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const referencePath = path.join(skillRoot, "references", "horario-html.md");
  assert.equal(await exists(referencePath), true, "schedule reference must exist");
  assert.match(skill, /references\/horario-html\.md/);
  const reference = await readFile(referencePath, "utf8");
  assert.match(reference, /assets\/horario-pucp\.html/);
  assert.match(reference, /scripts\/render-schedule\.mjs/);
  assert.match(reference, /--data/);
  assert.match(reference, /--output/);
  assert.match(skill, /No (?:crees|construyas|escribas).*HTML.*(?:desde cero|propio)/i);
  assert.match(reference, /separa.*docentes.*\//i);
  assert.match(reference, /abre.*HTML.*verifica/i);
  assert.match(reference, /evita.*mayúsculas/i);
  assert.match(reference, /cada curso que declare exámenes.*type.*exam/is);
  assert.match(reference, /examStatus.*published.*not_published.*unknown/is);
  assert.match(reference, /no cambies.*exams.*-.*validaci/is);
  assert.match(skill, /varias aulas.*una sola sesión.*no multipliques.*parciales\/finales/is);
});

test("public installations discover and copy the complete HTML schedule skill", async () => {
  const [skill, metadata, reference, agents, installation] = await Promise.all([
    readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
    readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8"),
    readFile(path.join(skillRoot, "references", "horario-html.md"), "utf8"),
    readFile(path.join(root, "AGENTS.md"), "utf8"),
    readFile(path.join(root, "docs", "installation.md"), "utf8")
  ]);

  assert.match(skill, /^description:.*horario.*HTML/im);
  assert.match(metadata, /horario.*HTML/is);
  assert.match(reference, /carriles horizontales|lado a lado/i);
  assert.match(agents, /carpetas completas.*recursiv/is);
  assert.match(installation, /carpetas completas.*recursiv/is);
  assert.equal(await exists(layoutPath), true, "public skill must bundle its layout module");
  assert.equal(await exists(sourcePath), true, "public skill must bundle its Campus schedule adapter");
});
