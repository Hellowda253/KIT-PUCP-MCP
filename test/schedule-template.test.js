import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, "skills", "pucp-campus-virtual");
const templatePath = path.join(skillRoot, "assets", "horario-pucp.html");
const rendererPath = path.join(skillRoot, "scripts", "render-schedule.mjs");
const layoutPath = path.join(skillRoot, "scripts", "schedule-layout.mjs");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

test("Campus skill bundles one UTF-8 responsive and printable schedule template", async () => {
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
  assert.match(html, /function sessionIsVisible\(session\)/);
  assert.match(html, /validSession\(session\) && sessionIsVisible\(session\)/);
  assert.match(html, /function setMode\(mode\)[\s\S]*activeMode = mode;[\s\S]*renderDesktop\(\);/);
});

test("print layout keeps the desktop timetable visible and vertically aligned", async () => {
  const html = await readFile(templatePath, "utf8");
  const printBlock = html.match(/@media print\s*{([\s\S]*?)\n\s*}\n\s*<\/style>/)?.[1] ?? "";

  assert.match(printBlock, /:root\s*{\s*--hour-height:\s*30px;/);
  assert.match(printBlock, /\.timetable-card\s*{[^}]*display:\s*block\s*!important;/s);
  assert.doesNotMatch(html, /const HOUR_HEIGHT\s*=/);
  assert.match(html, /const topPercent\s*=/);
  assert.match(html, /const heightPercent\s*=/);
  assert.match(html, /event\.style\.top\s*=\s*`calc\(\$\{topPercent\}% \+ 2px\)`/);
  assert.match(html, /event\.style\.height\s*=\s*`calc\(\$\{heightPercent\}% - 4px\)`/);
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
  assert.match(html, /event\.tabIndex\s*=\s*0/);
  assert.match(html, /event\.addEventListener\("pointerenter",[\s\S]*activateEventFocus\(event\)/);
  assert.match(html, /event\.addEventListener\("pointerleave",[\s\S]*clearEventFocus\(dayColumn\)/);
  assert.match(html, /event\.addEventListener\("focus",[\s\S]*activateEventFocus\(event\)/);
  assert.match(html, /event\.addEventListener\("blur",[\s\S]*clearEventFocus\(dayColumn\)/);
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
      exams: "—"
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

test("Campus skill points agents to the bundled schedule renderer", async () => {
  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const referencePath = path.join(skillRoot, "references", "horario-html.md");
  assert.equal(await exists(referencePath), true, "schedule reference must exist");
  assert.match(skill, /references\/horario-html\.md/);
  const reference = await readFile(referencePath, "utf8");
  assert.match(reference, /assets\/horario-pucp\.html/);
  assert.match(reference, /scripts\/render-schedule\.mjs/);
  assert.match(reference, /--data/);
  assert.match(reference, /--output/);
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
});
