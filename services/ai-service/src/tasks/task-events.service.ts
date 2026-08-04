import { EventEmitter } from "node:events";
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { CONFIG } from "@jobilee/service-kit";
import type { TaskStatus } from "@jobilee/shared-types";
import { Redis } from "ioredis";
import type { Config } from "../config.ts";

export interface TaskEvent {
  taskId: string;
  status: TaskStatus;
  /** Present once SUCCEEDED. */
  result?: string | null;
  /** Present once FAILED. */
  error?: string | null;
}

const CHANNEL_PREFIX = "task-events";

/**
 * Fans worker progress out to any connected SSE clients.
 *
 * Redis pub/sub rather than in-process events, because the worker and the HTTP
 * handler are only in the same process today — splitting the worker into its
 * own container must not break the stream.
 *
 * One shared Redis subscriber multiplexes to in-process listeners. A connection
 * per open stream would exhaust Redis long before it exhausted this service.
 */
@Injectable()
export class TaskEventsService implements OnModuleInit, OnModuleDestroy {
  private publisher?: Redis;
  private subscriber?: Redis;
  private readonly emitter = new EventEmitter();

  constructor(@Inject(CONFIG) private readonly config: Config) {
    // Many concurrent streams are normal; Node's default warning threshold is 10.
    this.emitter.setMaxListeners(0);
  }

  onModuleInit(): void {
    this.publisher = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });

    void this.subscriber.psubscribe(`${CHANNEL_PREFIX}:*`);
    this.subscriber.on("pmessage", (_pattern, channel, payload) => {
      const taskId = channel.slice(CHANNEL_PREFIX.length + 1);
      try {
        this.emitter.emit(taskId, JSON.parse(payload) as TaskEvent);
      } catch {
        /* a malformed message must not take down the subscriber */
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.emitter.removeAllListeners();
    await this.subscriber?.quit();
    await this.publisher?.quit();
  }

  async publish(event: TaskEvent): Promise<void> {
    await this.publisher?.publish(`${CHANNEL_PREFIX}:${event.taskId}`, JSON.stringify(event));
  }

  /** Returns an unsubscribe function; callers must invoke it on disconnect. */
  subscribe(taskId: string, listener: (event: TaskEvent) => void): () => void {
    this.emitter.on(taskId, listener);
    return () => this.emitter.off(taskId, listener);
  }
}
