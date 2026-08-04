# Test-only: a stand-in Anthropic Messages API. Never part of the prod stack.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tests/mock-anthropic/package.json tests/mock-anthropic/
RUN pnpm install --frozen-lockfile --filter @jobilee/mock-anthropic...
COPY tsconfig.base.json ./
COPY tests/mock-anthropic tests/mock-anthropic
RUN pnpm --filter @jobilee/mock-anthropic run build

FROM build AS runner
WORKDIR /app/tests/mock-anthropic
EXPOSE 4010
CMD ["node", "dist/main.js"]
