import { Injectable } from "@nestjs/common";
import { AppError } from "@jobilee/service-kit";
import {
  RESUME_UPLOAD_CONTENT_TYPES,
  RESUME_UPLOAD_MAX_BYTES,
  type ResumeFile,
  type SignedUrl,
} from "@jobilee/shared-types";
import { PrismaService } from "../prisma/prisma.service.ts";
import { StorageService } from "../storage/storage.service.ts";

const ALLOWED: ReadonlySet<string> = new Set(RESUME_UPLOAD_CONTENT_TYPES);

export interface UploadInput {
  filename: string;
  contentType: string;
  size: number;
  buffer: Buffer;
  jobId?: string | undefined;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, jobId?: string): Promise<ResumeFile[]> {
    return this.prisma.resumeFile.findMany({
      where: { userId, ...(jobId ? { jobId } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async upload(userId: string, input: UploadInput): Promise<ResumeFile> {
    if (!ALLOWED.has(input.contentType)) {
      throw new AppError(
        "BAD_REQUEST",
        `unsupported file type: ${input.contentType}. Allowed: PDF, DOCX, DOC, TXT, MD`,
      );
    }
    if (input.size > RESUME_UPLOAD_MAX_BYTES) {
      throw new AppError("BAD_REQUEST", `file is larger than ${RESUME_UPLOAD_MAX_BYTES} bytes`);
    }

    const objectKey = this.storage.buildObjectKey(userId, input.filename);
    await this.storage.put(objectKey, input.buffer, input.contentType);

    try {
      return await this.prisma.resumeFile.create({
        data: {
          userId,
          jobId: input.jobId ?? null,
          filename: input.filename,
          contentType: input.contentType,
          size: input.size,
          objectKey,
        },
      });
    } catch (error) {
      // Don't leave an orphaned object behind if the row can't be written.
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Returns a short-lived URL rather than streaming the bytes: the download
   * goes browser→MinIO directly, and the URL can't be reused for long if it
   * leaks into history or a log.
   */
  async signedUrl(userId: string, id: string): Promise<SignedUrl> {
    const file = await this.owned(userId, id);
    return this.storage.signedDownloadUrl(file.objectKey, file.filename);
  }

  async remove(userId: string, id: string): Promise<void> {
    const file = await this.owned(userId, id);
    // Row first: an orphaned object is recoverable waste, but a row pointing at
    // a deleted object is a broken download.
    await this.prisma.resumeFile.delete({ where: { id } });
    await this.storage.remove(file.objectKey).catch(() => undefined);
  }

  /** Ownership gate — the only path from a file id to an object key. */
  private async owned(userId: string, id: string): Promise<ResumeFile> {
    const file = await this.prisma.resumeFile.findFirst({ where: { id, userId } });
    if (!file) throw new AppError("NOT_FOUND", "file not found");
    return file;
  }
}
