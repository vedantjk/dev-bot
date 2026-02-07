# KB MCP Tools Testing Guide

This document explains how to test the KB (Knowledge Base) MCP tools that allow dev-bot agents to interact with the kb-service.

## Overview

The KB MCP tools provide the following capabilities:
- **kb_add**: Add memories to the knowledge base
- **kb_search**: Search for memories using semantic similarity
- **kb_update**: Update existing memories
- **kb_remove**: Remove memories
- **kb_update_preference**: Store user preferences
- **kb_get_preference**: Retrieve user preferences

## Prerequisites

### For Linux/macOS

1. Build the kb-service:
```bash
cd kb-service
mkdir -p build
cd build
cmake .. -DBUILD_TESTS=ON
make -j$(nproc)
```

2. The kb-service binary will be at: `kb-service/build/kb-service`

### For Windows

The kb-service uses Unix domain sockets which are not supported on Windows. To test on Windows:

1. **Option A: Use Docker** (Recommended)
```bash
cd kb-service
docker build -t kb-service .
docker run -v /tmp:/tmp -v kb-data:/data kb-service
```

2. **Option B: Use WSL2**
   - Install WSL2 with Ubuntu
   - Build kb-service inside WSL2
   - Run tests inside WSL2

## Running Tests

### Automated Tests (Linux/macOS only)

Run the KB MCP tools test suite:

```bash
npm test -- kb-mcp-tools.test.ts
```

The test suite will:
1. Start the kb-service process automatically
2. Start the MCP server with KB tools enabled
3. Run comprehensive tests for all KB tools
4. Clean up processes and test data

### Manual Testing

1. **Start the kb-service**:
```bash
./kb-service/build/kb-service --socket /tmp/dev-bot-kb.sock --db /tmp/kb-test.db --dim 128
```

2. **Start the MCP server** with KB socket path:
```bash
KB_SOCKET_PATH=/tmp/dev-bot-kb.sock npx tsx src/mcp/dev-bot-server.ts
```

3. **Test using MCP client**:
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Add a memory
await client.callTool({
  name: 'kb_add',
  arguments: {
    content: 'User prefers TypeScript for type safety',
    category: 'preference'
  }
});

// Search for memories
await client.callTool({
  name: 'kb_search',
  arguments: {
    query: 'What does the user prefer?',
    top_k: 5
  }
});
```

## Test Coverage

The test suite covers:

### Basic Operations
- ✓ Adding memories with auto-generated IDs
- ✓ Adding memories with custom IDs
- ✓ Searching with semantic similarity
- ✓ Updating existing memories
- ✓ Removing memories
- ✓ Setting user preferences
- ✓ Getting user preferences

### Error Handling
- ✓ Updating non-existent memories
- ✓ Removing non-existent memories
- ✓ Getting non-existent preferences
- ✓ Service connection errors

### Integration Workflows
- ✓ Full workflow: add → search → update → search → remove
- ✓ Multiple preference management
- ✓ Search result ranking by semantic similarity

## Expected Test Output

When all tests pass, you should see:

```
✓ KB MCP Tools > tool listing > lists all KB tools
✓ KB MCP Tools > kb_add > adds a memory successfully
✓ KB MCP Tools > kb_add > adds memory with custom ID
✓ KB MCP Tools > kb_search > searches for memories
✓ KB MCP Tools > kb_update > updates an existing memory
✓ KB MCP Tools > kb_remove > removes an existing memory
✓ KB MCP Tools > kb_update_preference > stores a user preference
✓ KB MCP Tools > kb_get_preference > retrieves a stored preference
✓ KB MCP Tools > integration workflow > completes a full workflow
```

## Troubleshooting

### "KB Service binary not found"
- Build the kb-service first (see Prerequisites)
- Check that `kb-service/build/kb-service` exists

### "KB Service failed to start"
- Check if socket path already exists: `rm /tmp/dev-bot-kb.sock`
- Check if port is in use
- View logs: kb-service outputs to stdout

### "Socket error: ECONNREFUSED"
- Ensure kb-service is running
- Check socket path matches between service and MCP server
- Verify socket file exists: `ls -l /tmp/dev-bot-kb.sock`

### "Failed to add memory"
- Check kb-service logs for errors
- Verify RocksDB path is writable
- Ensure sufficient disk space

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  dev-bot Agent (TypeScript)                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ MCP Client                                             │ │
│  │   ↓                                                    │ │
│  │ KBClient (kb-client.ts)                               │ │
│  │   ↓ Unix Socket                                        │ │
│  │ kb-service (C++ with FAISS + RocksDB)                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Next Steps

After verifying the tests pass:

1. **Integration with agents**: Use KB tools in agent workflows
2. **Production deployment**:
   - Configure kb-service as a systemd service
   - Set up proper data persistence paths
   - Configure backup for RocksDB data
3. **Replace mock embeddings**:
   - Integrate with OpenAI embeddings API
   - Or use local Sentence-BERT model
   - Update `embedding_service.cpp` accordingly

## Additional Resources

- [kb-service README](../kb-service/README.md) - Full kb-service documentation
- [MCP SDK Documentation](https://github.com/anthropics/mcp-sdk) - MCP protocol details
- [Test Implementation](./kb-mcp-tools.test.ts) - Complete test source code
