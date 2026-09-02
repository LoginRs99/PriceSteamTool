# ----------------------------------------------------
# Stage 1: Build Frontend and Backend + Native Modules
# ----------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for compiling native SQLite C/C++ bindings on Alpine
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json tsconfig*.json ./

# Clean install all dependencies (including devDependencies for build)
RUN npm ci

# Copy application source
COPY src/ ./src/

# Compile frontend bundle (Vite) and backend (TypeScript)
RUN npm run build:client
RUN npm run build:server

# Prune devDependencies while keeping compiled native modules intact
RUN npm prune --omit=dev

# ----------------------------------------------------
# Stage 2: Hardened Minimal Production Runtime
# ----------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Install tini as init system (PID 1) for signal forwarding & zombie reaping
RUN apk add --no-cache tini

# Copy compiled artifacts and production node_modules from builder stage
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Pre-create data directory with unprivileged node user ownership (UID 1000:GID 1000)
RUN mkdir -p /data && chown -R node:node /data /app

# Run strictly under unprivileged node user
USER node

# Declare data volume
VOLUME ["/data"]

EXPOSE 3000

# Built-in lightweight healthcheck using Alpine's native wget (no heavy external curl required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Use tini to handle SIGTERM/SIGINT and forward to Node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]

