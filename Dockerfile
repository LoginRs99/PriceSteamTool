# ----------------------------------------------------
# Stage 1: Build Frontend and Backend + Native Modules
# ----------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install native build tools for compiling better-sqlite3 on Alpine
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json tsconfig*.json ./

# Clean install all dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build client (Vite) and server (TypeScript)
RUN npm run build:client
RUN npm run build:server

# Remove devDependencies while preserving compiled native modules
RUN npm prune --omit=dev

# ----------------------------------------------------
# Stage 2: Production Runtime
# ----------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

# Install curl for Docker health checks
RUN apk add --no-cache curl

# Copy production node_modules with compiled native SQLite from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Create persistent data volume directory and set non-root permissions
RUN mkdir -p /data && chown -R node:node /data /app

# Run as non-root user
USER node

VOLUME ["/data"]

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server/index.js"]
