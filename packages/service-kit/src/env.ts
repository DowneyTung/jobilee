import { z } from "zod";

/**
 * Environment settings every service shares. Compose (and `env_file`) can't
 * unset an inherited variable, so an empty string is treated as "not set".
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

/**
 * Parses process.env against a schema, failing the boot with every problem
 * listed at once. A bad environment should kill the process at startup rather
 * than surface as a 500 an hour later.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  service: string,
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid environment for ${service}:\n${problems}`);
  }
  return parsed.data as z.infer<T>;
}

/** Injection token for the parsed config object. */
export const CONFIG = Symbol("CONFIG");
/** Injection token for the service-wide structured logger. */
export const LOGGER = Symbol("LOGGER");
