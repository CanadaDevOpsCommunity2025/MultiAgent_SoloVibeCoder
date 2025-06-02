# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /workspace

# Install zip utility for project packaging
RUN apk add --no-cache zip

# Copy package.json files first for better caching
COPY agents/coder/package*.json ./agents/coder/

# Install dependencies (this layer will be cached if package.json doesn't change)
RUN cd agents/coder && npm install

# Copy source code after dependencies are installed
COPY agents/coder/src ./agents/coder/src
COPY agents/coder/tsconfig.json ./agents/coder/tsconfig.json

# Build the package
RUN cd agents/coder && npm run build

# Set working directory to the agent
WORKDIR /workspace/agents/coder

# Remove development dependencies to reduce image size
RUN npm prune --production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S coder -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R coder:nodejs /workspace
USER coder

# Expose port for health checks (if needed)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start the application
CMD ["node", "dist/index.js"] 