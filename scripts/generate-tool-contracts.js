import path from "node:path";

import { writeToolContracts } from "@pucp-academic-mcp/common";
import { createCampusVirtualServer } from "../servers/campus-virtual-pucp/src/server.js";
import { createOverviewServer } from "../servers/overview/src/server.js";
import { createPaideiaServer } from "../servers/paideia/src/server.js";

const outputFlagIndex = process.argv.indexOf("--output");
const outputRoot =
  outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : undefined;
if (!outputRoot) {
  throw new Error("Pass --output <directory>; no implicit target is allowed.");
}

const servers = [
  ["paideia", createPaideiaServer()],
  ["campus_virtual_pucp", createCampusVirtualServer()],
  ["pucp_academic_overview", createOverviewServer()]
];

for (const [name, server] of servers) {
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  });
  await writeToolContracts(
    path.join(path.resolve(outputRoot), name),
    response.result.tools
  );
}
