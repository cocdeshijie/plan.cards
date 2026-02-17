FROM alpine:3.20 AS git-hash
RUN apk add --no-cache git
COPY .git /repo/.git
WORKDIR /repo
RUN git rev-parse --short HEAD > /commit-hash 2>/dev/null || echo "dev" > /commit-hash

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
COPY --from=git-hash /commit-hash /tmp/commit-hash
ARG BACKEND_URL=http://backend:8000
ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_URL=${BACKEND_URL}
RUN export NEXT_PUBLIC_COMMIT_HASH=$(cat /tmp/commit-hash) && npx next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./

USER nextjs
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
