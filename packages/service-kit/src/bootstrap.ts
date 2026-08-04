/**
 * Startup failures happen before the logger exists, so this writes the same
 * JSON shape by hand and exits non-zero — a container that can't boot should
 * say why in one greppable line rather than a bare stack trace.
 */
export function logFatal(service: string, error: unknown): never {
  process.stdout.write(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      service,
      msg: "failed to start",
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    }) + "\n",
  );
  process.exit(1);
}
