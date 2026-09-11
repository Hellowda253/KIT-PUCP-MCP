import path from "node:path";

import { defaultSkillDestinations, syncSkills } from "./lib/skill-sync.js";

function values(args, option) {
  return args.flatMap((value, index) => value === option ? [args[index + 1]] : []).filter(Boolean);
}

async function main(args) {
  const repositoryRoot = path.resolve(process.cwd());
  const destinations = values(args, "--destination").map((item) => path.resolve(item));
  for (const target of values(args, "--target")) {
    destinations.push(...await defaultSkillDestinations(target.toLowerCase()));
  }
  if (destinations.length === 0) {
    throw new Error("Use --target codex, --target antigravity, or --destination ABSOLUTE_PATH");
  }
  const result = await syncSkills({
    repositoryRoot,
    destinations,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    backupRoot: values(args, "--backup-root")[0]
      ? path.resolve(values(args, "--backup-root")[0])
      : undefined
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
