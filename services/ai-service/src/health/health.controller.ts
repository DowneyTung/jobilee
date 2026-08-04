import { Controller, Get, HttpCode } from "@nestjs/common";
import type { Health } from "@jobilee/shared-types";
import { PrismaService } from "../prisma/prisma.service.ts";
import { QuotaService } from "../quota/quota.service.ts";

const SERVICE = "ai-service";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  @Get("health")
  health(): Health {
    return { status: "ok", service: SERVICE, uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Redis backs both the queue and the quota counter, so it gates readiness. */
  @Get("ready")
  @HttpCode(200)
  async ready(): Promise<Health> {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.isReachable(),
      this.quota.isReachable(),
    ]);
    return {
      status: dbOk && redisOk ? "ok" : "error",
      service: SERVICE,
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" },
    };
  }
}
