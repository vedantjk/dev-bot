cmake_minimum_required(VERSION 3.15)
project(kb-service VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find required packages
find_package(PkgConfig REQUIRED)

# RocksDB
find_library(ROCKSDB_LIB rocksdb REQUIRED)

# FAISS
find_library(FAISS_LIB faiss REQUIRED)

# JSON library (header-only)
find_package(nlohmann_json 3.2.0 QUIET)
if(NOT nlohmann_json_FOUND)
  # Fallback to manual include if package not found
  include_directories(/usr/local/include)
endif()

# OpenSSL for hashing
find_package(OpenSSL REQUIRED)

# Google Test for unit tests
option(BUILD_TESTS "Build unit tests" ON)
if(BUILD_TESTS)
  find_package(GTest QUIET)
  if(NOT GTest_FOUND)
    include(FetchContent)
    FetchContent_Declare(
      googletest
      GIT_REPOSITORY https://github.com/google/googletest.git
      GIT_TAG v1.14.0
    )
    # Set options before making available
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)
  endif()
  enable_testing()
endif()

# Add executable
add_executable(kb-service
  src/main.cpp
  src/server.cpp
  src/knowledge_base.cpp
  src/embedding_service.cpp
  src/request_handler.cpp
)

target_include_directories(kb-service PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(kb-service PRIVATE
  ${ROCKSDB_LIB}
  ${FAISS_LIB}
  OpenSSL::SSL
  OpenSSL::Crypto
  pthread
  openblas
  lapack
  gomp
)

# Link nlohmann_json if found as package
if(nlohmann_json_FOUND)
  target_link_libraries(kb-service PRIVATE nlohmann_json::nlohmann_json)
endif()

# Compiler flags
target_compile_options(kb-service PRIVATE
  -Wall
  -Wextra
  -Wpedantic
  -O3
)

# Install target
install(TARGETS kb-service
  RUNTIME DESTINATION bin
)

# Build tests
if(BUILD_TESTS)
  add_executable(kb-service-tests
    test/knowledge_base_test.cpp
    src/knowledge_base.cpp
    src/embedding_service.cpp
  )

  target_include_directories(kb-service-tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  )

  target_link_libraries(kb-service-tests PRIVATE
    GTest::gtest
    GTest::gtest_main
    ${ROCKSDB_LIB}
    ${FAISS_LIB}
    OpenSSL::SSL
    OpenSSL::Crypto
    pthread
    openblas
    lapack
    gomp
  )

  if(nlohmann_json_FOUND)
    target_link_libraries(kb-service-tests PRIVATE nlohmann_json::nlohmann_json)
  endif()

  target_compile_options(kb-service-tests PRIVATE
    -Wall
    -Wextra
    -Wpedantic
  )

  include(GoogleTest)
  gtest_discover_tests(kb-service-tests)

  # Integration test (standalone executable)
  add_executable(kb-integration-test
    test/integration_test.cpp
    src/knowledge_base.cpp
    src/embedding_service.cpp
  )

  target_include_directories(kb-integration-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  )

  target_link_libraries(kb-integration-test PRIVATE
    ${ROCKSDB_LIB}
    ${FAISS_LIB}
    OpenSSL::SSL
    OpenSSL::Crypto
    pthread
    openblas
    lapack
    gomp
  )

  if(nlohmann_json_FOUND)
    target_link_libraries(kb-integration-test PRIVATE nlohmann_json::nlohmann_json)
  endif()

  target_compile_options(kb-integration-test PRIVATE
    -Wall
    -Wextra
    -Wpedantic
  )
endif()
