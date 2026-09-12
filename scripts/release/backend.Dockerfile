FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node backend/src ./src
COPY --chown=node:node backend/.babelrc ./.babelrc
COPY --chown=node:node scripts/run-backend.cjs /app/scripts/run-backend.cjs
ENV BABEL_DISABLE_CACHE=1 PORT=5000 SCHEDULED_JOBS_ENABLED=false
USER node
EXPOSE 5000
CMD ["node", "/app/scripts/run-backend.cjs"]
