import path from "node:path";

import { verifyClientIntegration } from "./lib/client-integration.js";

const VALUE_FLAGS = new Set(["--client", "--config", "--skills-dir", "--launcher", "--client-id"]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") continue;
    if (!VALUE_FLAGS.has(flag)) throw new TypeError(`unknown verification argument: ${flag ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${flag} requires a value`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  for (const required of ["client", "config", "skills-dir", "launcher", "client-id"]) {
    if (!options[required]) throw new TypeError(`--${required} is required`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = await verifyClientIntegration({
    client: options.client,
    configPath: path.resolve(options.config),
    skillsDir: path.resolve(options["skills-dir"]),
    launcherPath: path.resolve(options.launcher),
    clientId: options["client-id"]
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: "client_verification",
    code: "client_config_invalid",
    retryable: false,
    suggestedAction: "review_the_requested_paths_and_retry",
    detail: error.message
  })}\n`);
  process.exitCode = 1;
}
