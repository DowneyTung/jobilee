import type { Logger } from "@jobilee/logger";
import { apiError } from "@jobilee/shared-types";
import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";
import type { Config } from "../config.ts";
import { isPublicRoute } from "../routes.ts";
import { asGatewayRequest } from "../types.ts";

/**
 * Fixed-window rate limiting, counted in Redis.
 *
 * Redis rather than in-process memory for two reasons: the limit survives a
 * gateway restart (an in-memory counter hands an attacker a clean slate on
 * every deploy), and it stays correct if a second gateway replica is added.
 *
 * Two buckets, because they defend different things:
 *  - the auth endpoints are the brute-force surface, and each attempt costs an
 *    argon2 hash downstream, so they get a small per-IP budget;
 *  - everything else is keyed per user, so one noisy client cannot spend
 *    another's allowance.
 */
export interface RateLimitDeps {
  config: Config;
  log: Logger;
  redis: Redis;
}

export function createRedisClient(config: Config): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
}

export function createRateLimiter({ config, log, redis }: RateLimitDeps) {
  return async function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const request = asGatewayRequest(req);

    // The gateway's own endpoints are used by container healthchecks.
    if (!request.path.startsWith("/api/")) {
      next();
      return;
    }

    const isAuthRoute = isPublicRoute(request.method, request.path);
    const limit = isAuthRoute ? config.RATE_LIMIT_AUTH_MAX : config.RATE_LIMIT_MAX;
    // Authenticated traffic is charged to the user; anonymous traffic to the IP.
    const identity = isAuthRoute || !request.userId ? `ip:${clientIp(request)}` : `user:${request.userId}`;
    const window = config.RATE_LIMIT_WINDOW_SECONDS;
    const bucket = Math.floor(Date.now() / 1000 / window);
    const key = `ratelimit:${isAuthRoute ? "auth" : "api"}:${identity}:${bucket}`;

    let used: number;
    try {
      const [[, count]] = (await redis
        .multi()
        .incr(key)
        .expire(key, window)
        .exec()) as [[null, number], [null, number]];
      used = count;
    } catch (error) {
      // Redis being down must not take the whole API down with it. Log loudly
      // and fail open — availability matters more than a perfect limit here.
      log.error("rate limiter unavailable, allowing request", error, { path: request.path });
      next();
      return;
    }

    const remaining = Math.max(0, limit - used);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String((bucket + 1) * window - Math.floor(Date.now() / 1000)));

    if (used > limit) {
      const retryAfter = (bucket + 1) * window - Math.floor(Date.now() / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
      log.warn("rate limit exceeded", {
        path: request.path,
        identity,
        used,
        limit,
        requestId: request.requestId,
      });
      res.status(429).json(
        apiError("RATE_LIMITED", "Too many requests. Please slow down and try again.", {
          requestId: request.requestId,
        }),
      );
      return;
    }

    next();
  };
}

/**
 * Behind a reverse proxy the socket address is the proxy's. Trust the
 * left-most X-Forwarded-For entry only when a proxy is actually configured —
 * otherwise a client could set the header and rotate its own identity.
 */
function clientIp(req: Request): string {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded && process.env["TRUST_PROXY"] === "true") {
    return forwarded.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
