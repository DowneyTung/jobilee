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
  // `undefined` means "nothing chosen yet", which renders the first artifact
  // expanded. Picking the initial value at mount would leave a just-generated
  // brief collapsed, because there were no artifacts when the component mounted.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);

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
        const open = openId === undefined ? artifacts[0]?.id === artifact.id : openId === artifact.id;
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
