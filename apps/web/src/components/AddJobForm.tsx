import { createJobSchema, type CreateJobRequest } from "@jobilee/shared-types";
import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client.ts";
import { useCreateJob } from "../api/jobs.ts";

interface Props {
  onDone(): void;
}

/**
 * Validates with the same schema the service enforces, so bad input is caught
 * before a round-trip and the messages match what the server would have said.
 */
export function AddJobForm({ onDone }: Props) {
  const createJob = useCreateJob();
  const [fields, setFields] = useState({
    company: "",
    title: "",
    location: "",
    link: "",
    jd: "",
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) =>
    setFields((prev) => ({ ...prev, [key]: event.target.value }));

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    // Empty optional fields must be omitted, not sent as "" — link is a url.
    const candidate: Record<string, string> = { company: fields.company, title: fields.title };
    if (fields.location.trim()) candidate["location"] = fields.location.trim();
    if (fields.link.trim()) candidate["link"] = fields.link.trim();
    if (fields.jd.trim()) candidate["jd"] = fields.jd;

    const parsed = createJobSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    try {
      await createJob.mutateAsync(parsed.data as CreateJobRequest);
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save this job.");
    }
  }

  return (
    <form className="card add-job" onSubmit={handleSubmit} noValidate>
      <h2>Add a job</h2>

      <div className="field-row">
        <div className="field">
          <label htmlFor="company">Company</label>
          <input id="company" value={fields.company} onChange={set("company")} required />
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" value={fields.title} onChange={set("title")} required />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="location">Location</label>
          <input
            id="location"
            value={fields.location}
            onChange={set("location")}
            placeholder="Remote"
          />
        </div>
        <div className="field">
          <label htmlFor="link">Posting link</label>
          <input
            id="link"
            value={fields.link}
            onChange={set("link")}
            placeholder="https://…"
            inputMode="url"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="jd">Job description</label>
        <textarea id="jd" rows={6} value={fields.jd} onChange={set("jd")} />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={createJob.isPending}>
          {createJob.isPending ? "Saving…" : "Add job"}
        </button>
      </div>
    </form>
  );
}
