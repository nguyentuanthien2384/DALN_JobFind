# Giao dien React + Caddy (HTTPS tu dong). Build tu thu muc goc du an:
#   docker compose -f deploy/docker-compose.yml build web
# Cac co REACT_APP_* duoc dong vao bundle luc build; doi co phai build lai image.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# Lockfile co React 18 cung thu vien lightbox khai bao peer React 16/17:
# giu nguyen do thi phu thuoc da khoa thay vi de npm giai lai.
RUN npm ci --include=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/scripts ./scripts
ARG REACT_APP_JOB_SEARCH_MODE
ARG REACT_APP_JOB_WORKSPACE_MODE
ARG REACT_APP_JOB_CREATE_MODE
ARG REACT_APP_JOB_EDIT_MODE
ARG REACT_APP_JOB_REPOST_MODE
ARG REACT_APP_CANDIDATE_AI_ENABLED
ARG REACT_APP_APPLICATION_PROGRESS_ENABLED
ARG REACT_APP_PREPARED_CV_APPLICATION_ENABLED
ARG REACT_APP_CONTACT_EMAIL
# "/" = cung origin voi trang: Caddy chuyen /api va /socket.io vao API Gateway.
ENV REACT_APP_BACKEND_URL=/ GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/build /srv
