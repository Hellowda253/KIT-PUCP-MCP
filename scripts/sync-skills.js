import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syncSkills } from "./lib/skill-sync.js";

function values(args, option) {
  return args.flatMap((value, index) => value === option ? [args[index + 1]] : []).filter(Boolean);
}

async function directoryExists(directory) {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

async function targetDestinations(target) {
  const home = os.homedir();
  if (target === "codex") return [path.join(home, ".codex", "skills")];
  if (target === "antigravity") {
    const candidates = [
      path.join(home, ".gemini", "antigravity", "skills"),
      path.join(home, ".gemini", "config", "skills")
    ];
    const existing = [];
    for (const candidate of candidates) if (await directoryExists(candidate)) existing.push(candidate);
    return existing.length > 0 ? existing : [candidates[0]];
  }
  throw new TypeError(`Unsupported skill target: ${target}`);
}

async function main(args) {
  const repositoryRoot = path.resolve(process.cwd());
  const destinations = values(args, "--destination").map((item) => path.resolve(item));
  for (const target of values(args, "--target")) {
    destinations.push(...await targetDestinations(target.toLowerCase()));
  }
  if (destinations.length === 0) {
    throw new Error("Use --target codex, --target antigravity, or --destination ABSOLUTE_PATH");
  }
  const result = await syncSkills({
    repositoryRoot,
    destinations,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
