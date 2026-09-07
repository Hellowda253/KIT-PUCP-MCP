import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCourseSchedule, recommendCourseSchedules } from '../src/schedule-optimizer.js';

const row = (kind, start, end, extra = {}) => ({
  courseCode: 'CUR100', term: '2026-2', scheduleId: '1031', scheduleType: kind,
  associatedScheduleIds: [], professor: kind === 'laboratory' ? 'Docente Lab' : 'Docente',
  sessions: [{ day: 'thursday', start, end, kind }], ...extra
});
const parts = [row('class', '15:00', '17:00'), row('laboratory', '17:00', '19:00'),
  row('exam', '18:30', '21:30', { sessions: [{ day: 'tuesday', start: '18:30', end: '21:30', kind: 'exam' }] })];
const selection = [{ courseCode: 'CUR100', scheduleId: '1031' }];

test('same schedule is one option containing every component, with duplicate rows removed', () => {
  const result = recommendCourseSchedules({ courseCodes: ['CUR100'], offerings: [...parts, parts[0]] });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].courses[0].sessions.length, 3);
  assert.equal(result.recommendations[0].courses[0].risk.length, 1);
  assert.match(result.recommendations[0].courses[0].professor, /Docente Lab/);
});
test('evaluation detects a conflict that occurs only in a laboratory', () => {
  const other = row('class', '17:30', '18:30', { courseCode: 'OTR200', scheduleId: '0201' });
  const result = evaluateCourseSchedule({ offerings: [...parts, other], selections: [...selection, { courseCode: 'OTR200', scheduleId: '0201' }] });
  assert.equal(result.valid, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.courses[0].sessions.length, 3);
});
test('associated schedule includes all rows and missing associations cannot pass validation', () => {
  const root = row('class', '15:00', '17:00', { associatedScheduleIds: ['1032'] });
  const lab = row('laboratory', '17:00', '19:00', { scheduleId: '1032' });
  const exam = { ...parts[2], scheduleId: '1032' };
  assert.equal(evaluateCourseSchedule({ offerings: [root, lab, exam], selections: selection }).courses[0].sessions.length, 3);
  const missing = evaluateCourseSchedule({ offerings: [root], selections: selection });
  assert.equal(missing.valid, false);
  assert.equal(missing.validationStatus, 'incomplete');
  assert.equal(recommendCourseSchedules({ courseCodes: ['CUR100'], offerings: [root] }).recommendations.length, 0);
});
test('different terms never silently merge and empty sessions are incomplete', () => {
  assert.equal(evaluateCourseSchedule({ offerings: [parts[0], { ...parts[0], term: '2025-2' }], selections: selection }).valid, false);
  assert.equal(evaluateCourseSchedule({ offerings: [row('class', '', '', { sessions: [] })], selections: selection }).valid, false);
});
test('legacy numeric capacity values are not mistaken for missing associated schedules', () => {
  const legacy = row('class', '08:00', '10:00', { associatedScheduleIds: ['40'] });
  assert.equal(evaluateCourseSchedule({ offerings: [legacy], selections: selection }).valid, true);
});
test('dated sessions on different dates do not conflict', () => {
  const a = row('exam', '08:00', '10:00'); a.sessions[0].date = '2026-09-10';
  const b = row('exam', '08:00', '10:00', { courseCode: 'OTR200', scheduleId: '0201' }); b.sessions[0].date = '2026-09-17';
  assert.equal(evaluateCourseSchedule({ offerings: [a, b], selections: [...selection, { courseCode: 'OTR200', scheduleId: '0201' }] }).valid, true);
});
