import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 removed `url` from the datasource block. The CLI reads the
 * connection string from here; the client gets it through a driver adapter —
 * see src/prisma/prisma.service.ts.
 *
 * The URL is read leniently rather than with Prisma's `env()` helper, which
 * throws while merely *loading* this file. `prisma generate` runs during the
 * Docker build, where no database exists and none is needed; only `migrate`
 * actually connects. The placeholder names the variable to set, so a migration
 * run without it fails with a message that says what to do.
 */
const CONNECTION_STRING =
  process.env["AI_DATABASE_URL"] ?? "postgresql://set-AI_DATABASE_URL-to-run-migrations";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: { path: path.join("prisma", "migrations") },
  datasource: { url: CONNECTION_STRING },
});
