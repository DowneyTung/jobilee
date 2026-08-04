import { z } from "zod";

/** Pipeline stages, in board order. Mirrors the Prisma `Stage` enum. */
export const STAGES = [
  "SAVED",
  "APPLIED",
  "RECRUITER_CALL",
  "PHONE_SCREEN",
  "TECHNICAL",
  "ONSITE",
  "OFFER",
  "REJECTED",
] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

export const STAGE_LABELS: Record<Stage, string> = {
  SAVED: "Saved",
  APPLIED: "Applied",
  RECRUITER_CALL: "Recruiter call",
  PHONE_SCREEN: "Phone screen",
  TECHNICAL: "Technical",
  ONSITE: "Onsite",
  OFFER: "Offer",
  REJECTED: "Rejected",
};

/** Stages that sit on the forward-progress rail; REJECTED is a terminal side exit. */
export const ACTIVE_STAGES = STAGES.filter((s) => s !== "REJECTED");

export const ARTIFACT_TYPES = ["RESEARCH", "INTERVIEW_PREP"] as const;
export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const stageEventSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  stage: stageSchema,
  at: z.coerce.date(),
});
export type StageEvent = z.infer<typeof stageEventSchema>;

export const jobArtifactSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  type: artifactTypeSchema,
  content: z.string(),
  createdAt: z.coerce.date(),
});
export type JobArtifact = z.infer<typeof jobArtifactSchema>;

export const jobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  link: z.string().nullable(),
  jd: z.string(),
  notes: z.string(),
  stage: stageSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Job = z.infer<typeof jobSchema>;

/** `GET /jobs/:id` returns the job with its history and generated artifacts. */
export const jobDetailSchema = jobSchema.extend({
  events: z.array(stageEventSchema),
  artifacts: z.array(jobArtifactSchema),
});
export type JobDetail = z.infer<typeof jobDetailSchema>;

export const createJobSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  link: z.string().trim().url().max(2000).optional(),
  jd: z.string().max(100_000).default(""),
  notes: z.string().max(100_000).default(""),
  stage: stageSchema.default("SAVED"),
});
export type CreateJobRequest = z.infer<typeof createJobSchema>;

/** PATCH body — every field optional, but at least one must be present. */
export const updateJobSchema = createJobSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "no fields to update" });
export type UpdateJobRequest = z.infer<typeof updateJobSchema>;

export const changeStageSchema = z.object({ stage: stageSchema });
export type ChangeStageRequest = z.infer<typeof changeStageSchema>;

export const upsertArtifactSchema = z.object({ content: z.string().min(1).max(200_000) });
export type UpsertArtifactRequest = z.infer<typeof upsertArtifactSchema>;
