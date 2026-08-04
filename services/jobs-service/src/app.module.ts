import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module.ts";
import { HealthController } from "./health/health.controller.ts";
import { JobsModule } from "./jobs/jobs.module.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";

@Module({
  imports: [ConfigModule, PrismaModule, JobsModule],
  controllers: [HealthController],
})
export class AppModule {}
