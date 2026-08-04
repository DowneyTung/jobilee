import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Logger } from "@jobilee/logger";
import { CONFIG, LOGGER } from "@jobilee/service-kit";
import { UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Config } from "../config.ts";
import { GenerationService, describeFailure } from "../generation/generation.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { QuotaService } from "../quota/quota.service.ts";
import { TaskEventsService } from "../tasks/task-events.service.ts";
import { GENERATION_QUEUE, type GenerationJob } from "./queue.service.ts";

/**
 * Runs in the same process as the API for local simplicity. Splitting it into
 * its own container is a compose change plus dropping the HTTP modules — the
 * worker shares no state with the controllers beyond Postgres and Redis.
 */
@Injectable()
export class GenerationWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<GenerationJob>;
  private connection?: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly prisma: PrismaService,
    private readonly generation: GenerationService,
    private readonly quota: QuotaService,
    private readonly events: TaskEventsService,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });

    this.worker = new Worker<GenerationJob>(
      GENERATION_QUEUE,
      async (job) => this.process(job.data, job.attemptsMade),
      {
        connection: this.connection,
        // Bounded concurrency is the rate-limit guard: without it, twenty
        // queued generations would hit the API at once.
        concurrency: this.config.AI_WORKER_CONCURRENCY,
        limiter: { max: this.config.AI_WORKER_CONCURRENCY, duration: 1_000 },
      },
    );

    this.worker.on("failed", (job, error) => {
      this.log.error("generation job failed", error, {
        taskId: job?.data.taskId,
        attempts: job?.attemptsMade,
      });
    });

    this.log.info("generation worker started", {
      concurrency: this.config.AI_WORKER_CONCURRENCY,
      model: this.config.AI_MODEL_GENERATION,
    });
  }

  async onModuleDestroy(): Promise<void> {
    // Let in-flight generations finish rather than orphaning a RUNNING task.
    await this.worker?.close();
    await this.connection?.quit();
  }

  private async process(data: GenerationJob, attemptsMade: number): Promise<void> {
    const { taskId, userId, request } = data;
    const startedAt = Date.now();

    await this.prisma.generationTask.update({
      where: { id: taskId },
      data: { status: "RUNNING", error: null },
    });
    await this.events.publish({ taskId, status: "RUNNING" });

    try {
      const result = await this.generation.generate(request);

      await this.prisma.generationTask.update({
        where: { id: taskId },
        data: {
          status: "SUCCEEDED",
          result: result.text,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          error: null,
        },
      });

      await this.events.publish({ taskId, status: "SUCCEEDED", result: result.text });

      this.log.info("generation succeeded", {
        taskId,
        userId,
        type: request.type,
        durationMs: Date.now() - startedAt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (error) {
      const { message, retryable } = describeFailure(error);
      const attemptsLeft = this.config.AI_MAX_ATTEMPTS - (attemptsMade + 1);

      if (retryable && attemptsLeft > 0) {
        // Leave the row RUNNING; BullMQ will call us again after backoff.
        this.log.warn("generation attempt failed, retrying", {
          taskId,
          type: request.type,
          attemptsLeft,
        });
        throw error;
      }

      await this.prisma.generationTask.update({
        where: { id: taskId },
        data: { status: "FAILED", error: message },
      });
      await this.events.publish({ taskId, status: "FAILED", error: message });
      // The user was charged a quota unit for work that produced nothing.
      await this.quota.refund(userId).catch(() => undefined);

      this.log.error("generation failed permanently", error, {
        taskId,
        userId,
        type: request.type,
        durationMs: Date.now() - startedAt,
      });

      // Stop BullMQ retrying a failure we've already recorded as terminal.
      throw new UnrecoverableError(message);
    }
  }
}
