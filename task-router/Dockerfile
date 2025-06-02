# Multi-stage build for optimal image size
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY task-router/package.json task-router/package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Copy source code
COPY task-router/src/ ./src/
COPY task-router/tsconfig.json ./

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine

# Create app user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy package files and install production dependencies
COPY task-router/package.json task-router/package-lock.json* ./
RUN npm ci --only=production && \
    npm cache clean --force && \
    chown -R appuser:appgroup /app

# Copy built application from builder stage
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Expose ports
EXPOSE 3000 9090

# Start the application
CMD ["node", "dist/index.js"] 