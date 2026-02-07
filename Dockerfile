# Root Dockerfile for dev-bot TypeScript project
# This validates the TypeScript codebase builds correctly

FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/
COPY test/ ./test/

# Build the TypeScript project
RUN npm run build

# Verify build artifacts exist
RUN test -f dist/ai/orchestrator.js && \
    test -f dist/mcp/dev-bot-server.js && \
    test -f dist/kb/kb-client.js && \
    echo "Build verification passed"

CMD ["node", "dist/mcp/dev-bot-server.js"]
