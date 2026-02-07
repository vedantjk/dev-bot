#pragma once

#include <string>
#include <memory>
#include <functional>
#include <atomic>
#include <thread>
#include <vector>
#include <mutex>

namespace kb {

class KnowledgeBase;
class RequestHandler;

class TCPServer {
public:
  TCPServer(int port, std::shared_ptr<KnowledgeBase> kb, std::shared_ptr<RequestHandler> handler);
  ~TCPServer();

  void start();
  void stop();
  bool isRunning() const { return running_; }

private:
  void acceptLoop();
  void handleClient(int client_fd);
  void joinAllThreads();

  int port_;
  std::shared_ptr<KnowledgeBase> kb_;
  std::shared_ptr<RequestHandler> handler_;
  int server_fd_;
  std::atomic<bool> running_;
  std::thread accept_thread_;
  std::vector<std::shared_ptr<std::thread>> client_threads_;
  std::mutex threads_mutex_;
  std::atomic<int> active_connections_;
};

} // namespace kb
