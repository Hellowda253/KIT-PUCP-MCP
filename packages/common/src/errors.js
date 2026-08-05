export class McpToolError extends Error {
  constructor(code, message, { retryable = false, details } = {}) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function toToolErrorResult(error) {
  const structured =
    error instanceof McpToolError
      ? {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      : {
          code: "internal_error",
          message: "An unexpected internal error occurred",
          retryable: false,
          hint: "Retry the request or inspect local diagnostics"
        };

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: structured })
      }
    ]
  };
}
