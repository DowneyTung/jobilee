import { STAGES, STAGE_LABELS, type Stage } from "@jobilee/shared-types";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client.ts";
import { useChangeStage, useDeleteJob, useJob, useUpdateJob } from "../api/jobs.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { Artifacts } from "../components/Artifacts.tsx";
import { FileList } from "../components/FileList.tsx";
import { GenerationPanel } from "../components/GenerationPanel.tsx";
import { TailoredResumes } from "../components/TailoredResumes.tsx";

const timestamp = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function JobDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: job, isLoading, isError, error } = useJob(id);
  const changeStage = useChangeStage(id);
  const updateJob = useUpdateJob(id);
  const deleteJob = useDeleteJob();

  const [jd, setJd] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the editors once the job arrives, without clobbering in-progress edits.
  useEffect(() => {
    if (!job) return;
    setJd(job.jd);
    setNotes(job.notes);
  }, [job?.id]);

  if (isLoading) return <Shell><p className="muted">Loading…</p></Shell>;
  if (isError || !job) {
    return (
      <Shell>
        <p className="error" role="alert">
          {error instanceof ApiError ? error.message : "Could not load this job."}
        </p>
        <Link to="/">← Back to the board</Link>
      </Shell>
    );
  }

  const dirty = jd !== job.jd || notes !== job.notes;

  async function handleSave(): Promise<void> {
    setSaveError(null);
    try {
      await updateJob.mutateAsync({ jd, notes });
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : "Could not save changes.");
    }
  }

  return (
    <Shell>
      <Link to="/" className="back-link">
        ← Board
      </Link>

      <section className="card">
        <div className="detail-head">
          <div>
            <h1>{job.company}</h1>
            <p className="muted">
              {job.title}
              {job.location ? ` · ${job.location}` : ""}
            </p>
            {job.link && (
              <a href={job.link} target="_blank" rel="noreferrer noopener">
                View posting ↗
              </a>
            )}
          </div>

          <div className="field">
            <label htmlFor="stage">Stage</label>
            <select
              id="stage"
              value={job.stage}
              disabled={changeStage.isPending}
              onChange={(event) => changeStage.mutate(event.target.value as Stage)}
            >
              {STAGES.map((stage) => (
                <option value={stage} key={stage}>
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>History</h2>
        <ol className="timeline">
          {job.events.map((event) => (
            <li key={event.id}>
              <span className="dot" aria-hidden="true" />
              <span className="timeline-stage">{STAGE_LABELS[event.stage]}</span>
              <time className="muted tiny" dateTime={event.at.toISOString()}>
                {timestamp.format(event.at)}
              </time>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <div className="field">
          <label htmlFor="jd">Job description</label>
          <textarea id="jd" rows={10} value={jd} onChange={(e) => setJd(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            rows={6}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Recruiter name, salary range, follow-ups…"
          />
        </div>

        {saveError && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={handleSave}
            disabled={!dirty || updateJob.isPending}
          >
            {updateJob.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </section>

      <GenerationPanel job={job} />

      <section className="card">
        <h2>Research &amp; prep</h2>
        <Artifacts artifacts={job.artifacts} />
      </section>

      <section className="card">
        <h2>Tailored resumes</h2>
        <TailoredResumes jobId={job.id} />
      </section>

      <section className="card">
        <h2>Files</h2>
        <p className="muted tiny">
          The exact PDF or DOCX you sent for this application.
        </p>
        <FileList jobId={job.id} />
      </section>

      <section className="card danger-zone">
        {confirmingDelete ? (
          <>
            <p>Delete this job and its history? This cannot be undone.</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={deleteJob.isPending}
                onClick={async () => {
                  await deleteJob.mutateAsync(job.id);
                  navigate("/", { replace: true });
                }}
              >
                Delete permanently
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="ghost" onClick={() => setConfirmingDelete(true)}>
            Delete job
          </button>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <AppHeader />
      <main className="app-main detail">{children}</main>
    </div>
  );
}
