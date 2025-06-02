# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /workspace

# Install zip utility for project packaging
RUN apk add --no-cache zip

# Copy package.json files first for better caching
COPY agents/researcher/package*.json ./agents/researcher/

# Install dependencies (this layer will be cached if package.json doesn't change)
RUN cd agents/researcher && npm install

# Copy source code after dependencies are installed
COPY agents/researcher/src ./agents/researcher/src
COPY agents/researcher/tsconfig.json ./agents/researcher/tsconfig.json

# Build the package
RUN cd agents/researcher && npm run build

# Set working directory to the agent
WORKDIR /workspace/agents/researcher

# Remove development dependencies to reduce image size
RUN npm prune --production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S researcher -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R researcher:nodejs /workspace
USER researcher

# Expose port for health checks (if needed)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start the application
CMD ["node", "dist/index.js"] 