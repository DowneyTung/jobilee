import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { CONFIG } from "@jobilee/service-kit";
import type { Config } from "../config.ts";
import { PrismaClient } from "../../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Prisma 7 takes the connection through a driver adapter rather than a `url`
  // in the schema, so the config the rest of the service validates is now also
  // the single source of the database URL.
  constructor(@Inject(CONFIG) config: Config) {
    super({ adapter: new PrismaPg({ connectionString: config.AI_DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap round-trip used by GET /ready. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
