import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { KBClient } from './kb/kb-client.js';

const LOGS_DIR = resolve('./logs');

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

// Generate timestamp for log file names
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
const logFile = join(LOGS_DIR, `dev-bot-${timestamp}.log`);

// Create base logger with file and console transports
const logger = pino({
  level: 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
    bindings: (bindings) => {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.multistream([
  // File transport - all logs
  {
    level: 'trace',
    stream: pino.destination({
      dest: logFile,
      sync: false,
    }),
  },
  // Console transport - formatted for readability
  {
    level: 'info',
    stream: pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    }),
  },
]));

export { logger, LOGS_DIR };

/**
 * Create a child logger for a specific component.
 */
export function createComponentLogger(component: string) {
  return logger.child({ component });
}

/**
 * Log request lifecycle events.
 */
export class RequestLogger {
  private requestId: string;
  private log: pino.Logger;
  private startTime: number;
  private kbClient: KBClient | null;

  constructor(requestId: string) {
    this.requestId = requestId;
    this.log = logger.child({ requestId });
    this.startTime = Date.now();

    // Initialize KB client for storing memories
    const KB_SOCKET_PATH = process.env.KB_SOCKET_PATH ?? '/tmp/dev-bot-kb.sock';
    try {
      this.kbClient = new KBClient(KB_SOCKET_PATH);
    } catch (error) {
      this.log.warn('KB client initialization failed, memory logging disabled');
      this.kbClient = null;
    }
  }

  /**
   * Log user input.
   */
  userInput(sender: string, message: string) {
    this.log.info({
      event: 'user_input',
      sender,
      message,
    }, 'User request received');
  }

  /**
   * Log agent phase start.
   */
  agentStart(agentType: string, prompt: string) {
    this.log.info({
      event: 'agent_start',
      agentType,
      prompt,
    }, `Starting ${agentType} agent`);
  }

  /**
   * Log agent thinking/text output.
   */
  agentThinking(agentType: string, text: string) {
    this.log.debug({
      event: 'agent_thinking',
      agentType,
      text,
    }, `${agentType} agent thinking`);
  }

  /**
   * Log tool usage.
   */
  toolUsage(agentType: string, toolName: string, input: any, result?: any, error?: any) {
    this.log.info({
      event: 'tool_usage',
      agentType,
      toolName,
      input,
      result: result ? this.truncate(JSON.stringify(result), 500) : undefined,
      error: error ? error.message : undefined,
    }, `Tool: ${toolName}`);
  }

  /**
   * Log agent completion.
   */
  agentComplete(agentType: string, result: string, stats?: {
    cost: number;
    turns: number;
    duration: number;
  }) {
    this.log.info({
      event: 'agent_complete',
      agentType,
      result: this.truncate(result, 500),
      ...stats,
    }, `${agentType} agent completed`);
  }

  /**
   * Log agent error.
   */
  agentError(agentType: string, error: Error) {
    this.log.error({
      event: 'agent_error',
      agentType,
      error: error.message,
      stack: error.stack,
    }, `${agentType} agent failed`);
  }

  /**
   * Log status message sent to user.
   */
  statusMessage(message: string) {
    this.log.info({
      event: 'status_message',
      message,
    }, 'Status message sent');
  }

  /**
   * Log final response sent to user.
   */
  response(message: string) {
    const duration = Date.now() - this.startTime;
    this.log.info({
      event: 'response',
      message: this.truncate(message, 1000),
      duration,
    }, `Request completed in ${duration}ms`);
  }

  /**
   * Log request error.
   */
  error(error: Error) {
    const duration = Date.now() - this.startTime;
    this.log.error({
      event: 'error',
      error: error.message,
      stack: error.stack,
      duration,
    }, `Request failed after ${duration}ms`);
  }

  /**
   * Log git operations.
   */
  gitOperation(operation: string, repo: string, details?: any) {
    this.log.info({
      event: 'git_operation',
      operation,
      repo,
      ...details,
    }, `Git: ${operation} on ${repo}`);
  }

  /**
   * Log KB operations and store as memory.
   */
  async kbOperation(
    operation: 'add' | 'search' | 'update' | 'remove' | 'update_preference' | 'get_preference',
    params: any,
    result?: any,
    error?: any
  ) {
    this.log.info({
      event: 'kb_operation',
      operation,
      params,
      result: result ? this.truncate(JSON.stringify(result), 500) : undefined,
      error: error ? error.message : undefined,
    }, `KB: ${operation}`);

    // Store KB operation as a memory for future reference
    // Skip logging for 'add' operations with category 'kb-operation' to prevent recursion
    if (this.kbClient && !error && !(operation === 'add' && params.category === 'kb-operation')) {
      try {
        const memoryContent = this.formatKBOperationAsMemory(operation, params, result);
        await this.kbClient.add(memoryContent, 'kb-operation');
      } catch (memError) {
        this.log.warn({
          event: 'kb_memory_storage_failed',
          error: memError instanceof Error ? memError.message : String(memError),
        }, 'Failed to store KB operation as memory');
      }
    }
  }

  /**
   * Format KB operation as a memory entry.
   */
  private formatKBOperationAsMemory(
    operation: string,
    params: any,
    result?: any
  ): string {
    const timestamp = new Date().toISOString();
    let content = `[${timestamp}] KB Operation: ${operation}\n`;

    switch (operation) {
      case 'add':
        content += `Added memory: "${params.content}" (category: ${params.category || 'general'})`;
        if (result?.id) content += `\nMemory ID: ${result.id}`;
        break;
      case 'search':
        content += `Searched for: "${params.query}" (top_k: ${params.top_k || 5})`;
        if (result?.results?.length > 0) {
          content += `\nFound ${result.results.length} results`;
        }
        break;
      case 'update':
        content += `Updated memory ${params.id}: "${params.content}"`;
        break;
      case 'remove':
        content += `Removed memory ${params.id}`;
        break;
      case 'update_preference':
        content += `Set preference '${params.key}' = '${params.value}'`;
        break;
      case 'get_preference':
        content += `Retrieved preference '${params.key}'`;
        if (result?.value) content += ` = '${result.value}'`;
        break;
    }

    return content;
  }

  /**
   * Truncate long strings for logging.
   */
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '... (truncated)';
  }
}
