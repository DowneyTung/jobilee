import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger } from "@jobilee/logger";
import { AppModule } from "./app.module.ts";
import { NestJsonLogger } from "./common/nest-logger.ts";
import { loadConfig } from "./config.ts";
import {
  createAuthMiddleware,
  requestIdMiddleware,
  stripInboundUserId,
} from "./middleware/identity.ts";
import { createRouteProxy } from "./middleware/proxy.ts";
import { buildRoutes } from "./routes.ts";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const log = createLogger({ service: "gateway", level: config.LOG_LEVEL });

  const app = await NestFactory.create(AppModule, {
    logger: new NestJsonLogger(log),
    // The gateway forwards bodies, it never reads them. Leaving the body parser
    // on would consume the stream and break proxied POSTs and file uploads.
    bodyParser: false,
  });

  app.enableCors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
  });

  // Order matters. Correlation id first so every later log carries it; the
  // header strip second so no path can smuggle an identity in; authentication
  // third; proxies last.
  app.use(requestIdMiddleware);
  app.use(stripInboundUserId);
  app.use(createAuthMiddleware(config, log));

  const routes = buildRoutes(config);
  for (const route of routes) {
    app.use(createRouteProxy(route, log));
  }

  app.enableShutdownHooks();
  await app.listen(config.GATEWAY_PORT, "0.0.0.0");
  log.info("gateway listening", {
    port: config.GATEWAY_PORT,
    env: config.NODE_ENV,
    routes: routes.map((route) => `${route.prefix} -> ${route.target}${route.rewriteTo}`),
  });
}

bootstrap().catch((error: unknown) => {
  process.stdout.write(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      service: "gateway",
      msg: "failed to start",
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    }) + "\n",
  );
  process.exit(1);
});
