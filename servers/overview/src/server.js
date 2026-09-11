import path from "node:path";
import { pathToFileURL } from "node:url";

import { createStdioMcpServer, createAcademicCalendarStore, createAcademicCalendarTools, withAcademicContext } from "@pucp-academic-mcp/common";

import { defaultOverviewPaths } from "./config.js";
import { createOverviewService } from "./service.js";
import { createOverviewTools } from "./tools.js";

export function createOverviewServer(options = {}) {
  const {
    calendarStore = createAcademicCalendarStore(),
    service = createOverviewService(defaultOverviewPaths()),
    ...transportOptions
  } = options;
  return createStdioMcpServer({
    name: "pucp-academic-overview",
    version: "0.4.1",
    tools: [...withAcademicContext(createOverviewTools(service), calendarStore), ...createAcademicCalendarTools(calendarStore)],
    ...transportOptions
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await createOverviewServer().start();
}
