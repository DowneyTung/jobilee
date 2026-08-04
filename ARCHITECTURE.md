# Job Hunt Portal — Microservices Architecture & Implementation Plan

> **Audience:** Claude Code (or any engineer) implementing this from scratch.
> **Goal:** A full-fledged, multi-user job-hunting portal that tracks applications through a pipeline, generates AI company research / interview prep / tailored resumes, and stores resume versions — runnable entirely locally with `docker compose up`.

---

## 0. Read this first: is microservices the right call?

For a **single user**, no — a modular monolith is the correct engineering choice and will ship 5x faster. Microservices earn their keep when you have **independent scaling needs, separate deploy cadences, or multiple teams**. This app has one real reason to lean that way: the **AI generation work is slow (20–40s), bursty, and calls a rate-limited external API**, so isolating it behind a queue is genuinely useful.

**Recommendation:** Build the services below as **separate deployable units but inside one monorepo with shared packages.** Keep boundaries clean. If the ops overhead annoys you, you can collapse the domain services into one process without rewriting business logic (see §9, *Modular Monolith Fallback*). This plan is designed so that collapse is a config change, not a rewrite.

Every service must:
- Own its own database schema (no cross-service table reads).
- Talk to other services only over HTTP (sync) or the message broker (async).
- Boot from environment variables, expose `GET /health`, and log structured JSON to stdout.

---

## 1. System overview

```
                        ┌─────────────────────────────────────────┐
                        │                Browser                   │
                        │        Web (React + Vite SPA)            │
                        └───────────────────┬──────────────────────┘
                                            │  HTTPS (JSON)
                                            ▼
                        ┌─────────────────────────────────────────┐
                        │            API Gateway (BFF)             │
                        │  auth verify · routing · rate limit      │
                        └───┬─────────┬──────────┬────────┬────────┘
                            │         │          │        │
              ┌─────────────▼──┐  ┌───▼──────┐  ┌▼────────▼────┐  ┌───────────────┐
              │  auth-service  │  │ jobs-svc │  │ resume-svc   │  │   ai-service  │
              │  users, JWT    │  │ pipeline │  │ base+tailored│  │ generate work │
              └───────┬────────┘  └────┬─────┘  └─────┬────────┘  └───┬───────┬───┘
                      │                │              │               │       │
                 ┌────▼────┐      ┌────▼────┐    ┌────▼────┐     ┌────▼──┐ ┌──▼────────┐
                 │ pg:auth │      │ pg:jobs │    │ pg:resume│    │ Redis │ │ Anthropic │
                 └─────────┘      └─────────┘    │  +MinIO  │    │ queue │ │    API    │
                                                 └──────────┘    └───────┘ └───────────┘
```

**Shared infrastructure (local, via Docker):** PostgreSQL, Redis (cache + BullMQ queue), MinIO (S3-compatible object storage for resume files/PDFs).

---

## 2. Services & responsibilities

| Service | Responsibility | Owns | Talks to |
|---|---|---|---|
| **web** | React SPA. All UI. No secrets. | — | gateway |
| **gateway** (BFF) | Single entry point. Verifies JWT, injects `X-User-Id` header downstream, routes, applies rate limits, aggregates where convenient. | — | all services |
| **auth-service** | Register / login, password hashing (argon2), issues + refreshes JWT, exposes JWKS/verify. | `users` | pg |
| **jobs-service** | Job CRUD, pipeline **stage transitions + timestamped history**, notes, and storage of **research** and **interview-prep** artifacts attached to a job. | `jobs`, `stage_events`, `job_artifacts` | pg, ai-service (request generation) |
| **resume-service** | Base resume storage, **tailored resume versions** (immutable, versioned), file uploads/downloads (PDF/DOCX) to object storage. | `base_resumes`, `tailored_resumes`, `resume_files` | pg, MinIO, ai-service |
| **ai-service** | The only service holding `ANTHROPIC_API_KEY`. Runs generation jobs (company research w/ web search, interview prep, resume tailoring) as **async queue workers**. Stateless except for a task-tracking table. | `generation_tasks` | Redis (queue), Anthropic API |

**Design decision — where generated content lives:** the AI service *produces* text but does **not** own domain content. Research/prep are stored by `jobs-service` as `job_artifacts`; tailored resumes by `resume-service`. The AI service only tracks task status + returns the payload. This keeps domain data with its domain owner and lets you retire/replace the AI service without data migration.

---

## 3. Tech stack (opinionated, pick-and-swap)

Chosen to minimize context-switching for a solo dev and to be very implementable by Claude Code.

- **Language:** TypeScript everywhere (Node 20+). One language = shared types package, less friction.
  - *Alt:* make `ai-service` Python/FastAPI if you prefer — it's a clean seam. The rest stays TS.
- **Web:** React 18 + Vite + TypeScript. React Router. TanStack Query for server state. Plain CSS or Tailwind (your call).
- **Backend services:** [NestJS](https://nestjs.com) (structured, DI, easy to keep boundaries clean) **or** Express + Zod if you want lighter. This plan assumes **NestJS**.
- **DB access / migrations:** [Prisma](https://www.prisma.io) — one schema file per service, `prisma migrate` on boot.
- **Queue:** [BullMQ](https://docs.bullmq.io) on Redis.
- **Object storage:** MinIO locally (S3 API), swap for real S3 in prod via env.
- **AI:** Official `@anthropic-ai/sdk`. Use the **Messages API** with the **web search tool** for company research. Model is an env var (see §6). Default suggestions as of 2026: a Sonnet-class model for generation, a Haiku-class model for cheap tasks — **check current model strings at https://docs.claude.com/en/docs/about-claude/models/overview since these rotate.**
- **Auth:** JWT (access ~15min + refresh ~7d), argon2 password hashing.
- **Local orchestration:** Docker Compose. Optional [Traefik](https://traefik.io) as reverse proxy so everything is one hostname; Nginx is fine too.
- **Monorepo:** pnpm workspaces + [Turborepo](https://turbo.build) for task caching.

---

## 4. Repository layout

```
job-hunt-portal/
├── docker-compose.yml
├── docker-compose.override.yml        # dev-only: hot reload, source mounts
├── .env.example
├── Makefile
├── turbo.json
├── pnpm-workspace.yaml
├── packages/
│   ├── shared-types/                  # DTOs, enums (Stage), zod schemas — imported by all
│   ├── http-client/                   # typed inter-service client + auth header helper
│   └── logger/                        # structured JSON logger
├── services/
│   ├── gateway/
│   │   ├── Dockerfile
│   │   └── src/
│   ├── auth-service/
│   │   ├── Dockerfile
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   ├── jobs-service/
│   │   ├── Dockerfile
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   ├── resume-service/
│   │   ├── Dockerfile
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   └── ai-service/
│       ├── Dockerfile
│       ├── prisma/schema.prisma
│       └── src/ (api/ + workers/)
└── apps/
    └── web/
        ├── Dockerfile
        └── src/
```

---

## 5. Data models (Prisma-style, per service)

### auth-service
```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}
```

### jobs-service
```prisma
enum Stage { SAVED APPLIED RECRUITER_CALL PHONE_SCREEN TECHNICAL ONSITE OFFER REJECTED }

model Job {
  id        String   @id @default(uuid())
  userId    String                 // from X-User-Id, indexed
  company   String
  title     String
  location  String?
  link      String?
  jd        String   @db.Text
  notes     String   @db.Text @default("")
  stage     Stage    @default(SAVED)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events    StageEvent[]
  artifacts JobArtifact[]
  @@index([userId])
}

model StageEvent {
  id     String   @id @default(uuid())
  jobId  String
  stage  Stage
  at     DateTime @default(now())
  job    Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
}

enum ArtifactType { RESEARCH INTERVIEW_PREP }

model JobArtifact {
  id        String       @id @default(uuid())
  jobId     String
  type      ArtifactType
  content   String       @db.Text
  createdAt DateTime     @default(now())
  job       Job          @relation(fields: [jobId], references: [id], onDelete: Cascade)
  @@unique([jobId, type])   // one current research + one current prep per job
}
```

### resume-service
```prisma
model BaseResume {
  id        String   @id @default(uuid())
  userId    String   @unique
  content   String   @db.Text
  updatedAt DateTime @updatedAt
}

model TailoredResume {
  id           String   @id @default(uuid())
  userId       String
  jobId        String                 // which job this was tailored for
  version      Int                    // incrementing per (userId, jobId)
  gapAnalysis  String   @db.Text
  content      String   @db.Text
  createdAt    DateTime @default(now())
  @@index([userId, jobId])
}

model ResumeFile {
  id           String   @id @default(uuid())
  userId       String
  jobId        String?
  filename     String
  contentType  String
  objectKey    String                 // MinIO/S3 key
  createdAt    DateTime @default(now())
}
```

### ai-service
```prisma
enum TaskType   { RESEARCH INTERVIEW_PREP RESUME_TAILOR }
enum TaskStatus { QUEUED RUNNING SUCCEEDED FAILED }

model GenerationTask {
  id        String     @id @default(uuid())
  userId    String
  type      TaskType
  status    TaskStatus @default(QUEUED)
  input     Json                       // { jobId, jd, baseResume?, ... }
  result    String?    @db.Text
  error     String?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  @@index([userId])
}
```

---

## 6. Environment variables (`.env.example`)

```dotenv
# --- shared ---
NODE_ENV=development
JWT_SECRET=change-me-to-a-long-random-string
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800

# --- postgres (one instance, one DB per service) ---
POSTGRES_USER=portal
POSTGRES_PASSWORD=portal
AUTH_DATABASE_URL=postgresql://portal:portal@postgres:5432/auth
JOBS_DATABASE_URL=postgresql://portal:portal@postgres:5432/jobs
RESUME_DATABASE_URL=postgresql://portal:portal@postgres:5432/resume
AI_DATABASE_URL=postgresql://portal:portal@postgres:5432/ai

# --- redis ---
REDIS_URL=redis://redis:6379

# --- object storage (MinIO) ---
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=resumes
S3_FORCE_PATH_STYLE=true

# --- ai-service (ONLY place the key lives) ---
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL_GENERATION=<current Sonnet-class model id>
AI_MODEL_CHEAP=<current Haiku-class model id>

# --- service discovery (compose DNS names) ---
AUTH_SERVICE_URL=http://auth-service:3001
JOBS_SERVICE_URL=http://jobs-service:3002
RESUME_SERVICE_URL=http://resume-service:3003
AI_SERVICE_URL=http://ai-service:3004
```

> Keep `ANTHROPIC_API_KEY` **out of the gateway and web**. Only `ai-service` reads it. This is the single biggest security upgrade over the browser-based prototype, where the key would be exposed client-side.

---

## 7. API contracts

All routes go through the gateway at `/api`. Gateway verifies the JWT, then forwards to the service with header `X-User-Id`. **Downstream services trust `X-User-Id` and never accept it from the outside world** (gateway strips any inbound copy).

### auth-service
```
POST /auth/register      { email, password }            -> { user, accessToken, refreshToken }
POST /auth/login         { email, password }            -> { accessToken, refreshToken }
POST /auth/refresh       { refreshToken }               -> { accessToken }
GET  /auth/me            (Bearer)                        -> { user }
```

### jobs-service  (all require X-User-Id)
```
GET    /jobs                                    -> Job[]   (user's jobs, newest first)
POST   /jobs             { company, title, ... } -> Job
GET    /jobs/:id                                 -> Job (with events + artifacts)
PATCH  /jobs/:id         { ...editable fields }  -> Job
DELETE /jobs/:id                                 -> 204
POST   /jobs/:id/stage   { stage }               -> Job   (appends StageEvent)
GET    /jobs/:id/artifacts/:type                 -> JobArtifact
PUT    /jobs/:id/artifacts/:type { content }     -> JobArtifact   (upsert; called after AI completes)
```

### resume-service
```
GET  /resume/base                                -> BaseResume
PUT  /resume/base        { content }             -> BaseResume
GET  /resume/tailored?jobId=                     -> TailoredResume[]  (version history)
POST /resume/tailored    { jobId, gapAnalysis, content } -> TailoredResume (version++)
POST /resume/files       (multipart)             -> ResumeFile   (upload to MinIO)
GET  /resume/files/:id                           -> signed download URL
```

### ai-service
```
POST /ai/tasks     { type, input }   -> { taskId, status: "QUEUED" }
GET  /ai/tasks/:id                   -> GenerationTask (poll for status + result)
```
`type` ∈ `RESEARCH | INTERVIEW_PREP | RESUME_TAILOR`. Gateway/clients **poll** `GET /ai/tasks/:id` until `SUCCEEDED`/`FAILED`, or subscribe via SSE (optional, §8).

---

## 8. Async AI flow (the important part)

Because generations are slow and rate-limited, they run through a queue instead of blocking an HTTP request.

**Sequence — "Research this company":**
1. Web → `POST /api/ai/tasks { type: RESEARCH, input: { jobId, jd, company, title } }`.
2. `ai-service` inserts a `GenerationTask (QUEUED)`, enqueues a BullMQ job, returns `{ taskId }` immediately.
3. A **worker** picks it up, sets `RUNNING`, calls the Anthropic Messages API with the **web search tool** enabled, sets `SUCCEEDED` + `result`.
4. Web polls `GET /api/ai/tasks/:taskId` (e.g. every 2s) until done.
5. On success, web calls `PUT /api/jobs/:jobId/artifacts/RESEARCH { content: result }` so the domain owns the output. (Or: ai-service emits a `generation.succeeded` event and jobs-service persists — pick one; polling+PUT is simpler to start.)

**Prompt/config specifics** (port these from the prototype — they already work):
- **Research:** system = research analyst; enable web search tool; ask for `## What they do / ## Recent news / ## Culture & values / ## Smart questions to ask`.
- **Interview prep:** likely behavioral (STAR outlines) + technical questions w/ sample answers + role-specific watch-outs + recruiter-call cheat sheet, grounded in the JD.
- **Resume tailoring:** system enforces *"never invent experience — only reframe/reorder/reword"*; output `## Gap analysis` then `## Tailored resume`. Inputs = base resume + JD.

**Guardrails to add for production:**
- Concurrency limit on the worker (e.g. 2–3) to respect API rate limits; BullMQ `limiter`.
- Retry with backoff on 429/5xx; mark `FAILED` with a user-friendly message after N attempts.
- Truncate JD/resume inputs to sane token budgets.
- Per-user daily generation cap (store counter in Redis) to bound cost.

**Optional:** replace polling with **Server-Sent Events** (`GET /api/ai/tasks/:id/stream`) for instant updates.

---

## 9. Docker: running it all locally

### `docker-compose.yml` (services list — Claude Code fills details)
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data, ./infra/initdb:/docker-entrypoint-initdb.d]
    # initdb script creates the 4 databases: auth, jobs, resume, ai
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"], interval: 5s, retries: 10 }

  redis:
    image: redis:7
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, retries: 10 }

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: ${S3_ACCESS_KEY}, MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY} }
    ports: ["9000:9000", "9001:9001"]     # 9001 = web console
    volumes: [miniodata:/data]

  auth-service:
    build: ./services/auth-service
    env_file: .env
    depends_on: { postgres: { condition: service_healthy } }

  jobs-service:
    build: ./services/jobs-service
    env_file: .env
    depends_on: { postgres: { condition: service_healthy }, ai-service: { condition: service_started } }

  resume-service:
    build: ./services/resume-service
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      minio:    { condition: service_started }

  ai-service:
    build: ./services/ai-service
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }

  gateway:
    build: ./services/gateway
    env_file: .env
    ports: ["8080:8080"]
    depends_on: [auth-service, jobs-service, resume-service, ai-service]

  web:
    build: ./apps/web
    ports: ["5173:5173"]
    environment: { VITE_API_BASE: "http://localhost:8080/api" }
    depends_on: [gateway]

volumes:
  pgdata:
  miniodata:
```

### `docker-compose.override.yml` (dev hot reload)
- Mount each service's `./src` into the container.
- Run `nest start --watch` / `vite` instead of the production build.
- This file is picked up automatically by `docker compose up`, so **dev = hot reload, prod build = `docker compose -f docker-compose.yml up`**.

### One-command start (`Makefile`)
```makefile
up:        ## start everything with hot reload
	docker compose up --build

migrate:   ## run all prisma migrations
	docker compose exec auth-service   npx prisma migrate deploy
	docker compose exec jobs-service   npx prisma migrate deploy
	docker compose exec resume-service npx prisma migrate deploy
	docker compose exec ai-service     npx prisma migrate deploy

seed:      ## optional demo user + sample jobs
	docker compose exec jobs-service npm run seed

down:
	docker compose down

reset:     ## nuke volumes (fresh DB)
	docker compose down -v
```

**Developer first-run:**
```bash
cp .env.example .env      # then paste your ANTHROPIC_API_KEY
make up                   # build + start; wait for healthchecks
make migrate              # create tables
open http://localhost:5173
```

### Modular Monolith Fallback (the escape hatch)
If the compose sprawl isn't worth it: keep `packages/` and the per-service *modules*, but mount them into **one** NestJS app that imports all four domain modules and shares a single Postgres schema. Compose then runs just `web`, `api` (the monolith), `postgres`, `redis`, `minio`. The AI queue/worker can still run in-process. You lose independent scaling but keep every line of business logic. Because boundaries were respected (no cross-module DB reads, DTOs in `shared-types`), splitting back out later is mechanical.

---

## 10. Cross-cutting concerns

- **Auth propagation:** gateway verifies JWT → sets `X-User-Id` → services authorize every query by `userId`. Never expose one user's data to another; add `WHERE userId = ...` to every query.
- **Validation:** Zod schemas in `shared-types`, used both client- and server-side.
- **Errors:** consistent JSON `{ error: { code, message } }`; gateway maps to HTTP status.
- **Health/readiness:** every service `GET /health` (liveness) + `GET /ready` (DB reachable). Compose healthchecks gate `depends_on`.
- **Logging:** structured JSON to stdout (`packages/logger`), include `requestId` + `userId`.
- **Secrets:** only in `.env` locally; never commit it (`.gitignore`). `ANTHROPIC_API_KEY` restricted to `ai-service`.
- **Testing:** unit tests per service (Jest); one integration test that spins compose + hits the gateway end-to-end (`stage transition`, `generate research`).
- **Migrations run on deploy**, not on every boot in prod.

---

## 11. Phased build plan (hand these to Claude Code one at a time)

Each phase ends with a **runnable, demoable** state. Do them in order.

### Phase 0 — Scaffold & infra (no business logic)
- Monorepo: pnpm workspaces + Turborepo. `packages/shared-types`, `packages/logger`, `packages/http-client`.
- `docker-compose.yml` + override with **postgres, redis, minio only**; verify healthchecks pass.
- initdb script creating the 4 databases. `Makefile` with `up/down/reset`.
- **Done when:** `make up` brings up infra healthy; MinIO console reachable at :9001.

### Phase 1 — Auth + Gateway + Web shell
- `auth-service`: register/login/refresh/me, argon2, JWT, Prisma `User`.
- `gateway`: JWT verify middleware, proxy routing skeleton, `X-User-Id` injection, strips inbound `X-User-Id`.
- `web`: Vite React app, login/register screens, TanStack Query, auth token storage (in memory + refresh), protected route shell.
- **Done when:** you can register, log in, and see an empty authenticated dashboard.

### Phase 2 — Jobs service + pipeline UI
- `jobs-service`: full Job CRUD, `POST /jobs/:id/stage` appends `StageEvent`, artifacts upsert endpoints.
- `web`: job list with the **stage rail**, add-job form, job detail page with stage dropdown + timestamped history, notes + JD editing. (Port the prototype's visuals.)
- **Done when:** you can add jobs, move them through stages, and see history persist across restarts.

### Phase 3 — Resume service + object storage
- `resume-service`: base resume get/put; tailored resume versioning; file upload/download via MinIO with signed URLs.
- `web`: base-resume editor (settings), tailored-resume version list per job, file upload/download UI.
- **Done when:** base resume persists; you can upload a PDF and download it back.

### Phase 4 — AI service (the payoff)
- `ai-service`: `GenerationTask` model, `POST /ai/tasks` + `GET /ai/tasks/:id`, BullMQ queue + worker, Anthropic SDK integration with web search for research. Port the three prompts.
- Worker concurrency limit, retry/backoff, per-user daily cap in Redis.
- `web`: on each job — "Research", "Interview prep", "Tailor resume" buttons that create a task, poll for completion, then persist the result to jobs-service (research/prep) or resume-service (tailored). Loading + error states.
- **Done when:** clicking "Research this company" produces a live, web-searched brief saved to the job; tailoring produces a gap analysis + rewritten resume saved as a new version.

### Phase 5 — Hardening
- SSE for task updates (replace polling), integration test through the gateway, rate limiting at gateway, basic observability (request logs + a `/metrics` endpoint if you want Prometheus later), README with the run instructions.
- **Done when:** `make up && make migrate` from a clean checkout yields a working app, and the end-to-end integration test passes.

---

## 12. What NOT to build yet (avoid scope creep)
- Kubernetes / service mesh / Kafka — none of it is needed to run or learn this locally. Compose is enough until you have real traffic.
- A separate "notifications" or "analytics" service — fold into jobs-service if you ever need it.
- Auto-submitting applications to LinkedIn/company ATS portals — this is brittle, often against ToS, and not something to design around. Keep submission a manual step: tailor in-app → copy/download → apply yourself → flip stage to `Applied`.

---

## 13. Handoff prompt for Claude Code

> Paste something like this to start:
>
> *"Implement Phase 0 of the attached `job-hunt-portal-ARCHITECTURE.md`: set up a pnpm + Turborepo monorepo with the described layout, the `shared-types`/`logger`/`http-client` packages, and a `docker-compose.yml` + override that starts postgres, redis, and minio with passing healthchecks and an initdb script creating the auth/jobs/resume/ai databases. Add the Makefile targets. Stop after Phase 0 so I can verify `make up` before we continue."*
>
> Then proceed phase by phase, verifying each is runnable before moving on.
