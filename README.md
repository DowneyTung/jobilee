# Jobilee

Multi-user job-hunting portal: track applications through a pipeline, generate AI
company research / interview prep / tailored resumes, and version resumes.
Runs entirely locally with Docker Compose.

Design and phased plan: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Monorepo scaffold, shared packages, infra (postgres/redis/minio) | ✅ done |
| 1 | auth-service, gateway, web shell | ✅ done |
| 2 | jobs-service + pipeline UI | ✅ done |
| 3 | resume-service + object storage | ✅ done |
| 4 | ai-service (queue, workers, Anthropic) | ✅ done |
| — | Test suite: unit, integration, browser E2E, mocked Anthropic API | ✅ done |
| 5 | Hardening (SSE, gateway rate limiting, observability) | ⏳ next |

## Quick start

```bash
cp .env.example .env      # then add your ANTHROPIC_API_KEY (only ai-service reads it)
make install              # corepack enable + pnpm install
make up                   # build + start everything (Ctrl-C to stop); or: make up-d
make migrate              # create tables
make health               # blocks until every service reports healthy
```

Then:
- App — http://localhost:5173
- Gateway — http://localhost:8080 (`/health`, `/ready`)
- MinIO console — http://localhost:9001 (`minioadmin` / `minioadmin`)
- Postgres — `localhost:5432`, user `jobilee`, databases `auth` `jobs` `resume` `ai`
- Redis — `localhost:6379`

## Make targets

| Target | What it does |
|---|---|
| `make up` / `make up-d` | start the stack (foreground / detached) |
| `make down` | stop containers, keep data |
| `make reset` | stop **and delete volumes** — fresh DB and object store |
| `make health` | wait for healthchecks, print connection info |
| `make logs s=postgres` | tail logs (all services if `s` is omitted) |
| `make psql db=jobs` | psql shell into one of the service databases |
| `make redis-cli` | redis shell |
| `make install` / `build` / `typecheck` | workspace tasks via Turborepo |
| `make test` | unit tests (fast, no services needed) |
| `make test-stack` / `test-stack-down` | the stack with a mocked Anthropic API |
| `make test-integration` / `test-e2e` / `test-all` | the other two layers |

## Layout

```
packages/
  shared-types/   DTOs, enums (Stage, TaskType…), zod schemas — used client- and server-side
  logger/         dependency-free structured JSON logger, child bindings, secret redaction
  http-client/    typed inter-service client: X-User-Id propagation, retries, schema validation
services/         gateway, auth-service, jobs-service, resume-service, ai-service (phases 1–4)
apps/web/         React + Vite SPA (phase 1+)
tests/
  mock-anthropic/ a stand-in Messages API, so AI paths are testable without a key
  integration/    service-level tests through the gateway
  e2e/            Playwright browser tests
infra/
  initdb/         postgres bootstrap — creates the four service databases
  scripts/        healthcheck waiter used by `make health`
```

## Conventions

- **One database per service.** No cross-service table reads; services talk over
  HTTP or the BullMQ queue.
- **Identity flows in a header.** The gateway verifies the JWT, strips any inbound
  `X-User-Id`, and injects a trusted one. Services scope every query by it.
- **Errors** are `{ error: { code, message } }`; `code` maps to an HTTP status via
  `ERROR_STATUS` in `@jobilee/shared-types`.
- **Logs** are JSON on stdout, carrying `requestId` and `userId`.
- **`ANTHROPIC_API_KEY` lives only in `ai-service`.** Never in the gateway or web.
- **Secrets stay in `.env`**, which is gitignored. `.env.example` is the template.

## Testing

Three layers, each with a different job.

| Layer | Command | Needs | What it covers |
|---|---|---|---|
| **Unit** (70) | `make test` | nothing | Pure logic: token issue/verify, gateway routing and header stripping, prompt construction, retry classification, env parsing, the shared packages. Runs in ~2s. |
| **Integration** (36) | `make test-stack` then `make test-integration` | the test stack | Every service through the gateway with real Postgres, Redis, and MinIO — auth flows, tenant isolation, the pipeline, signed-URL downloads, and the whole AI task lifecycle. |
| **E2E** (22) | `make test-stack` then `make test-e2e` | the test stack + Chromium | The browser: register, move a job through stages, generate, upload and download a file, and the failure states. |

`make test-all` runs all three, starting and stopping the stack around them.

### Testing the AI without an API key

`make test-stack` swaps in a **mock Anthropic API** (`tests/mock-anthropic`) and points
ai-service at it with `ANTHROPIC_BASE_URL`. It speaks the real Messages API SSE wire
protocol, so the actual SDK, the actual streaming parser, and our actual
`pause_turn` / refusal / retry code all run — a stubbed client would skip exactly
the code most likely to be wrong.

Tests drive it through a control endpoint:

```
POST   /__control  {"scenario": "pause_then_success"}
GET    /__requests     # what ai-service actually sent
DELETE /__requests
```

Scenarios: `success`, `pause_then_success`, `refusal`, `rate_limit_once`,
`auth_error`, `server_error`, `truncated`, `empty`. `/__requests` is what lets tests
assert on the request itself — that research declares the web search tool and
interview prep does not, that no sampling parameters are sent, that the
no-invention rule reaches the model, and that an oversized job description is
truncated before it costs tokens.

No real key, no spend, no 40-second waits.

## Security

This repo is public. The rules that keep it safe to be public:

- **No secrets in git, ever.** `.env` is gitignored; `.env.example` is a template
  holding placeholders and throwaway local defaults, never real values. If you
  ever commit a live key, treat it as burned — rotate it, don't just delete the
  line, because git history and GitHub's index keep it.
- **The credentials in `.env.example` are dev-only.** `jobilee/jobilee` and
  `minioadmin/minioadmin` exist so `make up` works with zero setup. Anything
  deployed off this repo needs real secrets from a secret manager, starting with
  a generated `JWT_SECRET` (`openssl rand -base64 48`).
- **Infra ports bind to `127.0.0.1`.** Postgres, Redis, and MinIO are reachable
  from your machine only, not from your network.
- **Your data never enters the repo.** Postgres/Redis/MinIO write to Docker named
  volumes (`pgdata`, `redisdata`, `miniodata`), which live in Docker's storage
  outside this directory. Nothing in the repo is a writable bind mount. Seed data
  must be fictional — no real applications, resumes, or employer names.
- **`ANTHROPIC_API_KEY` is confined to `ai-service`** and is never sent to the
  browser or the gateway.

## Notes

- Compose reads `docker-compose.override.yml` automatically, which publishes
  postgres/redis to the host for local tooling. For a prod-shaped run:
  `docker compose -f docker-compose.yml up`.
- `infra/initdb` runs **only against an empty data directory**. After changing it,
  `make reset` to re-bootstrap.
- Relative imports in TypeScript sources use `.ts` extensions (Node's native type
  stripping wants them); `rewriteRelativeImportExtensions` converts them on build.
