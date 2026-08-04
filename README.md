# Jobilee

Multi-user job-hunting portal: track applications through a pipeline, generate AI
company research / interview prep / tailored resumes, and version resumes.
Runs entirely locally with Docker Compose.

Design and phased plan: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Monorepo scaffold, shared packages, infra (postgres/redis/minio) | ✅ done |
| 1 | auth-service, gateway, web shell | ⏳ next |
| 2 | jobs-service + pipeline UI | — |
| 3 | resume-service + object storage | — |
| 4 | ai-service (queue, workers, Anthropic) | — |
| 5 | Hardening (SSE, integration test, rate limits) | — |

## Quick start

```bash
cp .env.example .env      # then paste your ANTHROPIC_API_KEY (needed from Phase 4)
make install              # corepack enable + pnpm install
make up                   # build + start infra (Ctrl-C to stop); or: make up-d
make health               # blocks until postgres/redis/minio report healthy
```

Then:
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
| `make install` / `build` / `typecheck` / `test` | workspace tasks via Turborepo |

## Layout

```
packages/
  shared-types/   DTOs, enums (Stage, TaskType…), zod schemas — used client- and server-side
  logger/         dependency-free structured JSON logger, child bindings, secret redaction
  http-client/    typed inter-service client: X-User-Id propagation, retries, schema validation
services/         gateway, auth-service, jobs-service, resume-service, ai-service (phases 1–4)
apps/web/         React + Vite SPA (phase 1+)
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
