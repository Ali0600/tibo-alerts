FROM node:24.20.0-bookworm@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build:node && npm run verify:bundle

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS app
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/tibo.sqlite MIGRATIONS_PATH=/app/drizzle
COPY --from=build --chown=node:node /app/dist/standalone/ ./
COPY --from=build --chown=node:node /app/drizzle/ ./drizzle/
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

FROM dependencies AS reader-build
COPY scripts/source-check.mjs scripts/setup-source.mjs ./scripts/
RUN npm run source:setup
COPY worker/ ./worker/
COPY core/ ./core/
RUN node scripts/source-check.mjs --smoke

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS worker
WORKDIR /app
# Git verifies the installed source revision at every scan; no fetch occurs at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=reader-build --chown=node:node /app/ ./
ENV NODE_ENV=production RSSHUB_PATH=/app/.source-reader
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "worker/run.ts", "--loop"]
