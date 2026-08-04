import { Controller, Get, HttpCode } from "@nestjs/common";
import type { Health } from "@jobilee/shared-types";
import { PrismaService } from "../prisma/prisma.service.ts";

const SERVICE = "jobs-service";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get("health")
  health(): Health {
    return { status: "ok", service: SERVICE, uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Readiness: dependencies are reachable, so traffic can be routed here. */
  @Get("ready")
  @HttpCode(200)
  async ready(): Promise<Health> {
    const dbOk = await this.prisma.isReachable();
    return {
      status: dbOk ? "ok" : "error",
      service: SERVICE,
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database: dbOk ? "ok" : "error" },
    };
  }
}
