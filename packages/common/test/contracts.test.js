import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAntigravityConfig,
  buildToolContracts,
  writeAntigravityConfig
} from "../src/contracts.js";

const servers = [
  {
    id: "pucp-paideia",
    command: "node",
    args: ["servers/paideia/src/server.js"],
    envKeys: ["PUCP_PROFILE_DIR", "PUCP_DATA_DIR"]
  }
];

test("buildAntigravityConfig creates deterministic secret-free MCP definitions", () => {
  assert.deepEqual(buildAntigravityConfig({ servers }), {
    mcpServers: {
      "pucp-paideia": {
        command: "node",
        args: ["servers/paideia/src/server.js"],
        env: {
          PUCP_DATA_DIR: "${PUCP_DATA_DIR}",
          PUCP_PROFILE_DIR: "${PUCP_PROFILE_DIR}"
        }
      }
    }
  });
});

test("writeAntigravityConfig writes only to an explicit target", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pucp-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, "mcp.json");

  await writeAntigravityConfig(outputPath, { servers });

  assert.deepEqual(
    JSON.parse(await readFile(outputPath, "utf8")),
    buildAntigravityConfig({ servers })
  );
  await assert.rejects(
    writeAntigravityConfig("", { servers }),
    /outputPath must be explicit/
  );
});

test("buildToolContracts converts MCP schemas to Antigravity declarations", () => {
  assert.deepEqual(
    buildToolContracts([
      {
        name: "list_courses",
        description: "List cached courses.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "integer", maximum: 100 } },
          additionalProperties: false
        }
      }
    ]),
    [
      {
        fileName: "list_courses.json",
        value: {
          name: "list_courses",
          description: "List cached courses.",
          parameters: {
            type: "object",
            properties: { limit: { type: "integer", maximum: 100 } },
            additionalProperties: false
          }
        }
      }
    ]
  );
});
