import { baseEnvSchema, parseEnv } from "@jobilee/service-kit";
import { z } from "zod";

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3003),
  RESUME_DATABASE_URL: z.string().url(),

  /** Reachable from inside the compose network — used for put/get/delete. */
  S3_ENDPOINT: z.string().url(),
  /**
   * Reachable from the user's browser. Presigned URLs must be signed against
   * the host the browser will actually call: SigV4 covers the Host header, so
   * a URL signed for `minio:9000` fails when opened from the host machine.
   */
  S3_PUBLIC_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Lifetime of a presigned download URL. */
  S3_SIGNED_URL_TTL: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseEnv("resume-service", envSchema, env);
}
