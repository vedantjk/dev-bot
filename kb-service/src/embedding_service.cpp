#include "embedding_service.h"
#include <openssl/sha.h>
#include <cmath>

namespace kb {

MockEmbeddingService::MockEmbeddingService(int dim) : dim_(dim) {}

std::vector<float> MockEmbeddingService::embed(const std::string& text) {
  // Simple hash-based embedding for testing
  // In production, replace with actual embedding model (e.g., Sentence-BERT, OpenAI API)

  std::vector<float> embedding(dim_, 0.0f);

  if (text.empty()) {
    return embedding;
  }

  // Compute SHA256 hash
  unsigned char hash[SHA256_DIGEST_LENGTH];
  SHA256(reinterpret_cast<const unsigned char*>(text.c_str()), text.length(), hash);

  // Expand hash to fill embedding dimension
  for (int i = 0; i < dim_; ++i) {
    int hash_idx = i % SHA256_DIGEST_LENGTH;
    int byte_idx = (i / SHA256_DIGEST_LENGTH) % SHA256_DIGEST_LENGTH;

    // Combine multiple hash bytes to create pseudo-random values
    unsigned char combined = hash[hash_idx] ^ hash[byte_idx];
    embedding[i] = (static_cast<float>(combined) / 255.0f) * 2.0f - 1.0f;
  }

  // Normalize to unit length
  float norm = 0.0f;
  for (float v : embedding) {
    norm += v * v;
  }
  norm = std::sqrt(norm);

  if (norm > 0.0f) {
    for (float& v : embedding) {
      v /= norm;
    }
  }

  return embedding;
}

} // namespace kb
