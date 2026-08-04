import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { AppError, CONFIG } from "@jobilee/service-kit";
import { Redis } from "ioredis";
import type { Config } from "../config.ts";

/**
 * Per-user daily generation cap, counted in Redis. Generations cost real money
 * per call, so an unbounded loop — a retry storm, a stuck client, a curious
 * user — is a billing incident. The counter is the cheap bound.
 */
@Injectable()
export class QuotaService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  /**
   * Increments first and rejects if over — checking then incrementing would let
   * concurrent requests both pass the check. The key expires on its own so
   * there is nothing to clean up.
   */
  async consume(userId: string): Promise<void> {
    const key = this.keyFor(userId);
    const [[, used], [, ttl]] = (await this.redis
      .multi()
      .incr(key)
      .ttl(key)
      .exec()) as [[null, number], [null, number]];

    // A key with no TTL (-1) would cap the user forever once it passed the
    // limit, so set the expiry whenever it's missing — not only on the first
    // increment, which a manual write or a lost EXPIRE would skip.
    if (ttl < 0) {
      await this.redis.expire(key, this.secondsUntilUtcMidnight());
    }

    if (used > this.config.AI_DAILY_TASK_CAP) {
      throw new AppError(
        "RATE_LIMITED",
        `You've used all ${this.config.AI_DAILY_TASK_CAP} generations for today. The limit resets at midnight UTC.`,
      );
    }
  }

  /** Called when a task fails before doing billable work, so it isn't charged. */
  async refund(userId: string): Promise<void> {
    const key = this.keyFor(userId);
    const remaining = await this.redis.decr(key);
    if (remaining < 0) await this.redis.del(key);
  }

  async remaining(userId: string): Promise<number> {
    const used = Number((await this.redis.get(this.keyFor(userId))) ?? 0);
    return Math.max(0, this.config.AI_DAILY_TASK_CAP - used);
  }

  async isReachable(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  private keyFor(userId: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `quota:generations:${today}:${userId}`;
  }

  private secondsUntilUtcMidnight(): number {
    const now = new Date();
    const midnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    return Math.max(60, Math.ceil((midnight - now.getTime()) / 1000));
  }
}
