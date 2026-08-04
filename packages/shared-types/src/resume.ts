import { z } from "zod";

export const baseResumeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string(),
  updatedAt: z.coerce.date(),
});
export type BaseResume = z.infer<typeof baseResumeSchema>;

export const putBaseResumeSchema = z.object({
  content: z.string().max(200_000),
});
export type PutBaseResumeRequest = z.infer<typeof putBaseResumeSchema>;

export const tailoredResumeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid(),
  version: z.number().int().positive(),
  gapAnalysis: z.string(),
  content: z.string(),
  createdAt: z.coerce.date(),
});
export type TailoredResume = z.infer<typeof tailoredResumeSchema>;

/** Version is assigned server-side (incrementing per user+job); never sent by clients. */
export const createTailoredResumeSchema = z.object({
  jobId: z.string().uuid(),
  gapAnalysis: z.string().max(100_000),
  content: z.string().min(1).max(200_000),
});
export type CreateTailoredResumeRequest = z.infer<typeof createTailoredResumeSchema>;

export const resumeFileSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  filename: z.string(),
  contentType: z.string(),
  objectKey: z.string(),
  createdAt: z.coerce.date(),
});
export type ResumeFile = z.infer<typeof resumeFileSchema>;

export const signedUrlSchema = z.object({
  url: z.string().url(),
  expiresAt: z.coerce.date(),
});
export type SignedUrl = z.infer<typeof signedUrlSchema>;

export const RESUME_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const RESUME_UPLOAD_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
] as const;
