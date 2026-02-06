#include <gtest/gtest.h>
#include <filesystem>
#include <thread>
#include <chrono>
#include "knowledge_base.h"
#include "embedding_service.h"

namespace fs = std::filesystem;

class KnowledgeBaseTest : public ::testing::Test {
protected:
  void SetUp() override {
    // Create temporary test directory
    test_db_path_ = "/tmp/kb_test_" + std::to_string(
      std::chrono::steady_clock::now().time_since_epoch().count()
    );

    embedding_service_ = std::make_unique<kb::MockEmbeddingService>(128);
    kb_ = std::make_unique<kb::KnowledgeBase>(test_db_path_, 128);
  }

  void TearDown() override {
    kb_.reset();
    embedding_service_.reset();

    // Clean up test database
    if (fs::exists(test_db_path_)) {
      fs::remove_all(test_db_path_);
    }
  }

  std::string test_db_path_;
  std::unique_ptr<kb::MockEmbeddingService> embedding_service_;
  std::unique_ptr<kb::KnowledgeBase> kb_;
};

// Test 1: Basic Add and Size
TEST_F(KnowledgeBaseTest, AddMemoryAndCheckSize) {
  EXPECT_EQ(kb_->size(), 0);

  kb::Memory mem;
  mem.content = "User prefers 2-space indentation";
  mem.category = "preference";
  mem.timestamp = 1234567890000;
  mem.embedding = embedding_service_->embed(mem.content);

  bool success = kb_->add(mem);
  EXPECT_TRUE(success);
  EXPECT_EQ(kb_->size(), 1);
}

// Test 2: Add with Custom ID
TEST_F(KnowledgeBaseTest, AddMemoryWithCustomId) {
  kb::Memory mem;
  mem.id = "custom_id_123";
  mem.content = "Custom ID test";
  mem.category = "test";
  mem.timestamp = 1234567890000;
  mem.embedding = embedding_service_->embed(mem.content);

  std::string returned_id = kb_->addAndReturnId(mem);
  EXPECT_EQ(returned_id, "custom_id_123");
  EXPECT_TRUE(kb_->exists("custom_id_123"));
}

// Test 3: Add Duplicate ID Should Fail
TEST_F(KnowledgeBaseTest, AddDuplicateIdShouldFail) {
  kb::Memory mem;
  mem.id = "duplicate_test";
  mem.content = "First entry";
  mem.category = "test";
  mem.timestamp = 1234567890000;
  mem.embedding = embedding_service_->embed(mem.content);

  std::string id1 = kb_->addAndReturnId(mem);
  EXPECT_EQ(id1, "duplicate_test");

  // Try to add again with same ID
  mem.content = "Second entry";
  std::string id2 = kb_->addAndReturnId(mem);
  EXPECT_EQ(id2, "");  // Should fail
  EXPECT_EQ(kb_->size(), 1);  // Size should remain 1
}

// Test 4: Generated ID Format
TEST_F(KnowledgeBaseTest, GeneratedIdFormat) {
  kb::Memory mem;
  mem.content = "Auto-generated ID test";
  mem.category = "test";
  mem.timestamp = 1234567890000;
  mem.embedding = embedding_service_->embed(mem.content);

  std::string id = kb_->addAndReturnId(mem);
  EXPECT_FALSE(id.empty());
  EXPECT_TRUE(id.rfind("mem_", 0) == 0);  // Should start with "mem_"
}

// Test 5: Search Functionality
TEST_F(KnowledgeBaseTest, SearchReturnsRelevantResults) {
  // Add multiple memories
  std::vector<std::string> contents = {
    "User prefers 2-space indentation",
    "Use TypeScript for type safety",
    "Always write unit tests",
    "Prefer async/await over promises"
  };

  for (const auto& content : contents) {
    kb::Memory mem;
    mem.content = content;
    mem.category = "preference";
    mem.timestamp = 1234567890000;
    mem.embedding = embedding_service_->embed(content);
    kb_->add(mem);
  }

  EXPECT_EQ(kb_->size(), 4);

  // Search for indentation preference
  auto query_embedding = embedding_service_->embed("User prefers 2-space indentation");
  auto results = kb_->search(query_embedding, 2);

  EXPECT_EQ(results.size(), 2);
  EXPECT_FALSE(results.empty());

  // First result should be exact match (lowest L2 distance)
  EXPECT_EQ(results[0].content, "User prefers 2-space indentation");
  EXPECT_EQ(results[0].category, "preference");

  // Score should be very low (close to 0) for exact match
  EXPECT_LT(results[0].score, 0.1f);
}

// Test 6: Search with Empty Index
TEST_F(KnowledgeBaseTest, SearchEmptyIndexReturnsEmpty) {
  auto query_embedding = embedding_service_->embed("test query");
  auto results = kb_->search(query_embedding, 5);
  EXPECT_TRUE(results.empty());
}

// Test 7: Search Respects top_k Limit
TEST_F(KnowledgeBaseTest, SearchRespectsTopK) {
  // Add 10 memories
  for (int i = 0; i < 10; ++i) {
    kb::Memory mem;
    mem.content = "Memory " + std::to_string(i);
    mem.category = "test";
    mem.timestamp = 1234567890000 + i;
    mem.embedding = embedding_service_->embed(mem.content);
    kb_->add(mem);
  }

  auto query_embedding = embedding_service_->embed("Memory 0");
  auto results = kb_->search(query_embedding, 3);

  EXPECT_EQ(results.size(), 3);
}

// Test 8: Update Memory
TEST_F(KnowledgeBaseTest, UpdateMemoryContent) {
  kb::Memory mem;
  mem.id = "update_test";
  mem.content = "Original content";
  mem.category = "test";
  mem.timestamp = 1234567890000;
  mem.embedding = embedding_service_->embed(mem.content);

  kb_->addAndReturnId(mem);

  // Update the memory
  std::string new_content = "Updated content";
  auto new_embedding = embedding_service_->embed(new_content);
  bool success = kb_->update("update_test", new_content, new_embedding);

  EXPECT_TRUE(success);

  // Search to verify update
  auto results = kb_->search(new_embedding, 1);
  EXPECT_EQ(results.size(), 1);
  EXPECT_EQ(results[0].id, "update_test");
  EXPECT_EQ(results[0].content, "Updated content");
  EXPECT_GT(results[0].timestamp, 1234567890000);  // Timestamp should be updated
}

// Test 9: Update Non-existent Memory
TEST_F(KnowledgeBaseTest, UpdateNonExistentMemoryFails) {
  auto embedding = embedding_service_->embed("test");
  bool success = kb_->update("non_existent_id", "content", embedding);
  EXPECT_FALSE(success);
}

// Test 10: Remove Memory
TEST_F(KnowledgeBaseTest, RemoveMemory) {
  kb::Memory mem;
  mem.id = "remove_test";
  mem.content = "To be removed";
  mem.category = "test";
  mem.timestamp = 1234567890000;
  mem.embedding = embedding_service_->embed(mem.content);

  kb_->addAndReturnId(mem);
  EXPECT_EQ(kb_->size(), 1);
  EXPECT_TRUE(kb_->exists("remove_test"));

  bool success = kb_->remove("remove_test");
  EXPECT_TRUE(success);
  EXPECT_EQ(kb_->size(), 0);
  EXPECT_FALSE(kb_->exists("remove_test"));
}

// Test 11: Remove Non-existent Memory
TEST_F(KnowledgeBaseTest, RemoveNonExistentMemoryFails) {
  bool success = kb_->remove("non_existent_id");
  EXPECT_FALSE(success);
}

// Test 12: User Preferences
TEST_F(KnowledgeBaseTest, UserPreferences) {
  bool success = kb_->updateUserPreference("indentation", "2 spaces");
  EXPECT_TRUE(success);

  std::string value = kb_->getUserPreference("indentation");
  EXPECT_EQ(value, "2 spaces");
}

// Test 13: Get Non-existent Preference
TEST_F(KnowledgeBaseTest, GetNonExistentPreference) {
  std::string value = kb_->getUserPreference("non_existent_key");
  EXPECT_EQ(value, "");
}

// Test 14: Update Existing Preference
TEST_F(KnowledgeBaseTest, UpdateExistingPreference) {
  kb_->updateUserPreference("theme", "dark");
  EXPECT_EQ(kb_->getUserPreference("theme"), "dark");

  kb_->updateUserPreference("theme", "light");
  EXPECT_EQ(kb_->getUserPreference("theme"), "light");
}

// Test 15: Persistence - Reload from Disk
TEST_F(KnowledgeBaseTest, PersistenceReloadFromDisk) {
  // Add some memories
  for (int i = 0; i < 3; ++i) {
    kb::Memory mem;
    mem.content = "Persistent memory " + std::to_string(i);
    mem.category = "test";
    mem.timestamp = 1234567890000 + i;
    mem.embedding = embedding_service_->embed(mem.content);
    kb_->add(mem);
  }

  // Add user preference
  kb_->updateUserPreference("test_key", "test_value");

  size_t original_size = kb_->size();
  EXPECT_EQ(original_size, 3);

  // Destroy and recreate KB
  kb_.reset();
  kb_ = std::make_unique<kb::KnowledgeBase>(test_db_path_, 128);

  // Verify data persisted
  EXPECT_EQ(kb_->size(), original_size);
  EXPECT_EQ(kb_->getUserPreference("test_key"), "test_value");

  // Verify search still works
  auto query_embedding = embedding_service_->embed("Persistent memory 0");
  auto results = kb_->search(query_embedding, 1);
  EXPECT_FALSE(results.empty());
}

// Test 16: Embedding Service Dimension
TEST_F(KnowledgeBaseTest, EmbeddingServiceDimension) {
  EXPECT_EQ(embedding_service_->dimension(), 128);

  auto embedding = embedding_service_->embed("test");
  EXPECT_EQ(embedding.size(), 128);
}

// Test 17: Embedding Determinism
TEST_F(KnowledgeBaseTest, EmbeddingDeterminism) {
  std::string text = "deterministic test";
  auto embedding1 = embedding_service_->embed(text);
  auto embedding2 = embedding_service_->embed(text);

  EXPECT_EQ(embedding1.size(), embedding2.size());
  for (size_t i = 0; i < embedding1.size(); ++i) {
    EXPECT_FLOAT_EQ(embedding1[i], embedding2[i]);
  }
}

// Test 18: Embedding Normalization
TEST_F(KnowledgeBaseTest, EmbeddingNormalization) {
  auto embedding = embedding_service_->embed("normalization test");

  // Calculate L2 norm
  float norm = 0.0f;
  for (float v : embedding) {
    norm += v * v;
  }
  norm = std::sqrt(norm);

  // Should be approximately 1.0 (unit vector)
  EXPECT_NEAR(norm, 1.0f, 0.001f);
}

// Test 19: Different Texts Have Different Embeddings
TEST_F(KnowledgeBaseTest, DifferentTextsHaveDifferentEmbeddings) {
  auto embedding1 = embedding_service_->embed("text one");
  auto embedding2 = embedding_service_->embed("text two");

  bool are_different = false;
  for (size_t i = 0; i < embedding1.size(); ++i) {
    if (std::abs(embedding1[i] - embedding2[i]) > 0.001f) {
      are_different = true;
      break;
    }
  }

  EXPECT_TRUE(are_different);
}

// Test 20: Empty String Embedding
TEST_F(KnowledgeBaseTest, EmptyStringEmbedding) {
  auto embedding = embedding_service_->embed("");
  EXPECT_EQ(embedding.size(), 128);

  // All values should be 0.0 for empty string
  for (float v : embedding) {
    EXPECT_FLOAT_EQ(v, 0.0f);
  }
}

// Test 21: Multiple Categories
TEST_F(KnowledgeBaseTest, MultipleCategoriesSearch) {
  std::vector<std::pair<std::string, std::string>> memories = {
    {"User prefers dark theme", "preference"},
    {"Fix bug in auth module", "task"},
    {"Use TypeScript", "preference"},
    {"Implement user login", "task"}
  };

  for (const auto& [content, category] : memories) {
    kb::Memory mem;
    mem.content = content;
    mem.category = category;
    mem.timestamp = 1234567890000;
    mem.embedding = embedding_service_->embed(content);
    kb_->add(mem);
  }

  // Search for preferences
  auto query_embedding = embedding_service_->embed("User prefers dark theme");
  auto results = kb_->search(query_embedding, 2);

  EXPECT_FALSE(results.empty());
  EXPECT_EQ(results[0].category, "preference");
}

// Test 22: Thread Safety - Concurrent Adds
TEST_F(KnowledgeBaseTest, ThreadSafetyConcurrentAdds) {
  const int num_threads = 4;
  const int adds_per_thread = 10;

  std::vector<std::thread> threads;

  for (int t = 0; t < num_threads; ++t) {
    threads.emplace_back([this, t, adds_per_thread]() {
      for (int i = 0; i < adds_per_thread; ++i) {
        kb::Memory mem;
        mem.content = "Thread " + std::to_string(t) + " Memory " + std::to_string(i);
        mem.category = "concurrent";
        mem.timestamp = 1234567890000;
        mem.embedding = embedding_service_->embed(mem.content);
        kb_->add(mem);
      }
    });
  }

  for (auto& thread : threads) {
    thread.join();
  }

  EXPECT_EQ(kb_->size(), num_threads * adds_per_thread);
}

// Test 23: Large Batch Add
TEST_F(KnowledgeBaseTest, LargeBatchAdd) {
  const int batch_size = 100;

  for (int i = 0; i < batch_size; ++i) {
    kb::Memory mem;
    mem.content = "Batch memory " + std::to_string(i);
    mem.category = "batch";
    mem.timestamp = 1234567890000 + i;
    mem.embedding = embedding_service_->embed(mem.content);
    kb_->add(mem);
  }

  EXPECT_EQ(kb_->size(), batch_size);

  // Verify search still works
  auto query_embedding = embedding_service_->embed("Batch memory 50");
  auto results = kb_->search(query_embedding, 5);
  EXPECT_EQ(results.size(), 5);
}

// Test 24: Update After Multiple Adds
TEST_F(KnowledgeBaseTest, UpdateAfterMultipleAdds) {
  // Add multiple memories
  std::vector<std::string> ids;
  for (int i = 0; i < 5; ++i) {
    kb::Memory mem;
    mem.content = "Memory " + std::to_string(i);
    mem.category = "test";
    mem.timestamp = 1234567890000;
    mem.embedding = embedding_service_->embed(mem.content);
    ids.push_back(kb_->addAndReturnId(mem));
  }

  // Update middle memory
  std::string new_content = "Updated middle memory";
  auto new_embedding = embedding_service_->embed(new_content);
  bool success = kb_->update(ids[2], new_content, new_embedding);

  EXPECT_TRUE(success);
  EXPECT_EQ(kb_->size(), 5);

  // Verify other memories still exist
  for (const auto& id : ids) {
    EXPECT_TRUE(kb_->exists(id));
  }
}

// Test 25: Search Score Ordering
TEST_F(KnowledgeBaseTest, SearchScoreOrdering) {
  std::string exact_match = "exact match content";

  // Add exact match
  kb::Memory mem1;
  mem1.content = exact_match;
  mem1.category = "test";
  mem1.timestamp = 1234567890000;
  mem1.embedding = embedding_service_->embed(mem1.content);
  kb_->add(mem1);

  // Add different content
  kb::Memory mem2;
  mem2.content = "completely different content";
  mem2.category = "test";
  mem2.timestamp = 1234567890000;
  mem2.embedding = embedding_service_->embed(mem2.content);
  kb_->add(mem2);

  // Search with exact match query
  auto query_embedding = embedding_service_->embed(exact_match);
  auto results = kb_->search(query_embedding, 2);

  EXPECT_EQ(results.size(), 2);
  // First result should have lower score (L2 distance)
  EXPECT_LT(results[0].score, results[1].score);
  EXPECT_EQ(results[0].content, exact_match);
}

int main(int argc, char** argv) {
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}
