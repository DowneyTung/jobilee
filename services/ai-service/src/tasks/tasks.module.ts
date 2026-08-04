import { Module } from "@nestjs/common";
import { GenerationService } from "../generation/generation.service.ts";
import { GenerationWorker } from "../queue/generation.worker.ts";
import { QueueService } from "../queue/queue.service.ts";
import { QuotaService } from "../quota/quota.service.ts";
import { TasksController } from "./tasks.controller.ts";
import { TasksService } from "./tasks.service.ts";

@Module({
  controllers: [TasksController],
  providers: [TasksService, QueueService, QuotaService, GenerationService, GenerationWorker],
  exports: [QuotaService],
})
export class TasksModule {}
