FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS builder
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY services/ov-telegram ./services/ov-telegram
RUN pnpm install --frozen-lockfile=false
RUN pnpm -F @overwatch/schemas build && pnpm -F @overwatch/shared-ts build && pnpm -F @overwatch/telegram build

FROM base AS runner
WORKDIR /repo/services/ov-telegram
COPY --from=builder /repo /repo
CMD ["node", "dist/index.js"]
