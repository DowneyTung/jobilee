import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.ts";
import { ConfigModule } from "./config.module.ts";
import { HealthController } from "./health/health.controller.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
