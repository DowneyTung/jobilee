import { Controller, Get, Inject } from "@nestjs/common";
import type { Health } from "@jobilee/shared-types";
import { CONFIG } from "@jobilee/service-kit";
import type { Config } from "../config.ts";
import { buildRoutes } from "../routes.ts";

const SERVICE = "gateway";

@Controller()
export class HealthController {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  @Get("health")
  health(): Health {
    return { status: "ok", service: SERVICE, uptimeSeconds: Math.floor(process.uptime()) };
  }

  /**
   * Readiness asks each configured downstream for its own liveness. A gateway
   * that can't reach anything is up but useless, so it reports "degraded".
   */
  @Get("ready")
  async ready(): Promise<Health> {
    const routes = buildRoutes(this.config);
    const results = await Promise.all(
      routes.map(async (route) => {
        try {
          const response = await fetch(new URL("/health", route.target), {
            signal: AbortSignal.timeout(2_000),
          });
          return [route.prefix, response.ok ? "ok" : "error"] as const;
        } catch {
          return [route.prefix, "error"] as const;
        }
      }),
    );

    const checks = Object.fromEntries(results);
    const healthy = results.filter(([, status]) => status === "ok").length;
    return {
      status: healthy === results.length ? "ok" : healthy === 0 ? "error" : "degraded",
      service: SERVICE,
      uptimeSeconds: Math.floor(process.uptime()),
      checks,
    };
  }
}
