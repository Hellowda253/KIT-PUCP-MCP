import path from "node:path";
import { pathToFileURL } from "node:url";

import { createStdioMcpServer, createAcademicCalendarStore, withAcademicContext } from "@pucp-academic-mcp/common";

import { createLivePaideiaAdapter } from "./live-adapter.js";
import { defaultPaideiaPaths } from "./config.js";
import { createPaideiaService } from "./service.js";
import { createPaideiaTools } from "./tools.js";

export function createPaideiaServer(options = {}) {
  const {
    calendarStore = createAcademicCalendarStore(),
    service = createPaideiaService({
      ...defaultPaideiaPaths(),
      adapter: createLivePaideiaAdapter()
    }),
    ...transportOptions
  } = options;
  return createStdioMcpServer({
    name: "pucp-paideia",
    version: "0.3.0",
    tools: withAcademicContext(createPaideiaTools(service), calendarStore),
    ...transportOptions
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await createPaideiaServer().start();
}
