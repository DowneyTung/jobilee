import { RESUME_UPLOAD_CONTENT_TYPES, RESUME_UPLOAD_MAX_BYTES } from "@jobilee/shared-types";
import { useRef, useState, type ChangeEvent } from "react";
import { ApiError } from "../api/client.ts";
import {
  downloadResumeFile,
  useDeleteResumeFile,
  useResumeFiles,
  useUploadResumeFile,
} from "../api/resume.ts";

const ACCEPT = [...RESUME_UPLOAD_CONTENT_TYPES, ".pdf", ".docx", ".doc", ".txt", ".md"].join(",");

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Upload + download list, shared by the settings page and each job page. */
export function FileList({ jobId }: { jobId?: string }) {
  const { data: files, isLoading } = useResumeFiles(jobId);
  const upload = useUploadResumeFile(jobId);
  const remove = useDeleteResumeFile(jobId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handlePick(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    // Fail fast on the client; the service enforces the same limit anyway.
    if (file.size > RESUME_UPLOAD_MAX_BYTES) {
      setError(`That file is ${humanSize(file.size)}. The limit is 10 MB.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    try {
      await upload.mutateAsync(file);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Upload failed.");
    } finally {
      // Let the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDownload(id: string): Promise<void> {
    setError(null);
    try {
      await downloadResumeFile(id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start the download.");
    }
  }

  return (
    <div className="file-list">
      <label className="upload-button">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={handlePick}
          disabled={upload.isPending}
        />
        <span>{upload.isPending ? "Uploading…" : "Upload a file"}</span>
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {isLoading && <p className="muted tiny">Loading files…</p>}
      {files?.length === 0 && <p className="muted tiny">No files yet.</p>}

      <ul className="files">
        {files?.map((file) => (
          <li key={file.id}>
            <div className="file-meta">
              <strong>{file.filename}</strong>
              <span className="muted tiny">
                {humanSize(file.size)} · {file.createdAt.toLocaleDateString()}
              </span>
            </div>
            <div className="file-actions">
              <button type="button" className="ghost compact" onClick={() => handleDownload(file.id)}>
                Download
              </button>
              {confirmingId === file.id ? (
                <>
                  <button
                    type="button"
                    className="danger compact"
                    onClick={async () => {
                      await remove.mutateAsync(file.id);
                      setConfirmingId(null);
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={() => setConfirmingId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() => setConfirmingId(file.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
