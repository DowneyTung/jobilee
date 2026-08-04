import { z } from "zod";

/** Header the gateway injects after verifying the JWT. Services trust only this. */
export const USER_ID_HEADER = "x-user-id";
/** Correlation id, generated at the gateway and propagated downstream. */
export const REQUEST_ID_HEADER = "x-request-id";

export const uuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/**
 * Every service returns failures in this shape; the gateway maps `code` to an
 * HTTP status (see `ERROR_STATUS`).
 */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    /** Field-level validation problems, when `code` is BAD_REQUEST. */
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiError(
  code: ErrorCode,
  message: string,
  extra?: { details?: unknown; requestId?: string },
): ApiError {
  return { error: { code, message, ...extra } };
}

export function isApiError(value: unknown): value is ApiError {
  return apiErrorSchema.safeParse(value).success;
}

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded", "error"]),
  service: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  /** Present on /ready: per-dependency reachability. */
  checks: z.record(z.enum(["ok", "error"])).optional(),
});
export type Health = z.infer<typeof healthSchema>;
