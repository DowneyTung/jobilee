import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "@jobilee/logger";
import { createJobsClient, createResumeClient } from "@jobilee/http-client";
import { CONFIG, LOGGER } from "@jobilee/service-kit";
import { splitTailorResult, type CreateTaskRequest } from "@jobilee/shared-types";
import type { Config } from "../config.ts";

/**
 * Hands a finished generation to the service that owns that kind of content.
 *
 * ai-service produces text but stores no domain data: research and interview
 * prep belong to jobs-service, tailored resumes to resume-service. Delivering
 * here rather than from the browser is what makes a result durable — the old
 * flow lost it if the tab was closed or reloaded mid-generation, leaving a
 * paid-for result orphaned with no way to recover it.
 *
 * The trade-off is a new dependency direction: ai-service now calls two
 * services it previously did not know about. The alternative — publishing an
 * event for each owner to consume — keeps them decoupled but needs a durable
 * subscriber in both, and a fire-and-forget publish would reintroduce exactly
 * the lossy path being fixed.
 */
@Injectable()
export class DeliveryService {
  private readonly jobs;
  private readonly resume;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) private readonly log: Logger,
  ) {
    this.jobs = createJobsClient({ baseUrl: config.JOBS_SERVICE_URL, logger: this.log });
    this.resume = createResumeClient({ baseUrl: config.RESUME_SERVICE_URL, logger: this.log });
  }

  /**
   * Throws on failure so the caller can retry. The generation itself is never
   * re-run — the worker skips it when a result is already stored — so a retry
   * costs a cheap HTTP call rather than another billed generation.
   */
  async deliver(userId: string, request: CreateTaskRequest, result: string): Promise<void> {
    // The user id travels in the header downstream services authorize on. That
    // is the same trust model the gateway relies on: the internal network is
    // the boundary, and only the gateway accepts an X-User-Id from outside.
    const ctx = { userId };

    switch (request.type) {
      case "RESEARCH":
      case "INTERVIEW_PREP": {
        await this.jobs.putArtifact(ctx, request.input.jobId, request.type, result);
        this.log.info("delivered artifact", {
          jobId: request.input.jobId,
          type: request.type,
        });
        return;
      }
      case "RESUME_TAILOR": {
        // The model returns one document with two sections; resume-service
        // stores them separately.
        const { gapAnalysis, content } = splitTailorResult(result);
        const version = await this.resume.createTailored(ctx, {
          jobId: request.input.jobId,
          gapAnalysis,
          content,
        });
        this.log.info("delivered tailored resume", {
          jobId: request.input.jobId,
          version: version.version,
        });
        return;
      }
    }
  }
}
