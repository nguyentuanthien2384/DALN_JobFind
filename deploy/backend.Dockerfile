# Backend Express + Socket.IO cho VPS. Build tu thu muc goc du an:
#   docker compose -f deploy/docker-compose.yml build backend
# Khong dong goi .env: moi cau hinh do docker-compose.yml truyen vao.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
FROM ${NODE_IMAGE}
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node backend/src ./src
COPY --chown=node:node backend/.babelrc ./.babelrc
# Backend doc danh muc tinh/thanh tu microservices/shared va danh sach viec lam
# ngoai da kiem duyet tu frontend/src/data (chatbot dung) theo duong dan tuong doi.
COPY --chown=node:node microservices/shared/recruitmentCatalog.cjs /app/microservices/shared/recruitmentCatalog.cjs
COPY --chown=node:node frontend/src/data /app/frontend/src/data
COPY --chown=node:node scripts/run-backend.cjs /app/scripts/run-backend.cjs
ENV NODE_ENV=production BABEL_DISABLE_CACHE=1 PORT=5000
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:5000/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "/app/scripts/run-backend.cjs"]
