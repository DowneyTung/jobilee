# Build context is the repo root.
#   docker build -f services/gateway/Dockerfile .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/logger/package.json packages/logger/
COPY packages/http-client/package.json packages/http-client/
COPY services/gateway/package.json services/gateway/
RUN pnpm install --frozen-lockfile --filter @jobilee/gateway...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY services/gateway services/gateway
RUN pnpm --filter @jobilee/shared-types --filter @jobilee/logger run build \
  && pnpm --filter @jobilee/gateway run build

FROM build AS dev
ENV NODE_ENV=development
WORKDIR /app/services/gateway
EXPOSE 8080
CMD ["pnpm", "run", "dev"]

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/services/gateway
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
