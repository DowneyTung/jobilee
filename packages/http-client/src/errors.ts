import { ERROR_STATUS, apiErrorSchema, type ErrorCode } from "@jobilee/shared-types";

/**
 * Every failure out of the client — HTTP status, transport error, or a
 * response that didn't match its schema — surfaces as an HttpError carrying a
 * domain `code`, so callers can map to a status without sniffing messages.
 */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly url: string;
  readonly method: string;
  readonly requestId: string | undefined;
  readonly body: unknown;

  constructor(init: {
    code: ErrorCode;
    message: string;
    status?: number;
    url: string;
    method: string;
    requestId?: string | undefined;
    body?: unknown;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "HttpError";
    this.code = init.code;
    this.status = init.status ?? ERROR_STATUS[init.code];
    this.url = init.url;
    this.method = init.method;
    this.requestId = init.requestId;
    this.body = init.body;
  }

  /** True for failures worth retrying: throttling, upstream/transport trouble. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export function statusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "UPSTREAM_ERROR" : "INTERNAL";
  }
}

/** Pulls `{ error: { code, message } }` out of a response body when present. */
export function parseErrorBody(body: unknown): { code: ErrorCode; message: string } | undefined {
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success
    ? { code: parsed.data.error.code, message: parsed.data.error.message }
    : undefined;
}
