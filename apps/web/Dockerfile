# Build context is the repo root.
#   docker build -f apps/web/Dockerfile .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/logger/package.json packages/logger/
COPY packages/http-client/package.json packages/http-client/
COPY packages/service-kit/package.json packages/service-kit/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @jobilee/web...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
# VITE_* values are inlined at build time, not read at runtime, so the API base
# has to be known here.
ARG VITE_API_BASE=http://localhost:8080/api
ENV VITE_API_BASE=$VITE_API_BASE
# `...` builds the package and its dependencies, in topological order.
RUN pnpm --filter @jobilee/web... run build

FROM build AS dev
ENV NODE_ENV=development
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["pnpm", "run", "dev"]

# Serves the built bundle with Vite's static preview server. Fine for local use;
# swap for nginx or a CDN when this is deployed anywhere real.
FROM build AS runner
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["pnpm", "run", "preview"]
