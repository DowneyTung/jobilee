import { useState } from "react";
import { useTailoredResumes } from "../api/resume.ts";

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Version history for one job. Versions are immutable, so this is a record of
 * what was actually produced — Phase 4 appends to it after each tailoring run.
 */
export function TailoredResumes({ jobId }: { jobId: string }) {
  const { data: versions, isLoading } = useTailoredResumes(jobId);
  // `undefined` renders the newest version expanded; see Artifacts.tsx.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);

  if (isLoading) return <p className="muted tiny">Loading versions…</p>;

  if (!versions || versions.length === 0) {
    return (
      <p className="muted tiny">
        No tailored versions yet. Generating one arrives with the AI service in the next phase.
      </p>
    );
  }

  return (
    <ul className="versions">
      {versions.map((version) => {
        const open = openId === undefined ? versions[0]?.id === version.id : openId === version.id;
        return (
          <li key={version.id}>
            <button
              type="button"
              className="version-head"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : version.id)}
            >
              <span className="version-tag">v{version.version}</span>
              <time className="muted tiny" dateTime={version.createdAt.toISOString()}>
                {timestamp.format(version.createdAt)}
              </time>
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>

            {open && (
              <div className="version-body">
                {version.gapAnalysis && (
                  <>
                    <h3>Gap analysis</h3>
                    <pre>{version.gapAnalysis}</pre>
                  </>
                )}
                <h3>Tailored resume</h3>
                <pre>{version.content}</pre>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
