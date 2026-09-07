import { McpToolError } from './errors.js';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function resolveCourse(courses, query) {
  const text = normalize(query);
  const exactId = courses.filter(c => String(c.id) === String(query).trim());
  const exact = courses.filter(c => [c.code, c.courseCode, c.name, c.shortName].some(v => v && normalize(v) === text));
  const token = courses.filter(c => [c.code, c.courseCode, c.name].some(v =>
    normalize(v).split(/[^a-z0-9]+/).includes(text)));
  const candidates = exactId.length ? exactId : exact.length ? exact : token.length ? token :
    courses.filter(c => [c.name, c.shortName].some(v => normalize(v).includes(text)));
  if (!text || candidates.length !== 1) {
    throw new McpToolError(candidates.length > 1 ? 'course_ambiguous' : 'course_not_found',
      candidates.length > 1 ? 'Specify a unique Moodle course id, term or full course name' : 'No cached course matched the query',
      { details: { matches: candidates.map(c => ({ id: c.id ?? c.code, name: c.name })) } });
  }
  return candidates[0];
}
