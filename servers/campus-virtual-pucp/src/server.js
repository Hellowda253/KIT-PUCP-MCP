import path from "node:path";
import { pathToFileURL } from "node:url";

import { createStdioMcpServer, createAcademicCalendarStore, withAcademicContext } from "@pucp-academic-mcp/common";

import { defaultCampusPaths } from "./config.js";
import { createLiveCampusAdapter } from "./live-adapter.js";
import { createCampusService } from "./service.js";
import { createCampusTools } from "./tools.js";

export function createCampusVirtualServer(options = {}) {
  const {
    calendarStore = createAcademicCalendarStore(),
    service = createCampusService({
      ...defaultCampusPaths(),
      adapter: createLiveCampusAdapter()
    }),
    ...transportOptions
  } = options;
  return createStdioMcpServer({
    name: "pucp-campus-virtual",
    version: "0.3.0",
    tools: withAcademicContext(createCampusTools(service), calendarStore),
    ...transportOptions
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await createCampusVirtualServer().start();
}
