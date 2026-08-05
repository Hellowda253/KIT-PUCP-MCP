import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeAntigravityConfig } from "@pucp-academic-mcp/common";

const outputFlagIndex = process.argv.indexOf("--output");
const outputPath =
  outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : undefined;

if (!outputPath) {
  throw new Error(
    "No files were written. Pass --output <path> to choose an explicit target."
  );
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const commonEnvKeys = ["PUCP_DATA_DIR", "PUCP_PROFILE_DIR"];
const servers = [
  ["paideia", "paideia"],
  ["campus_virtual_pucp", "campus-virtual-pucp"],
  ["pucp_academic_overview", "overview"]
].map(([id, directory]) => ({
  id,
  command: process.execPath,
  args: [path.join(projectRoot, "servers", directory, "src", "server.js")],
  envKeys: commonEnvKeys
}));

await writeAntigravityConfig(path.resolve(outputPath), { servers });
