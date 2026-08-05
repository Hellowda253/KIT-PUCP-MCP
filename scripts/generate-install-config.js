import path from "node:path";

import {
  SUPPORTED_INSTALL_CLIENTS,
  renderInstallConfig,
  writeInstallConfig
} from "./lib/installation-config.js";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--client", "--root", "--output", "--node"].includes(flag)) {
      throw new TypeError(`Unknown flag: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${flag} requires a value`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }
  if (!SUPPORTED_INSTALL_CLIENTS.includes(options.client)) {
    throw new TypeError(
      `--client must be one of: ${SUPPORTED_INSTALL_CLIENTS.join(", ")}`
    );
  }
  if (!options.root || !path.isAbsolute(options.root)) {
    throw new TypeError("--root must be an absolute path");
  }
  if (options.node && !path.isAbsolute(options.node)) {
    throw new TypeError("--node must be an absolute path");
  }
  return options;
}

const parsed = parseArgs(process.argv.slice(2));
const renderOptions = {
  client: parsed.client,
  repositoryRoot: parsed.root,
  nodePath: parsed.node || process.execPath
};

if (parsed.output) {
  const target = await writeInstallConfig(parsed.output, renderOptions);
  process.stdout.write(`Wrote proposed ${parsed.client} configuration to ${target}\n`);
} else {
  process.stdout.write(renderInstallConfig(renderOptions));
}
