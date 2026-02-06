#pragma once

#include <memory>
#include <string>
#include <vector>
#include <mutex>
#include <faiss/IndexFlat.h>
#include <rocksdb/db.h>

namespace kb {

struct Memory {
  std::string id;
  std::string content;
  std::string category;
  int64_t timestamp;
  std::vector<float> embedding;
};

struct SearchResult {
  std::string id;
  std::string content;
  std::string category;
  float score;
  int64_t timestamp;
};

class KnowledgeBase {
public:
  KnowledgeBase(const std::string& db_path, int dimension = 1024);
  ~KnowledgeBase();

  // Core operations
  bool add(const Memory& memory);
  std::string addAndReturnId(const Memory& memory);
  std::vector<SearchResult> search(const std::vector<float>& query_embedding, int top_k = 5);
  bool update(const std::string& id, const std::string& content, const std::vector<float>& embedding);
  bool remove(const std::string& id);

  // Metadata operations
  bool updateUserPreference(const std::string& key, const std::string& value);
  std::string getUserPreference(const std::string& key);

  // Utility
  bool exists(const std::string& id);
  size_t size() const;

private:
  void loadIndex();
  void saveIndex();
  std::string generateId();

  std::unique_ptr<faiss::IndexFlatL2> index_;
  std::unique_ptr<rocksdb::DB> db_;
  std::vector<std::string> id_map_;
  int dimension_;
  std::string db_path_;
  std::mutex index_mutex_;
};

} // namespace kb
