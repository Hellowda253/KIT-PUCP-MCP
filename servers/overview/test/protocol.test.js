import assert from "node:assert/strict";
import test from "node:test";

import { createOverviewServer } from "../src/server.js";

const expectedTools = [
  "get_academic_overview",
  "get_course_workspace",
  "list_upcoming_academic_items",
  "list_recent_academic_changes",
  "get_academic_data_status"
];

test("overview MCP advertises and dispatches the five public tools", async () => {
  const calls = [];
  const methods = {
    get_academic_overview: "getAcademicOverview",
    get_course_workspace: "getCourseWorkspace",
    list_upcoming_academic_items: "listUpcomingAcademicItems",
    list_recent_academic_changes: "listRecentAcademicChanges",
    get_academic_data_status: "getAcademicDataStatus"
  };
  const service = Object.fromEntries(
    expectedTools.map((name) => [
      methods[name],
      async (args) => {
        calls.push({ name, args });
        return { ok: true, name };
      }
    ])
  );
  const server = createOverviewServer({ service });
  const listed = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(listed.result.tools.map(({ name }) => name), expectedTools);
  for (const [index, name] of expectedTools.entries()) {
    const args = name === "get_course_workspace" ? { course: "Simulación" } : {};
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: index + 2,
      method: "tools/call",
      params: { name, arguments: args }
    });
    assert.equal(response.result.isError, undefined);
  }
  assert.equal(calls.length, 5);
});
