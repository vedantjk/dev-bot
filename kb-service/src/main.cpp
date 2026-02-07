#include "server.h"
#include "knowledge_base.h"
#include "embedding_service.h"
#include "request_handler.h"
#include <iostream>
#include <csignal>
#include <memory>
#include <cstdlib>
#include <thread>
#include <chrono>

static std::unique_ptr<kb::TCPServer> g_server;

void signalHandler(int signal) {
  std::cout << "\nReceived signal " << signal << ", shutting down..." << std::endl;
  if (g_server) {
    g_server->stop();
  }
  exit(0);
}

int main(int argc, char* argv[]) {
  int port = 50051;
  std::string db_path = "/data/kb.db";
  int dimension = 1024;

  // Parse command-line arguments
  for (int i = 1; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--port" && i + 1 < argc) {
      port = std::stoi(argv[++i]);
    } else if (arg == "--db" && i + 1 < argc) {
      db_path = argv[++i];
    } else if (arg == "--dim" && i + 1 < argc) {
      dimension = std::stoi(argv[++i]);
    } else if (arg == "--help") {
      std::cout << "Usage: " << argv[0] << " [options]\n"
                << "Options:\n"
                << "  --port PORT     TCP port to listen on (default: 50051)\n"
                << "  --db PATH       RocksDB path (default: /data/kb.db)\n"
                << "  --dim N         Embedding dimension (default: 1024)\n"
                << "  --help          Show this help\n";
      return 0;
    }
  }

  std::cout << "KB Service starting...\n"
            << "  Port: " << port << "\n"
            << "  DB: " << db_path << "\n"
            << "  Dimension: " << dimension << std::endl;

  try {
    // Initialize components
    auto kb = std::make_shared<kb::KnowledgeBase>(db_path, dimension);
    auto embedder = std::make_shared<kb::MockEmbeddingService>(dimension);
    auto handler = std::make_shared<kb::RequestHandler>(kb, embedder);

    // Create server
    g_server = std::make_unique<kb::TCPServer>(port, kb, handler);

    // Set up signal handlers
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    // Start server
    g_server->start();

    std::cout << "KB Service ready. Total memories: " << kb->size() << std::endl;

    // Keep main thread alive
    while (g_server->isRunning()) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }

  } catch (const std::exception& e) {
    std::cerr << "Fatal error: " << e.what() << std::endl;
    return 1;
  }

  return 0;
}
