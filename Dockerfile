FROM node:22-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web .
RUN npm run build

FROM node:22-bookworm-slim AS serverdeps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=serverdeps /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY --from=webbuild /app/web/dist web/dist
ENV NODE_ENV=production DATA_DIR=/data WEB_DIST=/app/web/dist PORT=8787
EXPOSE 8787
CMD ["node", "server/src/index.js"]
