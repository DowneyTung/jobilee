import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger, type Logger } from "@jobilee/logger";
import { ErrorEnvelopeFilter, LOGGER, NestJsonLogger, logFatal } from "@jobilee/service-kit";
import { AppModule } from "./app.module.ts";
import { loadConfig } from "./config.ts";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const log = createLogger({ service: "ai-service", level: config.LOG_LEVEL });

  const app = await NestFactory.create(AppModule, { logger: new NestJsonLogger(log) });
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get<Logger>(LOGGER)));
  // Lets in-flight generations drain instead of being orphaned as RUNNING.
  app.enableShutdownHooks();

  await app.listen(config.PORT, "0.0.0.0");
  log.info("ai-service listening", {
    port: config.PORT,
    env: config.NODE_ENV,
    model: config.AI_MODEL_GENERATION,
  });
}

bootstrap().catch((error: unknown) => logFatal("ai-service", error));
