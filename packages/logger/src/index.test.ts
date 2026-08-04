import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger, type LogFields } from "./index.ts";

function capture(level?: Parameters<typeof createLogger>[0]["level"]) {
  const lines: LogFields[] = [];
  const log = createLogger({
    service: "test-svc",
    level: level ?? "debug",
    write: (line) => lines.push(JSON.parse(line) as LogFields),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { log, lines };
}

test("emits one JSON line with service, level, time and message", () => {
  const { log, lines } = capture();
  log.info("listening", { port: 3002 });

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    time: "2026-01-01T00:00:00.000Z",
    level: "info",
    service: "test-svc",
    msg: "listening",
    port: 3002,
  });
});

test("child loggers inherit bindings and can add their own", () => {
  const { log, lines } = capture();
  log.child({ requestId: "r1" }).child({ userId: "u1" }).warn("slow");

  assert.equal(lines[0]?.["requestId"], "r1");
  assert.equal(lines[0]?.["userId"], "u1");
  assert.equal(lines[0]?.["level"], "warn");
});

test("filters records below the configured level", () => {
  const { log, lines } = capture("warn");
  log.debug("nope");
  log.info("nope");
  log.error("yes");

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.["msg"], "yes");
});

test("serializes Errors including cause and status", () => {
  const { log, lines } = capture();
  const cause = new Error("connection refused");
  const err = Object.assign(new Error("db unreachable", { cause }), { status: 503 });
  log.error("query failed", err);

  const serialized = lines[0]?.["err"] as LogFields;
  assert.equal(serialized["message"], "db unreachable");
  assert.equal(serialized["status"], 503);
  assert.equal((serialized["cause"] as LogFields)["message"], "connection refused");
  assert.match(String(serialized["stack"]), /db unreachable/);
});

test("redacts secret-shaped fields at any depth", () => {
  const { log, lines } = capture();
  log.info("register", {
    body: { email: "a@b.com", password: "hunter2" },
    headers: { authorization: "Bearer abc" },
  });

  assert.equal((lines[0]?.["body"] as LogFields)["password"], "[redacted]");
  assert.equal((lines[0]?.["body"] as LogFields)["email"], "a@b.com");
  assert.equal((lines[0]?.["headers"] as LogFields)["authorization"], "[redacted]");
});

test("survives circular structures", () => {
  const { log, lines } = capture();
  const node: LogFields = { name: "a" };
  node["self"] = node;
  log.info("cycle", { node });

  assert.equal((lines[0]?.["node"] as LogFields)["self"], "[circular]");
});
