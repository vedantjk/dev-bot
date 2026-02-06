#include "request_handler.h"
#include "knowledge_base.h"
#include "embedding_service.h"
#include <chrono>

using json = nlohmann::json;

namespace kb {

RequestHandler::RequestHandler(std::shared_ptr<KnowledgeBase> kb, std::shared_ptr<EmbeddingService> embedder)
  : kb_(kb), embedder_(embedder) {}

std::string RequestHandler::handle(const std::string& request_json) {
  try {
    json request = json::parse(request_json);

    std::string endpoint = request.value("endpoint", "");
    json params = request.value("params", json::object());

    json response;

    if (endpoint == "/add") {
      response = handleAdd(params);
    } else if (endpoint == "/search") {
      response = handleSearch(params);
    } else if (endpoint == "/update") {
      response = handleUpdate(params);
    } else if (endpoint == "/remove") {
      response = handleRemove(params);
    } else if (endpoint == "/update_preference") {
      response = handleUpdatePreference(params);
    } else if (endpoint == "/get_preference") {
      response = handleGetPreference(params);
    } else {
      response["success"] = false;
      response["error"] = "Unknown endpoint: " + endpoint;
    }

    return response.dump();

  } catch (const json::exception& e) {
    json error_response;
    error_response["success"] = false;
    error_response["error"] = "JSON parse error: " + std::string(e.what());
    return error_response.dump();
  } catch (const std::exception& e) {
    json error_response;
    error_response["success"] = false;
    error_response["error"] = "Error: " + std::string(e.what());
    return error_response.dump();
  }
}

json RequestHandler::handleAdd(const json& params) {
  std::string content = params.value("content", "");
  std::string category = params.value("category", "general");
  std::string id = params.value("id", "");

  if (content.empty()) {
    json response;
    response["success"] = false;
    response["error"] = "Content is required";
    return response;
  }

  // Generate embedding
  std::vector<float> embedding = embedder_->embed(content);

  Memory memory;
  memory.id = id;
  memory.content = content;
  memory.category = category;
  memory.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::system_clock::now().time_since_epoch()
  ).count();
  memory.embedding = embedding;

  std::string generated_id = kb_->addAndReturnId(memory);
  bool success = !generated_id.empty();

  json response;
  response["success"] = success;
  if (success) {
    response["id"] = generated_id;
  } else {
    response["error"] = "Failed to add memory (may already exist)";
  }

  return response;
}

json RequestHandler::handleSearch(const json& params) {
  std::string query = params.value("query", "");
  int top_k = params.value("top_k", 5);

  if (query.empty()) {
    json response;
    response["success"] = false;
    response["error"] = "Query is required";
    return response;
  }

  // Generate query embedding
  std::vector<float> query_embedding = embedder_->embed(query);

  // Search
  std::vector<SearchResult> results = kb_->search(query_embedding, top_k);

  json response;
  response["success"] = true;
  response["results"] = json::array();

  for (const auto& result : results) {
    json item;
    item["id"] = result.id;
    item["content"] = result.content;
    item["category"] = result.category;
    item["score"] = result.score;
    item["timestamp"] = result.timestamp;
    response["results"].push_back(item);
  }

  return response;
}

json RequestHandler::handleUpdate(const json& params) {
  std::string id = params.value("id", "");
  std::string content = params.value("content", "");

  if (id.empty() || content.empty()) {
    json response;
    response["success"] = false;
    response["error"] = "ID and content are required";
    return response;
  }

  // Generate new embedding
  std::vector<float> embedding = embedder_->embed(content);

  bool success = kb_->update(id, content, embedding);

  json response;
  response["success"] = success;
  if (!success) {
    response["error"] = "Memory not found or update failed";
  }

  return response;
}

json RequestHandler::handleRemove(const json& params) {
  std::string id = params.value("id", "");

  if (id.empty()) {
    json response;
    response["success"] = false;
    response["error"] = "ID is required";
    return response;
  }

  bool success = kb_->remove(id);

  json response;
  response["success"] = success;
  if (!success) {
    response["error"] = "Memory not found";
  }

  return response;
}

json RequestHandler::handleUpdatePreference(const json& params) {
  std::string key = params.value("key", "");
  std::string value = params.value("value", "");

  if (key.empty()) {
    json response;
    response["success"] = false;
    response["error"] = "Key is required";
    return response;
  }

  bool success = kb_->updateUserPreference(key, value);

  json response;
  response["success"] = success;
  if (!success) {
    response["error"] = "Failed to update preference";
  }

  return response;
}

json RequestHandler::handleGetPreference(const json& params) {
  std::string key = params.value("key", "");

  if (key.empty()) {
    json response;
    response["success"] = false;
    response["error"] = "Key is required";
    return response;
  }

  std::string value = kb_->getUserPreference(key);

  json response;
  response["success"] = true;
  response["value"] = value;

  return response;
}

} // namespace kb
