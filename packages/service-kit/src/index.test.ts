import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AppError, ZodValidationPipe, baseEnvSchema, optionalUrl, parseEnv } from "./index.ts";

test("parseEnv applies defaults and coerces", () => {
  const schema = baseEnvSchema.extend({ PORT: z.coerce.number().int().default(3000) });
  const config = parseEnv("svc", schema, { PORT: "8080" } as NodeJS.ProcessEnv);

  assert.equal(config.PORT, 8080);
  assert.equal(config.NODE_ENV, "development");
  assert.equal(config.LOG_LEVEL, "info");
});

test("parseEnv reports every problem at once, naming the service", () => {
  const schema = baseEnvSchema.extend({
    DATABASE_URL: z.string().url(),
    SECRET: z.string().min(10),
  });

  assert.throws(
    () => parseEnv("jobs-service", schema, { DATABASE_URL: "nope", SECRET: "x" } as NodeJS.ProcessEnv),
    (error: Error) => {
      assert.match(error.message, /jobs-service/);
      // Both failures listed, so one boot surfaces the whole misconfiguration.
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /SECRET/);
      return true;
    },
  );
});

test("optionalUrl treats empty string as unset", () => {
  // Compose cannot unset an inherited variable, so it blanks it instead.
  const schema = z.object({ SVC: optionalUrl });
  assert.equal(schema.parse({ SVC: "" }).SVC, undefined);
  assert.equal(schema.parse({}).SVC, undefined);
  assert.equal(schema.parse({ SVC: "http://svc:1" }).SVC, "http://svc:1");
  assert.equal(schema.safeParse({ SVC: "not-a-url" }).success, false);
});

test("AppError carries the domain code and its HTTP status", () => {
  const notFound = new AppError("NOT_FOUND", "job not found");
  assert.equal(notFound.code, "NOT_FOUND");
  assert.equal(notFound.getStatus(), 404);

  assert.equal(new AppError("RATE_LIMITED", "slow down").getStatus(), 429);
  assert.equal(new AppError("CONFLICT", "exists").getStatus(), 409);
});

test("ZodValidationPipe returns parsed data and throws ZodError on bad input", () => {
  const pipe = new ZodValidationPipe(z.object({ n: z.coerce.number() }));
  assert.deepEqual(pipe.transform({ n: "42" }), { n: 42 });
  assert.throws(() => pipe.transform({ n: "abc" }), z.ZodError);
});
