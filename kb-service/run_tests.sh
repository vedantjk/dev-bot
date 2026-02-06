#!/bin/bash
# Test runner script for KB Service

set -e

BUILD_DIR="build"
VERBOSE=0

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose)
      VERBOSE=1
      shift
      ;;
    -c|--clean)
      echo "Cleaning build directory..."
      rm -rf "$BUILD_DIR"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [-v|--verbose] [-c|--clean]"
      exit 1
      ;;
  esac
done

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Configure with tests enabled
echo "Configuring CMake..."
cmake .. -DBUILD_TESTS=ON

# Build
echo "Building..."
make -j$(nproc)

echo ""
echo "=========================================="
echo "Running Unit Tests"
echo "=========================================="
echo ""

# Run unit tests
if [ $VERBOSE -eq 1 ]; then
  ./kb-service-tests --gtest_color=yes
else
  ./kb-service-tests --gtest_color=yes --gtest_brief=1
fi

UNIT_TEST_RESULT=$?

echo ""
echo "=========================================="
echo "Running Integration Test"
echo "=========================================="
echo ""

# Run integration test
./kb-integration-test

INTEGRATION_TEST_RESULT=$?

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""

if [ $UNIT_TEST_RESULT -eq 0 ]; then
  echo "✓ Unit tests: PASSED"
else
  echo "✗ Unit tests: FAILED"
fi

if [ $INTEGRATION_TEST_RESULT -eq 0 ]; then
  echo "✓ Integration test: PASSED"
else
  echo "✗ Integration test: FAILED"
fi

echo ""

if [ $UNIT_TEST_RESULT -eq 0 ] && [ $INTEGRATION_TEST_RESULT -eq 0 ]; then
  echo "All tests passed!"
  exit 0
else
  echo "Some tests failed!"
  exit 1
fi
