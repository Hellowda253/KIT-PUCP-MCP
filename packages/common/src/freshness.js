export const TTL_SECONDS = Object.freeze({
  academic: 2 * 60 * 60,
  agenda: 12 * 60 * 60,
  materialAdmin: 48 * 60 * 60
});

function toEpoch(value, fieldName) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) {
    throw new TypeError(`${fieldName} must be a valid date`);
  }
  return epoch;
}

export function cacheFreshness({
  generatedAt,
  now = new Date().toISOString(),
  ttlSeconds
}) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    throw new TypeError("ttlSeconds must be a non-negative number");
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((toEpoch(now, "now") - toEpoch(generatedAt, "generatedAt")) / 1_000)
  );
  return {
    ageSeconds,
    stale: ageSeconds >= ttlSeconds
  };
}

export function shouldRefresh({
  forceRefresh = false,
  generatedAt,
  now,
  ttlSeconds
}) {
  if (forceRefresh || !generatedAt) {
    return true;
  }
  return cacheFreshness({ generatedAt, now, ttlSeconds }).stale;
}
