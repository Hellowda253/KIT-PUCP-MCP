import assert from "node:assert/strict";
import test from "node:test";

import { createCampusVirtualServer } from "../../../servers/campus-virtual-pucp/src/server.js";
import { createOverviewServer } from "../../../servers/overview/src/server.js";

test("Campus Virtual implementation exposes its non-empty MCP tool registry", async () => {
  const server = createCampusVirtualServer();
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  });

  assert.equal(response.result.tools.length, 33);
});

test("academic overview implementation exposes its five MCP tools", async () => {
  const server = createOverviewServer();
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  });

  assert.equal(response.result.tools.length, 5);
});
