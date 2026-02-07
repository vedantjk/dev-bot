import { Socket } from 'net';
import { promisify } from 'util';

export interface KBMemory {
  id?: string;
  content: string;
  category?: string;
  timestamp?: number;
  score?: number;
}

export interface KBSearchResult {
  id: string;
  content: string;
  category: string;
  score: number;
  timestamp: number;
}

export interface KBResponse {
  success: boolean;
  error?: string;
  id?: string;
  results?: KBSearchResult[];
  value?: string;
}

/**
 * Client for communicating with the kb-service via Unix socket
 */
export class KBClient {
  private socketPath: string;

  constructor(socketPath: string = '/tmp/dev-bot-kb.sock') {
    this.socketPath = socketPath;
  }

  /**
   * Send a request to the kb-service and return the response
   */
  private async sendRequest(endpoint: string, params: any): Promise<KBResponse> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let responseData = '';

      socket.on('data', (data) => {
        responseData += data.toString();
      });

      socket.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error}`));
        }
      });

      socket.on('error', (error) => {
        reject(new Error(`Socket error: ${error.message}`));
      });

      socket.connect(this.socketPath, () => {
        const request = JSON.stringify({ endpoint, params });
        socket.write(request);
        socket.end();
      });

      // Timeout after 10 seconds
      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Add a memory to the knowledge base
   */
  async add(content: string, category: string = 'general', id?: string): Promise<string> {
    const response = await this.sendRequest('/add', { content, category, id });
    if (!response.success) {
      throw new Error(response.error || 'Failed to add memory');
    }
    return response.id || '';
  }

  /**
   * Search for memories based on a query
   */
  async search(query: string, topK: number = 5): Promise<KBSearchResult[]> {
    const response = await this.sendRequest('/search', { query, top_k: topK });
    if (!response.success) {
      throw new Error(response.error || 'Failed to search');
    }
    return response.results || [];
  }

  /**
   * Update an existing memory
   */
  async update(id: string, content: string): Promise<void> {
    const response = await this.sendRequest('/update', { id, content });
    if (!response.success) {
      throw new Error(response.error || 'Failed to update memory');
    }
  }

  /**
   * Remove a memory
   */
  async remove(id: string): Promise<void> {
    const response = await this.sendRequest('/remove', { id });
    if (!response.success) {
      throw new Error(response.error || 'Failed to remove memory');
    }
  }

  /**
   * Update a user preference
   */
  async updatePreference(key: string, value: string): Promise<void> {
    const response = await this.sendRequest('/update_preference', { key, value });
    if (!response.success) {
      throw new Error(response.error || 'Failed to update preference');
    }
  }

  /**
   * Get a user preference
   */
  async getPreference(key: string): Promise<string> {
    const response = await this.sendRequest('/get_preference', { key });
    if (!response.success) {
      throw new Error(response.error || 'Failed to get preference');
    }
    return response.value || '';
  }
}
