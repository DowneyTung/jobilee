import { Controller, Get, Param, ParseUUIDPipe, Res } from "@nestjs/common";
import { UserId } from "@jobilee/service-kit";
import { isTerminalStatus } from "@jobilee/shared-types";
import type { Response } from "express";
import { TaskEventsService, type TaskEvent } from "./task-events.service.ts";
import { TasksService } from "./tasks.service.ts";

/** Keeps proxies and load balancers from dropping an idle stream. */
const HEARTBEAT_MS = 20_000;
/** A generation should never outlive this; the client falls back to polling. */
const MAX_STREAM_MS = 10 * 60 * 1000;

@Controller("ai")
export class TaskStreamController {
  constructor(
    private readonly tasks: TasksService,
    private readonly events: TaskEventsService,
  ) {}

  /**
   * Server-sent events for one task, replacing the client's poll loop.
   *
   * Uses a raw response rather than Nest's `@Sse()` so the handler owns
   * heartbeats, the terminal close, and cleanup on client disconnect.
   */
  @Get("tasks/:id/stream")
  async stream(
    @UserId() userId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    // Scoped read first: this throws NOT_FOUND for someone else's task, so a
    // stream is never opened for a task the caller cannot see.
    const task = await this.tasks.get(userId, id);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Belt and braces for any reverse proxy that buffers by default.
      "x-accel-buffering": "no",
    });
    res.flushHeaders();

    const send = (event: TaskEvent): void => {
      res.write(`event: task\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Replay current state immediately: a client that connects after the work
    // finished must still get its result rather than waiting for an event that
    // has already been published.
    const current: TaskEvent = {
      taskId: task.id,
      status: task.status,
      result: task.result,
      error: task.error,
    };
    send(current);

    if (isTerminalStatus(task.status)) {
      res.end();
      return;
    }

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(maxLifetime);
      unsubscribe();
      res.end();
    };

    const unsubscribe = this.events.subscribe(id, (event) => {
      if (closed) return;
      send(event);
      if (isTerminalStatus(event.status)) close();
    });

    const heartbeat = setInterval(() => {
      // A comment line is a valid no-op event; it keeps the socket warm
      // without the client having to interpret anything.
      if (!closed) res.write(": ping\n\n");
    }, HEARTBEAT_MS);

    const maxLifetime = setTimeout(close, MAX_STREAM_MS);

    // The client navigating away or closing the tab must release the
    // subscription and the timers.
    res.on("close", close);
  }
}
