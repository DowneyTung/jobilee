import type { Logger } from "@jobilee/logger";
import type { NextFunction, Request, Response } from "express";
import { asGatewayRequest } from "../types.ts";

/**
 * Minimal Prometheus-shaped counters, hand-rolled rather than pulling in a
 * client library: the gateway needs four numbers, and a dependency that ships
 * a default registry of process metrics is more surface than that is worth.
 */
class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; sumMs: number }>();
  private inFlight = 0;
  private readonly startedAt = Date.now();

  observe(route: string, method: string, status: number, durationMs: number): void {
    const key = `${method}|${route}|${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);

    const durationKey = `${method}|${route}`;
    const entry = this.durations.get(durationKey) ?? { count: 0, sumMs: 0 };
    entry.count += 1;
    entry.sumMs += durationMs;
    this.durations.set(durationKey, entry);
  }

  enter(): void {
    this.inFlight += 1;
  }

  leave(): void {
    this.inFlight -= 1;
  }

  render(): string {
    const lines: string[] = [
      "# HELP jobilee_gateway_requests_total Requests handled, by method, route and status.",
      "# TYPE jobilee_gateway_requests_total counter",
    ];
    for (const [key, count] of this.requests) {
      const [method, route, status] = key.split("|");
      lines.push(
        `jobilee_gateway_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`,
      );
    }

    lines.push(
      "# HELP jobilee_gateway_request_duration_ms_sum Total request time in milliseconds.",
      "# TYPE jobilee_gateway_request_duration_ms_sum counter",
    );
    for (const [key, entry] of this.durations) {
      const [method, route] = key.split("|");
      lines.push(
        `jobilee_gateway_request_duration_ms_sum{method="${method}",route="${route}"} ${entry.sumMs}`,
      );
      lines.push(
        `jobilee_gateway_request_duration_ms_count{method="${method}",route="${route}"} ${entry.count}`,
      );
    }

    lines.push(
      "# HELP jobilee_gateway_requests_in_flight Requests currently being served.",
      "# TYPE jobilee_gateway_requests_in_flight gauge",
      `jobilee_gateway_requests_in_flight ${this.inFlight}`,
      "# HELP jobilee_gateway_uptime_seconds Seconds since the gateway started.",
      "# TYPE jobilee_gateway_uptime_seconds gauge",
      `jobilee_gateway_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
    );

    return lines.join("\n") + "\n";
  }
}

export const metrics = new Metrics();

/**
 * Collapses a path to its route shape so ids don't explode the label space —
 * `/api/jobs/<uuid>/stage` becomes `/api/jobs/:id/stage`. Unbounded label
 * cardinality is the classic way to melt a metrics backend.
 */
export function routeLabel(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+/g, "/:n");
}

/**
 * One structured line per completed request, carrying the correlation id and
 * the caller — the two fields that make a log searchable when something breaks.
 */
export function createAccessLog(log: Logger) {
  return function accessLog(req: Request, res: Response, next: NextFunction): void {
    const request = asGatewayRequest(req);
    const startedAt = process.hrtime.bigint();
    // Captured now, not on finish: the proxy rewrites req.url on its way
    // downstream, so reading it later labels the same endpoint two different
    // ways depending on whether it was proxied or rejected first.
    const path = request.path;
    const route = routeLabel(path);
    metrics.enter();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metrics.leave();
      metrics.observe(route, request.method, res.statusCode, durationMs);

      const fields = {
        method: request.method,
        path,
        route,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: request.userId,
        requestId: request.requestId,
      };

      // Server errors deserve attention; client errors are ordinary traffic.
      if (res.statusCode >= 500) log.error("request failed", undefined, fields);
      else if (res.statusCode >= 400) log.warn("request rejected", fields);
      else log.info("request", fields);
    });

    // A client that disconnects mid-stream never fires `finish`.
    res.on("close", () => {
      if (!res.writableEnded) metrics.leave();
    });

    next();
  };
}
