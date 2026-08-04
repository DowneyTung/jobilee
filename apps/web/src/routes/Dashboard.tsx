import { ACTIVE_STAGES, STAGE_LABELS } from "@jobilee/shared-types";
import { useAuth } from "../auth/AuthProvider.tsx";

/**
 * The authenticated shell. Phase 1 ends here: a real session, a real layout,
 * and an empty pipeline. Phase 2 fills the rail with jobs from jobs-service.
 */
export function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>Jobilee</strong>
        </div>
        <div className="header-right">
          <span className="muted">{user?.email}</span>
          <button type="button" className="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="stage-rail" aria-label="Pipeline stages">
          {ACTIVE_STAGES.map((stage) => (
            <div className="stage" key={stage}>
              <div className="stage-head">
                <span className="stage-name">{STAGE_LABELS[stage]}</span>
                <span className="stage-count">0</span>
              </div>
              <div className="stage-body" />
            </div>
          ))}
        </section>

        <section className="card empty-state">
          <h2>No applications yet</h2>
          <p className="muted">
            Your pipeline is empty. Adding jobs, moving them through stages, and generating
            company research arrives in the next phase.
          </p>
        </section>
      </main>
    </div>
  );
}
