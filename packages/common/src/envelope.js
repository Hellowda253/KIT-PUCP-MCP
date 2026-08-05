import { cacheFreshness } from "./freshness.js";

export function createEnvelope({
  source,
  retrievedAt,
  generatedAt,
  ttlSeconds,
  data,
  warnings = [],
  now = new Date().toISOString()
}) {
  const freshness = cacheFreshness({ generatedAt, now, ttlSeconds });

  return {
    source,
    retrievedAt,
    cache: {
      generatedAt,
      ...freshness
    },
    data,
    warnings: [...warnings]
  };
}
