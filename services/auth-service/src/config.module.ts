import { Global, Module } from "@nestjs/common";
import { createLogger, type Logger } from "@jobilee/logger";
import { CONFIG, LOGGER } from "@jobilee/service-kit";
import { loadConfig, type Config } from "./config.ts";

/**
 * Global so every module can inject CONFIG/LOGGER without re-importing —
 * these are process-wide singletons, not per-feature collaborators.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: (): Config => loadConfig() },
    {
      provide: LOGGER,
      inject: [CONFIG],
      useFactory: (config: Config): Logger =>
        createLogger({ service: "auth-service", level: config.LOG_LEVEL }),
    },
  ],
  exports: [CONFIG, LOGGER],
})
export class ConfigModule {}
