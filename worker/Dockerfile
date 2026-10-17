# Build from the repo root so the shared edge module is included:
#   docker build -f worker/Dockerfile -t nexxore-edge-worker .
FROM node:22-slim
WORKDIR /app
COPY js/edge.js js/edge.js
COPY worker/package.json worker/package-lock.json worker/
RUN cd worker && npm ci --omit=dev
COPY worker/src worker/src
WORKDIR /app/worker
USER node
CMD ["node", "src/index.js"]
