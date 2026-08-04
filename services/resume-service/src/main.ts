import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger, type Logger } from "@jobilee/logger";
import { ErrorEnvelopeFilter, LOGGER, NestJsonLogger, logFatal } from "@jobilee/service-kit";
import { AppModule } from "./app.module.ts";
import { loadConfig } from "./config.ts";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const log = createLogger({ service: "resume-service", level: config.LOG_LEVEL });

  const app = await NestFactory.create(AppModule, { logger: new NestJsonLogger(log) });
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get<Logger>(LOGGER)));
  app.enableShutdownHooks();

  await app.listen(config.PORT, "0.0.0.0");
  log.info("resume-service listening", { port: config.PORT, env: config.NODE_ENV });
}

bootstrap().catch((error: unknown) => logFatal("resume-service", error));
