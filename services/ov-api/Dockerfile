FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS builder
# Native build deps for better-sqlite3 / argon2
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY services/ov-api ./services/ov-api
RUN pnpm install --frozen-lockfile=false
RUN pnpm -F @overwatch/schemas build \
 && pnpm -F @overwatch/shared-ts build \
 && pnpm -F @overwatch/api build

FROM base AS runner
WORKDIR /app
COPY --from=builder /repo /repo
WORKDIR /repo/services/ov-api
EXPOSE 3000
CMD ["node", "dist/index.js"]
