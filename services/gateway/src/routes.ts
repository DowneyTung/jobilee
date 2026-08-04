import type { Config } from "./config.ts";

export interface RouteDef {
  /** Path prefix as the browser sees it. */
  prefix: string;
  /** Base URL of the service that owns it. */
  target: string;
  /** `prefix` is rewritten to this before the request goes downstream. */
  rewriteTo: string;
  /** Carries SSE or other long-lived responses; disables the request timeout. */
  longLived?: boolean;
}

/**
 * Endpoints reachable without a token. Everything else under /api requires a
 * verified access token — the list is allow-only, so a new route is protected
 * by default rather than exposed by omission.
 */
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: "POST", path: "/api/auth/register" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/refresh" },
];

export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.path === path,
  );
}

/**
 * Only services with a configured URL get routed; the rest simply 404 until
 * their phase lands, which is a more honest answer than a 502.
 */
export function buildRoutes(config: Config): RouteDef[] {
  const table: Array<RouteDef | undefined> = [
    { prefix: "/api/auth", target: config.AUTH_SERVICE_URL, rewriteTo: "/auth" },
    config.JOBS_SERVICE_URL
      ? { prefix: "/api/jobs", target: config.JOBS_SERVICE_URL, rewriteTo: "/jobs" }
      : undefined,
    config.RESUME_SERVICE_URL
      ? { prefix: "/api/resume", target: config.RESUME_SERVICE_URL, rewriteTo: "/resume" }
      : undefined,
    config.AI_SERVICE_URL
      ? { prefix: "/api/ai", target: config.AI_SERVICE_URL, rewriteTo: "/ai", longLived: true }
      : undefined,
  ];
  return table.filter((route): route is RouteDef => route !== undefined);
}
