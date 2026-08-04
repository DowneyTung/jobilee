import {
  splitTailorResult,
  type ArtifactType,
  type JobDetail,
} from "@jobilee/shared-types";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useGeneration } from "../api/ai.ts";
import { ApiError, apiFetch } from "../api/client.ts";
import { jobKeys } from "../api/jobs.ts";
import { resumeKeys } from "../api/resume.ts";

type Kind = "RESEARCH" | "INTERVIEW_PREP" | "RESUME_TAILOR";

const LABELS: Record<Kind, { idle: string; queued: string; running: string }> = {
  RESEARCH: { idle: "Research company", queued: "Queued…", running: "Searching the web…" },
  INTERVIEW_PREP: { idle: "Interview prep", queued: "Queued…", running: "Writing prep…" },
  RESUME_TAILOR: { idle: "Tailor resume", queued: "Queued…", running: "Tailoring…" },
};

/**
 * The AI entry point on a job. Each button creates a task, polls it, then
 * persists the result to whichever service owns that content — jobs-service for
 * research and prep, resume-service for tailored resumes. ai-service never
 * writes domain data itself.
 */
export function GenerationPanel({ job }: { job: JobDetail }) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Kind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useGeneration();

  const hasJd = job.jd.trim().length > 0;

  async function persistArtifact(type: ArtifactType, content: string): Promise<void> {
    await apiFetch(`/jobs/${job.id}/artifacts/${type}`, { method: "PUT", body: { content } });
    await queryClient.invalidateQueries({ queryKey: jobKeys.detail(job.id) });
  }

  async function persistTailored(result: string): Promise<void> {
    const { gapAnalysis, content } = splitTailorResult(result);
    await apiFetch("/resume/tailored", {
      method: "POST",
      body: { jobId: job.id, gapAnalysis, content },
    });
    await queryClient.invalidateQueries({ queryKey: resumeKeys.tailored(job.id) });
  }

  async function start(kind: Kind): Promise<void> {
    setActive(kind);
    setNotice(null);

    try {
      let result: string | null = null;

      if (kind === "RESEARCH") {
        result = await generation.run({
          type: "RESEARCH",
          input: { jobId: job.id, company: job.company, title: job.title, jd: job.jd },
        });
        if (result) await persistArtifact("RESEARCH", result);
      } else if (kind === "INTERVIEW_PREP") {
        result = await generation.run({
          type: "INTERVIEW_PREP",
          input: { jobId: job.id, company: job.company, title: job.title, jd: job.jd },
        });
        if (result) await persistArtifact("INTERVIEW_PREP", result);
      } else {
        // Tailoring needs the base resume, which lives in resume-service.
        const base = await apiFetch<{ content: string }>("/resume/base");
        if (!base.content.trim()) {
          setNotice("Add your base resume under “Resume” before tailoring.");
          return;
        }
        result = await generation.run({
          type: "RESUME_TAILOR",
          input: {
            jobId: job.id,
            company: job.company,
            title: job.title,
            jd: job.jd,
            baseResume: base.content,
          },
        });
        if (result) await persistTailored(result);
      }

      if (result) setNotice("Saved.");
    } catch (cause) {
      setNotice(
        cause instanceof ApiError
          ? `Generated, but saving failed: ${cause.message}`
          : "Generated, but saving failed.",
      );
    } finally {
      setActive(null);
    }
  }

  const labelFor = (kind: Kind): string => {
    if (active !== kind) return LABELS[kind].idle;
    return generation.phase === "running" ? LABELS[kind].running : LABELS[kind].queued;
  };

  return (
    <section className="card">
      <h2>AI assistance</h2>
      {!hasJd && (
        <p className="muted tiny">
          Paste the job description above for sharper interview prep and tailoring.
        </p>
      )}

      <div className="generation-buttons">
        {(Object.keys(LABELS) as Kind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="primary"
            disabled={generation.running || (kind === "INTERVIEW_PREP" && !hasJd)}
            onClick={() => void start(kind)}
          >
            {labelFor(kind)}
          </button>
        ))}
      </div>

      {generation.running && (
        <p className="muted tiny" role="status" aria-live="polite">
          This usually takes 20–40 seconds. You can leave this page — the result is saved
          when it finishes.
        </p>
      )}
      {generation.error && (
        <p className="error" role="alert">
          {generation.error}
        </p>
      )}
      {notice && !generation.error && <p className="muted tiny">{notice}</p>}
    </section>
  );
}
