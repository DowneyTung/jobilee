import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AppError, UserId, ZodValidationPipe } from "@jobilee/service-kit";
import {
  RESUME_UPLOAD_MAX_BYTES,
  createTailoredResumeSchema,
  putBaseResumeSchema,
  uuidSchema,
  type BaseResume,
  type CreateTailoredResumeRequest,
  type PutBaseResumeRequest,
  type ResumeFile,
  type SignedUrl,
  type TailoredResume,
} from "@jobilee/shared-types";
import { FilesService } from "../files/files.service.ts";
import { ResumeService } from "./resume.service.ts";

const jobIdPipe = new ZodValidationPipe(uuidSchema);

@Controller("resume")
export class ResumeController {
  constructor(
    private readonly resume: ResumeService,
    private readonly files: FilesService,
  ) {}

  @Get("base")
  getBase(@UserId() userId: string): Promise<BaseResume> {
    return this.resume.getBase(userId);
  }

  @Put("base")
  putBase(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(putBaseResumeSchema)) body: PutBaseResumeRequest,
  ): Promise<BaseResume> {
    return this.resume.putBase(userId, body.content);
  }

  @Get("tailored")
  listTailored(
    @UserId() userId: string,
    @Query("jobId", jobIdPipe) jobId: string,
  ): Promise<TailoredResume[]> {
    return this.resume.listTailored(userId, jobId);
  }

  @Post("tailored")
  createTailored(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(createTailoredResumeSchema)) body: CreateTailoredResumeRequest,
  ): Promise<TailoredResume> {
    return this.resume.createTailored(userId, body);
  }

  @Get("files")
  listFiles(
    @UserId() userId: string,
    @Query("jobId") jobId?: string,
  ): Promise<ResumeFile[]> {
    return this.files.list(userId, jobId);
  }

  /**
   * Multipart upload. Multer buffers in memory with a hard byte limit — these
   * are resumes, not videos, and nothing touches the container's disk.
   */
  @Post("files")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: RESUME_UPLOAD_MAX_BYTES, files: 1 } }),
  )
  uploadFile(
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("jobId") jobId?: string,
  ): Promise<ResumeFile> {
    if (!file) throw new AppError("BAD_REQUEST", "no file was uploaded (field name: 'file')");

    return this.files.upload(userId, {
      // Browsers send the client's filename; keep it for display only — it
      // never becomes part of the object key.
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      buffer: file.buffer,
      jobId: jobId && jobId.length > 0 ? jobId : undefined,
    });
  }

  @Get("files/:id")
  download(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SignedUrl> {
    return this.files.signedUrl(userId, id);
  }

  @Delete("files/:id")
  @HttpCode(204)
  removeFile(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.files.remove(userId, id);
  }
}
