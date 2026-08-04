import { Injectable } from "@nestjs/common";
import { AppError } from "@jobilee/service-kit";
import type {
  ArtifactType,
  CreateJobRequest,
  Job,
  JobArtifact,
  JobDetail,
  Stage,
  UpdateJobRequest,
} from "@jobilee/shared-types";
import { PrismaService } from "../prisma/prisma.service.ts";

/**
 * Every method takes `userId` first and threads it into the WHERE clause.
 * That is the entire multi-tenancy story for this service: there is no query
 * here that can reach a row the caller doesn't own.
 *
 * A job belonging to someone else is reported as NOT_FOUND rather than
 * FORBIDDEN — a 403 would confirm the id exists.
 */
@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(userId: string, body: CreateJobRequest): Promise<Job> {
    // The job and its opening history entry are one atomic fact.
    return this.prisma.job.create({
      data: {
        userId,
        company: body.company,
        title: body.title,
        location: body.location ?? null,
        link: body.link ?? null,
        jd: body.jd,
        notes: body.notes,
        stage: body.stage,
        events: { create: { stage: body.stage } },
      },
    });
  }

  async get(userId: string, id: string): Promise<JobDetail> {
    const job = await this.prisma.job.findFirst({
      where: { id, userId },
      include: {
        events: { orderBy: { at: "asc" } },
        artifacts: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!job) throw new AppError("NOT_FOUND", "job not found");
    return job;
  }

  async update(userId: string, id: string, body: UpdateJobRequest): Promise<Job> {
    await this.assertOwned(userId, id);

    // A stage sent through PATCH is ignored: stage changes must go through
    // changeStage so history is never silently skipped.
    const { stage: _ignored, ...editable } = body;

    return this.prisma.job.update({
      where: { id },
      data: {
        ...editable,
        ...(editable.location === undefined ? {} : { location: editable.location ?? null }),
        ...(editable.link === undefined ? {} : { link: editable.link ?? null }),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    // Events and artifacts cascade at the database level.
    await this.prisma.job.delete({ where: { id } });
  }

  /** Moves a job and appends a timestamped history entry, atomically. */
  async changeStage(userId: string, id: string, stage: Stage): Promise<Job> {
    const current = await this.assertOwned(userId, id);

    // Re-selecting the same stage is a no-op, not a duplicate history row.
    if (current.stage === stage) return current;

    const [, job] = await this.prisma.$transaction([
      this.prisma.stageEvent.create({ data: { jobId: id, stage } }),
      this.prisma.job.update({ where: { id }, data: { stage } }),
    ]);
    return job;
  }

  async getArtifact(userId: string, id: string, type: ArtifactType): Promise<JobArtifact> {
    await this.assertOwned(userId, id);
    const artifact = await this.prisma.jobArtifact.findUnique({
      where: { jobId_type: { jobId: id, type } },
    });
    if (!artifact) throw new AppError("NOT_FOUND", `no ${type} artifact for this job`);
    return artifact;
  }

  /** Upsert: the AI flow re-runs and replaces the current brief. */
  async putArtifact(
    userId: string,
    id: string,
    type: ArtifactType,
    content: string,
  ): Promise<JobArtifact> {
    await this.assertOwned(userId, id);
    return this.prisma.jobArtifact.upsert({
      where: { jobId_type: { jobId: id, type } },
      create: { jobId: id, type, content },
      update: { content },
    });
  }

  /** Single ownership gate, so no handler can forget it. */
  private async assertOwned(userId: string, id: string): Promise<Job> {
    const job = await this.prisma.job.findFirst({ where: { id, userId } });
    if (!job) throw new AppError("NOT_FOUND", "job not found");
    return job;
  }
}
