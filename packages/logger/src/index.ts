/**
 * Structured JSON logger — one line per event on stdout, no dependencies.
 *
 *   const log = createLogger({ service: "jobs-service" });
 *   log.info("listening", { port: 3002 });
 *   const reqLog = log.child({ requestId, userId });   // fields inherited
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Field names whose values are replaced with "[redacted]" at any depth. */
const REDACTED_KEYS = new Set(
  [
    "password",
    "passwordhash",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "cookie",
    "apikey",
    "api_key",
    "anthropic_api_key",
    "jwt_secret",
    "secret",
    "s3_secret_key",
  ].map((k) => k.toLowerCase()),
);

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  /** `err` may be an Error or a plain field bag; Errors are serialized. */
  error(msg: string, err?: unknown, fields?: LogFields): void;
  /** Returns a logger that merges `bindings` into every record. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  /** Service name stamped on every record. */
  service: string;
  /** Defaults to $LOG_LEVEL, else "debug" in development and "info" elsewhere. */
  level?: LogLevel;
  /** Fields merged into every record (e.g. version, region). */
  bindings?: LogFields;
  /** Sink for serialized lines. Defaults to process.stdout. */
  write?: (line: string) => void;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

function defaultLevel(): LogLevel {
  const fromEnv = process.env["LOG_LEVEL"]?.toLowerCase();
  if (isLogLevel(fromEnv)) return fromEnv;
  return process.env["NODE_ENV"] === "development" ? "debug" : "info";
}

function serializeError(err: Error): LogFields {
  const out: LogFields = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  // Carry through common enrichments (HTTP status, error codes, causes).
  for (const key of ["code", "status", "statusCode"] as const) {
    const value = (err as unknown as LogFields)[key];
    if (value !== undefined) out[key] = value;
  }
  if (err.cause instanceof Error) out["cause"] = serializeError(err.cause);
  else if (err.cause !== undefined) out["cause"] = err.cause;
  return out;
}

/** Depth-limited, cycle-safe sanitizer: redacts secrets, makes values JSON-safe. */
function sanitize(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= 8) return "[depth-limit]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen, depth + 1));
  }
  const out: LogFields = {};
  for (const [key, item] of Object.entries(value as LogFields)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? "[redacted]"
      : sanitize(item, seen, depth + 1);
  }
  return out;
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? defaultLevel();
  const threshold = SEVERITY[level];
  const write = options.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const now = options.now ?? (() => new Date());

  const make = (bindings: LogFields): Logger => {
    const emit = (recordLevel: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields) => {
      if (SEVERITY[recordLevel] < threshold) return;
      const record = {
        time: now().toISOString(),
        level: recordLevel,
        service: options.service,
        msg,
        ...(sanitize({ ...bindings, ...fields }, new WeakSet()) as LogFields),
      };
      try {
        write(JSON.stringify(record));
      } catch {
        // Never let logging take down the process.
        write(JSON.stringify({ time: record.time, level: "error", service: options.service, msg: "log serialization failed", originalMsg: msg }));
      }
    };

    return {
      level,
      debug: (msg, fields) => emit("debug", msg, fields),
      info: (msg, fields) => emit("info", msg, fields),
      warn: (msg, fields) => emit("warn", msg, fields),
      error: (msg, err, fields) => {
        const errFields =
          err === undefined ? undefined : err instanceof Error ? { err } : (err as LogFields);
        emit("error", msg, { ...errFields, ...fields });
      },
      child: (extra) => make({ ...bindings, ...extra }),
    };
  };

  return make(options.bindings ?? {});
}

/** Logger that swallows everything — handy in tests. */
export const noopLogger: Logger = createLogger({ service: "noop", level: "silent", write: () => {} });
