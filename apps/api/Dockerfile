FROM node:20-alpine AS base
RUN corepack enable
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS builder
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ziradesk/api exec prisma generate
RUN pnpm --filter @ziradesk/shared build
RUN pnpm --filter @ziradesk/api build
RUN rm -rf /app/deploy
RUN pnpm --filter @ziradesk/api --prod deploy /app/deploy
RUN prisma_build_dir="$(find /app/node_modules/.pnpm -maxdepth 1 -type d -name '@prisma+client@*' | head -n 1)" \
  && prisma_deploy_dir="$(find /app/deploy/node_modules/.pnpm -maxdepth 1 -type d -name '@prisma+client@*' | head -n 1)" \
  && test -n "$prisma_build_dir" \
  && test -n "$prisma_deploy_dir" \
  && mkdir -p "$prisma_deploy_dir/node_modules/.prisma" \
  && cp -R "$prisma_build_dir/node_modules/.prisma/." "$prisma_deploy_dir/node_modules/.prisma/"

FROM base AS runtime
WORKDIR /app
COPY --from=builder /app/deploy ./
COPY --from=builder /app/apps/api/prisma ./prisma
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3333/health || exit 1
CMD ["node", "dist/server.js"]
