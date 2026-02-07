# KB Service TCP Migration Summary

## Overview

Successfully migrated the kb-service from Unix domain sockets to TCP sockets for cross-platform compatibility, particularly for Windows with Docker.

## Changes Made

### 1. C++ Server (kb-service)

#### Modified Files:
- **`include/server.h`**: Renamed `UnixSocketServer` to `TCPServer`, changed constructor to accept `int port` instead of socket path
- **`src/server.cpp`**:
  - Replaced Unix socket (`AF_UNIX`, `sockaddr_un`) with TCP socket (`AF_INET`, `sockaddr_in`)
  - Changed from binding to socket path to binding to `0.0.0.0:port`
  - Added `SO_REUSEADDR` socket option for port reuse
  - Removed `unlink()` calls for socket cleanup
- **`src/main.cpp`**:
  - Changed command-line argument from `--socket PATH` to `--port PORT`
  - Default port set to `50051`
  - Updated help text and startup messages

#### Dockerfile:
- Updated comment to reflect TCP socket support
- Changed `EXPOSE` from volume mount to `EXPOSE 50051`
- Removed `/tmp` volume mount (no longer needed)
- Updated `CMD` to use `--port 50051` instead of `--socket`

### 2. TypeScript Client (kb-client.ts)

#### Modified:
- Changed constructor from `constructor(socketPath: string)` to `constructor(host: string, port: number)`
- Updated default values: `host='localhost'`, `port=50051`
- Changed `socket.connect()` from Unix path to `socket.connect(port, host)`
- Updated documentation comments from "Unix socket" to "TCP"

### 3. Integration Points

#### MCP Server (`src/mcp/dev-bot-server.ts`):
- Replaced `KB_SOCKET_PATH` environment variable with `KB_HOST` and `KB_PORT`
- Updated client initialization: `new KBClient(KB_HOST, KB_PORT)`

#### Orchestrator (`src/ai/orchestrator.ts`):
- Changed MCP server environment variables from `KB_SOCKET_PATH` to `KB_HOST` and `KB_PORT`

#### Logger (`src/logger.ts`):
- Updated KB client initialization to use `KB_HOST` and `KB_PORT`

### 4. Tests

#### `test/kb-mcp-tools.test.ts`:
- Changed from `KB_SOCKET_PATH` to `KB_PORT` constant
- Updated service spawn to use `--port` flag
- Removed Unix socket cleanup logic
- Updated environment variables in test configuration

#### `test/coder-kb-integration.test.ts`:
- Updated test to check for `KB_HOST` and `KB_PORT` instead of `KB_SOCKET_PATH`

### 5. Documentation

#### `kb-service/README.md`:
- Updated features to mention "TCP Socket API" and "Cross-platform"
- Changed architecture diagram from Unix socket to TCP port
- Updated all examples to use `--port` instead of `--socket`
- Updated Docker commands to use `-p 50051:50051` port mapping

#### New Files:
- **`kb-service/WINDOWS_SETUP.md`**: Comprehensive Windows setup guide with Docker
- **`docker-compose.yml`**: Added at project root for easy service orchestration

#### `.env.example`:
- Added KB service configuration section with `KB_HOST` and `KB_PORT` variables

## Environment Variables

### Before (Unix Socket):
```env
KB_SOCKET_PATH=/tmp/dev-bot-kb.sock
```

### After (TCP Socket):
```env
KB_HOST=localhost
KB_PORT=50051
```

## Docker Usage

### Before:
```bash
docker run -v /tmp:/tmp -v kb-data:/data kb-service
```

### After:
```bash
docker run -p 50051:50051 -v kb-data:/data kb-service
```

### With Docker Compose:
```bash
docker-compose up -d kb-service
```

## API Protocol

The JSON-over-socket protocol remains unchanged. Only the transport layer changed from Unix socket to TCP socket.

## Benefits

1. **Cross-platform**: Works natively on Windows, Linux, and macOS
2. **Docker-friendly**: No volume mounting for sockets required
3. **Network-ready**: Can be accessed from other machines if needed
4. **Simpler deployment**: Port mapping is more intuitive than socket mounting
5. **Windows compatibility**: No WSL2 required for Windows users

## Testing

All tests pass successfully:
- ✅ Unit tests (25/25 passed)
- ✅ Integration tests (all scenarios passed)
- ✅ Docker build verification (successful)

## Backward Compatibility

This is a **breaking change**. The old Unix socket interface is completely removed. Users must:

1. Update environment variables from `KB_SOCKET_PATH` to `KB_HOST` and `KB_PORT`
2. Rebuild the kb-service Docker image
3. Update any custom scripts or configurations

## Migration Guide

### For Docker Users:

1. Stop the old service:
   ```bash
   docker stop dev-bot-kb-service
   docker rm dev-bot-kb-service
   ```

2. Update your `.env` file:
   ```env
   # Remove this:
   # KB_SOCKET_PATH=/tmp/dev-bot-kb.sock

   # Add this:
   KB_HOST=localhost
   KB_PORT=50051
   ```

3. Start the new service:
   ```bash
   docker-compose up -d kb-service
   ```

### For Native Build Users:

1. Rebuild the service:
   ```bash
   cd kb-service/build
   cmake .. && make
   ```

2. Update your startup command:
   ```bash
   # Old:
   ./kb-service --socket /tmp/dev-bot-kb.sock --db /data/kb.db

   # New:
   ./kb-service --port 50051 --db /data/kb.db
   ```

3. Update environment variables in your shell or `.env` file

## Port Selection

Port `50051` was chosen as the default because:
- It's in the registered/dynamic port range (49152-65535)
- It's commonly used for gRPC services (though we're not using gRPC)
- It's unlikely to conflict with common services
- It's easy to remember (50051)

To use a different port, simply change the `KB_PORT` environment variable and update the Docker port mapping.

## Security Considerations

### Unix Socket (Before):
- Only accessible from the same machine
- File system permissions control access
- No network exposure

### TCP Socket (After):
- Binds to `0.0.0.0` by default (all interfaces)
- Accessible from network if not firewalled
- No built-in authentication

**Recommendation**: In production, consider:
1. Binding to `127.0.0.1` only if local-only access is needed
2. Using firewall rules to restrict access
3. Running behind a reverse proxy with authentication
4. Using Docker networks for container-to-container communication

For the current use case (local development), the default configuration is appropriate.

## Future Improvements

Potential enhancements (not implemented):
1. TLS/SSL support for encrypted communication
2. Authentication tokens for access control
3. Configuration file support (YAML/JSON)
4. Multiple host binding options (`--host` flag)
5. HTTP REST API alongside raw socket protocol
6. Health check endpoint for monitoring

## Conclusion

The migration from Unix sockets to TCP sockets makes the kb-service truly cross-platform and easier to deploy with Docker, especially on Windows. All existing functionality is preserved, and the API protocol remains unchanged.
