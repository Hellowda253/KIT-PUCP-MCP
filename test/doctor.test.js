import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatDoctorHuman,
  inspectLocalRuntime,
  runDoctor,
  smokeStdioServer
} from "../scripts/lib/doctor.js";

const repositoryRoot = path.resolve("C:/PUCP MCP");
const sentinel = "super-secret-sentinel";

test("doctor classifies a missing system browser as browser_required", async () => {
  const result = await inspectLocalRuntime({ repositoryRoot, envText: "", env: {} });
  const browser = result.checks.find(({ id }) => id === "browser");
  assert.equal(browser.status, "warn");
  assert.equal(browser.code, "browser_required");
});

function passingRuntime() {
  return {
    checks: [
      { id: "node", status: "pass", detail: "Node.js 20+" },
      { id: "dependencies", status: "pass", detail: "Dependencies installed" },
      { id: "browser", status: "pass", detail: "Browser available" },
      { id: "env-ignore", status: "pass", detail: ".env.local ignored" }
    ]
  };
}

test("doctor stays offline and reports credential presence without values", async () => {
  let liveCalls = 0;
  const report = await runDoctor({
    repositoryRoot,
    envText: `PAIDEIA_USER=alumno\nPAIDEIA_PASS=${sentinel}\n`,
    live: false,
    inspectRuntime: async () => passingRuntime(),
    smokeServer: async ({ id }) => ({
      id,
      initialize: true,
      toolCount: 1,
      durationMs: 12
    }),
    liveCheck: async () => {
      liveCalls += 1;
    }
  });

  assert.equal(report.ok, true);
  assert.equal(report.live, false);
  assert.equal(liveCalls, 0);
  assert.equal(report.credentials.PAIDEIA_USER, true);
  assert.equal(report.credentials.PAIDEIA_PASS, true);
  assert.equal(report.credentials.CAMPUS_PUCP_USER, false);
  assert.equal(report.credentials.CAMPUS_PUCP_PASS, false);
  assert.equal(
    report.checks.filter(({ id }) => id.startsWith("mcp:")).length,
    3
  );
  assert.deepEqual(report.timings.servers, {
    campus_virtual_pucp: 12,
    paideia: 12,
    pucp_academic_overview: 12
  });
  assert.equal(Number.isInteger(report.timings.totalMs), true);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
  assert.doesNotMatch(formatDoctorHuman(report), new RegExp(sentinel));
});

test("missing credentials warn while required runtime failures fail doctor", async () => {
  const report = await runDoctor({
    repositoryRoot,
    envText: "",
    inspectRuntime: async () => ({
      checks: [
        { id: "node", status: "fail", detail: "Node.js 20+ required" }
      ]
    }),
    smokeServer: async ({ id }) => ({ id, initialize: true, toolCount: 1 })
  });

  assert.equal(report.ok, false);
  assert.equal(report.credentials.PAIDEIA_PASS, false);
  assert.equal(
    report.checks.find(({ id }) => id === "credentials").status,
    "warn"
  );
});

test("live diagnostics run only after explicit opt-in", async () => {
  let liveCalls = 0;
  const report = await runDoctor({
    repositoryRoot,
    envText: "",
    live: true,
    inspectRuntime: async () => passingRuntime(),
    smokeServer: async ({ id }) => ({ id, initialize: true, toolCount: 1 }),
    liveCheck: async () => {
      liveCalls += 1;
      return { status: "pass", detail: "Explicit live check completed" };
    }
  });

  assert.equal(liveCalls, 1);
  assert.equal(report.live, true);
  assert.equal(report.checks.at(-1).id, "live");
});

test("stdio smoke sends a valid MCP initialize request", async () => {
  const actualRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const result = await smokeStdioServer({
    id: "paideia",
    entrypoint: path.join(actualRoot, "servers", "paideia", "src", "server.js"),
    repositoryRoot: actualRoot
  });

  assert.equal(result.initialize, true);
  assert.ok(result.toolCount > 0);
});
