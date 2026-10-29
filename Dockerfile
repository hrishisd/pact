# syntax=docker/dockerfile:1
# One image: the Node server (TypeScript run directly with type stripping),
# the built SPA, and Litestream, which restores and replicates /data/pact.db.

ARG NODE_VERSION=24.22.2
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d

# ---- build the client ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- production dependencies only ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- litestream, pinned and checksummed ----
FROM debian:bookworm-slim AS litestream
ARG LITESTREAM_VERSION
ARG LITESTREAM_SHA256
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz /tmp/litestream.tar.gz
RUN echo "${LITESTREAM_SHA256}  /tmp/litestream.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    PACT_DB_PATH=/data/pact.db
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY package.json ./
COPY src/shared ./src/shared
COPY src/core ./src/core
COPY src/server ./src/server
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY litestream.yml /etc/litestream.yml
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
