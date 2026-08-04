import { noopLogger, type Logger } from "@jobilee/logger";
import {
  REQUEST_ID_HEADER,
  USER_ID_HEADER,
  type Uuid,
} from "@jobilee/shared-types";
import type { ZodType } from "zod";
import { HttpError, parseErrorBody, statusToErrorCode } from "./errors.ts";

/** Caller identity + correlation, propagated on every inter-service hop. */
export interface RequestContext {
  userId?: Uuid;
  requestId?: string;
}

/**
 * Builds the headers downstream services authorize on. Services accept
 * `X-User-Id` only from the gateway; the gateway strips any inbound copy.
 */
export function contextHeaders(ctx: RequestContext = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (ctx.userId) headers[USER_ID_HEADER] = ctx.userId;
  if (ctx.requestId) headers[REQUEST_ID_HEADER] = ctx.requestId;
  return headers;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export interface HttpClientOptions {
  /** e.g. http://jobs-service:3002 */
  baseUrl: string;
  /** Used in logs to identify the callee. */
  name?: string;
  logger?: Logger;
  /** Per-attempt timeout. Default 10s. */
  timeoutMs?: number;
  /** Extra attempts after the first, for retryable failures. Default 2. */
  retries?: number;
  /** Base backoff; grows exponentially with jitter. Default 200ms. */
  retryBaseMs?: number;
  /** Headers merged into every request. */
  headers?: Record<string, string>;
  /** Injectable for tests. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions<T> extends RequestContext {
  /** Parsed and validated against this; a mismatch raises UPSTREAM_ERROR. */
  schema?: ZodType<T>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Override retry count for this call (POSTs default to no retries). */
  retries?: number;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const IDEMPOTENT: ReadonlySet<Method> = new Set<Method>(["GET", "PUT", "DELETE"]);

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestOptions<unknown>["query"],
): string {
  const url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpClient {
  request<T = unknown>(method: Method, path: string, options?: RequestOptions<T>): Promise<T>;
  get<T = unknown>(path: string, options?: RequestOptions<T>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions<T>): Promise<T>;
  /** Client bound to a caller — no need to pass userId on every call. */
  withContext(ctx: RequestContext): HttpClient;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    baseUrl,
    name = new URL(baseUrl).hostname,
    logger = noopLogger,
    timeoutMs = 10_000,
    retries: defaultRetries = 2,
    retryBaseMs = 200,
    headers: baseHeaders = {},
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  const make = (boundCtx: RequestContext): HttpClient => {
    async function request<T>(
      method: Method,
      path: string,
      opts: RequestOptions<T> = {},
    ): Promise<T> {
      const url = buildUrl(baseUrl, path, opts.query);
      const ctx: RequestContext = {
        userId: opts.userId ?? boundCtx.userId,
        requestId: opts.requestId ?? boundCtx.requestId,
      };
      const maxAttempts =
        1 + (opts.retries ?? (IDEMPOTENT.has(method) ? defaultRetries : 0));

      const headers: Record<string, string> = {
        accept: "application/json",
        ...baseHeaders,
        ...contextHeaders(ctx),
        ...opts.headers,
      };
      let payload: string | undefined;
      if (opts.body !== undefined) {
        payload = JSON.stringify(opts.body);
        headers["content-type"] = "application/json";
      }

      let lastError: HttpError | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeout = AbortSignal.timeout(opts.timeoutMs ?? timeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
        const startedAt = Date.now();

        try {
          const response = await fetchImpl(url, {
            method,
            headers,
            signal,
            ...(payload === undefined ? {} : { body: payload }),
          });
          const durationMs = Date.now() - startedAt;
          const requestId = response.headers.get(REQUEST_ID_HEADER) ?? ctx.requestId;

          if (!response.ok) {
            const body = await readBody(response);
            const fromBody = parseErrorBody(body);
            const error = new HttpError({
              code: fromBody?.code ?? statusToErrorCode(response.status),
              message: fromBody?.message ?? `${method} ${url} failed with ${response.status}`,
              status: response.status,
              url,
              method,
              requestId: requestId ?? undefined,
              body,
            });
            if (error.retryable && attempt < maxAttempts) {
              lastError = error;
              await sleep(backoff(retryBaseMs, attempt));
              continue;
            }
            logger.warn("upstream request failed", {
              target: name,
              method,
              url,
              status: response.status,
              durationMs,
              requestId,
            });
            throw error;
          }

          logger.debug("upstream request ok", {
            target: name,
            method,
            url,
            status: response.status,
            durationMs,
            requestId,
          });

          if (response.status === 204) return undefined as T;
          const body = await readBody(response);
          if (!opts.schema) return body as T;

          const parsed = opts.schema.safeParse(body);
          if (!parsed.success) {
            throw new HttpError({
              code: "UPSTREAM_ERROR",
              message: `${name} returned an unexpected payload for ${method} ${path}`,
              status: 502,
              url,
              method,
              requestId: requestId ?? undefined,
              body: parsed.error.issues,
            });
          }
          return parsed.data;
        } catch (cause) {
          if (cause instanceof HttpError) throw cause;

          const aborted = opts.signal?.aborted === true;
          const error = new HttpError({
            code: aborted ? "INTERNAL" : "UPSTREAM_ERROR",
            message: aborted
              ? `${method} ${url} aborted by caller`
              : `${method} ${url} failed: ${(cause as Error).message}`,
            status: 502,
            url,
            method,
            requestId: ctx.requestId,
            cause,
          });
          if (!aborted && attempt < maxAttempts) {
            lastError = error;
            await sleep(backoff(retryBaseMs, attempt));
            continue;
          }
          logger.warn("upstream request errored", {
            target: name,
            method,
            url,
            attempt,
            err: cause,
          });
          throw error;
        }
      }

      /* c8 ignore next — only reachable if the loop is ever restructured */
      throw lastError ?? new HttpError({ code: "INTERNAL", message: "request loop exited", url, method });
    }

    return {
      request,
      get: (path, opts) => request("GET", path, opts),
      post: (path, body, opts) => request("POST", path, { ...opts, body }),
      patch: (path, body, opts) => request("PATCH", path, { ...opts, body }),
      put: (path, body, opts) => request("PUT", path, { ...opts, body }),
      delete: (path, opts) => request("DELETE", path, opts),
      withContext: (ctx) => make({ ...boundCtx, ...ctx }),
    };
  };

  return make({});
}

/** Exponential backoff with full jitter, capped at 5s. */
function backoff(baseMs: number, attempt: number): number {
  const ceiling = Math.min(baseMs * 2 ** (attempt - 1), 5_000);
  return Math.random() * ceiling;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
