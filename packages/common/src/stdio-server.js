import { createInterface } from "node:readline";

import Ajv from "ajv";

import { McpToolError, toToolErrorResult } from "./errors.js";

export const SUPPORTED_PROTOCOL_VERSION = "2024-11-05";

function resultResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function publicToolDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? { type: "object" }
  };
}

function normalizeToolResult(value) {
  if (value && Array.isArray(value.content)) {
    return value;
  }
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value ?? null)
      }
    ]
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidId(message) {
  if (!Object.hasOwn(message, "id")) {
    return true;
  }
  return (
    typeof message.id === "string" ||
    (typeof message.id === "number" && Number.isFinite(message.id))
  );
}

function requestIdOrNull(message) {
  return isObject(message) &&
    Object.hasOwn(message, "id") &&
    hasValidId(message)
    ? message.id
    : null;
}

function schemaIssues(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "$",
    keyword: error.keyword,
    message: error.message ?? "input is invalid"
  }));
}

export function createStdioMcpServer({
  name,
  version,
  tools = [],
  input = process.stdin,
  output = process.stdout
}) {
  const ajv = new Ajv({
    allErrors: true,
    allowUnionTypes: true,
    strict: true
  });
  const toolMap = new Map(
    tools.map((tool) => [
      tool.name,
      {
        tool,
        validate: ajv.compile(tool.inputSchema ?? { type: "object" })
      }
    ])
  );
  let lineReader;
  let runPromise;
  let isClosed = false;

  async function handleMessage(message) {
    if (
      !isObject(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string"
    ) {
      return errorResponse(
        requestIdOrNull(message),
        -32600,
        "Invalid Request"
      );
    }
    if (!hasValidId(message)) {
      return errorResponse(null, -32600, "Invalid Request", {
        code: "invalid_request",
        issues: ["id must be a string or finite number"]
      });
    }

    const isNotification = !Object.hasOwn(message, "id");
    if (
      Object.hasOwn(message, "params") &&
      (message.params === null || typeof message.params !== "object")
    ) {
      return isNotification
        ? undefined
        : errorResponse(message.id, -32602, "Invalid params", {
            code: "invalid_params",
            issues: ["params must be an object or array"]
          });
    }

    const invalidObjectParams = (issues) =>
      isNotification
        ? undefined
        : errorResponse(message.id, -32602, "Invalid params", {
            code: "invalid_params",
            issues
          });

    if (message.method === "notifications/initialized") {
      if (message.params !== undefined && !isObject(message.params)) {
        return invalidObjectParams(["params must be an object"]);
      }
      return undefined;
    }

    if (message.method === "initialize") {
      if (isNotification) {
        return undefined;
      }
      if (
        !isObject(message.params) ||
        typeof message.params.protocolVersion !== "string"
      ) {
        return invalidObjectParams([
          "initialize params must include a protocolVersion string"
        ]);
      }
      return resultResponse(message.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version }
      });
    }

    if (message.method === "ping") {
      if (message.params !== undefined && !isObject(message.params)) {
        return invalidObjectParams(["ping params must be an object"]);
      }
      return isNotification ? undefined : resultResponse(message.id, {});
    }

    if (message.method === "tools/list") {
      if (isNotification) {
        return undefined;
      }
      if (message.params !== undefined && !isObject(message.params)) {
        return invalidObjectParams(["tools/list params must be an object"]);
      }
      return resultResponse(message.id, {
        tools: tools.map(publicToolDefinition)
      });
    }

    if (message.method === "tools/call") {
      if (isNotification) {
        return undefined;
      }
      if (
        !isObject(message.params) ||
        typeof message.params.name !== "string" ||
        message.params.name.length === 0
      ) {
        return invalidObjectParams([
          "tools/call params must include a non-empty name string"
        ]);
      }
      if (
        Object.hasOwn(message.params, "arguments") &&
        !isObject(message.params.arguments)
      ) {
        return invalidObjectParams([
          "tools/call arguments must be an object"
        ]);
      }
      const registration = toolMap.get(message.params?.name);
      if (!registration) {
        return resultResponse(
          message.id,
          toToolErrorResult(
            new McpToolError(
              "TOOL_NOT_FOUND",
              `Unknown tool: ${message.params?.name ?? ""}`
            )
          )
        );
      }

      try {
        const argumentsValue = message.params.arguments ?? {};
        if (!registration.validate(argumentsValue)) {
          return resultResponse(
            message.id,
            toToolErrorResult(
              new McpToolError(
                "tool_input_invalid",
                "Tool input did not match its schema",
                {
                  details: {
                    issues: schemaIssues(registration.validate.errors)
                  }
                }
              )
            )
          );
        }
        const value = await registration.tool.handler(argumentsValue, {
          request: message
        });
        return resultResponse(message.id, normalizeToolResult(value));
      } catch (error) {
        return resultResponse(message.id, toToolErrorResult(error));
      }
    }

    if (isNotification) {
      return undefined;
    }
    return errorResponse(message.id, -32601, "Method not found");
  }

  async function start() {
    if (runPromise) {
      return runPromise;
    }

    lineReader = createInterface({
      input,
      crlfDelay: Infinity,
      terminal: false
    });
    runPromise = (async () => {
      try {
        for await (const line of lineReader) {
          if (line.trim() === "") {
            continue;
          }
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            output.write(
              `${JSON.stringify(errorResponse(null, -32700, "Parse error"))}\n`
            );
            continue;
          }

          let response;
          try {
            response = await handleMessage(message);
          } catch {
            response = errorResponse(
              requestIdOrNull(message),
              -32603,
              "Internal error",
              {
                code: "internal_error",
                hint: "Retry the request or inspect local diagnostics"
              }
            );
          }
          if (response !== undefined) {
            output.write(`${JSON.stringify(response)}\n`);
          }
        }
      } finally {
        isClosed = true;
      }
    })();
    return runPromise;
  }

  function close() {
    lineReader?.close();
  }

  return {
    start,
    close,
    handleMessage,
    get closed() {
      return isClosed;
    }
  };
}
