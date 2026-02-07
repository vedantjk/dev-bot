# KB Tools for dev-bot

MCP tools for integrating dev-bot agents with the kb-service (Knowledge Base service).

## What is This?

These tools allow dev-bot agents to store and retrieve information across conversations:
- Remember user preferences and coding standards
- Search past interactions for relevant context
- Build cumulative knowledge about projects
- Maintain persistent memory across sessions

## Quick Start

### 1. Prerequisites

The kb-service must be running. See [kb-service README](kb-service/README.md) for details.

**Linux/macOS:**
```bash
cd kb-service && mkdir build && cd build
cmake .. && make
./kb-service --socket /tmp/dev-bot-kb.sock --db /data/kb.db
```

**Docker:**
```bash
cd kb-service
docker build -t kb-service .
docker run -v /tmp:/tmp -v kb-data:/data kb-service
```

### 2. Use the Tools

The KB tools are automatically available in dev-bot's MCP server:

```typescript
// Store a preference
await mcp.callTool('kb_add', {
  content: 'User prefers TypeScript strict mode',
  category: 'preference'
});

// Search for it later
await mcp.callTool('kb_search', {
  query: 'What are the TypeScript preferences?',
  top_k: 5
});
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `kb_add` | Store a memory in the knowledge base |
| `kb_search` | Search for memories using semantic similarity |
| `kb_update` | Update an existing memory |
| `kb_remove` | Delete a memory |
| `kb_update_preference` | Store a simple key-value preference |
| `kb_get_preference` | Retrieve a preference value |

## Documentation

- **[Quick Reference Guide](docs/KB_TOOLS_GUIDE.md)** - How to use each tool
- **[Testing Guide](test/README-KB-TESTS.md)** - How to test the tools
- **[Implementation Details](KB_MCP_IMPLEMENTATION.md)** - Technical documentation
- **[Summary](KB_TOOLS_SUMMARY.md)** - Implementation overview
- **[Checklist](KB_TOOLS_CHECKLIST.md)** - What's been completed

## Testing

### Automated Tests

```bash
# Requires kb-service to be running
npm test -- kb-mcp-tools.test.ts
```

### Manual Testing

See [test/README-KB-TESTS.md](test/README-KB-TESTS.md) for detailed instructions.

## Architecture

```
┌─────────────────────────────────────────┐
│  dev-bot Agent (TypeScript)             │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ MCP Client                        │ │
│  │   ↓ calls kb_add, kb_search, ... │ │
│  │ MCP Server (dev-bot-server.ts)   │ │
│  │   ↓ uses                          │ │
│  │ KBClient (kb-client.ts)          │ │
│  │   ↓ Unix socket                   │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  kb-service (C++ binary)                │
│  • FAISS (semantic search)              │
│  • RocksDB (persistent storage)         │
│  • Unix socket server                   │
└─────────────────────────────────────────┘
```

## Configuration

Set the socket path via environment variable:

```bash
export KB_SOCKET_PATH=/tmp/dev-bot-kb.sock
```

Default: `/tmp/dev-bot-kb.sock`

## Platform Support

| Platform | Support | Method |
|----------|---------|--------|
| Linux | ✅ Full | Native Unix sockets |
| macOS | ✅ Full | Native Unix sockets |
| Windows | ⚠️ Limited | Docker or WSL2 required |

## Example Workflows

### Remembering User Preferences

```typescript
// User tells you their preferences
await kb_add({
  content: 'User prefers functional programming style',
  category: 'preference'
});

await kb_update_preference({
  key: 'indentation',
  value: '2 spaces'
});
```

### Searching for Context

```typescript
// Before starting a task, search for relevant info
const results = await kb_search({
  query: 'What are the coding standards for this project?',
  top_k: 5
});

// Use the results to inform your implementation
```

### Managing Knowledge

```typescript
// Update outdated information
const results = await kb_search({
  query: 'database preferences',
  top_k: 1
});

if (results.length > 0) {
  await kb_update({
    id: results[0].id,
    content: 'Updated: Using PostgreSQL 15 with Prisma ORM'
  });
}
```

## Status

✅ **Implementation Complete**
- All 6 tools implemented
- Comprehensive tests written
- Full documentation provided
- Build verification passed

⏳ **Testing Pending**
- Requires kb-service binary to run tests
- See [test/README-KB-TESTS.md](test/README-KB-TESTS.md)

## Troubleshooting

### "Socket error: ECONNREFUSED"
→ kb-service is not running. Start it first.

### "Request timeout"
→ kb-service is overloaded or crashed. Check logs and restart.

### "KB Service binary not found"
→ Build kb-service first (see Prerequisites above)

More troubleshooting: [docs/KB_TOOLS_GUIDE.md](docs/KB_TOOLS_GUIDE.md#troubleshooting)

## Next Steps

1. **Build kb-service** for your platform
2. **Run tests** to verify everything works
3. **Start using** KB tools in agent workflows
4. **Plan production deployment** (see checklist)

## Contributing

The KB tools follow dev-bot coding standards:
- 2-space indentation
- Single quotes
- TypeScript strict mode
- Comprehensive error handling
- Full documentation

## License

MIT (same as dev-bot)

## Support

- Issues: Open a GitHub issue
- Questions: See documentation links above
- KB Service: See [kb-service/README.md](kb-service/README.md)

---

**Quick Links:**
- [User Guide](docs/KB_TOOLS_GUIDE.md) - How to use
- [Testing Guide](test/README-KB-TESTS.md) - How to test
- [Implementation Docs](KB_MCP_IMPLEMENTATION.md) - Technical details
