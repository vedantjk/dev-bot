# Dockerfile for building kb-service
# This is a multi-stage build that compiles the C++ knowledge base service

FROM ubuntu:22.04

# NOTE: This service uses Unix domain sockets which are only supported on Linux/macOS.
# For Windows compatibility, the service would need to be modified to use TCP sockets.
# To run on Windows, use Docker Desktop with WSL2 backend or modify the code to use TCP.

# Install build dependencies
RUN apt-get update && apt-get install -y \
  build-essential \
  cmake \
  git \
  pkg-config \
  libssl-dev \
  librocksdb-dev \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Install FAISS
RUN apt-get update && apt-get install -y \
  libopenblas-dev \
  liblapack-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
RUN git clone https://github.com/facebookresearch/faiss.git && \
  cd faiss && \
  cmake -B build -DFAISS_ENABLE_GPU=OFF -DFAISS_ENABLE_PYTHON=OFF -DBUILD_TESTING=OFF . && \
  make -C build -j$(nproc) && \
  make -C build install && \
  cd .. && rm -rf faiss

# Install nlohmann_json
RUN wget https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp && \
  mkdir -p /usr/local/include/nlohmann && \
  mv json.hpp /usr/local/include/nlohmann/

# Copy kb-service source code
WORKDIR /app
COPY kb-service/ ./kb-service/

# Build the application
WORKDIR /app/kb-service
RUN mkdir -p build && \
  cd build && \
  cmake .. && \
  make -j$(nproc)

# Create data directory
RUN mkdir -p /data

# Expose unix socket
VOLUME ["/tmp", "/data"]

# Run the service
CMD ["./build/kb-service"]
