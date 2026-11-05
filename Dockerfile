# syntax=docker/dockerfile:1
# One image: the Node server (TypeScript run directly with type stripping),
# the built SPA, Litestream, which restores and replicates /data/pact.db, and
# Python with Anki's own package, which reads owners' decks from AnkiWeb.

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
# Python 3 (bookworm's 3.11) for the AnkiWeb reader. Anki's wheel needs glibc 2.35 or later; bookworm has 2.36.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
# The pinned anki package, in its own venv. Its version lives in src/core/anki-requirements.txt only.
COPY src/core/anki-requirements.txt /tmp/anki-requirements.txt
RUN python3 -m venv /opt/anki \
 && /opt/anki/bin/pip install --no-cache-dir --require-virtualenv -r /tmp/anki-requirements.txt \
 && rm /tmp/anki-requirements.txt
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    PACT_DB_PATH=/data/pact.db \
    ANKI_PYTHON=/opt/anki/bin/python3
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY package.json ./
COPY src/shared ./src/shared
COPY src/core ./src/core
COPY src/server ./src/server
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY litestream.yml /etc/litestream.yml
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The commit /health reports: set by CI, empty for a manual `fly deploy`. Last,
# because it changes every build and would invalidate the layers after it.
ARG PACT_COMMIT=""
ENV PACT_COMMIT=$PACT_COMMIT
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
