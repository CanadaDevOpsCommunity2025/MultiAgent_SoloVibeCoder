# Multi-stage build for Next.js app
FROM node:18-alpine AS base

# Install dependencies only
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files for better caching
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Build the application
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code and essential files
COPY src ./src
COPY public ./public
COPY package.json ./
COPY tsconfig.json ./

# Copy config files that exist
COPY next.config.ts ./
COPY tailwind.config.js ./
COPY postcss.config.mjs ./

# Build the application
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# For standalone mode, copy the standalone output and required files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy the original .next/server for API routes
COPY --from=builder --chown=nextjs:nodejs /app/.next/server ./.next/server

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use the standalone server with comprehensive debugging
CMD ["sh", "-c", "echo '🔍 [DEBUG] Container filesystem:' && ls -la && echo '🔍 [DEBUG] .next directory:' && ls -la .next/ && echo '🔍 [DEBUG] Environment variables:' && env | grep -E '(PORT|HOSTNAME|NODE_ENV|TASK_ROUTER)' && echo '🔍 [DEBUG] Starting server...' && node server.js"] 