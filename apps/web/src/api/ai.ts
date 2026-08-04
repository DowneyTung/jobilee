import {
  createTaskResponseSchema,
  generationTaskSchema,
  isTerminalStatus,
  taskStatusSchema,
  type CreateTaskRequest,
  type GenerationTask,
  type TaskStatus,
} from "@jobilee/shared-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, apiFetch } from "./client.ts";
import { streamEvents } from "./sse.ts";

const POLL_INTERVAL_MS = 2_000;
/** ~13 minutes at the poll interval — past the slowest expected generation. */
const MAX_POLLS = 400;

/** What the SSE endpoint pushes on each transition. */
const taskEventSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
  result: z.string().nullish(),
  error: z.string().nullish(),
});

export async function createTask(body: CreateTaskRequest): Promise<string> {
  const { taskId } = createTaskResponseSchema.parse(
    await apiFetch<unknown>("/ai/tasks", { method: "POST", body }),
  );
  return taskId;
}

export async function getTask(taskId: string): Promise<GenerationTask> {
  return generationTaskSchema.parse(await apiFetch<unknown>(`/ai/tasks/${taskId}`));
}

export interface GenerationState {
  running: boolean;
  error: string | null;
  phase: "idle" | "queued" | "running";
  /** How the result was awaited, surfaced for diagnostics. */
  transport: "sse" | "polling" | null;
}

interface Outcome {
  result: string | null;
  error: string | null;
}

/**
 * Creates a generation task and waits for it to settle.
 *
 * Prefers a server-sent event stream — the result lands the moment the worker
 * finishes rather than up to two seconds later — and falls back to polling if
 * the stream cannot be established. Task state lives in Postgres either way, so
 * a dropped connection loses nothing.
 */
export function useGeneration() {
  const [state, setState] = useState<GenerationState>({
    running: false,
    error: null,
    phase: "idle",
    transport: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const cancelled = useRef(false);

  // A component unmounting mid-generation must not leave a socket open.
  useEffect(
    () => () => {
      cancelled.current = true;
      abortRef.current?.abort();
    },
    [],
  );

  const reset = useCallback(() => {
    cancelled.current = true;
    abortRef.current?.abort();
    setState({ running: false, error: null, phase: "idle", transport: null });
  }, []);

  const run = useCallback(async (body: CreateTaskRequest): Promise<string | null> => {
    cancelled.current = false;
    setState({ running: true, error: null, phase: "queued", transport: null });

    const controller = new AbortController();
    abortRef.current = controller;

    const onStatus = (status: TaskStatus): void => {
      if (status === "RUNNING") setState((prev) => ({ ...prev, phase: "running" }));
    };

    try {
      const taskId = await createTask(body);

      let outcome: Outcome | null = null;
      try {
        setState((prev) => ({ ...prev, transport: "sse" }));
        outcome = await awaitViaStream(taskId, controller.signal, onStatus);
      } catch {
        // The stream is an optimization; polling is the guarantee.
        if (cancelled.current) return null;
        setState((prev) => ({ ...prev, transport: "polling" }));
        outcome = await awaitViaPolling(taskId, onStatus, () => cancelled.current);
      }

      if (cancelled.current || outcome === null) return null;

      if (outcome.result !== null) {
        setState({ running: false, error: null, phase: "idle", transport: null });
        return outcome.result;
      }

      setState({
        running: false,
        error: outcome.error ?? "Generation failed.",
        phase: "idle",
        transport: null,
      });
      return null;
    } catch (cause) {
      if (cancelled.current) return null;
      setState({
        running: false,
        error: cause instanceof ApiError ? cause.message : "Could not start generation.",
        phase: "idle",
        transport: null,
      });
      return null;
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { ...state, run, reset };
}

async function awaitViaStream(
  taskId: string,
  signal: AbortSignal,
  onStatus: (status: TaskStatus) => void,
): Promise<Outcome | null> {
  for await (const message of streamEvents(`/ai/tasks/${taskId}/stream`, signal)) {
    if (message.event !== "task") continue;

    const event = taskEventSchema.parse(JSON.parse(message.data));
    onStatus(event.status);

    if (isTerminalStatus(event.status)) {
      return event.status === "SUCCEEDED"
        ? { result: event.result ?? "", error: null }
        : { result: null, error: event.error ?? "Generation failed." };
    }
  }
  // The stream ended without a terminal event — let the caller fall back.
  throw new Error("stream closed before the task settled");
}

async function awaitViaPolling(
  taskId: string,
  onStatus: (status: TaskStatus) => void,
  isCancelled: () => boolean,
): Promise<Outcome | null> {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (isCancelled()) return null;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    if (isCancelled()) return null;

    const task = await getTask(taskId);
    onStatus(task.status);

    if (isTerminalStatus(task.status)) {
      return task.status === "SUCCEEDED"
        ? { result: task.result ?? "", error: null }
        : { result: null, error: task.error ?? "Generation failed." };
    }
  }
  return { result: null, error: "This is taking longer than expected. Check back shortly." };
}
