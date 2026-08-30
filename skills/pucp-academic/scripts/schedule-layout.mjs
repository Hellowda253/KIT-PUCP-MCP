export function sessionsOverlap(left, right, toMinutes) {
  return toMinutes(left.start) < toMinutes(right.end) &&
    toMinutes(right.start) < toMinutes(left.end);
}

export function layoutDaySessions(sessions, toMinutes) {
  const sorted = [...sessions].sort((left, right) =>
    toMinutes(left.start) - toMinutes(right.start) ||
    toMinutes(left.end) - toMinutes(right.end)
  );
  const groups = [];
  let current = [];
  let currentEnd = -1;

  for (const session of sorted) {
    const start = toMinutes(session.start);
    if (current.length && start >= currentEnd) {
      groups.push(current);
      current = [];
      currentEnd = -1;
    }
    current.push(session);
    currentEnd = Math.max(currentEnd, toMinutes(session.end));
  }
  if (current.length) groups.push(current);

  return groups.flatMap((group) => {
    const laneEnds = [];
    const placed = group.map((session) => {
      const start = toMinutes(session.start);
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = toMinutes(session.end);
      return { session, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    return placed.map(({ session, lane }) => ({ session, lane, lanes }));
  });
}
