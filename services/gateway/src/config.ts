import { z } from "zod";

/**
 * An unset variable and one set to "" both mean "this service isn't wired up
 * yet" — compose has no way to unset a variable inherited from env_file, so it
 * blanks it instead.
 */
const optionalServiceUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  // Must match the secret auth-service signs with — the gateway verifies
  // tokens locally rather than calling auth-service on every request.
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  AUTH_SERVICE_URL: z.string().url(),
  JOBS_SERVICE_URL: optionalServiceUrl,
  RESUME_SERVICE_URL: optionalServiceUrl,
  AI_SERVICE_URL: optionalServiceUrl,
  /** Browser origin allowed by CORS. */
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid environment for gateway:\n${problems}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol("CONFIG");
