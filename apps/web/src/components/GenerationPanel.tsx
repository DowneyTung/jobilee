import type { JobDetail } from "@jobilee/shared-types";
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
 * The AI entry point on a job.
 *
 * This component starts a generation and watches it, but it does not save the
 * result — ai-service delivers finished work to whichever service owns it, and
 * only reports SUCCEEDED once that has happened. Persisting from here made the
 * browser tab load-bearing: closing or reloading the page mid-generation lost a
 * result that had already been produced and paid for.
 */
export function GenerationPanel({ job }: { job: JobDetail }) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Kind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useGeneration();

  const hasJd = job.jd.trim().length > 0;

  async function start(kind: Kind): Promise<void> {
    setActive(kind);
    setNotice(null);

    try {
      if (kind === "RESUME_TAILOR") {
        // Tailoring needs the base resume, which lives in resume-service.
        const base = await apiFetch<{ content: string }>("/resume/base");
        if (!base.content.trim()) {
          setNotice("Add your base resume under “Resume” before tailoring.");
          return;
        }
        const saved = await generation.run({
          type: "RESUME_TAILOR",
          input: {
            jobId: job.id,
            company: job.company,
            title: job.title,
            jd: job.jd,
            baseResume: base.content,
          },
        });
        if (saved !== null) {
          await queryClient.invalidateQueries({ queryKey: resumeKeys.tailored(job.id) });
          setNotice("Saved.");
        }
        return;
      }

      const saved = await generation.run({
        type: kind,
        input: { jobId: job.id, company: job.company, title: job.title, jd: job.jd },
      });
      if (saved !== null) {
        await queryClient.invalidateQueries({ queryKey: jobKeys.detail(job.id) });
        setNotice("Saved.");
      }
    } catch (cause) {
      setNotice(
        cause instanceof ApiError ? `Could not start: ${cause.message}` : "Could not start.",
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
    <section className="card" aria-label="AI assistance">
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
          This usually takes 20–40 seconds. You can close this page — the result is saved
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
