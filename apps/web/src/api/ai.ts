import {
  createTaskResponseSchema,
  generationTaskSchema,
  isTerminalStatus,
  type CreateTaskRequest,
  type GenerationTask,
} from "@jobilee/shared-types";
import { useCallback, useRef, useState } from "react";
import { ApiError, apiFetch } from "./client.ts";

const POLL_INTERVAL_MS = 2_000;
/** 40 generations × 2s ≈ 13 minutes — well past the slowest expected run. */
const MAX_POLLS = 400;

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
  /** What the task is doing right now, for the button label. */
  phase: "idle" | "queued" | "running";
}

/**
 * Creates a generation task and polls until it settles.
 *
 * Polling rather than SSE, per the architecture: it is simpler and survives a
 * gateway restart mid-generation, because the task's state lives in Postgres
 * rather than in an open connection. Phase 5 can swap in SSE without changing
 * the persistence model.
 */
export function useGeneration() {
  const [state, setState] = useState<GenerationState>({
    running: false,
    error: null,
    phase: "idle",
  });
  // Lets an unmount stop the loop instead of setting state on a dead component.
  const cancelled = useRef(false);

  const reset = useCallback(() => {
    cancelled.current = true;
    setState({ running: false, error: null, phase: "idle" });
  }, []);

  const run = useCallback(async (body: CreateTaskRequest): Promise<string | null> => {
    cancelled.current = false;
    setState({ running: true, error: null, phase: "queued" });

    try {
      const taskId = await createTask(body);

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        if (cancelled.current) return null;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelled.current) return null;

        const task = await getTask(taskId);
        if (task.status === "RUNNING") {
          setState((prev) => ({ ...prev, phase: "running" }));
        }

        if (isTerminalStatus(task.status)) {
          if (task.status === "SUCCEEDED" && task.result) {
            setState({ running: false, error: null, phase: "idle" });
            return task.result;
          }
          setState({
            running: false,
            error: task.error ?? "Generation failed.",
            phase: "idle",
          });
          return null;
        }
      }

      setState({
        running: false,
        error: "This is taking longer than expected. Check back shortly.",
        phase: "idle",
      });
      return null;
    } catch (cause) {
      setState({
        running: false,
        error: cause instanceof ApiError ? cause.message : "Could not start generation.",
        phase: "idle",
      });
      return null;
    }
  }, []);

  return { ...state, run, reset };
}
