import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPaideiaService } from "../src/service.js";
import { createPaideiaServer } from "../src/server.js";

const expectedTools = [
  "download_course_materials",
  "download_paideia_resource",
  "get_activity_details",
  "get_course_outline",
  "get_paideia_job_status",
  "get_paideia_status",
  "list_activities",
  "list_announcements",
  "list_course_grades",
  "list_courses",
  "list_material_changes",
  "list_next_pending_items",
  "list_pending_items",
  "search_materials",
  "sync_paideia"
];

test("Paideia MCP advertises complete schemas and safe cache calls return envelopes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paideia-protocol-"));
  const cachePath = path.join(dir, "cache.json");
  await writeFile(cachePath, JSON.stringify({
    generatedAt: "2026-07-24T10:00:00.000Z",
    retrievedAt: "2026-07-24T10:00:00.000Z",
    courses: [],
    activities: [],
    pendingItems: [],
    materials: [],
    activityDetails: {},
    announcements: {},
    grades: {}
  }));
  const service = createPaideiaService({
    cachePath,
    historyPath: path.join(dir, "history.json"),
    manifestPath: path.join(dir, "manifest.json"),
    adapter: { async sync() { throw new Error("not called"); } },
    now: () => "2026-07-24T10:30:00.000Z",
    uniRoot: path.join(dir, ".UNI V2")
  });
  const server = createPaideiaServer({ service });
  const listed = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), expectedTools);
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  const called = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "list_courses", arguments: {} }
  });
  const payload = JSON.parse(called.result.content[0].text);
  assert.equal(payload.source, "paideia");
  assert.deepEqual(Object.keys(payload), ["source", "retrievedAt", "cache", "data", "warnings"]);
});

test("unsafe or ambiguous calls produce structured MCP tool errors", async () => {
  const service = createPaideiaService({
    cachePath: path.join(os.tmpdir(), "missing-paideia-cache.json"),
    historyPath: path.join(os.tmpdir(), "missing-paideia-history.json"),
    manifestPath: path.join(os.tmpdir(), "missing-paideia-manifest.json"),
    adapter: {},
    now: () => "2026-07-24T10:30:00.000Z",
    uniRoot: "C:\\Users\\student\\OneDrive\\.UNI V2"
  });
  const server = createPaideiaServer({ service });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "download_course_materials", arguments: {} }
  });
  assert.equal(response.result.isError, true);
  assert.equal(JSON.parse(response.result.content[0].text).error.code, "tool_input_invalid");
});
