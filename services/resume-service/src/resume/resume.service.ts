import { Injectable } from "@nestjs/common";
import { AppError } from "@jobilee/service-kit";
import type {
  BaseResume,
  CreateTailoredResumeRequest,
  TailoredResume,
} from "@jobilee/shared-types";
import { Prisma } from "../../generated/prisma/index.js";
import { PrismaService } from "../prisma/prisma.service.ts";

/** How many times to re-derive the next version when writers collide. */
const VERSION_RETRIES = 5;

@Injectable()
export class ResumeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reading a base resume that doesn't exist yet creates an empty one, so the
   * endpoint is total and the editor never has to special-case "no resume".
   */
  async getBase(userId: string): Promise<BaseResume> {
    return this.prisma.baseResume.upsert({
      where: { userId },
      create: { userId, content: "" },
      update: {},
    });
  }

  async putBase(userId: string, content: string): Promise<BaseResume> {
    return this.prisma.baseResume.upsert({
      where: { userId },
      create: { userId, content },
      update: { content },
    });
  }

  /** Newest version first — the UI shows the latest tailoring at the top. */
  async listTailored(userId: string, jobId: string): Promise<TailoredResume[]> {
    return this.prisma.tailoredResume.findMany({
      where: { userId, jobId },
      orderBy: { version: "desc" },
    });
  }

  /**
   * Appends the next version for this user+job. The version sequence is
   * enforced by a unique index rather than by reading the max and hoping:
   * two concurrent tailorings would otherwise both compute N+1, and one would
   * silently overwrite or fail. On collision we re-read and retry.
   */
  async createTailored(
    userId: string,
    body: CreateTailoredResumeRequest,
  ): Promise<TailoredResume> {
    for (let attempt = 0; attempt < VERSION_RETRIES; attempt++) {
      const latest = await this.prisma.tailoredResume.findFirst({
        where: { userId, jobId: body.jobId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      try {
        return await this.prisma.tailoredResume.create({
          data: {
            userId,
            jobId: body.jobId,
            version,
            gapAnalysis: body.gapAnalysis,
            content: body.content,
          },
        });
      } catch (error) {
        const lostRace =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!lostRace) throw error;
      }
    }
    throw new AppError("CONFLICT", "could not allocate a resume version, please retry");
  }
}
