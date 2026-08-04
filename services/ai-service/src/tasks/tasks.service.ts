import { Injectable } from "@nestjs/common";
import { AppError } from "@jobilee/service-kit";
import type {
  CreateTaskRequest,
  CreateTaskResponse,
  GenerationTask,
} from "@jobilee/shared-types";
import type { Prisma } from "../../generated/prisma/index.js";
import { PrismaService } from "../prisma/prisma.service.ts";
import { QuotaService } from "../quota/quota.service.ts";
import { QueueService } from "../queue/queue.service.ts";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * Records the task, enqueues it, and returns immediately. Generations take
   * 20–40s, so the HTTP request must not wait on one — the client polls
   * GET /ai/tasks/:id.
   */
  async create(userId: string, body: CreateTaskRequest): Promise<CreateTaskResponse> {
    // Charged before the work is queued, so a burst of requests can't slip
    // past the cap while the first one is still starting.
    await this.quota.consume(userId);

    let task;
    try {
      task = await this.prisma.generationTask.create({
        data: {
          userId,
          type: body.type,
          status: "QUEUED",
          input: body.input as unknown as Prisma.InputJsonValue,
        },
      });
      await this.queue.enqueue({ taskId: task.id, userId, request: body });
    } catch (error) {
      // Nothing billable happened, so give the quota unit back.
      await this.quota.refund(userId).catch(() => undefined);
      if (task) {
        await this.prisma.generationTask
          .update({
            where: { id: task.id },
            data: { status: "FAILED", error: "Could not queue this generation." },
          })
          .catch(() => undefined);
      }
      throw error;
    }

    return { taskId: task.id, status: "QUEUED" };
  }

  /** Scoped by userId — one user must never poll another's task. */
  async get(userId: string, id: string): Promise<GenerationTask> {
    const task = await this.prisma.generationTask.findFirst({ where: { id, userId } });
    if (!task) throw new AppError("NOT_FOUND", "task not found");

    return {
      id: task.id,
      userId: task.userId,
      type: task.type,
      status: task.status,
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  async remainingQuota(userId: string): Promise<{ remaining: number }> {
    return { remaining: await this.quota.remaining(userId) };
  }
}
