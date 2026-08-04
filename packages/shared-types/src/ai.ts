import { z } from "zod";

/**
 * Input ceilings, mirroring the limits jobs-service and resume-service already
 * enforce on the same content. Without them an oversized paste is rejected by
 * the HTTP body parser as an opaque error instead of a clear validation
 * message.
 */
export const MAX_JD_CHARS = 100_000;
export const MAX_RESUME_CHARS = 200_000;

export const TASK_TYPES = ["RESEARCH", "INTERVIEW_PREP", "RESUME_TAILOR"] as const;
export const taskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const TASK_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["SUCCEEDED", "FAILED"];
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

/** Input payloads, discriminated by task type — the worker switches on this. */
export const researchInputSchema = z.object({
  jobId: z.string().uuid(),
  company: z.string().min(1),
  title: z.string().min(1),
  jd: z.string().max(MAX_JD_CHARS).default(""),
});
export type ResearchInput = z.infer<typeof researchInputSchema>;

export const interviewPrepInputSchema = z.object({
  jobId: z.string().uuid(),
  company: z.string().min(1),
  title: z.string().min(1),
  jd: z.string().min(1).max(MAX_JD_CHARS),
});
export type InterviewPrepInput = z.infer<typeof interviewPrepInputSchema>;

export const resumeTailorInputSchema = z.object({
  jobId: z.string().uuid(),
  company: z.string().min(1),
  title: z.string().min(1),
  jd: z.string().min(1).max(MAX_JD_CHARS),
  baseResume: z.string().min(1).max(MAX_RESUME_CHARS),
});
export type ResumeTailorInput = z.infer<typeof resumeTailorInputSchema>;

export const createTaskSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("RESEARCH"), input: researchInputSchema }),
  z.object({ type: z.literal("INTERVIEW_PREP"), input: interviewPrepInputSchema }),
  z.object({ type: z.literal("RESUME_TAILOR"), input: resumeTailorInputSchema }),
]);
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

export const generationTaskSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: taskTypeSchema,
  status: taskStatusSchema,
  /** Present only once SUCCEEDED. */
  result: z.string().nullable(),
  /** User-facing failure message once FAILED. */
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type GenerationTask = z.infer<typeof generationTaskSchema>;

export const createTaskResponseSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
});
export type CreateTaskResponse = z.infer<typeof createTaskResponseSchema>;

/**
 * A resume-tailoring result is one document with two sections; the web app
 * splits it for display and resume-service stores the halves separately.
 */
export const TAILOR_SECTION_HEADINGS = {
  gapAnalysis: "## Gap analysis",
  tailoredResume: "## Tailored resume",
} as const;

export function splitTailorResult(result: string): { gapAnalysis: string; content: string } {
  const index = result.indexOf(TAILOR_SECTION_HEADINGS.tailoredResume);
  if (index === -1) return { gapAnalysis: "", content: result.trim() };
  return {
    gapAnalysis: result
      .slice(0, index)
      .replace(TAILOR_SECTION_HEADINGS.gapAnalysis, "")
      .trim(),
    content: result.slice(index + TAILOR_SECTION_HEADINGS.tailoredResume.length).trim(),
  };
}
