import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { McpToolError } from "../src/errors.js";
import { createStdioMcpServer } from "../src/stdio-server.js";

function request(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

test("stdio server supports MCP initialization, tools, notifications, and clean EOF", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    written += chunk;
  });

  const server = createStdioMcpServer({
    name: "test-server",
    version: "1.2.3",
    input,
    output,
    tools: [
      {
        name: "echo",
        description: "Echo a value",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } }
        },
        handler: ({ value }) => ({ echoed: value })
      },
      {
        name: "needs_login",
        description: "Fails safely",
        inputSchema: { type: "object" },
        handler: () => {
          throw new McpToolError("AUTH_REQUIRED", "Login required");
        }
      }
    ]
  });

  const stopped = server.start();
  input.write(
    `${request(1, "initialize", {
      protocolVersion: "2099-01-01",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" }
    })}\n`
  );
  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })}\n`
  );
  input.write(`${request(2, "tools/list", {})}\n`);
  input.write(
    `${request(3, "tools/call", {
      name: "echo",
      arguments: { value: "hola" }
    })}\n`
  );
  input.write(
    `${request(4, "tools/call", {
      name: "needs_login",
      arguments: {}
    })}\n`
  );
  input.end();
  await stopped;

  const responses = written
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(responses.length, 4);
  assert.deepEqual(responses[0].result, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "test-server", version: "1.2.3" }
  });
  assert.deepEqual(responses[1].result.tools, [
    {
      name: "echo",
      description: "Echo a value",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } }
      }
    },
    {
      name: "needs_login",
      description: "Fails safely",
      inputSchema: { type: "object" }
    }
  ]);
  assert.deepEqual(responses[2].result, {
    content: [
      {
        type: "text",
        text: JSON.stringify({ echoed: "hola" })
      }
    ]
  });
  assert.equal(responses[3].result.isError, true);
  assert.equal(
    JSON.parse(responses[3].result.content[0].text).error.code,
    "AUTH_REQUIRED"
  );
  assert.equal(server.closed, true);
});

test("tools/call returns an isError result for an unknown tool", async () => {
  const server = createStdioMcpServer({
    name: "test-server",
    version: "1",
    tools: []
  });
  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "missing", arguments: {} }
  });

  assert.equal(response.id, 9);
  assert.equal(response.result.isError, true);
  assert.equal(
    JSON.parse(response.result.content[0].text).error.code,
    "TOOL_NOT_FOUND"
  );
});

test("ping returns an empty result", async () => {
  const server = createStdioMcpServer({
    name: "test-server",
    version: "1",
    tools: []
  });

  assert.deepEqual(
    await server.handleMessage({
      jsonrpc: "2.0",
      id: "ping-1",
      method: "ping"
    }),
    {
      jsonrpc: "2.0",
      id: "ping-1",
      result: {}
    }
  );
});

test("JSON-RPC validates request ids and method params", async () => {
  const server = createStdioMcpServer({
    name: "test-server",
    version: "1",
    tools: []
  });

  const invalidId = await server.handleMessage({
    jsonrpc: "2.0",
    id: { unsafe: true },
    method: "ping"
  });
  assert.deepEqual(invalidId, {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32600,
      message: "Invalid Request",
      data: {
        code: "invalid_request",
        issues: ["id must be a string or finite number"]
      }
    }
  });

  const malformedRequest = await server.handleMessage({
    jsonrpc: "1.0",
    id: { unsafe: true },
    method: 42
  });
  assert.equal(malformedRequest.id, null);
  assert.equal(malformedRequest.error.code, -32600);

  const invalidParams = await server.handleMessage({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/list",
    params: "not-an-object"
  });
  assert.equal(invalidParams.error.code, -32602);
  assert.equal(invalidParams.error.data.code, "invalid_params");
});

test("tools/call rejects non-object arguments before handler invocation", async () => {
  let calls = 0;
  const server = createStdioMcpServer({
    name: "test-server",
    version: "1",
    tools: [
      {
        name: "course",
        inputSchema: { type: "object" },
        handler: () => {
          calls += 1;
          return {};
        }
      }
    ]
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "course", arguments: [] }
  });

  assert.equal(response.error.code, -32602);
  assert.equal(response.error.data.code, "invalid_params");
  assert.equal(calls, 0);
});

test("tools/call validates required, types, extra fields, bounds, and enums", async () => {
  let calls = 0;
  const server = createStdioMcpServer({
    name: "test-server",
    version: "1",
    tools: [
      {
        name: "course",
        inputSchema: {
          type: "object",
          required: ["course", "credits", "mode"],
          additionalProperties: false,
          properties: {
            course: { type: "string", enum: ["IND101"] },
            credits: { type: "integer", minimum: 1, maximum: 5 },
            mode: { type: "string", enum: ["regular", "summer"] },
            section: { type: "string", pattern: "^\\d{4}$" }
          }
        },
        handler: () => {
          calls += 1;
          return {};
        }
      }
    ]
  });
  const invalidArguments = [
    {},
    { course: 101, credits: 3, mode: "regular" },
    { course: "IND101", credits: 3, mode: "regular", secret: true },
    { course: "IND101", credits: 0, mode: "regular" },
    { course: "OTHER", credits: 3, mode: "regular" },
    {
      course: "IND101",
      credits: 3,
      mode: "regular",
      section: "08A1"
    }
  ];

  for (const [index, argumentsValue] of invalidArguments.entries()) {
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 20 + index,
      method: "tools/call",
      params: { name: "course", arguments: argumentsValue }
    });
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(response.result.isError, true);
    assert.equal(payload.error.code, "tool_input_invalid");
    assert.ok(payload.error.details.issues.length > 0);
  }
  assert.equal(calls, 0);

  const valid = await server.handleMessage({
    jsonrpc: "2.0",
    id: 30,
    method: "tools/call",
    params: {
      name: "course",
      arguments: {
        course: "IND101",
        credits: 3,
        mode: "summer",
        section: "0801"
      }
    }
  });
  assert.equal(valid.result.isError, undefined);
  assert.equal(calls, 1);
});

test("server creation fails early when a tool input schema is invalid", () => {
  assert.throws(
    () =>
      createStdioMcpServer({
        name: "test-server",
        version: "1",
        tools: [
          {
            name: "invalid",
            inputSchema: {
              type: "object",
              properties: {
                value: { type: "not-a-json-schema-type" }
              }
            },
            handler: () => ({})
          }
        ]
      }),
    /schema|type/i
  );
});

test("stdio parse errors do not echo malformed secret-bearing input", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    written += chunk;
  });
  const server = createStdioMcpServer({
    name: "test-server",
    version: "1",
    input,
    output
  });

  const stopped = server.start();
  input.end("Cookie=session-super-secret\n");
  await stopped;

  const response = JSON.parse(written);
  assert.equal(response.error.code, -32700);
  assert.equal(/cookie|session|super-secret/i.test(written), false);
});
