import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client.ts";
import { useBaseResume, useSaveBaseResume } from "../api/resume.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { FileList } from "../components/FileList.tsx";

/**
 * The base resume is the single source everything else is derived from —
 * Phase 4 feeds it to the tailoring prompt alongside a job description.
 */
export function Settings() {
  const { data: base, isLoading } = useBaseResume();
  const save = useSaveBaseResume();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (base) setContent(base.content);
  }, [base?.id]);

  const dirty = base !== undefined && content !== base.content;

  async function handleSave(): Promise<void> {
    setError(null);
    try {
      await save.mutateAsync(content);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your resume.");
    }
  }

  return (
    <div className="app">
      <AppHeader />
      <main className="app-main detail">
        <Link to="/" className="back-link">
          ← Board
        </Link>

        <section className="card">
          <h2>Base resume</h2>
          <p className="muted">
            Plain text or Markdown. This is the source the AI tailors from, so keep it complete —
            it never invents experience you haven't listed here.
          </p>
          {isLoading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <textarea
                aria-label="Base resume"
                rows={22}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={"# Your Name\n\n## Experience\n…"}
              />
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="actions">
                <span className="muted tiny">
                  {base?.updatedAt && !dirty
                    ? `Saved ${base.updatedAt.toLocaleString()}`
                    : dirty
                      ? "Unsaved changes"
                      : ""}
                </span>
                <button
                  type="button"
                  className="primary"
                  onClick={handleSave}
                  disabled={!dirty || save.isPending}
                >
                  {save.isPending ? "Saving…" : "Save resume"}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>Resume files</h2>
          <p className="muted">
            PDFs and Word documents you upload here aren't tied to a single application. Files
            attached to a specific job live on that job's page.
          </p>
          <FileList />
        </section>
      </main>
    </div>
  );
}
