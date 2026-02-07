# KB Service - Windows Setup Guide

The KB service now uses TCP sockets for cross-platform compatibility, making it easy to run on Windows with Docker.

## Quick Start with Docker

### 1. Start the Service

From the project root directory:

```bash
docker-compose up -d kb-service
```

Or manually:

```bash
cd kb-service
docker build -t kb-service .
docker run -d -p 50051:50051 -v kb-data:/data --name dev-bot-kb-service kb-service
```

### 2. Configure Environment Variables

The TypeScript client will automatically connect to `localhost:50051` by default. You can customize this in your `.env` file:

```env
KB_HOST=localhost
KB_PORT=50051
```

### 3. Verify the Service is Running

Check Docker logs:

```bash
docker logs dev-bot-kb-service
```

You should see:
```
KB Service starting...
  Port: 50051
  DB: /data/kb.db
  Dimension: 1024
KB Service listening on 0.0.0.0:50051
KB Service ready. Total memories: 0
```

### 4. Test the Connection

From your Node.js/TypeScript application:

```typescript
import { KBClient } from './src/kb/kb-client.js';

const client = new KBClient('localhost', 50051);

// Add a memory
const id = await client.add('Test memory', 'general');
console.log('Added memory:', id);

// Search
const results = await client.search('Test', 5);
console.log('Search results:', results);
```

## Docker Compose Commands

Start the service:
```bash
docker-compose up -d kb-service
```

Stop the service:
```bash
docker-compose down
```

View logs:
```bash
docker-compose logs -f kb-service
```

Restart the service:
```bash
docker-compose restart kb-service
```

## Connecting from Host Machine

The service listens on `0.0.0.0:50051` inside the container and is exposed on `localhost:50051` on your Windows machine.

- **Host**: `localhost` or `127.0.0.1`
- **Port**: `50051`

## Connecting from Other Docker Containers

If your Node.js application also runs in Docker, use the service name as hostname:

```yaml
services:
  app:
    build: .
    environment:
      - KB_HOST=kb-service
      - KB_PORT=50051
    depends_on:
      - kb-service
```

## Data Persistence

The database is stored in a Docker volume named `kb-data`. Your data persists across container restarts.

To backup the data:
```bash
docker run --rm -v kb-data:/data -v ${PWD}:/backup ubuntu tar czf /backup/kb-backup.tar.gz /data
```

To restore:
```bash
docker run --rm -v kb-data:/data -v ${PWD}:/backup ubuntu tar xzf /backup/kb-backup.tar.gz -C /
```

## Troubleshooting

### Port Already in Use

If port 50051 is already in use, change it in `docker-compose.yml`:

```yaml
ports:
  - "50052:50051"  # Map host port 50052 to container port 50051
```

Then update your `.env`:
```env
KB_PORT=50052
```

### Connection Refused

1. Check if the container is running:
   ```bash
   docker ps | grep kb-service
   ```

2. Check container logs:
   ```bash
   docker logs dev-bot-kb-service
   ```

3. Verify port mapping:
   ```bash
   docker port dev-bot-kb-service
   ```

### Firewall Issues

Windows Defender Firewall may block the connection. Add an inbound rule for port 50051 or allow Docker Desktop.

## Building Locally (Without Docker)

Building natively on Windows requires:
- Visual Studio 2019+ with C++ tools
- CMake 3.15+
- vcpkg for dependencies

This is complex. Using Docker is recommended for Windows.
