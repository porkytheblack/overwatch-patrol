FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS builder
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=60000 \
    npm_config_fetch_retry_maxtimeout=600000 \
    npm_config_network_timeout=600000
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json .npmrc ./
COPY packages ./packages
COPY services/ov-dashboard ./services/ov-dashboard
RUN pnpm install --frozen-lockfile=false \
 || (echo '↻ retry 1' && pnpm install --frozen-lockfile=false) \
 || (echo '↻ retry 2' && pnpm install --frozen-lockfile=false)
RUN pnpm -F @overwatch/schemas build && pnpm -F @overwatch/shared-ts build
WORKDIR /repo/services/ov-dashboard
RUN pnpm build

FROM base AS runner
WORKDIR /app
COPY --from=builder /repo/services/ov-dashboard/.next/standalone /app
COPY --from=builder /repo/services/ov-dashboard/.next/static /app/services/ov-dashboard/.next/static
COPY --from=builder /repo/services/ov-dashboard/public /app/services/ov-dashboard/public
EXPOSE 3000
WORKDIR /app/services/ov-dashboard
CMD ["node", "server.js"]
