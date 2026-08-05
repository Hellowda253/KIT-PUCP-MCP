import assert from "node:assert/strict";
import test from "node:test";

import { McpToolError, toToolErrorResult } from "../src/errors.js";

test("toToolErrorResult preserves safe structured MCP tool error fields", () => {
  const result = toToolErrorResult(
    new McpToolError("AUTH_REQUIRED", "A local login is required", {
      retryable: true,
      details: { source: "paideia" }
    })
  );

  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [
    {
      type: "text",
      text: JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "A local login is required",
          retryable: true,
          details: { source: "paideia" }
        }
      })
    }
  ]);
});

test("toToolErrorResult redacts unexpected errors and provides a safe hint", () => {
  const result = toToolErrorResult(
    new Error("Cookie: session=super-secret-session-value")
  );
  const payload = JSON.parse(result.content[0].text);

  assert.deepEqual(payload, {
    error: {
      code: "internal_error",
      message: "An unexpected internal error occurred",
      retryable: false,
      hint: "Retry the request or inspect local diagnostics"
    }
  });
  assert.equal(
    /cookie|session|super-secret/i.test(result.content[0].text),
    false
  );
});
