import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger, type Logger } from "@jobilee/logger";
import { AppModule } from "./app.module.ts";
import { LOGGER } from "./config.module.ts";
import { ErrorEnvelopeFilter } from "./common/errors.ts";
import { loadConfig } from "./config.ts";
import { NestJsonLogger } from "./common/nest-logger.ts";

async function bootstrap(): Promise<void> {
  // Read config before Nest boots so a bad environment fails loudly and early.
  const config = loadConfig();
  const log = createLogger({ service: "auth-service", level: config.LOG_LEVEL });

  const app = await NestFactory.create(AppModule, { logger: new NestJsonLogger(log) });
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get<Logger>(LOGGER)));
  app.enableShutdownHooks();

  await app.listen(config.PORT, "0.0.0.0");
  log.info("auth-service listening", { port: config.PORT, env: config.NODE_ENV });
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet, so write the raw record ourselves.
  process.stdout.write(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      service: "auth-service",
      msg: "failed to start",
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    }) + "\n",
  );
  process.exit(1);
});
