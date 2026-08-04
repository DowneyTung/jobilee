import {
  jobDetailSchema,
  jobSchema,
  type CreateJobRequest,
  type Job,
  type JobDetail,
  type Stage,
  type UpdateJobRequest,
} from "@jobilee/shared-types";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client.ts";

/**
 * Responses are parsed with the same schemas the service validates against, so
 * a contract drift surfaces here instead of as `undefined` deep in a component.
 * It also turns ISO strings into real Dates for free.
 */
const jobListSchema = z.array(jobSchema);

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
};

export function useJobs(): UseQueryResult<Job[]> {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: async () => jobListSchema.parse(await apiFetch<unknown>("/jobs")),
  });
}

export function useJob(id: string): UseQueryResult<JobDetail> {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: async () => jobDetailSchema.parse(await apiFetch<unknown>(`/jobs/${id}`)),
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateJobRequest) =>
      jobSchema.parse(await apiFetch<unknown>("/jobs", { method: "POST", body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

export function useUpdateJob(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateJobRequest) =>
      jobSchema.parse(await apiFetch<unknown>(`/jobs/${id}`, { method: "PATCH", body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

export function useChangeStage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stage: Stage) =>
      jobSchema.parse(
        await apiFetch<unknown>(`/jobs/${id}/stage`, { method: "POST", body: { stage } }),
      ),
    onSuccess: () => {
      // The detail page shows the new history entry; the board shows the move.
      void queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

export function useDeleteJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiFetch<void>(`/jobs/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}
