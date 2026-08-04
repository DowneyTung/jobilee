import {
  baseResumeSchema,
  resumeFileSchema,
  signedUrlSchema,
  tailoredResumeSchema,
  type BaseResume,
  type ResumeFile,
  type TailoredResume,
} from "@jobilee/shared-types";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client.ts";

const fileListSchema = z.array(resumeFileSchema);
const tailoredListSchema = z.array(tailoredResumeSchema);

export const resumeKeys = {
  base: ["resume", "base"] as const,
  tailored: (jobId: string) => ["resume", "tailored", jobId] as const,
  files: (jobId?: string) => ["resume", "files", jobId ?? "all"] as const,
};

export function useBaseResume(): UseQueryResult<BaseResume> {
  return useQuery({
    queryKey: resumeKeys.base,
    queryFn: async () => baseResumeSchema.parse(await apiFetch<unknown>("/resume/base")),
  });
}

export function useSaveBaseResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) =>
      baseResumeSchema.parse(
        await apiFetch<unknown>("/resume/base", { method: "PUT", body: { content } }),
      ),
    onSuccess: (saved) => queryClient.setQueryData(resumeKeys.base, saved),
  });
}

export function useTailoredResumes(jobId: string): UseQueryResult<TailoredResume[]> {
  return useQuery({
    queryKey: resumeKeys.tailored(jobId),
    queryFn: async () =>
      tailoredListSchema.parse(await apiFetch<unknown>(`/resume/tailored?jobId=${jobId}`)),
  });
}

export function useResumeFiles(jobId?: string): UseQueryResult<ResumeFile[]> {
  return useQuery({
    queryKey: resumeKeys.files(jobId),
    queryFn: async () =>
      fileListSchema.parse(
        await apiFetch<unknown>(jobId ? `/resume/files?jobId=${jobId}` : "/resume/files"),
      ),
  });
}

export function useUploadResumeFile(jobId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (jobId) form.append("jobId", jobId);
      return resumeFileSchema.parse(
        await apiFetch<unknown>("/resume/files", { method: "POST", body: form }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: resumeKeys.files(jobId) }),
  });
}

export function useDeleteResumeFile(jobId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiFetch<void>(`/resume/files/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: resumeKeys.files(jobId) }),
  });
}

/**
 * Fetches a fresh signed URL and hands it to the browser. The URL is minted per
 * click and expires in minutes, so nothing long-lived ends up in the DOM.
 */
export async function downloadResumeFile(id: string): Promise<void> {
  const { url } = signedUrlSchema.parse(await apiFetch<unknown>(`/resume/files/${id}`));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
