import { type JobArtifact } from "@jobilee/shared-types";
import { useState } from "react";

const TITLES = {
  RESEARCH: "Company research",
  INTERVIEW_PREP: "Interview prep",
} as const;

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Renders generated briefs. Content is shown as preformatted text rather than
 * rendered Markdown: it comes from a model, and piping model output through an
 * HTML renderer is how you get an injection bug. `<pre>` shows it verbatim.
 */
export function Artifacts({ artifacts }: { artifacts: JobArtifact[] }) {
  const [openId, setOpenId] = useState<string | null>(artifacts[0]?.id ?? null);

  if (artifacts.length === 0) {
    return (
      <p className="muted tiny">
        No research or prep yet. Generate them with the buttons above.
      </p>
    );
  }

  return (
    <ul className="versions">
      {artifacts.map((artifact) => {
        const open = openId === artifact.id;
        return (
          <li key={artifact.id}>
            <button
              type="button"
              className="version-head"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : artifact.id)}
            >
              <span className="version-tag">{TITLES[artifact.type]}</span>
              <time className="muted tiny" dateTime={artifact.createdAt.toISOString()}>
                {timestamp.format(artifact.createdAt)}
              </time>
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="version-body">
                <pre>{artifact.content}</pre>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
