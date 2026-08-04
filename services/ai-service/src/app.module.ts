import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module.ts";
import { HealthController } from "./health/health.controller.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";
import { TasksModule } from "./tasks/tasks.module.ts";

@Module({
  imports: [ConfigModule, PrismaModule, TasksModule],
  controllers: [HealthController],
})
export class AppModule {}
