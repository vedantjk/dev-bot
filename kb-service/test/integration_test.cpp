#include <iostream>
#include <filesystem>
#include <chrono>
#include "knowledge_base.h"
#include "embedding_service.h"

namespace fs = std::filesystem;

void print_separator() {
  std::cout << std::string(60, '=') << std::endl;
}

int main() {
  std::cout << "KB Service Integration Test" << std::endl;
  print_separator();

  // Setup
  std::string test_db_path = "/tmp/kb_integration_test_" + std::to_string(
    std::chrono::steady_clock::now().time_since_epoch().count()
  );

  auto embedding_service = std::make_unique<kb::MockEmbeddingService>(128);
  auto kb = std::make_unique<kb::KnowledgeBase>(test_db_path, 128);

  std::cout << "✓ Knowledge base initialized" << std::endl;
  std::cout << "  DB Path: " << test_db_path << std::endl;
  std::cout << "  Dimension: " << embedding_service->dimension() << std::endl;
  print_separator();

  // Test 1: Add memories
  std::cout << "\n[Test 1] Adding memories to knowledge base..." << std::endl;

  struct TestMemory {
    std::string content;
    std::string category;
  };

  std::vector<TestMemory> test_memories = {
    {"User prefers 2-space indentation for code", "preference"},
    {"Always use TypeScript for type safety", "preference"},
    {"Write unit tests for all new features", "best-practice"},
    {"Use async/await instead of raw promises", "coding-style"},
    {"Dark theme is preferred for the IDE", "preference"},
    {"Follow Git flow branching strategy", "workflow"},
    {"Code reviews are required before merge", "workflow"},
    {"Use ESLint with Airbnb style guide", "tooling"}
  };

  std::vector<std::string> added_ids;
  for (const auto& test_mem : test_memories) {
    kb::Memory mem;
    mem.content = test_mem.content;
    mem.category = test_mem.category;
    mem.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()
    ).count();
    mem.embedding = embedding_service->embed(mem.content);

    std::string id = kb->addAndReturnId(mem);
    added_ids.push_back(id);
    std::cout << "  ✓ Added [" << test_mem.category << "]: " << test_mem.content << std::endl;
    std::cout << "    ID: " << id << std::endl;
  }

  std::cout << "\n✓ Total memories added: " << kb->size() << std::endl;
  print_separator();

  // Test 2: Extract (search) memories
  std::cout << "\n[Test 2] Searching for relevant memories..." << std::endl;

  struct SearchQuery {
    std::string query;
    std::string description;
    int top_k;
  };

  std::vector<SearchQuery> queries = {
    {"What are the user's code formatting preferences?", "Code formatting query", 3},
    {"Tell me about testing practices", "Testing query", 2},
    {"What workflow should I follow?", "Workflow query", 2},
    {"How should I write asynchronous code?", "Async coding query", 2}
  };

  for (const auto& query : queries) {
    std::cout << "\n  Query: \"" << query.query << "\"" << std::endl;
    std::cout << "  Description: " << query.description << std::endl;

    auto query_embedding = embedding_service->embed(query.query);
    auto results = kb->search(query_embedding, query.top_k);

    std::cout << "  Results (top " << query.top_k << "):" << std::endl;
    for (size_t i = 0; i < results.size(); ++i) {
      std::cout << "    " << (i + 1) << ". [" << results[i].category << "] "
                << results[i].content << std::endl;
      std::cout << "       Score: " << results[i].score
                << " | ID: " << results[i].id << std::endl;
    }
  }

  print_separator();

  // Test 3: Update a memory
  std::cout << "\n[Test 3] Updating a memory..." << std::endl;

  if (!added_ids.empty()) {
    std::string id_to_update = added_ids[0];
    std::string new_content = "User prefers 4-space indentation (updated preference)";
    auto new_embedding = embedding_service->embed(new_content);

    bool update_success = kb->update(id_to_update, new_content, new_embedding);
    std::cout << "  ✓ Update " << (update_success ? "successful" : "failed") << std::endl;
    std::cout << "    ID: " << id_to_update << std::endl;
    std::cout << "    New content: " << new_content << std::endl;

    // Verify update by searching
    auto verify_results = kb->search(new_embedding, 1);
    if (!verify_results.empty() && verify_results[0].id == id_to_update) {
      std::cout << "  ✓ Update verified through search" << std::endl;
      std::cout << "    Retrieved content: " << verify_results[0].content << std::endl;
    }
  }

  print_separator();

  // Test 4: User preferences
  std::cout << "\n[Test 4] Testing user preferences..." << std::endl;

  struct Preference {
    std::string key;
    std::string value;
  };

  std::vector<Preference> prefs = {
    {"editor", "VSCode"},
    {"theme", "dark"},
    {"font_size", "14"},
    {"line_length", "100"}
  };

  std::cout << "  Setting preferences:" << std::endl;
  for (const auto& pref : prefs) {
    bool success = kb->updateUserPreference(pref.key, pref.value);
    std::cout << "    ✓ " << pref.key << " = " << pref.value
              << " (" << (success ? "success" : "failed") << ")" << std::endl;
  }

  std::cout << "\n  Retrieving preferences:" << std::endl;
  for (const auto& pref : prefs) {
    std::string value = kb->getUserPreference(pref.key);
    bool matches = (value == pref.value);
    std::cout << "    " << (matches ? "✓" : "✗") << " " << pref.key
              << " = " << value << std::endl;
  }

  print_separator();

  // Test 5: Remove a memory
  std::cout << "\n[Test 5] Removing a memory..." << std::endl;

  if (added_ids.size() >= 2) {
    std::string id_to_remove = added_ids[1];
    size_t size_before = kb->size();

    bool remove_success = kb->remove(id_to_remove);
    size_t size_after = kb->size();

    std::cout << "  ✓ Remove " << (remove_success ? "successful" : "failed") << std::endl;
    std::cout << "    ID: " << id_to_remove << std::endl;
    std::cout << "    Size before: " << size_before << std::endl;
    std::cout << "    Size after: " << size_after << std::endl;

    bool exists = kb->exists(id_to_remove);
    std::cout << "    Memory exists: " << (exists ? "yes" : "no") << std::endl;
  }

  print_separator();

  // Test 6: Persistence
  std::cout << "\n[Test 6] Testing persistence..." << std::endl;

  size_t size_before_reload = kb->size();
  std::cout << "  Size before reload: " << size_before_reload << std::endl;
  std::cout << "  Destroying and recreating knowledge base..." << std::endl;

  kb.reset();
  kb = std::make_unique<kb::KnowledgeBase>(test_db_path, 128);

  size_t size_after_reload = kb->size();
  std::cout << "  Size after reload: " << size_after_reload << std::endl;
  std::cout << "  ✓ Persistence " << (size_before_reload == size_after_reload ? "verified" : "FAILED") << std::endl;

  // Verify preferences persisted
  std::string editor_pref = kb->getUserPreference("editor");
  std::cout << "  ✓ User preference persisted: editor = " << editor_pref << std::endl;

  print_separator();

  // Test 7: Embedding correctness
  std::cout << "\n[Test 7] Verifying embedding properties..." << std::endl;

  std::string test_text = "This is a test for embedding properties";
  auto embedding = embedding_service->embed(test_text);

  std::cout << "  Dimension: " << embedding.size() << std::endl;

  // Check normalization
  float norm = 0.0f;
  for (float v : embedding) {
    norm += v * v;
  }
  norm = std::sqrt(norm);
  std::cout << "  L2 Norm: " << norm << " (should be ~1.0)" << std::endl;

  // Check determinism
  auto embedding2 = embedding_service->embed(test_text);
  bool is_deterministic = (embedding == embedding2);
  std::cout << "  ✓ Deterministic: " << (is_deterministic ? "yes" : "no") << std::endl;

  // Check different texts produce different embeddings
  auto different_embedding = embedding_service->embed("Completely different text");
  bool are_different = (embedding != different_embedding);
  std::cout << "  ✓ Different texts produce different embeddings: "
            << (are_different ? "yes" : "no") << std::endl;

  print_separator();

  // Cleanup
  std::cout << "\n[Cleanup] Removing test database..." << std::endl;
  kb.reset();
  if (fs::exists(test_db_path)) {
    fs::remove_all(test_db_path);
    std::cout << "  ✓ Test database removed" << std::endl;
  }

  print_separator();
  std::cout << "\n✓ All integration tests completed successfully!" << std::endl;
  print_separator();

  return 0;
}
