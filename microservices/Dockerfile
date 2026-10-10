# syntax=docker/dockerfile:1
# Mot image dung chung cho ca 9 service (Compose chon thu muc/lenh chay cho tung service).
# - Image goc ghim theo digest sha256: build lai luon ra cung mot Node/Alpine, khong bi
#   doi am tham khi tag node:22-alpine cap nhat.
# - Multi-stage: stage "dependencies" chi chep package.json + lockfile roi npm ci
#   --omit=dev (bo thu vien test). Docker cache layer nay: sua code khong phai cai lai
#   thu vien. Stage "runtime" chi chep ket qua, image gon hon.
# - USER node: tien trinh khong chay bang root, han che thiet hai neu bi chiem quyen.
# - HEALTHCHECK goi scripts/healthcheck.mjs de Docker/Compose biet container da san sang.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Patched braces tarball installed through npm overrides (see vendor/README.md).
COPY vendor/ vendor/
COPY shared/package.json shared/package.json
COPY api-gateway/package.json api-gateway/package.json
COPY identity-service/package.json identity-service/package.json
COPY job-core-service/package.json job-core-service/package.json
COPY search-service/package.json search-service/package.json
COPY application-service/package.json application-service/package.json
COPY notification-service/package.json notification-service/package.json
COPY admin-service/package.json admin-service/package.json
COPY ai-worker/package.json ai-worker/package.json
COPY support-chat-service/package.json support-chat-service/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app /app
COPY --chown=node:node shared/ shared/
COPY --chown=node:node contracts/ contracts/
COPY --chown=node:node api-gateway/ api-gateway/
COPY --chown=node:node identity-service/ identity-service/
COPY --chown=node:node job-core-service/ job-core-service/
COPY --chown=node:node search-service/ search-service/
COPY --chown=node:node application-service/ application-service/
COPY --chown=node:node notification-service/ notification-service/
COPY --chown=node:node admin-service/ admin-service/
COPY --chown=node:node ai-worker/ ai-worker/
COPY --chown=node:node support-chat-service/ support-chat-service/
COPY --chown=node:node scripts/healthcheck.mjs scripts/healthcheck.mjs
USER node
WORKDIR /app/api-gateway
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 CMD ["node", "/app/scripts/healthcheck.mjs"]
CMD ["node", "src/app.js"]
