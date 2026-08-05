import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Paideia skill guides agents across both authenticated areas", async () => {
  const skill = await readFile(
    new URL("../skills/pucp-paideia/SKILL.md", import.meta.url),
    "utf8"
  );

  assert.match(skill, /^---[\s\S]*description:\s*Use when\b/m);
  assert.match(skill, /Pregrado\/Posgrado/);
  assert.match(skill, /Educaci[oó]n Continua/);
  assert.match(skill, /areaStates/);
  assert.match(skill, /no.*servidor.*adicional/i);
});

test("Campus and overview skills guide current schedules and confirmation-gated registration", async () => {
  const campus = await readFile(
    new URL("../skills/pucp-campus-virtual/SKILL.md", import.meta.url),
    "utf8"
  );
  const overview = await readFile(
    new URL("../skills/pucp-academic-overview/SKILL.md", import.meta.url),
    "utf8"
  );
  assert.match(campus, /^---[\s\S]*description:\s*Use when\b/m);
  assert.match(campus, /list_allowed_courses/);
  assert.match(campus, /recommend_course_schedules/);
  assert.match(campus, /Inscríbete aquí.*fuente principal/is);
  assert.match(campus, /search_historical_course_schedules/);
  assert.match(campus, /prepare_course_registration.*commit_course_registration/is);
  assert.match(campus, /confirmación explícita/i);
  assert.match(campus, /no.*reintentes.*Grabar/is);
  assert.match(campus, /get_registration_status/);
  assert.match(campus, /no[\s\S]{0,50}uses el generador del Campus/i);
  assert.match(campus, /Nunca describas una vacante\s+como garantizada/i);
  assert.match(campus, /acción marcada `blocked`/i);
  assert.ok(campus.trim().split(/\s+/).length < 500);
  assert.match(overview, /^---[\s\S]*description:\s*Use when\b/m);
  assert.match(overview, /fechas.*impedimentos.*riesgo/is);
  assert.match(overview, /no prometas una\s+vacante/i);
  assert.ok(overview.trim().split(/\s+/).length < 300);
});

test("Profe PUCP teaches deeply without imposing a rigid response ritual", async () => {
  const skillUrl = new URL("../skills/profe-pucp/SKILL.md", import.meta.url);
  const skill = await readFile(skillUrl, "utf8").catch(() => "");
  const assessment = await readFile(
    new URL("../skills/profe-pucp/references/assessment-analysis.md", import.meta.url),
    "utf8"
  ).catch(() => "");
  const examPreparation = await readFile(
    new URL("../skills/profe-pucp/references/exam-preparation.md", import.meta.url),
    "utf8"
  ).catch(() => "");
  const metadata = await readFile(
    new URL("../skills/profe-pucp/agents/openai.yaml", import.meta.url),
    "utf8"
  ).catch(() => "");
  const repositoryReadme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8"
  );

  assert.ok(skill, "skills/profe-pucp/SKILL.md must exist");
  assert.match(skill, /^---[\s\S]*description:\s*Use when\b/m);
  assert.match(skill, /pregrado, posgrado y Educación Continua/i);
  assert.match(skill, /consulta automáticamente/i);
  assert.match(skill, /notas.*sílabo.*materiales.*anuncios.*pendientes.*calendario/is);
  assert.match(skill, /no uses una plantilla fija/i);
  assert.match(skill, /cuando resulte útil/i);
  assert.match(skill, /no insistas/i);
  assert.match(skill, /comprensión transferible/i);
  assert.match(skill, /conceptual, procedimental, de cálculo o de interpretación/i);
  assert.match(skill, /intuición.*formalización.*ejemplo.*comprobación/is);
  assert.match(skill, /respuesta directa.*explicación conceptual.*resolución guiada.*retroalimentación/is);
  assert.match(skill, /no ocultes una respuesta conocida/i);
  assert.match(skill, /qué parte.*por qué.*cómo corregir/is);
  assert.match(skill, /hechos.*inferencias.*supuestos/is);
  assert.match(skill, /notación.*docente/is);
  assert.match(skill, /references\/assessment-analysis\.md/);
  assert.match(skill, /references\/exam-preparation\.md/);
  assert.doesNotMatch(skill, /integridad académica/i);
  assert.doesNotMatch(skill, /no abras.*intento/is);
  assert.ok(skill.trim().split(/\s+/).length < 800, "SKILL.md should stay focused");

  assert.match(assessment, /fórmula.*confirmada/is);
  assert.match(assessment, /escenarios/i);
  assert.match(examPreparation, /prioriza/i);
  assert.match(examPreparation, /retroalimentación específica/i);
  assert.doesNotMatch(examPreparation, /evaluaciones activas/i);
  assert.match(metadata, /display_name: "Profe PUCP"/);
  assert.match(metadata, /\$profe-pucp/);
  assert.match(repositoryReadme, /`profe-pucp`/);
});

test("PUCP Context routes questions to current official sources without bloating every prompt", async () => {
  const skill = await readFile(
    new URL("../skills/pucp-context/SKILL.md", import.meta.url),
    "utf8"
  ).catch(() => "");
  const catalog = await readFile(
    new URL(
      "../skills/pucp-context/references/official-sources.yaml",
      import.meta.url
    ),
    "utf8"
  ).catch(() => "");
  const metadata = await readFile(
    new URL("../skills/pucp-context/agents/openai.yaml", import.meta.url),
    "utf8"
  ).catch(() => "");
  const professorSkill = await readFile(
    new URL("../skills/profe-pucp/SKILL.md", import.meta.url),
    "utf8"
  );
  const repositoryReadme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8"
  );

  assert.ok(skill, "skills/pucp-context/SKILL.md must exist");
  assert.match(skill, /^---[\s\S]*description:\s*Use when\b/m);
  assert.match(skill, /references\/official-sources\.yaml/);
  assert.match(skill, /cargar.*catálogo.*solo/is);
  assert.match(skill, /datos personales.*MCP/is);
  assert.match(skill, /información pública.*web/is);
  assert.match(skill, /unidad académica.*fuente general/is);
  assert.match(skill, /sesión|session_id/i);
  assert.match(skill, /tercero.*enlazado.*oficial/is);
  assert.ok(skill.trim().split(/\s+/).length < 500, "pucp-context must stay compact");

  assert.match(catalog, /last_reviewed:\s*"2026-07-29"/);
  assert.match(catalog, /id:\s*"paideia-portal"/);
  assert.match(catalog, /id:\s*"campus-virtual-portal"/);
  assert.match(catalog, /id:\s*"agora-campus-help"/);
  assert.match(catalog, /id:\s*"student-portal"/);
  assert.match(catalog, /id:\s*"student-regulations"/);
  assert.match(catalog, /id:\s*"academic-calendar-hub"/);
  assert.match(catalog, /id:\s*"institutional-documents"/);
  assert.match(catalog, /id:\s*"library-portal"/);
  assert.match(catalog, /id:\s*"institutional-repository"/);
  assert.match(catalog, /id:\s*"daes-portal"/);
  assert.match(catalog, /id:\s*"dti-portal"/);
  assert.match(catalog, /id:\s*"international-mobility"/);
  assert.match(catalog, /id:\s*"employability-portal"/);
  assert.match(catalog, /id:\s*"continuing-education"/);
  assert.match(catalog, /https:\/\/daes\.pucp\.edu\.pe\//);
  assert.match(catalog, /https:\/\/empleabilidad\.pucp\.edu\.pe\//);
  assert.match(catalog, /https:\/\/educacioncontinua\.pucp\.edu\.pe\//);
  assert.doesNotMatch(catalog, /url:\s*"http:\/\//);
  assert.doesNotMatch(catalog, /profesorado\.pucp\.edu\.pe/);
  assert.ok(
    (catalog.match(/^\s+- id:/gm) ?? []).length >= 20,
    "official source catalog should cover the main student domains"
  );

  assert.match(metadata, /display_name:\s*"Contexto PUCP"/);
  assert.match(metadata, /\$pucp-context/);
  assert.match(professorSkill, /`pucp-context`/);
  assert.match(repositoryReadme, /`pucp-context`/);
});
