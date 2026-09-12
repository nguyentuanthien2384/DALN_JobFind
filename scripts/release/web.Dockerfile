FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Existing lockfile contains React 18 alongside older peer ranges (lightbox).
# Preserve that locked graph instead of resolving a different dependency set.
RUN npm ci --include=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY public ./public
ARG REACT_APP_JOB_SEARCH_MODE
ARG REACT_APP_JOB_WORKSPACE_MODE
ARG REACT_APP_JOB_CREATE_MODE
ARG REACT_APP_JOB_EDIT_MODE
ARG REACT_APP_JOB_REPOST_MODE
ARG REACT_APP_CANDIDATE_AI_ENABLED
ARG REACT_APP_APPLICATION_PROGRESS_ENABLED
ARG REACT_APP_PREPARED_CV_APPLICATION_ENABLED
ENV REACT_APP_BACKEND_URL=/ GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build
FROM nginx@sha256:5a88c9c45479443d7be2eadc894b4ed0a9801bae03d97a5760ae13b5c2005942
COPY .release/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/build /usr/share/nginx/html
COPY .release/release-info.json /usr/share/nginx/html/release-info.json
USER 101:101
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
