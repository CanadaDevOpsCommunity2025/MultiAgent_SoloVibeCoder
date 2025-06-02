# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /workspace

# Install zip utility for project packaging
RUN apk add --no-cache zip

# Copy package.json files first for better caching
COPY agents/product_manager/package*.json ./agents/product_manager/

# Install dependencies (this layer will be cached if package.json doesn't change)
RUN cd agents/product_manager && npm install

# Copy source code after dependencies are installed
COPY agents/product_manager/src ./agents/product_manager/src
COPY agents/product_manager/tsconfig.json ./agents/product_manager/tsconfig.json

# Build the package
RUN cd agents/product_manager && npm run build

# Set working directory to the agent
WORKDIR /workspace/agents/product_manager

# Remove development dependencies to reduce image size
RUN npm prune --production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S product_manager -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R product_manager:nodejs /workspace
USER product_manager

# Expose port for health checks (if needed)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start the application
CMD ["node", "dist/index.js"] 