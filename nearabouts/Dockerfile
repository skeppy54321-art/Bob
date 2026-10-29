# Nearabouts — single container: API + websockets + built web app + SQLite.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools in case better-sqlite3 has to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/nearabouts.sqlite TRUST_PROXY=true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY src ./src
COPY data/geo ./data/geo
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server/index.ts"]
