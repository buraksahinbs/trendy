# syntax=docker/dockerfile:1.7
#
# Hedefler:
#   server → API, worker ve veritabanı migration'ı (aynı imaj, farklı komut)
#   web    → satıcı paneli (Next.js standalone)
#
# İsteğe bağlı: kurumsal proxy arkasında derlerken kök sertifika `--secret id=ca,src=...` ile
# verilebilir. Verilmezse (normal sunucu) hiçbir etkisi yoktur.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    npm install -g pnpm@10.33.0 && pnpm --version
WORKDIR /repo

# Bağımlılık manifestleri (kaynak koddan ayrı katman: kod değişince yeniden kurulum yapılmaz).
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
COPY packages/pricing/package.json packages/pricing/
COPY packages/shared/package.json packages/shared/
COPY packages/trendyol-client/package.json packages/trendyol-client/
COPY packages/xml-ingest/package.json packages/xml-ingest/

# ── server: yalnızca API/worker üretim bağımlılıkları ─────────────────────────
FROM manifests AS server-deps
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --prod --filter "@trendy/api..." --filter "@trendy/worker..."

FROM ${NODE_IMAGE} AS server
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=server-deps /repo /repo
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY tsconfig.base.json ./
USER node
# Varsayılan komut API; worker ve migration compose dosyasında komutla seçilir.
CMD ["apps/api/node_modules/.bin/tsx", "apps/api/src/server.ts"]

# ── web: Next.js standalone ─────────────────────────────────────────────────
FROM manifests AS web-build
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --filter "@trendy/web..."
COPY apps/web apps/web
COPY tsconfig.base.json ./
# Tarayıcı /api'ye aynı adresten gider; üretimde Caddy /api'yi doğrudan API'ye yönlendirir.
# Bu değer yalnızca Next rewrite'ı için (Caddy olmadan çalıştırıldığında) kullanılır.
ARG API_URL=http://api:3000
ENV API_URL=${API_URL} NEXT_STANDALONE=1
RUN pnpm --filter @trendy/web build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3200 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3200
CMD ["node", "apps/web/server.js"]
