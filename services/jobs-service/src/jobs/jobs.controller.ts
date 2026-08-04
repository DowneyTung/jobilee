import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { UserId, ZodValidationPipe } from "@jobilee/service-kit";
import {
  artifactTypeSchema,
  changeStageSchema,
  createJobSchema,
  updateJobSchema,
  upsertArtifactSchema,
  type ArtifactType,
  type ChangeStageRequest,
  type CreateJobRequest,
  type Job,
  type JobArtifact,
  type JobDetail,
  type UpdateJobRequest,
  type UpsertArtifactRequest,
} from "@jobilee/shared-types";
import { JobsService } from "./jobs.service.ts";

/** Rejects a bad :type in the path before it reaches the service. */
const artifactTypePipe = new ZodValidationPipe<ArtifactType>(artifactTypeSchema);

@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@UserId() userId: string): Promise<Job[]> {
    return this.jobs.list(userId);
  }

  @Post()
  create(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(createJobSchema)) body: CreateJobRequest,
  ): Promise<Job> {
    return this.jobs.create(userId, body);
  }

  @Get(":id")
  get(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string): Promise<JobDetail> {
    return this.jobs.get(userId, id);
  }

  @Patch(":id")
  update(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJobSchema)) body: UpdateJobRequest,
  ): Promise<Job> {
    return this.jobs.update(userId, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.jobs.remove(userId, id);
  }

  /** The pipeline move. Appends a StageEvent so history is never lost. */
  @Post(":id/stage")
  @HttpCode(200)
  changeStage(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeStageSchema)) body: ChangeStageRequest,
  ): Promise<Job> {
    return this.jobs.changeStage(userId, id, body.stage);
  }

  @Get(":id/artifacts/:type")
  getArtifact(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", artifactTypePipe) type: ArtifactType,
  ): Promise<JobArtifact> {
    return this.jobs.getArtifact(userId, id, type);
  }

  /** Called after an AI generation completes, so the domain owns the output. */
  @Put(":id/artifacts/:type")
  putArtifact(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", artifactTypePipe) type: ArtifactType,
    @Body(new ZodValidationPipe(upsertArtifactSchema)) body: UpsertArtifactRequest,
  ): Promise<JobArtifact> {
    return this.jobs.putArtifact(userId, id, type, body.content);
  }
}
