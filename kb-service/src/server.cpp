#include "server.h"
#include "knowledge_base.h"
#include "request_handler.h"
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <fcntl.h>
#include <iostream>
#include <cstring>
#include <thread>
#include <chrono>

namespace kb {

UnixSocketServer::UnixSocketServer(const std::string& socket_path, std::shared_ptr<KnowledgeBase> kb, std::shared_ptr<RequestHandler> handler)
  : socket_path_(socket_path), kb_(kb), handler_(handler), server_fd_(-1), running_(false), active_connections_(0) {}

UnixSocketServer::~UnixSocketServer() {
  stop();
}

void UnixSocketServer::start() {
  // Create socket
  server_fd_ = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server_fd_ < 0) {
    throw std::runtime_error("Failed to create socket");
  }

  // Remove existing socket file
  unlink(socket_path_.c_str());

  // Bind socket
  struct sockaddr_un addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, socket_path_.c_str(), sizeof(addr.sun_path) - 1);

  if (bind(server_fd_, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
    close(server_fd_);
    throw std::runtime_error("Failed to bind socket");
  }

  // Listen
  if (listen(server_fd_, 10) < 0) {
    close(server_fd_);
    throw std::runtime_error("Failed to listen on socket");
  }

  running_ = true;
  std::cout << "KB Service listening on " << socket_path_ << std::endl;

  // Accept connections in a separate thread
  accept_thread_ = std::thread(&UnixSocketServer::acceptLoop, this);
}

void UnixSocketServer::stop() {
  if (running_.exchange(false)) {
    // Close server socket to unblock accept()
    if (server_fd_ >= 0) {
      shutdown(server_fd_, SHUT_RDWR);
      close(server_fd_);
      server_fd_ = -1;
    }

    // Join accept thread
    if (accept_thread_.joinable()) {
      accept_thread_.join();
    }

    // Wait for all client connections to finish
    while (active_connections_.load() > 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    // Join all client threads
    joinAllThreads();

    unlink(socket_path_.c_str());
  }
}

void UnixSocketServer::acceptLoop() {
  while (running_.load()) {
    // Check if still running before blocking on accept
    if (!running_.load()) {
      break;
    }

    int client_fd = accept(server_fd_, nullptr, nullptr);
    if (client_fd < 0) {
      if (running_.load()) {
        std::cerr << "Accept failed" << std::endl;
      }
      break;
    }

    // Handle client in a separate thread
    active_connections_.fetch_add(1);
    auto thread_ptr = std::make_shared<std::thread>([this, client_fd]() {
      this->handleClient(client_fd);
      active_connections_.fetch_sub(1);
    });

    {
      std::lock_guard<std::mutex> lock(threads_mutex_);
      client_threads_.push_back(thread_ptr);
    }
  }
}

void UnixSocketServer::joinAllThreads() {
  std::lock_guard<std::mutex> lock(threads_mutex_);
  for (auto& thread_ptr : client_threads_) {
    if (thread_ptr && thread_ptr->joinable()) {
      thread_ptr->join();
    }
  }
  client_threads_.clear();
}

void UnixSocketServer::handleClient(int client_fd) {
  // Read request
  char buffer[65536];
  ssize_t bytes_read = recv(client_fd, buffer, sizeof(buffer) - 1, 0);

  if (bytes_read <= 0) {
    close(client_fd);
    return;
  }

  buffer[bytes_read] = '\0';
  std::string request(buffer);

  // Handle request
  std::string response = handler_->handle(request);

  // Send response
  send(client_fd, response.c_str(), response.length(), 0);

  close(client_fd);
}

} // namespace kb
