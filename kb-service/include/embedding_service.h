#pragma once

#include <string>
#include <vector>

namespace kb {

// Interface for embedding generation
// In a real implementation, this would call an external API or model
class EmbeddingService {
public:
  virtual ~EmbeddingService() = default;

  // Generate embedding from text (returns 1024-dim vector)
  virtual std::vector<float> embed(const std::string& text) = 0;

  virtual int dimension() const = 0;
};

// Mock implementation that uses simple hashing for testing
// In production, replace with actual embedding model or API call
class MockEmbeddingService : public EmbeddingService {
public:
  MockEmbeddingService(int dim = 1024);

  std::vector<float> embed(const std::string& text) override;
  int dimension() const override { return dim_; }

private:
  int dim_;
};

} // namespace kb
