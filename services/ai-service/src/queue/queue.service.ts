import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { CONFIG } from "@jobilee/service-kit";
import type { CreateTaskRequest } from "@jobilee/shared-types";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Config } from "../config.ts";

export const GENERATION_QUEUE = "generation";

export interface GenerationJob {
  taskId: string;
  userId: string;
  request: CreateTaskRequest;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  readonly queue: Queue<GenerationJob>;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    // BullMQ requires this to be null — it blocks on BRPOPLPUSH, and a retry
    // limit would sever long waits.
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<GenerationJob>(GENERATION_QUEUE, { connection: this.connection });
  }

  async enqueue(job: GenerationJob): Promise<void> {
    await this.queue.add(job.request.type, job, {
      // Retries are for transient upstream failures (429, 5xx, connection
      // resets). The worker marks permanent failures non-retryable itself.
      attempts: this.config.AI_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 5_000 },
      // Keep a short history for debugging without growing Redis forever.
      removeOnComplete: { age: 3_600, count: 100 },
      removeOnFail: { age: 86_400, count: 100 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
