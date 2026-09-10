import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCourseSchedule, recommendCourseSchedules } from '../src/schedule-optimizer.js';
import { buildCanonicalStudentSchedule, buildCourseOptions } from '../src/schedule-components.js';
import * as commonScheduleComponents from '../../../packages/common/src/schedule-components.js';

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
test('canonical and evaluated schedules retain course credits for artifact generation', () => {
  const credited = parts.map((item) => ({ ...item, credits: 3 }));
  const canonical = buildCanonicalStudentSchedule([
    { courseCode: 'CUR100', courseName: 'Curso', scheduleId: '1031', credits: 3 }
  ], credited);
  const evaluated = evaluateCourseSchedule({ offerings: credited, selections: selection });

  assert.equal(canonical.courseDetails[0].credits, 3);
  assert.equal(evaluated.courses[0].credits, 3);
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

test('dated assessments do not count toward the weekly maximum day constraint', () => {
  const first = row('class', '10:00', '12:00', {
    sessions: [{ day: 'monday', start: '10:00', end: '12:00', kind: 'class' }]
  });
  const firstPartial = row('exam', '08:00', '11:00', {
    sessions: [{ day: 'wednesday', start: '08:00', end: '11:00', kind: 'exam', date: '2026-10-14' }]
  });
  const firstFinal = row('exam', '08:00', '11:00', {
    sessions: [{ day: 'friday', start: '08:00', end: '11:00', kind: 'exam', date: '2026-12-11' }]
  });
  const second = row('class', '15:00', '17:00', {
    courseCode: 'OTR200', scheduleId: '0201',
    sessions: [{ day: 'thursday', start: '15:00', end: '17:00', kind: 'class' }]
  });
  const secondPartial = row('exam', '18:30', '21:30', {
    courseCode: 'OTR200', scheduleId: '0201',
    sessions: [{ day: 'tuesday', start: '18:30', end: '21:30', kind: 'exam', date: '2026-10-13' }]
  });
  const selections = [...selection, { courseCode: 'OTR200', scheduleId: '0201' }];
  const offerings = [first, firstPartial, firstFinal, second, secondPartial];

  const evaluation = evaluateCourseSchedule({ offerings, selections, preferences: { maxDays: 2 } });
  const recommendation = recommendCourseSchedules({
    courseCodes: ['CUR100', 'OTR200'], offerings, preferences: { maxDays: 2 }
  });

  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.courses.flatMap(({ sessions }) => sessions).length, 5);
  assert.equal(evaluation.explanation.at(-1), 'Clases distribuidas en 2 días.');
  assert.equal(recommendation.status, 'complete');
  assert.equal(recommendation.recommendations.length, 1);
});

test('dated assessments do not consume a requested recurring free day', () => {
  const recurring = row('class', '10:00', '12:00', {
    sessions: [{ day: 'monday', start: '10:00', end: '12:00', kind: 'class' }]
  });
  const fridayFinal = row('exam', '08:00', '11:00', {
    sessions: [{ day: 'friday', start: '08:00', end: '11:00', kind: 'exam', date: '2026-12-11' }]
  });

  const result = recommendCourseSchedules({
    courseCodes: ['CUR100'],
    offerings: [recurring, fridayFinal],
    preferences: { freeDays: ['friday'] }
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].courses[0].sessions.length, 2);
});

test('Campus room prefixes are separated from the physical room', () => {
  assert.equal(typeof commonScheduleComponents.normalizeCampusRoom, 'function');
  assert.deepEqual(commonScheduleComponents.normalizeCampusRoom('S E115'), { room: 'E115', group: 'S' });
  assert.deepEqual(commonScheduleComponents.normalizeCampusRoom('A A701'), { room: 'A701', group: 'A' });
  assert.deepEqual(commonScheduleComponents.normalizeCampusRoom('U107'), { room: 'U107', group: '' });
});

test('same component and time with multiple rooms remains one session', () => {
  const first = row('practice', '10:00', '12:00', {
    scheduleId: '0734',
    sessions: [{ day: 'saturday', start: '10:00', end: '12:00', kind: 'practice', room: 'A A701' }]
  });
  const second = row('practice', '10:00', '12:00', {
    scheduleId: '0734',
    sessions: [{ day: 'saturday', start: '10:00', end: '12:00', kind: 'practice', room: 'A A703' }]
  });

  const option = buildCourseOptions([first, second]).get('CUR100')[0];

  assert.equal(option.sessions.length, 1);
  assert.equal(option.sessions[0].room, 'A701, A703');
  assert.deepEqual(option.sessions[0].rooms, ['A701', 'A703']);
  assert.deepEqual(option.sessions[0].groups, ['A']);
});
test('a dated exam overlapping only a recurring pattern is potential, not a confirmed conflict', () => {
  const exam = row('exam', '08:00', '11:00');
  exam.sessions[0].date = '2026-10-14';
  exam.sessions[0].day = 'wednesday';
  const recurring = row('class', '08:00', '10:00', {
    courseCode: 'OTR200', scheduleId: '0201',
    sessions: [{ day: 'wednesday', start: '08:00', end: '10:00', kind: 'class' }]
  });
  const selections = [...selection, { courseCode: 'OTR200', scheduleId: '0201' }];

  const evaluation = evaluateCourseSchedule({ offerings: [exam, recurring], selections });

  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.validationStatus, 'incomplete');
  assert.equal(evaluation.conflicts.length, 1);
  assert.equal(evaluation.conflicts[0].certainty, 'potential');
});
test('an undated exam overlap is reported as potential instead of rejected as a confirmed weekly conflict', () => {
  const exam = row('exam', '08:00', '10:00');
  const recurring = row('class', '08:00', '10:00', { courseCode: 'OTR200', scheduleId: '0201' });
  const selections = [...selection, { courseCode: 'OTR200', scheduleId: '0201' }];
  const evaluation = evaluateCourseSchedule({ offerings: [exam, recurring], selections });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.validationStatus, 'incomplete');
  assert.equal(evaluation.conflicts[0].certainty, 'potential');
  const recommendation = recommendCourseSchedules({
    courseCodes: ['CUR100', 'OTR200'],
    offerings: [exam, recurring]
  });
  assert.equal(recommendation.recommendations.length, 1);
  assert.equal(recommendation.recommendations[0].conflicts[0].certainty, 'potential');
});

test('catalog exams expose weekday-only precision and make recommendations temporally partial', () => {
  const recommendation = recommendCourseSchedules({
    courseCodes: ['CUR100'],
    offerings: parts
  });
  const exam = recommendation.recommendations[0].courses[0].sessions.find(
    ({ kind }) => kind === 'exam'
  );

  assert.equal(exam.date, undefined);
  assert.equal(exam.datePrecision, 'weekday_time_only');
  assert.equal(recommendation.recommendations[0].temporalCompleteness, 'partial');
  assert.match(recommendation.warnings.join(' '), /exact exam date.*not published/i);
});

test('implicit defaults retain early sessions while explicit time limits exclude them', () => {
  const early = row('class', '06:00', '07:00');
  const unconstrained = recommendCourseSchedules({
    courseCodes: ['CUR100', 'ABS200'],
    offerings: [early]
  });

  assert.deepEqual(unconstrained.missingCourses, ['ABS200']);
  assert.deepEqual(unconstrained.constraintExcludedCourses, []);

  const constrained = recommendCourseSchedules({
    courseCodes: ['CUR100'],
    offerings: [early],
    preferences: { earliestStart: '07:00' }
  });
  assert.deepEqual(constrained.constraintExcludedCourses, [{
    courseCode: 'CUR100',
    reasons: ['earliest_start']
  }]);
});
