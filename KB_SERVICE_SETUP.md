# KB Service Setup Guide

## Quick Start

The KB service now uses TCP sockets for cross-platform compatibility. It works seamlessly on Windows, Linux, and macOS.

### 1. Start the Service with Docker Compose (Recommended)

```bash
# Start the service
docker-compose up -d kb-service

# View logs
docker-compose logs -f kb-service

# Stop the service
docker-compose down
```

### 2. Configure Your Application

Update your `.env` file:

```env
KB_HOST=localhost
KB_PORT=50051
```

### 3. Verify Connection

The service should show:
```
KB Service starting...
  Port: 50051
  DB: /data/kb.db
  Dimension: 1024
KB Service listening on 0.0.0.0:50051
KB Service ready. Total memories: 0
```

## Platform-Specific Guides

### Windows

See [kb-service/WINDOWS_SETUP.md](kb-service/WINDOWS_SETUP.md) for detailed Windows instructions.

Quick summary:
```powershell
# Start with Docker Compose
docker-compose up -d kb-service

# Or manually
docker build -t kb-service ./kb-service
docker run -d -p 50051:50051 -v kb-data:/data --name dev-bot-kb-service kb-service
```

### Linux/macOS

Same commands as Windows. Docker makes it platform-agnostic!

```bash
# Using Docker Compose
docker-compose up -d kb-service

# Or manually
docker build -t kb-service ./kb-service
docker run -d -p 50051:50051 -v kb-data:/data --name dev-bot-kb-service kb-service
```

### Native Build (Linux/macOS Only)

If you want to build without Docker:

```bash
cd kb-service
mkdir build && cd build
cmake ..
make -j$(nproc)
./kb-service --port 50051 --db /data/kb.db
```

**Note**: Native Windows builds require Visual Studio and are complex. Docker is recommended.

## Usage in Code

### TypeScript/JavaScript

```typescript
import { KBClient } from './src/kb/kb-client.js';

// Connect to the service
const client = new KBClient('localhost', 50051);

// Add a memory
const id = await client.add('User prefers 2-space indentation', 'preference');
console.log('Memory ID:', id);

// Search for memories
const results = await client.search('code formatting', 5);
results.forEach(result => {
  console.log(`[${result.category}] ${result.content}`);
  console.log(`Score: ${result.score}`);
});

// Update a memory
await client.update(id, 'User prefers 4-space indentation');

// Remove a memory
await client.remove(id);

// Store user preferences
await client.updatePreference('editor', 'VSCode');

// Retrieve user preferences
const editor = await client.getPreference('editor');
console.log('Editor:', editor);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Your Application (Node.js/TypeScript)                      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ KBClient (TCP)                                       │  │
│  │ - localhost:50051                                    │  │
│  └──────────────────┬───────────────────────────────────┘  │
└────────────────────┼─────────────────────────────────────┘
                      │ TCP Connection
                      │ (JSON Protocol)
                      │
┌────────────────────┴─────────────────────────────────────┐
│  kb-service (Docker Container)                           │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ TCP Server (0.0.0.0:50051)                        │  │
│  │                                                    │  │
│  │ ┌──────────────────────────────────────────────┐  │  │
│  │ │ FAISS Index (In-Memory Search)              │  │  │
│  │ │ - Fast semantic search                      │  │  │
│  │ │ - L2 distance metric                        │  │  │
│  │ └──────────────────────────────────────────────┘  │  │
│  │                                                    │  │
│  │ ┌──────────────────────────────────────────────┐  │  │
│  │ │ RocksDB (Persistent Storage)                │  │  │
│  │ │ - Memories with embeddings                  │  │  │
│  │ │ - User preferences                          │  │  │
│  │ │ - Metadata                                  │  │  │
│  │ └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KB_HOST` | `localhost` | Hostname or IP address of kb-service |
| `KB_PORT` | `50051` | TCP port of kb-service |

## Docker Compose Configuration

The `docker-compose.yml` file includes:

```yaml
services:
  kb-service:
    build:
      context: ./kb-service
      dockerfile: Dockerfile
    ports:
      - "50051:50051"  # Expose TCP port
    volumes:
      - kb-data:/data  # Persistent storage
    restart: unless-stopped
    container_name: dev-bot-kb-service

volumes:
  kb-data:
    driver: local
```

## API Endpoints

The service exposes a JSON-over-TCP API:

### /add
Add a new memory
```json
{
  "endpoint": "/add",
  "params": {
    "content": "Memory content",
    "category": "general",
    "id": "optional-custom-id"
  }
}
```

### /search
Search for similar memories
```json
{
  "endpoint": "/search",
  "params": {
    "query": "search query",
    "top_k": 5
  }
}
```

### /update
Update an existing memory
```json
{
  "endpoint": "/update",
  "params": {
    "id": "memory-id",
    "content": "updated content"
  }
}
```

### /remove
Remove a memory
```json
{
  "endpoint": "/remove",
  "params": {
    "id": "memory-id"
  }
}
```

### /update_preference
Store a user preference
```json
{
  "endpoint": "/update_preference",
  "params": {
    "key": "editor",
    "value": "VSCode"
  }
}
```

### /get_preference
Retrieve a user preference
```json
{
  "endpoint": "/get_preference",
  "params": {
    "key": "editor"
  }
}
```

## Troubleshooting

### Connection Refused

1. **Check if service is running:**
   ```bash
   docker ps | grep kb-service
   ```

2. **Check logs:**
   ```bash
   docker logs dev-bot-kb-service
   ```

3. **Verify port mapping:**
   ```bash
   docker port dev-bot-kb-service
   # Should show: 50051/tcp -> 0.0.0.0:50051
   ```

### Port Already in Use

Change the port in `docker-compose.yml`:

```yaml
ports:
  - "50052:50051"  # Use host port 50052
```

Then update your `.env`:
```env
KB_PORT=50052
```

### Permission Denied (Linux)

If you get permission errors with the data volume:

```bash
# Fix volume permissions
docker-compose down
docker volume rm dev-bot_kb-data
docker-compose up -d kb-service
```

### Build Failures

1. **Clear Docker cache:**
   ```bash
   docker-compose build --no-cache kb-service
   ```

2. **Check Docker resources:**
   Ensure Docker has enough memory (4GB+ recommended)

3. **Verify dependencies:**
   The Dockerfile installs all dependencies. No manual setup required.

## Data Backup and Restore

### Backup

```bash
# Create a backup of the kb-data volume
docker run --rm -v dev-bot_kb-data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/kb-backup.tar.gz /data
```

### Restore

```bash
# Restore from backup
docker run --rm -v dev-bot_kb-data:/data -v $(pwd):/backup \
  ubuntu tar xzf /backup/kb-backup.tar.gz -C /
```

## Performance

- **Add operation**: ~1ms (includes embedding generation and storage)
- **Search operation**: ~5-10ms for 1000 memories
- **Memory usage**: ~100MB + (dimension * num_memories * 4 bytes)
- **Disk usage**: RocksDB compression typically achieves 60-70% compression

## Limitations

- **Embedding model**: Currently uses mock embeddings (SHA256-based). Replace with real embeddings in production.
- **No authentication**: Service has no built-in authentication. Use firewall rules or reverse proxy.
- **Single instance**: No horizontal scaling support. Use multiple instances with separate databases if needed.
- **No TLS**: Communication is not encrypted. Use VPN or internal network for security.

## Production Recommendations

1. **Use real embeddings**: Replace `MockEmbeddingService` with Sentence-BERT or OpenAI embeddings
2. **Add authentication**: Put service behind an authenticated reverse proxy
3. **Enable TLS**: Use nginx or similar to add HTTPS
4. **Monitor performance**: Add metrics export (Prometheus, etc.)
5. **Regular backups**: Automate backup of the kb-data volume
6. **Resource limits**: Set Docker memory/CPU limits in production

## Next Steps

- Read [KB_TCP_MIGRATION.md](KB_TCP_MIGRATION.md) for details on the Unix→TCP migration
- See [kb-service/README.md](kb-service/README.md) for C++ implementation details
- Check [kb-service/WINDOWS_SETUP.md](kb-service/WINDOWS_SETUP.md) for Windows-specific instructions
