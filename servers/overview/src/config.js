import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(serverRoot, "../..");

export function defaultOverviewPaths(env = process.env) {
  const root = path.resolve(
    env.PUCP_DATA_DIR || path.join(repositoryRoot, "data")
  );
  return {
    paideiaCachePath: path.join(root, "paideia", "cache.json"),
    campusCachePath: path.join(root, "campus-virtual-pucp", "cache.json"),
    campusSchedulePath: path.join(
      root,
      "campus-virtual-pucp",
      "course-schedules.json"
    ),
    paideiaHistoryPath: path.join(root, "paideia", "sync-history.json"),
    campusHistoryPath: path.join(
      root,
      "campus-virtual-pucp",
      "sync-history.json"
    )
  };
}
