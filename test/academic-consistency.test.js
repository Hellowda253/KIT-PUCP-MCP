import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPaideiaService } from '../servers/paideia/src/service.js';
import { createCampusService } from '../servers/campus-virtual-pucp/src/service.js';
import { createOverviewService } from '../servers/overview/src/service.js';
import { parseLegacyCurriculumHtml } from '../servers/campus-virtual-pucp/src/parsers.js';
const at = '2026-09-06T10:00:00.000Z';
const course = { id: '11', area: 'pregrado_posgrado', name: '2026-2 CURSO GENERAL (CUR100-0101)', shortName: 'CURSO GENERAL', sections: [{ title: 'Semana 3' }] };
const paideia = { generatedAt: at, retrievedAt: at, courses: [course],
  activities: [{ id: 'act', courseId: '11', course: course.shortName, type: 'assignment', title: 'Informe', url: 'https://example.test/mod/assign/view.php?id=10' }],
  materials: [{ id: 'mat', courseId: '11', course: course.shortName, title: 'Lectura' }], pendingItems: [], activityDetails: {}, announcements: {}, grades: {} };
const campus = { generatedAt: at, retrievedAt: at, modules: {
  enrolled_courses: { state: 'available', generatedAt: at, items: [{ code: 'CUR100', name: 'CURSO GENERAL', term: '2026-2', scheduleId: '0101' }] },
  student_schedule: { state: 'available', generatedAt: at, term: '2026-2', items: [{ courseCode: 'CUR100', course: 'CURSO GENERAL', day: 'monday', start: '08:00', end: '10:00' }] },
  agenda: { state: 'available', generatedAt: at, items: [] }
} };
async function setup(p = paideia, c = campus) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pucp-consistency-'));
  const paths = { cachePath: path.join(dir, 'paideia.json'), historyPath: path.join(dir, 'history.json'), manifestPath: path.join(dir, 'manifest.json') };
  const campusPath = path.join(dir, 'campus.json');
  await writeFile(paths.cachePath, JSON.stringify(p)); await writeFile(campusPath, JSON.stringify(c));
  return { dir, paths, campusPath };
}
test('all Paideia row queries resolve a code through the Moodle course id', async () => {
  const { paths } = await setup();
  const service = createPaideiaService({ ...paths, now: () => at, adapter: {} });
  assert.equal((await service.listActivities({ course: 'CUR100' })).data.count, 1);
  assert.equal((await service.searchMaterials({ course: 'CUR100' })).data.count, 1);
  assert.equal((await service.getCourseOutline({ course: 'CUR100' })).data.course.id, '11');
  const duplicate = structuredClone(paideia); duplicate.courses.push({ ...course, id: '12', name: '2025-2 CURSO GENERAL (CUR100-0101)' });
  const other = await setup(duplicate);
  await assert.rejects(createPaideiaService({ ...other.paths, now: () => at, adapter: {} }).listActivities({ course: 'CUR100' }), { code: 'course_ambiguous' });
});
test('Paideia status does not expose the cache location', async () => {
  const { paths, dir } = await setup();
  const response = await createPaideiaService({ ...paths, now: () => at, adapter: {} }).getStatus();
  assert.equal(Object.hasOwn(response.data, 'cachePath'), false);
  assert.equal(JSON.stringify(response).includes(dir), false);
});
test('missing activity detail dispatches a targeted metadata job even with a fresh catalog', async () => {
  const { paths } = await setup(); let input;
  const service = createPaideiaService({ ...paths, now: () => at, adapter: { async sync(options) {
    input = options; return { ...paideia, activityDetails: { act: { state: 'available', instructions: 'Indicaciones oficiales' } } };
  } } });
  const first = await service.getActivityDetails({ activity: 'act' });
  const duplicate = await service.getActivityDetails({ activity: 'act' });
  assert.equal(first.data.detail.state, 'pending');
  assert.equal(duplicate.data.jobId, first.data.jobId);
  await service.waitForIdle();
  assert.equal(input.activity, 'act'); assert.equal(input.course, '11');
  assert.equal((await service.getActivityDetails({ activity: 'act' })).data.detail.instructions, 'Indicaciones oficiales');
});
test('focused sync retains unrelated sections and does not refresh their timestamps', async () => {
  const p = structuredClone(paideia); p.courses.push({ ...course, id: '22', name: 'OTRO200', sections: [{ title: 'No borrar' }] });
  const { paths } = await setup(p); const later = '2026-09-06T11:00:00.000Z';
  const service = createPaideiaService({ ...paths, now: () => later, adapter: { async sync() {
    return { ...p, generatedAt: later, courses: p.courses.map(c => ({ ...c, sections: c.id === '11' ? [{ title: 'Nueva' }] : [] })),
      areaStates: [{ area: 'pregrado_posgrado', state: 'available' }], coverage: { components: ['catalog', 'course_content'], allCourses: false, courseIds: ['11'] } };
  } } });
  await service.syncPaideia({ scope: 'materials', course: '11' }); await service.waitForIdle();
  const after = JSON.parse(await readFile(paths.cachePath, 'utf8'));
  assert.equal(after.courses.find(c => c.id === '22').sections[0].title, 'No borrar');
  assert.equal(after.componentGeneratedAt.course_content, at);
  assert.equal(after.courseComponentGeneratedAt['11'].course_content, later);
});
test('registration page absent returns unavailable, not an internal exception', async () => {
  const { paths, campusPath } = await setup();
  const service = createCampusService({ ...paths, cachePath: campusPath, now: () => at, adapter: {
    async readRegistrationWorkspace() { throw Object.assign(new Error('private diagnostics'), { code: 'registration_portal_not_visible' }); }
  } });
  const result = await service.getRegistrationStatus();
  assert.equal(result.data.state, 'unavailable');
  assert.equal(result.data.reason, 'registration_portal_not_visible');
  assert.equal(JSON.stringify(result).includes('private diagnostics'), false);
});
test('curriculum placeholders do not become failing zero grades', () => {
  const html = '<h1>Consolidado curricular</h1><table><tr><th>Clave</th><th>Nombre del curso</th><th>Créditos</th><th>Nota</th><th>Ciclo</th></tr>' +
    ['Sin Nota', '0', '10', '15'].map((grade,i) => `<tr><td>CUR10${i}</td><td>Curso</td><td>3</td><td>${grade}</td><td>2026-2</td></tr>`).join('') + '</table>';
  assert.deepEqual(parseLegacyCurriculumHtml(html).items.map(i => i.status), ['Sin calificar', 'No aprobado', 'No aprobado', 'Aprobado']);
});
test('current enrolled curriculum rows are identified as in progress', async () => {
  const c = structuredClone(campus);
  c.modules.curriculum = { state: 'available', generatedAt: at, items: [
    { code: 'CUR100', name: 'CURSO GENERAL', term: '2026-2', grade: 'Sin Nota', gradeValue: null, status: 'Sin calificar' }
  ] };
  const { paths, campusPath } = await setup(paideia, c);
  const result = await createCampusService({ ...paths, cachePath: campusPath, now: () => at, adapter: {} }).getCurriculumProgress();
  assert.equal(result.data.items[0].status, 'En curso');
});
test('workspace uses recurring student schedule separately from dated agenda', async () => {
  const { paths, campusPath } = await setup();
  const service = createOverviewService({ paideiaCachePath: paths.cachePath, campusCachePath: campusPath, now: () => at });
  const result = await service.getCourseWorkspace({ course: 'CUR100' });
  assert.equal(result.data.schedule.length, 1);
  assert.deepEqual(result.data.agenda, []);
  assert.equal(result.data.scheduleStatus.source, 'student_schedule_page');
  assert.equal(result.data.materials.length, 1);
});
