import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { UserId, ZodValidationPipe } from "@jobilee/service-kit";
import {
  createTaskSchema,
  type CreateTaskRequest,
  type CreateTaskResponse,
  type GenerationTask,
} from "@jobilee/shared-types";
import { TasksService } from "./tasks.service.ts";

@Controller("ai")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** Returns immediately with a task id; the client polls for the result. */
  @Post("tasks")
  create(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskRequest,
  ): Promise<CreateTaskResponse> {
    return this.tasks.create(userId, body);
  }

  /** Remaining generations for today — lets the UI warn before the cap bites. */
  @Get("quota")
  quota(@UserId() userId: string): Promise<{ remaining: number }> {
    return this.tasks.remainingQuota(userId);
  }

  @Get("tasks/:id")
  get(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<GenerationTask> {
    return this.tasks.get(userId, id);
  }
}
