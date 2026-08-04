import { Global, Module } from "@nestjs/common";
import { createLogger, type Logger } from "@jobilee/logger";
import { CONFIG, loadConfig, type Config } from "./config.ts";
import { HealthController } from "./health/health.controller.ts";

export const LOGGER = Symbol("LOGGER");

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: CONFIG, useFactory: (): Config => loadConfig() },
    {
      provide: LOGGER,
      inject: [CONFIG],
      useFactory: (config: Config): Logger =>
        createLogger({ service: "gateway", level: config.LOG_LEVEL }),
    },
  ],
  exports: [CONFIG, LOGGER],
})
export class AppModule {}
