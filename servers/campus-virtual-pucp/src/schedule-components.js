// A Campus row is a component, not an independently selectable timetable.
export function buildCourseOptions(offerings = []) {
  const courses = new Map();
  for (const row of offerings) {
    const code = String(row.courseCode ?? '').toUpperCase();
    if (!courses.has(code)) courses.set(code, new Map());
    const groups = courses.get(code);
    const key = `${row.term ?? ''}|${row.scheduleId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = new Map();
  for (const [courseCode, groups] of courses) {
    const blocks = [...groups.values()].map(rows => {
      const root = rows.find(r => r.scheduleType === 'class') ?? rows[0];
      const sessions = new Map();
      for (const row of rows) for (const session of row.sessions ?? []) {
        const item = { ...session, kind: session.kind ?? row.scheduleType };
        const key = JSON.stringify([item.day, item.start, item.end, item.kind, item.room,
          item.date, item.beginDate, item.weeks, item.startDate, item.endDate]);
        sessions.set(key, item);
      }
      return { ...root, courseCode,
        professor: [...new Set(rows.map(r => r.professor).filter(Boolean))].join(' / '),
        componentTypes: [...new Set(rows.map(r => r.scheduleType).filter(Boolean))],
        associatedScheduleIds: [...new Set(rows.flatMap(r => r.associatedScheduleIds ?? []).map(String))],
        sessions: [...sessions.values()],
        invalidRows: rows.some(r => !r.sessions?.length)
      };
    });
    const options = [];
    for (const term of new Set(blocks.map(b => b.term ?? ''))) {
      const termBlocks = blocks.filter(b => (b.term ?? '') === term);
      const hasClasses = termBlocks.some(b => b.componentTypes.includes('class'));
      const referenced = new Set(termBlocks.flatMap(b => b.associatedScheduleIds));
      const roots = termBlocks.filter(b => hasClasses ? b.componentTypes.includes('class') : !referenced.has(b.scheduleId));
      for (const root of roots.length ? roots : termBlocks) {
        const selected = new Map();
        const missing = new Set();
        const visit = block => {
          if (selected.has(block.scheduleId)) return;
          selected.set(block.scheduleId, block);
          for (const id of block.associatedScheduleIds) {
            const target = termBlocks.find(b => String(b.scheduleId) === id);
            // Old enrollment JSON caches exposed capacity (for example "40")
            // in this position. Only schedule-like unresolved values are evidence
            // that a mandatory component is missing.
            if (target) visit(target);
            else if (id.length >= 4 || /\D/u.test(id)) missing.add(id);
          }
          // Some reports put the association on the practice/exam row instead.
          for (const child of termBlocks.filter(b => !b.componentTypes.includes('class') &&
            b.associatedScheduleIds.includes(String(block.scheduleId)))) visit(child);
        };
        visit(root);
        const components = [...selected.values()];
        const issues = [];
        if (missing.size) issues.push({ reason: 'missing_associated_schedules', scheduleIds: [...missing] });
        if (components.some(b => b.invalidRows || b.sessions.some(s => !s.day || !/^\d{1,2}:\d{2}$/.test(s.start ?? '') || !/^\d{1,2}:\d{2}$/.test(s.end ?? '')))) {
          issues.push({ reason: 'missing_or_invalid_sessions' });
        }
        // An association to several alternative classes cannot safely be treated as mandatory.
        if (components.filter(b => b.componentTypes.includes('class')).length > 1) issues.push({ reason: 'ambiguous_association' });
        options.push({ ...root, components, completenessIssues: issues,
          professor: [...new Set(components.map(b => b.professor).filter(Boolean))].join(' / ') });
      }
    }
    result.set(courseCode, options);
  }
  return result;
}
