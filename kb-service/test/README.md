# KB Service Tests

Comprehensive test suite for the knowledge base service.

## Test Files

### `knowledge_base_test.cpp`
Unit tests using Google Test framework covering:
- Basic CRUD operations (add, search, update, remove)
- Memory persistence and reload
- User preferences management
- Embedding service functionality
- Thread safety
- Edge cases and error handling
- Search correctness and score ordering

**Test Coverage:**
- 25 unit tests
- Tests for all public API methods
- Thread safety verification
- Persistence testing
- Embedding normalization and determinism

### `integration_test.cpp`
Integration test demonstrating real-world usage:
- Adding multiple memories to the knowledge base
- Semantic search with various queries
- Updating existing memories
- User preferences storage
- Memory removal
- Persistence verification
- Embedding property validation

This test provides a practical example of how to use the KB service.

## Building and Running Tests

### Build with tests enabled

```bash
cd kb-service
mkdir build
cd build
cmake .. -DBUILD_TESTS=ON
make -j$(nproc)
```

### Run unit tests

```bash
./kb-service-tests
```

Expected output:
```
[==========] Running 25 tests from 1 test suite.
[----------] Global test environment set-up.
[----------] 25 tests from KnowledgeBaseTest
[ RUN      ] KnowledgeBaseTest.AddMemoryAndCheckSize
[       OK ] KnowledgeBaseTest.AddMemoryAndCheckSize
...
[==========] 25 tests from 1 test suite ran.
[  PASSED  ] 25 tests.
```

### Run integration test

```bash
./kb-integration-test
```

This will output a detailed walkthrough of KB operations.

## Test Details

### Unit Tests

1. **AddMemoryAndCheckSize** - Basic add operation
2. **AddMemoryWithCustomId** - Custom ID support
3. **AddDuplicateIdShouldFail** - Duplicate prevention
4. **GeneratedIdFormat** - ID generation validation
5. **SearchReturnsRelevantResults** - Search correctness
6. **SearchEmptyIndexReturnsEmpty** - Empty index handling
7. **SearchRespectsTopK** - Result limit verification
8. **UpdateMemoryContent** - Update operation
9. **UpdateNonExistentMemoryFails** - Update error handling
10. **RemoveMemory** - Remove operation
11. **RemoveNonExistentMemoryFails** - Remove error handling
12. **UserPreferences** - Preference storage
13. **GetNonExistentPreference** - Preference error handling
14. **UpdateExistingPreference** - Preference update
15. **PersistenceReloadFromDisk** - Data persistence
16. **EmbeddingServiceDimension** - Embedding dimension check
17. **EmbeddingDeterminism** - Deterministic embedding
18. **EmbeddingNormalization** - Unit vector validation
19. **DifferentTextsHaveDifferentEmbeddings** - Embedding uniqueness
20. **EmptyStringEmbedding** - Edge case handling
21. **MultipleCategoriesSearch** - Category support
22. **ThreadSafetyConcurrentAdds** - Thread safety
23. **LargeBatchAdd** - Performance with large batches
24. **UpdateAfterMultipleAdds** - Update with multiple entries
25. **SearchScoreOrdering** - Score ranking correctness

### Integration Test Scenarios

1. **Adding memories** - Batch add with categories
2. **Searching** - Various semantic queries
3. **Updating** - Content and embedding update
4. **User preferences** - Key-value storage
5. **Removing** - Delete operation
6. **Persistence** - Reload verification
7. **Embedding correctness** - Properties validation

## Test Requirements

- Google Test (automatically fetched if not found)
- RocksDB
- FAISS
- OpenSSL
- nlohmann/json

## Continuous Integration

These tests should be run in CI/CD pipelines to ensure:
- Code correctness
- No regressions
- Performance stability
- Thread safety

## Debugging Failed Tests

If tests fail:

1. Check test output for specific failure
2. Verify all dependencies are installed
3. Check disk space for RocksDB operations
4. Ensure `/tmp` is writable
5. Run with verbose output: `./kb-service-tests --gtest_filter=TestName`

## Adding New Tests

When adding new functionality:

1. Add unit tests to `knowledge_base_test.cpp`
2. Update integration test if needed
3. Follow existing test patterns
4. Test both success and failure paths
5. Add edge cases

## Performance Benchmarks

Key performance characteristics validated by tests:

- **Add**: O(1) for storage, O(log n) for index
- **Search**: O(log n) with FAISS
- **Update**: O(n) due to index rebuild (can be optimized)
- **Remove**: O(n) due to index rebuild (can be optimized)

## Known Limitations

- Update/delete operations rebuild the entire FAISS index
  - This is acceptable for small-medium datasets
  - For large datasets, consider incremental index updates
- Mock embedding service uses SHA256 hashing
  - Not a true semantic embedding
  - Replace with real embedding model in production
