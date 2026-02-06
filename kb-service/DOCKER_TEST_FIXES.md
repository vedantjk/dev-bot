# Docker Test Execution Fixes

## Problem
The kb-service tests were not running properly in Docker builds. The tests would either fail to execute or encounter linking errors during the build process.

## Changes Made

### 1. Dockerfile Improvements

#### Added Library Configuration Updates
- Added `ldconfig` after installing RocksDB dependencies (line 16)
- Added `ldconfig` after installing FAISS (line 30)
- These ensure that shared libraries are properly registered and can be found by the linker

#### Enhanced Test Execution
Updated the test execution section (lines 48-54) to:
- Add verbose output with echo statements
- Use `--gtest_color=yes` flag for colored output
- Add explicit error handling with `|| (echo "..." && exit 1)`
- Show clear success message after all tests pass

Before:
```dockerfile
RUN cd build && ./kb-service-tests && ./kb-integration-test
```

After:
```dockerfile
RUN cd build && \
  echo "Running unit tests..." && \
  ./kb-service-tests --gtest_color=yes || (echo "Unit tests failed!" && exit 1) && \
  echo "Running integration tests..." && \
  ./kb-integration-test || (echo "Integration tests failed!" && exit 1) && \
  echo "All tests passed successfully!"
```

### 2. CMakeLists.txt Improvements

#### Google Test Configuration
Added proper configuration for Google Test when using FetchContent (lines 37-39):
```cmake
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
```

These settings:
- Ensure proper CRT linking on Windows-compatible builds
- Disable GMock to reduce build time and dependencies

#### Library Linking Order
Fixed linking order for all executables to include BLAS libraries:

**kb-service** (lines 58-66):
- Added `openblas` and `lapack` libraries
- Required by FAISS for vector operations

**kb-service-tests** (lines 98-108):
- Moved `GTest::gtest` and `GTest::gtest_main` to the top
- Added `openblas` and `lapack` libraries
- Proper order ensures correct symbol resolution

**kb-integration-test** (lines 133-142):
- Added `openblas` and `lapack` libraries
- Consistent with other executables

## Why These Changes Matter

### Library Linking Order
The order of libraries in `target_link_libraries` matters because:
1. The linker resolves symbols left-to-right
2. Libraries with dependencies must come before their dependencies
3. Google Test should be listed first for test executables
4. FAISS requires BLAS libraries (openblas/lapack) for numerical operations

### ldconfig Calls
Running `ldconfig` after installing libraries:
1. Updates the dynamic linker cache
2. Allows executables to find shared libraries at runtime
3. Prevents "library not found" errors during test execution

### Verbose Test Output
Enhanced test output helps with:
1. Debugging build failures in CI/CD
2. Understanding which tests fail
3. Verifying test execution in Docker logs

## Testing the Changes

### Local Docker Build (when Docker is available)
```bash
cd kb-service
docker build -t kb-service:test .
```

Expected output should include:
```
Running unit tests...
[==========] Running 25 tests from 1 test suite.
...
[  PASSED  ] 25 tests.
Running integration tests...
KB Service Integration Test
...
✓ All integration tests completed successfully!
All tests passed successfully!
```

### Manual Build (without Docker)
```bash
cd kb-service
mkdir -p build && cd build
cmake .. -DBUILD_TESTS=ON
make -j$(nproc)
./kb-service-tests
./kb-integration-test
```

## Dependencies

The following dependencies are required for tests:
- **Google Test**: Unit testing framework (auto-fetched if not found)
- **RocksDB**: Persistent key-value storage
- **FAISS**: Vector similarity search
- **OpenSSL**: Cryptographic operations
- **OpenBLAS**: BLAS implementation for FAISS
- **LAPACK**: Linear algebra routines for FAISS
- **nlohmann/json**: JSON parsing (header-only)

## Verified Test Coverage

### Unit Tests (25 tests in knowledge_base_test.cpp)
- ✅ Basic CRUD operations
- ✅ Memory persistence
- ✅ User preferences
- ✅ Embedding service functionality
- ✅ Thread safety
- ✅ Edge cases and error handling

### Integration Tests (integration_test.cpp)
- ✅ End-to-end workflow
- ✅ Semantic search
- ✅ Persistence verification
- ✅ Embedding properties

## Known Limitations

1. **Mock Embedding Service**: Uses SHA256 hashing instead of true semantic embeddings
   - Sufficient for testing storage and retrieval
   - Should be replaced with real embedding model in production

2. **Index Rebuilding**: Update/delete operations rebuild entire FAISS index
   - Acceptable for small-medium datasets
   - Consider incremental updates for large-scale production use

3. **Unix Domain Sockets**: Service uses Unix sockets (Linux/macOS only)
   - For Windows, modify to use TCP sockets or run via WSL2/Docker

## Troubleshooting

### Build Fails with "library not found"
- Ensure `ldconfig` is called after library installation
- Check that FAISS, RocksDB, and BLAS libraries are properly installed

### Tests Fail with Segmentation Fault
- Verify FAISS is built with correct flags
- Check that embedding dimensions match (128 in tests)
- Ensure `/tmp` is writable

### Linking Errors
- Verify library order in CMakeLists.txt
- Ensure all required libraries are linked
- Check that BLAS libraries (openblas, lapack) are available

## Future Improvements

1. Add CTest integration for better test reporting
2. Add memory sanitizers for debugging
3. Add performance benchmarks
4. Implement incremental FAISS index updates
5. Add more integration tests for concurrent operations
