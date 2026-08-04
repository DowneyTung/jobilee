# Build context is the repo root — a workspace package can't be built without
# the lockfile and the packages it depends on.
#   docker build -f services/jobs-service/Dockerfile .

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
COPY services/jobs-service/package.json services/jobs-service/
RUN pnpm install --frozen-lockfile --filter @jobilee/jobs-service...

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY services/jobs-service services/jobs-service
RUN pnpm --filter @jobilee/shared-types --filter @jobilee/logger --filter @jobilee/service-kit run build \
  && pnpm --filter @jobilee/jobs-service run build

# ---- dev --------------------------------------------------------------------
# Used by docker-compose.override.yml, which mounts source over /app and runs
# the watch task. Keeps devDependencies (typescript, prisma CLI).
FROM build AS dev
ENV NODE_ENV=development
# Same workdir as the runner stage, so `prisma` and `npm` commands run through
# `docker compose exec` find the schema either way.
WORKDIR /app/services/jobs-service
EXPOSE 3002
CMD ["pnpm", "run", "dev"]

# ---- production -------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/services/jobs-service
EXPOSE 3002
USER node
CMD ["node", "dist/main.js"]
