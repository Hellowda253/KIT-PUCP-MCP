import path from "node:path";
import { pathToFileURL } from "node:url";

import { createStdioMcpServer, createAcademicCalendarStore, withAcademicContext } from "@pucp-academic-mcp/common";

import { defaultCampusPaths } from "./config.js";
import { createLiveCampusAdapter } from "./live-adapter.js";
import { createCampusService } from "./service.js";
import { createCampusTools } from "./tools.js";

export function createCampusVirtualServer(options = {}) {
  const calendarStore = options.calendarStore ?? createAcademicCalendarStore();
  const adapter = options.adapter ?? createLiveCampusAdapter();
  const service = options.service ?? createCampusService({
      ...defaultCampusPaths(),
      adapter,
      academicCalendarContext: (args) => calendarStore.context(args)
    });
  const { calendarStore: _calendarStore, service: _service, adapter: _adapter, ...transportOptions } = options;
  const transport = createStdioMcpServer({
    name: "pucp-campus-virtual",
    version: "0.4.0",
    tools: withAcademicContext(createCampusTools(service), calendarStore),
    ...transportOptions
  });
  return Object.assign(transport, { dispose: () => service.close?.() });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const server = createCampusVirtualServer();
  try { await server.start(); }
  finally { await server.dispose(); }
}
