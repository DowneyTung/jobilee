import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module.ts";
import { HealthController } from "./health/health.controller.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";
import { ResumeModule } from "./resume/resume.module.ts";
import { StorageModule } from "./storage/storage.module.ts";

@Module({
  imports: [ConfigModule, PrismaModule, StorageModule, ResumeModule],
  controllers: [HealthController],
})
export class AppModule {}
