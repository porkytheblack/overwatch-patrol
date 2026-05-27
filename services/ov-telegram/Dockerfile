FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=60000 \
    npm_config_fetch_retry_maxtimeout=600000 \
    npm_config_network_timeout=600000
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json .npmrc ./
COPY packages ./packages
COPY services/ov-telegram ./services/ov-telegram
RUN pnpm install --frozen-lockfile=false \
 || (echo '↻ retry 1' && pnpm install --frozen-lockfile=false) \
 || (echo '↻ retry 2' && pnpm install --frozen-lockfile=false)
RUN pnpm -F @overwatch/schemas build \
 && pnpm -F @overwatch/shared-ts build \
 && pnpm -F @overwatch/telegram build

FROM base AS runner
WORKDIR /repo/services/ov-telegram
COPY --from=builder /repo /repo
EXPOSE 7100
CMD ["node", "dist/index.js"]
