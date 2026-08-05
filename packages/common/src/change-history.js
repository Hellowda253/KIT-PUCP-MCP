import { isDeepStrictEqual } from "node:util";

function assertContainer(value, name) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${name} must be an object or array`);
  }
}

export function summarizeChanges(previous, current) {
  assertContainer(previous, "previous");
  assertContainer(current, "current");

  const previousKeys = Object.keys(previous);
  const currentKeys = Object.keys(current);
  const previousSet = new Set(previousKeys);
  const currentSet = new Set(currentKeys);
  const addedKeys = currentKeys.filter((key) => !previousSet.has(key)).sort();
  const removedKeys = previousKeys.filter((key) => !currentSet.has(key)).sort();
  const changedKeys = currentKeys
    .filter(
      (key) =>
        previousSet.has(key) &&
        !isDeepStrictEqual(previous[key], current[key])
    )
    .sort();

  return {
    changed:
      addedKeys.length > 0 ||
      removedKeys.length > 0 ||
      changedKeys.length > 0,
    addedKeys,
    removedKeys,
    changedKeys
  };
}

export function appendChangeHistory(
  history,
  event,
  { maxEntries = 50 } = {}
) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("maxEntries must be a positive integer");
  }
  if (!event?.summary || typeof event.summary.changed !== "boolean") {
    throw new TypeError("event.summary.changed must be a boolean");
  }
  if (!event.summary.changed) {
    return [...history];
  }
  return [...history, event].slice(-maxEntries);
}
