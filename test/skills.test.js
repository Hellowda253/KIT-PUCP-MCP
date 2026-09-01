import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.join(root, "skills");

const read = (relativePath) =>
  readFile(path.join(root, relativePath), "utf8").catch(() => "");

const exists = (relativePath) =>
  access(path.join(root, relativePath)).then(() => true, () => false);

function metadata(skill) {
  const frontmatter = skill.match(/^---\s*\n([\s\S]*?)\n---/u)?.[1] ?? "";
  return Object.fromEntries(
    frontmatter
      .split(/\r?\n/u)
      .map((line) => line.match(/^([a-z][a-z0-9_-]*):\s*(.+)$/u))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/gu, "")])
  );
}

function wordCount(value) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

test("the public kit exposes exactly three intent-oriented skills", async () => {
  const directories = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(directories, ["profe-pucp", "pucp-academic", "pucp-context"]);
  for (const directory of directories) {
    const skill = await read(`skills/${directory}/SKILL.md`);
    const frontmatter = metadata(skill);
    assert.equal(frontmatter.name, directory);
    assert.match(frontmatter.description ?? "", /^Use when\b/u);
    assert.ok((frontmatter.description ?? "").length <= 500);
  }
});
test("PUCP Academic routes personal data and loads detailed workflows only on demand", async () => {
  const skill = await read("skills/pucp-academic/SKILL.md");
  const ui = await read("skills/pucp-academic/agents/openai.yaml");
  const referenceNames = [
    "paideia.md",
    "campus-virtual.md",
    "matricula-y-horarios.md",
    "horario-html.md"
  ];
  const references = Object.fromEntries(await Promise.all(referenceNames.map(async (name) => [
    name,
    await read(`skills/pucp-academic/references/${name}`)
  ])));

  assert.ok(skill, "skills/pucp-academic/SKILL.md must exist");
  assert.ok(wordCount(skill) < 400, "the academic router should stay compact");
  assert.match(metadata(skill).description, /Campus Virtual.*Paideia|Paideia.*Campus Virtual/iu);
  assert.match(skill, /pucp_academic_overview/u);
  assert.match(skill, /fuente.*conflicto|conflicto.*fuente/iu);
  for (const name of referenceNames) {
    assert.ok(references[name], `${name} must exist`);
    assert.match(skill, new RegExp(`references/${name.replaceAll(".", "\\.")}`, "u"));
  }

  assert.match(references["paideia.md"], /Pregrado\/Posgrado/iu);
  assert.match(references["paideia.md"], /Educaci[oó]n Continua/iu);
  assert.match(references["paideia.md"], /component|alcance/iu);
  assert.match(references["campus-virtual.md"], /get_student_schedule/u);
  assert.match(references["campus-virtual.md"], /pr[oó]xima clase.*get_campus_agenda/isu);
  assert.match(references["campus-virtual.md"], /vac[ií]o.*no.*horario semanal/isu);
  assert.match(references["campus-virtual.md"], /notas oficiales/iu);
  assert.match(references["matricula-y-horarios.md"], /prepare_course_registration/u);
  assert.match(references["matricula-y-horarios.md"], /commit_course_registration/u);
  assert.match(references["matricula-y-horarios.md"], /confirmaci[oó]n explícita/iu);
  assert.match(references["matricula-y-horarios.md"], /c[oó]digo de horario.*no.*nivel/isu);
  assert.match(references["matricula-y-horarios.md"], /nivel explícito.*obligatorio/isu);
  assert.match(references["matricula-y-horarios.md"], /Cursos Electivos.*nivel `?0`?/isu);
  assert.match(references["matricula-y-horarios.md"], /otra unidad.*search_course_schedules.*no.*search_historical_course_schedules/isu);
  assert.match(references["horario-html.md"], /scripts\/render-schedule\.mjs/u);
  assert.match(ui, /display_name:\s*"PUCP Académico"/u);
  assert.match(ui, /\$pucp-academic/u);
});

test("Profe PUCP is a focused teaching workflow that requests academic context selectively", async () => {
  const skill = await read("skills/profe-pucp/SKILL.md");
  const assessment = await read("skills/profe-pucp/references/assessment-analysis.md");
  const exam = await read("skills/profe-pucp/references/exam-preparation.md");
  const sources = await read("skills/profe-pucp/references/course-sources.md");
  const ui = await read("skills/profe-pucp/agents/openai.yaml");

  assert.ok(wordCount(skill) < 550, "Profe PUCP should contain decisions, not generic pedagogy");
  assert.match(metadata(skill).description, /learn|exercise|evaluation|feedback/iu);
  assert.match(skill, /`pucp-academic`/u);
  assert.match(skill, /`pucp-context`/u);
  assert.match(skill, /duda conceptual.*no.*expediente|no.*expediente.*duda conceptual/isu);
  assert.match(skill, /references\/assessment-analysis\.md/u);
  assert.match(skill, /references\/exam-preparation\.md/u);
  assert.match(skill, /references\/course-sources\.md/u);
  assert.match(assessment, /f[oó]rmula.*confirmada/isu);
  assert.match(assessment, /escenarios/iu);
  assert.match(exam, /prioriza/iu);
  assert.match(exam, /retroalimentaci[oó]n específica/iu);
  assert.match(sources, /bibliograf[ií]a.*s[ií]labo/isu);
  assert.match(sources, /no.*afirm.*consult|no.*finj.*consult/isu);
  assert.match(sources, /edici[oó]n.*cap[ií]tulo.*p[aá]gina/isu);
  assert.match(sources, /pregunta breve.*no.*s[ií]labo|no.*s[ií]labo.*pregunta breve/isu);
  assert.match(ui, /display_name:\s*"Profe PUCP"/u);
  assert.match(ui, /\$profe-pucp/u);
});

test("high-stakes academic activities use a strict evidence ladder without slowing ordinary classes", async () => {
  const academic = await read("skills/pucp-academic/references/campus-virtual.md");
  const paideia = await read("skills/pucp-academic/references/paideia.md");
  const professor = await read("skills/profe-pucp/SKILL.md");
  const combined = `${academic}\n${paideia}`;

  assert.match(combined, /tareas acad[eé]micas.*pr[aá]cticas.*laboratorios.*ex[aá]menes/isu);
  assert.match(combined, /correo institucional.*Paideia.*s[ií]labo.*materiales/isu);
  assert.match(combined, /correo.*(?:sin acceso|no.*acceso).*sugi/isu);
  assert.match(combined, /indicaciones.*programaci[oó]n.*sesiones/isu);
  assert.match(combined, /clase.*flujo (?:r[aá]pido|actual).*no.*correo/isu);
  assert.match(combined, /det[eé]n|detener|no.*consultar.*fuentes inferiores/isu);
  assert.match(combined, /indicado|confirmado/iu);
  assert.match(combined, /programado/iu);
  assert.match(combined, /probablemente|inferido/iu);
  assert.match(professor, /tarea.*pr[aá]ctica.*laboratorio.*examen/isu);
  assert.match(professor, /jerarqu[ií]a estricta|evidencia estricta/iu);
});

test("installation offers an optional academic library without imposing .UNI V2", async () => {
  const agents = await read("AGENTS.md");
  const installation = await read("docs/installation.md");
  const academic = await read("skills/pucp-academic/SKILL.md");
  const combined = `${agents}\n${installation}\n${academic}`;

  assert.match(combined, /PUCP_DOWNLOADS_DIR/u);
  assert.match(combined, /carpeta existente|ubicaci[oó]n existente/iu);
  assert.match(combined, /ofrecer.*una sola vez|no.*insist/isu);
  assert.match(combined, /no.*crear.*sin.*permiso/isu);
  assert.doesNotMatch(
    `${agents}\n${academic}`,
    /(?:debe|obligatoriamente|siempre).{0,30}(?:crear|usar).{0,30}\.UNI V2/isu
  );
});

test("PUCP Context is limited to public institutional evidence", async () => {
  const skill = await read("skills/pucp-context/SKILL.md");
  const catalog = await read("skills/pucp-context/references/official-sources.yaml");
  const ui = await read("skills/pucp-context/agents/openai.yaml");

  assert.ok(wordCount(skill) < 350, "the public-source router should stay compact");
  assert.match(metadata(skill).description, /regulations|procedures|services|official source/iu);
  assert.match(skill, /datos personales.*`pucp-academic`|`pucp-academic`.*datos personales/isu);
  assert.match(skill, /informaci[oó]n pública.*web/isu);
  assert.match(skill, /references\/official-sources\.yaml/u);
  assert.match(skill, /cargar.*solo cuando/isu);
  assert.match(catalog, /last_reviewed:\s*"2026-07-29"/u);
  assert.ok((catalog.match(/^\s+- id:/gmu) ?? []).length >= 20);
  assert.doesNotMatch(catalog, /url:\s*"http:\/\//u);
  assert.match(ui, /display_name:\s*"Contexto PUCP"/u);
  assert.match(ui, /\$pucp-context/u);
});

test("retired skill names are absent from the public documentation", async () => {
  const readme = await read("README.md");
  for (const retired of [
    "pucp-paideia",
    "pucp-campus-virtual",
    "pucp-academic-overview"
  ]) {
    assert.equal(await exists(`skills/${retired}`), false, `${retired} must be removed`);
    assert.doesNotMatch(readme, new RegExp(`\\b${retired}\\b`, "u"));
  }
  for (const current of ["pucp-academic", "profe-pucp", "pucp-context"]) {
    assert.match(readme, new RegExp(`\\b${current}\\b`, "u"));
  }
});
