import { STAGES, STAGE_LABELS, type Job, type Stage } from "@jobilee/shared-types";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useJobs } from "../api/jobs.ts";
import { AddJobForm } from "../components/AddJobForm.tsx";
import { AppHeader } from "../components/AppHeader.tsx";

export function Board() {
  const { data: jobs, isLoading, isError, error } = useJobs();
  const [adding, setAdding] = useState(false);

  // One pass into buckets, rather than filtering the list once per column.
  const byStage = useMemo(() => {
    const buckets = new Map<Stage, Job[]>(STAGES.map((stage) => [stage, []]));
    for (const job of jobs ?? []) buckets.get(job.stage)?.push(job);
    return buckets;
  }, [jobs]);

  return (
    <div className="app">
      <AppHeader>
        <button type="button" className="primary compact" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Add job"}
        </button>
      </AppHeader>

      <main className="app-main">
        {adding && <AddJobForm onDone={() => setAdding(false)} />}

        {isLoading && <p className="muted">Loading your pipeline…</p>}
        {isError && (
          <p className="error" role="alert">
            {error instanceof Error ? error.message : "Could not load jobs."}
          </p>
        )}

        {jobs && (
          <section className="stage-rail" aria-label="Pipeline stages">
            {STAGES.map((stage) => {
              const inStage = byStage.get(stage) ?? [];
              return (
                <div className={`stage${stage === "REJECTED" ? " stage-muted" : ""}`} key={stage}>
                  <div className="stage-head">
                    <span className="stage-name">{STAGE_LABELS[stage]}</span>
                    <span className="stage-count">{inStage.length}</span>
                  </div>
                  <div className="stage-body">
                    {inStage.map((job) => (
                      <Link className="job-card" to={`/jobs/${job.id}`} key={job.id}>
                        <strong>{job.company}</strong>
                        <span className="job-title">{job.title}</span>
                        {job.location && <span className="muted tiny">{job.location}</span>}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {jobs?.length === 0 && !adding && (
          <section className="card empty-state">
            <h2>No applications yet</h2>
            <p className="muted">
              Add your first job to start tracking it through the pipeline.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
