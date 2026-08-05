import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDoctorHuman, runDoctor } from "./lib/doctor.js";

const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--json")) {
  throw new TypeError("doctor accepts only --json; live PUCP checks use MCP tools explicitly");
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const report = await runDoctor({ repositoryRoot });
process.stdout.write(
  args.includes("--json")
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatDoctorHuman(report)
);
process.exitCode = report.ok ? 0 : 1;
