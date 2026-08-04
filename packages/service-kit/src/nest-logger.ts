import type { LoggerService } from "@nestjs/common";
import type { Logger } from "@jobilee/logger";

/**
 * Bridges Nest's internal logging into our structured JSON logger, so
 * framework messages and application messages land in the same format.
 *
 * The field is `inner`, not `log`, because `LoggerService` requires a method
 * named `log`.
 */
export class NestJsonLogger implements LoggerService {
  constructor(private readonly inner: Logger) {}

  log(message: unknown, context?: string): void {
    this.emit("info", message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.inner.error(String(message), undefined, { context, stack });
  }

  warn(message: unknown, context?: string): void {
    this.emit("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit("debug", message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.inner.error(String(message), undefined, { context });
  }

  private emit(level: "debug" | "info" | "warn", message: unknown, context?: string): void {
    this.inner[level](String(message), context ? { context } : undefined);
  }
}
