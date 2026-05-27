FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
ARG VITE_API_URL=https://api.ziradesk.com.br
ARG VITE_SOCKET_URL=https://api.ziradesk.com.br
ARG VITE_APP_URL=https://app.ziradesk.com.br

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}
ENV VITE_APP_URL=${VITE_APP_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @ziradesk/shared build
RUN pnpm --filter @ziradesk/web build

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
