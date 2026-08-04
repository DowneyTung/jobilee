import type { Logger } from "@jobilee/logger";
import { apiError } from "@jobilee/shared-types";
import type { RequestHandler, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { RouteDef } from "../routes.ts";
import { asGatewayRequest } from "../types.ts";

/**
 * One streaming proxy per route. Bodies are never buffered by the gateway
 * (Nest's body parser is disabled in main.ts), which keeps large payloads —
 * resume uploads in Phase 3 — from sitting in gateway memory.
 */
export function createRouteProxy(route: RouteDef, log: Logger): RequestHandler {
  return createProxyMiddleware({
    target: route.target,
    changeOrigin: true,
    pathFilter: `${route.prefix}/**`,
    pathRewrite: { [`^${route.prefix}`]: route.rewriteTo },
    // AI generations take 20–40s and their SSE streams stay open far longer,
    // so routes that carry them opt out of the request timeout entirely; the
    // service closes its own streams and heartbeats to keep them alive.
    ...(route.longLived
      ? { proxyTimeout: 0, timeout: 0 }
      : { proxyTimeout: 120_000, timeout: 120_000 }),
    on: {
      proxyReq: (proxyReq, req) => {
        const request = asGatewayRequest(req);
        log.debug("proxying", {
          method: request.method,
          path: request.path,
          target: route.target,
          userId: request.userId,
          requestId: request.requestId,
        });
      },
      error: (err, req, res) => {
        const request = asGatewayRequest(req);
        log.error("upstream unreachable", err, {
          method: request.method,
          path: request.path,
          target: route.target,
          requestId: request.requestId,
        });
        const response = res as Response;
        if (!response.headersSent) {
          response
            .status(502)
            .json(
              apiError("UPSTREAM_ERROR", `${route.prefix} is unavailable`, {
                requestId: request.requestId,
              }),
            );
        }
      },
    },
  });
}
