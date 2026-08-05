# Build context is the repo root — a workspace package can't be built without
# the lockfile and the packages it depends on.
#   docker build -f services/resume-service/Dockerfile .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# openssl: Prisma's query engine links against it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
# Only manifests here, so this layer is cached until a dependency actually
# changes — editing source doesn't trigger a reinstall.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/logger/package.json packages/logger/
COPY packages/http-client/package.json packages/http-client/
COPY packages/service-kit/package.json packages/service-kit/
COPY services/resume-service/package.json services/resume-service/
RUN pnpm install --frozen-lockfile --filter @jobilee/resume-service...

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY services/resume-service services/resume-service
# `...` builds the package and its dependencies, in topological order.
# An enumerated list of packages goes stale the moment a service gains a
# new workspace dependency.
RUN pnpm --filter @jobilee/resume-service... run build

# ---- dev --------------------------------------------------------------------
# Used by docker-compose.override.yml, which mounts source over /app and runs
# the watch task. Keeps devDependencies (typescript, prisma CLI).
FROM build AS dev
ENV NODE_ENV=development
# Same workdir as the runner stage, so `prisma` and `npm` commands run through
# `docker compose exec` find the schema either way.
WORKDIR /app/services/resume-service
EXPOSE 3003
CMD ["pnpm", "run", "dev"]

# ---- production -------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/services/resume-service
EXPOSE 3003
USER node
CMD ["node", "dist/main.js"]
