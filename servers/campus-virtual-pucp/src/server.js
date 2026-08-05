import path from "node:path";
import { pathToFileURL } from "node:url";

import { createStdioMcpServer } from "@pucp-academic-mcp/common";

import { defaultCampusPaths } from "./config.js";
import { createLiveCampusAdapter } from "./live-adapter.js";
import { createCampusService } from "./service.js";
import { createCampusTools } from "./tools.js";

export function createCampusVirtualServer(options = {}) {
  const {
    service = createCampusService({
      ...defaultCampusPaths(),
      adapter: createLiveCampusAdapter()
    }),
    ...transportOptions
  } = options;
  return createStdioMcpServer({
    name: "pucp-campus-virtual",
    version: "0.1.0",
    tools: createCampusTools(service),
    ...transportOptions
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await createCampusVirtualServer().start();
}
