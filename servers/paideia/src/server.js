import path from "node:path";
import { pathToFileURL } from "node:url";

import { createStdioMcpServer, createAcademicCalendarStore, withAcademicContext } from "@pucp-academic-mcp/common";

import { createLivePaideiaAdapter } from "./live-adapter.js";
import { defaultPaideiaPaths } from "./config.js";
import { createPaideiaService } from "./service.js";
import { createPaideiaTools } from "./tools.js";

export function createPaideiaServer(options = {}) {
  const calendarStore = options.calendarStore ?? createAcademicCalendarStore();
  const adapter = options.adapter ?? createLivePaideiaAdapter();
  const service = options.service ?? createPaideiaService({
    ...defaultPaideiaPaths(),
    adapter
  });
  const { calendarStore: _calendarStore, service: _service, adapter: _adapter, ...transportOptions } = options;
  const transport = createStdioMcpServer({
    name: "pucp-paideia",
    version: "0.3.0",
    tools: withAcademicContext(createPaideiaTools(service), calendarStore),
    ...transportOptions
  });
  return Object.assign(transport, { dispose: () => service.close?.() });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const server = createPaideiaServer();
  try { await server.start(); }
  finally { await server.dispose(); }
}
