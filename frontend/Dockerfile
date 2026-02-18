FROM alpine:3.19 AS git-info
RUN apk add --no-cache git
WORKDIR /repo
COPY .git* ./
RUN git rev-parse --short HEAD 2>/dev/null > /git-hash.txt || echo "" > /git-hash.txt

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
COPY --from=git-info /git-hash.txt /tmp/git-hash.txt
ARG COMMIT_HASH=
ARG SOURCE_COMMIT=
ARG BACKEND_URL=http://backend:8000
ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_URL=${BACKEND_URL}
RUN GIT_HASH=$(cat /tmp/git-hash.txt | tr -d '\n') && \
    export NEXT_PUBLIC_COMMIT_HASH="${GIT_HASH:-${SOURCE_COMMIT:-${COMMIT_HASH}}}" && \
    npx next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs frontend/docker-entrypoint.sh ./

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
