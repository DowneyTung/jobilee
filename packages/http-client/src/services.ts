/**
 * Typed clients for the internal services. Each wraps `createHttpClient` and
 * validates responses against the shared schemas, so a contract drift shows up
 * as an UPSTREAM_ERROR at the boundary instead of a stray `undefined` later.
 */
import {
  accessTokenResponseSchema,
  authResponseSchema,
  createTaskResponseSchema,
  generationTaskSchema,
  jobDetailSchema,
  jobSchema,
  baseResumeSchema,
  tailoredResumeSchema,
  userSchema,
  type AccessTokenResponse,
  type ArtifactType,
  type AuthResponse,
  type BaseResume,
  type ChangeStageRequest,
  type CreateJobRequest,
  type CreateTailoredResumeRequest,
  type CreateTaskRequest,
  type CreateTaskResponse,
  type GenerationTask,
  type Job,
  type JobArtifact,
  type JobDetail,
  type LoginRequest,
  type RegisterRequest,
  type TailoredResume,
  type UpdateJobRequest,
  type User,
  jobArtifactSchema,
} from "@jobilee/shared-types";
import { z } from "zod";
import { createHttpClient, type HttpClient, type HttpClientOptions, type RequestContext } from "./client.ts";

export interface AuthServiceClient {
  register(body: RegisterRequest): Promise<AuthResponse>;
  login(body: LoginRequest): Promise<AuthResponse>;
  refresh(refreshToken: string): Promise<AccessTokenResponse>;
  me(accessToken: string): Promise<User>;
}

export function createAuthClient(options: HttpClientOptions): AuthServiceClient {
  const http = createHttpClient({ name: "auth-service", ...options });
  return {
    register: (body) => http.post("/auth/register", body, { schema: authResponseSchema }),
    login: (body) => http.post("/auth/login", body, { schema: authResponseSchema }),
    refresh: (refreshToken) =>
      http.post("/auth/refresh", { refreshToken }, { schema: accessTokenResponseSchema }),
    me: (accessToken) =>
      http.get("/auth/me", {
        schema: z.object({ user: userSchema }),
        headers: { authorization: `Bearer ${accessToken}` },
      }).then((r) => r.user),
  };
}

export interface JobsServiceClient {
  list(ctx: RequestContext): Promise<Job[]>;
  create(ctx: RequestContext, body: CreateJobRequest): Promise<Job>;
  get(ctx: RequestContext, id: string): Promise<JobDetail>;
  update(ctx: RequestContext, id: string, body: UpdateJobRequest): Promise<Job>;
  remove(ctx: RequestContext, id: string): Promise<void>;
  changeStage(ctx: RequestContext, id: string, body: ChangeStageRequest): Promise<Job>;
  getArtifact(ctx: RequestContext, id: string, type: ArtifactType): Promise<JobArtifact>;
  putArtifact(
    ctx: RequestContext,
    id: string,
    type: ArtifactType,
    content: string,
  ): Promise<JobArtifact>;
}

export function createJobsClient(options: HttpClientOptions): JobsServiceClient {
  const http: HttpClient = createHttpClient({ name: "jobs-service", ...options });
  return {
    list: (ctx) => http.get("/jobs", { ...ctx, schema: z.array(jobSchema) }),
    create: (ctx, body) => http.post("/jobs", body, { ...ctx, schema: jobSchema }),
    get: (ctx, id) => http.get(`/jobs/${id}`, { ...ctx, schema: jobDetailSchema }),
    update: (ctx, id, body) => http.patch(`/jobs/${id}`, body, { ...ctx, schema: jobSchema }),
    remove: (ctx, id) => http.delete(`/jobs/${id}`, ctx).then(() => undefined),
    changeStage: (ctx, id, body) =>
      http.post(`/jobs/${id}/stage`, body, { ...ctx, schema: jobSchema }),
    getArtifact: (ctx, id, type) =>
      http.get(`/jobs/${id}/artifacts/${type}`, { ...ctx, schema: jobArtifactSchema }),
    putArtifact: (ctx, id, type, content) =>
      http.put(`/jobs/${id}/artifacts/${type}`, { content }, { ...ctx, schema: jobArtifactSchema }),
  };
}

export interface ResumeServiceClient {
  getBase(ctx: RequestContext): Promise<BaseResume>;
  putBase(ctx: RequestContext, content: string): Promise<BaseResume>;
  listTailored(ctx: RequestContext, jobId: string): Promise<TailoredResume[]>;
  createTailored(
    ctx: RequestContext,
    body: CreateTailoredResumeRequest,
  ): Promise<TailoredResume>;
}

export function createResumeClient(options: HttpClientOptions): ResumeServiceClient {
  const http = createHttpClient({ name: "resume-service", ...options });
  return {
    getBase: (ctx) => http.get("/resume/base", { ...ctx, schema: baseResumeSchema }),
    putBase: (ctx, content) =>
      http.put("/resume/base", { content }, { ...ctx, schema: baseResumeSchema }),
    listTailored: (ctx, jobId) =>
      http.get("/resume/tailored", {
        ...ctx,
        query: { jobId },
        schema: z.array(tailoredResumeSchema),
      }),
    createTailored: (ctx, body) =>
      http.post("/resume/tailored", body, { ...ctx, schema: tailoredResumeSchema }),
  };
}

export interface AiServiceClient {
  createTask(ctx: RequestContext, body: CreateTaskRequest): Promise<CreateTaskResponse>;
  getTask(ctx: RequestContext, id: string): Promise<GenerationTask>;
}

export function createAiClient(options: HttpClientOptions): AiServiceClient {
  const http = createHttpClient({ name: "ai-service", ...options });
  return {
    createTask: (ctx, body) =>
      http.post("/ai/tasks", body, { ...ctx, schema: createTaskResponseSchema }),
    getTask: (ctx, id) => http.get(`/ai/tasks/${id}`, { ...ctx, schema: generationTaskSchema }),
  };
}
