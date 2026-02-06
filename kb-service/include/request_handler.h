#pragma once

#include <string>
#include <memory>
#include <nlohmann/json.hpp>

namespace kb {

class KnowledgeBase;
class EmbeddingService;

class RequestHandler {
public:
  RequestHandler(std::shared_ptr<KnowledgeBase> kb, std::shared_ptr<EmbeddingService> embedder);

  std::string handle(const std::string& request_json);

private:
  nlohmann::json handleAdd(const nlohmann::json& params);
  nlohmann::json handleSearch(const nlohmann::json& params);
  nlohmann::json handleUpdate(const nlohmann::json& params);
  nlohmann::json handleRemove(const nlohmann::json& params);
  nlohmann::json handleUpdatePreference(const nlohmann::json& params);
  nlohmann::json handleGetPreference(const nlohmann::json& params);

  std::shared_ptr<KnowledgeBase> kb_;
  std::shared_ptr<EmbeddingService> embedder_;
};

} // namespace kb
