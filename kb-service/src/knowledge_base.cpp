#include "knowledge_base.h"
#include <chrono>
#include <sstream>
#include <iomanip>
#include <random>
#include <rocksdb/options.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace kb {

KnowledgeBase::KnowledgeBase(const std::string& db_path, int dimension)
  : dimension_(dimension), db_path_(db_path) {

  // Initialize FAISS index
  index_ = std::make_unique<faiss::IndexFlatL2>(dimension);

  // Open RocksDB
  rocksdb::Options options;
  options.create_if_missing = true;
  options.compression = rocksdb::kSnappyCompression;

  rocksdb::DB* db_ptr;
  rocksdb::Status status = rocksdb::DB::Open(options, db_path, &db_ptr);
  if (!status.ok()) {
    throw std::runtime_error("Failed to open RocksDB: " + status.ToString());
  }
  db_.reset(db_ptr);

  // Load existing index from RocksDB
  loadIndex();
}

KnowledgeBase::~KnowledgeBase() {
  saveIndex();
}

void KnowledgeBase::loadIndex() {
  rocksdb::Iterator* it = db_->NewIterator(rocksdb::ReadOptions());

  std::vector<float> all_vectors;
  id_map_.clear();

  for (it->SeekToFirst(); it->Valid(); it->Next()) {
    std::string key = it->key().ToString();

    // Skip metadata keys
    if (key.rfind("meta:", 0) == 0) continue;
    if (key.rfind("pref:", 0) == 0) continue;

    std::string value = it->value().ToString();

    try {
      json doc = json::parse(value);
      if (doc.contains("embedding") && doc["embedding"].is_array()) {
        id_map_.push_back(key);
        for (const auto& v : doc["embedding"]) {
          all_vectors.push_back(v.get<float>());
        }
      }
    } catch (...) {
      // Skip invalid entries
    }
  }

  delete it;

  // Add all vectors to FAISS index
  if (!all_vectors.empty()) {
    index_->add(id_map_.size(), all_vectors.data());
  }
}

void KnowledgeBase::saveIndex() {
  // FAISS index is ephemeral, vectors are persisted in RocksDB
  // No need to save separately
}

std::string KnowledgeBase::generateId() {
  auto now = std::chrono::system_clock::now();
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();

  std::random_device rd;
  std::mt19937 gen(rd());
  std::uniform_int_distribution<> dis(1000, 9999);

  std::ostringstream oss;
  oss << "mem_" << ms << "_" << dis(gen);
  return oss.str();
}

bool KnowledgeBase::add(const Memory& memory) {
  return !addAndReturnId(memory).empty();
}

std::string KnowledgeBase::addAndReturnId(const Memory& memory) {
  std::lock_guard<std::mutex> lock(index_mutex_);

  std::string id = memory.id.empty() ? generateId() : memory.id;

  // Check if already exists
  if (exists(id)) {
    return "";
  }

  // Store in RocksDB
  json doc;
  doc["id"] = id;
  doc["content"] = memory.content;
  doc["category"] = memory.category;
  doc["timestamp"] = memory.timestamp;
  doc["embedding"] = memory.embedding;

  std::string serialized = doc.dump();
  rocksdb::Status status = db_->Put(rocksdb::WriteOptions(), id, serialized);
  if (!status.ok()) {
    return "";
  }

  // Add to FAISS index
  id_map_.push_back(id);
  index_->add(1, memory.embedding.data());

  return id;
}

std::vector<SearchResult> KnowledgeBase::search(const std::vector<float>& query_embedding, int top_k) {
  std::lock_guard<std::mutex> lock(index_mutex_);

  std::vector<SearchResult> results;

  if (index_->ntotal == 0) {
    return results;
  }

  // FAISS search
  top_k = std::min(top_k, static_cast<int>(index_->ntotal));
  std::vector<float> distances(top_k);
  std::vector<faiss::idx_t> indices(top_k);

  index_->search(1, query_embedding.data(), top_k, distances.data(), indices.data());

  // Retrieve full documents from RocksDB
  for (int i = 0; i < top_k; ++i) {
    if (indices[i] < 0 || indices[i] >= static_cast<int>(id_map_.size())) {
      continue;
    }

    std::string id = id_map_[indices[i]];
    std::string value;
    rocksdb::Status status = db_->Get(rocksdb::ReadOptions(), id, &value);

    if (status.ok()) {
      try {
        json doc = json::parse(value);
        SearchResult result;
        result.id = id;
        result.content = doc.value("content", "");
        result.category = doc.value("category", "");
        result.score = distances[i];
        result.timestamp = doc.value("timestamp", 0L);
        results.push_back(result);
      } catch (...) {
        // Skip invalid entries
      }
    }
  }

  return results;
}

bool KnowledgeBase::update(const std::string& id, const std::string& content, const std::vector<float>& embedding) {
  std::lock_guard<std::mutex> lock(index_mutex_);

  std::string value;
  rocksdb::Status status = db_->Get(rocksdb::ReadOptions(), id, &value);

  if (!status.ok()) {
    return false;
  }

  try {
    json doc = json::parse(value);
    doc["content"] = content;
    doc["embedding"] = embedding;
    doc["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()
    ).count();

    std::string serialized = doc.dump();
    db_->Put(rocksdb::WriteOptions(), id, serialized);

    // Rebuild FAISS index
    index_->reset();
    id_map_.clear();
    loadIndex();

    return true;
  } catch (...) {
    return false;
  }
}

bool KnowledgeBase::remove(const std::string& id) {
  std::lock_guard<std::mutex> lock(index_mutex_);

  rocksdb::Status status = db_->Delete(rocksdb::WriteOptions(), id);

  if (status.ok()) {
    // Rebuild FAISS index
    index_->reset();
    id_map_.clear();
    loadIndex();
    return true;
  }

  return false;
}

bool KnowledgeBase::updateUserPreference(const std::string& key, const std::string& value) {
  std::string pref_key = "pref:" + key;
  rocksdb::Status status = db_->Put(rocksdb::WriteOptions(), pref_key, value);
  return status.ok();
}

std::string KnowledgeBase::getUserPreference(const std::string& key) {
  std::string pref_key = "pref:" + key;
  std::string value;
  rocksdb::Status status = db_->Get(rocksdb::ReadOptions(), pref_key, &value);

  if (status.ok()) {
    return value;
  }
  return "";
}

bool KnowledgeBase::exists(const std::string& id) {
  std::string value;
  rocksdb::Status status = db_->Get(rocksdb::ReadOptions(), id, &value);
  return status.ok();
}

size_t KnowledgeBase::size() const {
  return index_->ntotal;
}

} // namespace kb
