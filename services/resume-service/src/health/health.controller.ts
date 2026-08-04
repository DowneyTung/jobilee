import { Controller, Get, HttpCode } from "@nestjs/common";
import type { Health } from "@jobilee/shared-types";
import { PrismaService } from "../prisma/prisma.service.ts";
import { StorageService } from "../storage/storage.service.ts";

const SERVICE = "resume-service";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get("health")
  health(): Health {
    return { status: "ok", service: SERVICE, uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** This service is only useful when both the database and the bucket work. */
  @Get("ready")
  @HttpCode(200)
  async ready(): Promise<Health> {
    const [dbOk, storageOk] = await Promise.all([
      this.prisma.isReachable(),
      this.storage.isReachable(),
    ]);
    return {
      status: dbOk && storageOk ? "ok" : "error",
      service: SERVICE,
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database: dbOk ? "ok" : "error", storage: storageOk ? "ok" : "error" },
    };
  }
}
