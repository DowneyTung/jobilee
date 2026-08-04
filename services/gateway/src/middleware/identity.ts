import { randomUUID } from "node:crypto";
import type { Logger } from "@jobilee/logger";
import {
  REQUEST_ID_HEADER,
  USER_ID_HEADER,
  apiError,
  jwtClaimsSchema,
} from "@jobilee/shared-types";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";
import type { Config } from "../config.ts";
import { isPublicRoute } from "../routes.ts";
import { asGatewayRequest } from "../types.ts";

/** Tags every request so a log line can be traced across services. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const request = asGatewayRequest(req);
  const requestId = request.header(REQUEST_ID_HEADER) ?? randomUUID();
  request.requestId = requestId;
  request.headers[REQUEST_ID_HEADER] = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

/**
 * THE load-bearing security control. Downstream services trust `X-User-Id`
 * completely, so the gateway must guarantee it can only ever originate here.
 * Runs before authentication, unconditionally, on every path — including public
 * and unmatched ones — so there is no ordering in which a spoofed header
 * survives.
 */
export function stripInboundUserId(req: Request, _res: Response, next: NextFunction): void {
  delete req.headers[USER_ID_HEADER];
  next();
}

/**
 * Verifies the bearer access token and attaches the caller's id. Verification
 * is local (shared HS256 secret), so auth-service isn't in the hot path of
 * every request.
 */
export function createAuthMiddleware(config: Config, log: Logger) {
  const secret = new TextEncoder().encode(config.JWT_SECRET);

  return async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const request = asGatewayRequest(req);

    // The gateway's own endpoints (/health, /ready) are not proxied API calls
    // and must stay reachable without a token — container healthchecks use them.
    if (!request.path.startsWith("/api/")) {
      next();
      return;
    }

    if (isPublicRoute(request.method, request.path)) {
      next();
      return;
    }

    const header = request.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      res
        .status(401)
        .json(apiError("UNAUTHORIZED", "missing bearer token", { requestId: request.requestId }));
      return;
    }

    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer: "jobilee-auth",
        audience: "jobilee",
        algorithms: ["HS256"],
      });
      const claims = jwtClaimsSchema.parse(payload);
      // A refresh token must not open the door an access token opens.
      if (claims.typ !== "access") {
        res.status(401).json(
          apiError("UNAUTHORIZED", "expected an access token", {
            requestId: request.requestId,
          }),
        );
        return;
      }
      request.userId = claims.sub;
      request.headers[USER_ID_HEADER] = claims.sub;
      next();
    } catch {
      log.debug("token rejected", { path: request.path, requestId: request.requestId });
      res.status(401).json(
        apiError("UNAUTHORIZED", "invalid or expired token", {
          requestId: request.requestId,
        }),
      );
    }
  };
}
