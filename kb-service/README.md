# KB Service - C++ Knowledge Base with FAISS and RocksDB

A high-performance knowledge base service written in C++ that provides semantic search capabilities using FAISS for in-memory indexing and RocksDB for persistent storage.

## Features

- **FAISS Index**: Fast approximate nearest neighbor search in high-dimensional space
- **RocksDB Storage**: Persistent storage for memories and metadata
- **Unix Socket API**: Lightweight IPC communication
- **Semantic Search**: Store and retrieve memories based on semantic similarity
- **User Preferences**: Store and retrieve user-specific preferences

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  kb-service (C++ binary)                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ • FAISS index (in-memory)                                │  │
│  │ • RocksDB (persistent storage)                           │  │
│  │ • Unix socket server (/tmp/dev-bot-kb.sock)             │  │
│  │                                                          │  │
│  │ Endpoints:                                               │  │
│  │ POST /add     - Store memory with embedding             │  │
│  │ POST /search  - Semantic search                         │  │
│  │ POST /update  - Update existing memory                  │  │
│  │ POST /remove  - Delete memory                           │  │
│  │ POST /update_preference - Update user preference        │  │
│  │ POST /get_preference - Get user preference              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Building

### Prerequisites

- CMake 3.15+
- C++17 compiler
- RocksDB
- FAISS
- nlohmann/json
- OpenSSL

### Using Docker

```bash
docker build -t kb-service .
docker run -v /tmp:/tmp -v kb-data:/data kb-service
```

### Manual Build

```bash
mkdir build
cd build
cmake ..
make -j$(nproc)
./kb-service --socket /tmp/dev-bot-kb.sock --db /data/kb.db
```

## Usage

### Starting the Service

```bash
./kb-service [options]

Options:
  --socket PATH   Unix socket path (default: /tmp/dev-bot-kb.sock)
  --db PATH       RocksDB path (default: /data/kb.db)
  --dim N         Embedding dimension (default: 1024)
  --help          Show this help
```

### API Protocol

The service accepts JSON requests over Unix socket:

```json
{
  "endpoint": "/add",
  "params": {
    "content": "User prefers 2-space indentation",
    "category": "preference"
  }
}
```

Response:

```json
{
  "success": true,
  "id": "mem_1234567890_5678"
}
```

### Endpoints

#### POST /add

Add a new memory to the knowledge base.

**Request:**
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

**Response:**
```json
{
  "success": true,
  "id": "mem_1234567890_5678"
}
```

#### POST /search

Search for similar memories.

**Request:**
```json
{
  "endpoint": "/search",
  "params": {
    "query": "What are the user's coding preferences?",
    "top_k": 5
  }
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "id": "mem_1234567890_5678",
      "content": "User prefers 2-space indentation",
      "category": "preference",
      "score": 0.123,
      "timestamp": 1234567890000
    }
  ]
}
```

#### POST /update

Update an existing memory.

**Request:**
```json
{
  "endpoint": "/update",
  "params": {
    "id": "mem_1234567890_5678",
    "content": "Updated content"
  }
}
```

#### POST /remove

Remove a memory.

**Request:**
```json
{
  "endpoint": "/remove",
  "params": {
    "id": "mem_1234567890_5678"
  }
}
```

#### POST /update_preference

Store a user preference.

**Request:**
```json
{
  "endpoint": "/update_preference",
  "params": {
    "key": "indentation",
    "value": "2 spaces"
  }
}
```

#### POST /get_preference

Retrieve a user preference.

**Request:**
```json
{
  "endpoint": "/get_preference",
  "params": {
    "key": "indentation"
  }
}
```

**Response:**
```json
{
  "success": true,
  "value": "2 spaces"
}
```

## Implementation Details

### Embedding Generation

The current implementation uses a mock embedding service based on SHA256 hashing for testing. In production, replace `MockEmbeddingService` with:

- **Sentence-BERT**: Local embedding model
- **OpenAI API**: Cloud-based embeddings
- **Custom model**: Fine-tuned model for your domain

### Storage Layout

**RocksDB Keys:**
- `mem_*`: Memory documents (JSON)
- `pref:*`: User preferences (string)
- `meta:*`: System metadata

**FAISS Index:**
- In-memory L2 distance index
- Rebuilt on updates/deletes
- Loaded from RocksDB on startup

### Performance

- **Search**: O(log n) with FAISS approximate search
- **Add**: O(1) for storage, O(log n) for index update
- **Update/Delete**: O(n) due to index rebuild (optimizable)

## License

MIT
