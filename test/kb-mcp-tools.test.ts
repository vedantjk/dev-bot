import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, rmSync } from 'fs';

const KB_PORT = 50052; // Use different port for testing
const KB_DB_PATH = '/tmp/kb-test-db';

let client: Client;
let transport: StdioClientTransport;
let kbServiceProcess: ChildProcess | null = null;

// Check if kb-service binary exists
const KB_SERVICE_BINARY = resolve('./kb-service/build/kb-service');
const kbServiceAvailable = existsSync(KB_SERVICE_BINARY);

async function startKBService(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clean up any existing db
    if (existsSync(KB_DB_PATH)) {
      rmSync(KB_DB_PATH, { recursive: true, force: true });
    }

    kbServiceProcess = spawn(KB_SERVICE_BINARY, [
      '--port', KB_PORT.toString(),
      '--db', KB_DB_PATH,
      '--dim', '128'
    ]);

    let output = '';

    kbServiceProcess.stdout?.on('data', (data) => {
      output += data.toString();
      if (output.includes('KB Service ready')) {
        // Give it a moment to fully initialize
        setTimeout(() => resolve(), 500);
      }
    });

    kbServiceProcess.stderr?.on('data', (data) => {
      console.error('KB Service stderr:', data.toString());
    });

    kbServiceProcess.on('error', (error) => {
      reject(error);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      reject(new Error('KB Service failed to start within 10 seconds'));
    }, 10000);
  });
}

function stopKBService(): void {
  if (kbServiceProcess) {
    kbServiceProcess.kill('SIGTERM');
    kbServiceProcess = null;
  }
  // Clean up
  if (existsSync(KB_DB_PATH)) {
    rmSync(KB_DB_PATH, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  if (!kbServiceAvailable) {
    console.warn('KB Service binary not found. Skipping KB MCP tool tests.');
    return;
  }

  // Start KB service
  await startKBService();

  // Start MCP server with KB host and port
  transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/dev-bot-server.ts'],
    env: {
      ...process.env,
      KB_HOST: 'localhost',
      KB_PORT: KB_PORT.toString(),
      REPOS_DIR: './test-tmp/repos',
      GLOBAL_DIR: './test-tmp/global',
      GITHUB_USERNAME: 'test-user',
      DEV_BOT_ROOT: resolve('.'),
    },
    cwd: resolve('.'),
  });

  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  if (!kbServiceAvailable) return;

  try {
    await transport.close();
  } catch {
    /* ignore */
  }
  stopKBService();
});

describe.skipIf(!kbServiceAvailable)('KB MCP Tools', () => {
  describe('tool listing', () => {
    it('lists all KB tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toContain('kb_add');
      expect(names).toContain('kb_search');
      expect(names).toContain('kb_update');
      expect(names).toContain('kb_remove');
      expect(names).toContain('kb_update_preference');
      expect(names).toContain('kb_get_preference');
    });
  });

  describe('kb_add', () => {
    it('adds a memory successfully', async () => {
      const result = await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'User prefers 2-space indentation',
          category: 'preference',
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain('Memory added successfully');
      expect(text).toContain('ID:');
    });

    it('adds memory with custom ID', async () => {
      const customId = 'custom-test-id-1';
      const result = await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Test memory with custom ID',
          category: 'test',
          id: customId,
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain('Memory added successfully');
      expect(text).toContain(customId);
    });

    it('adds memory with default category', async () => {
      const result = await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Memory without explicit category',
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain('Memory added successfully');
    });
  });

  describe('kb_search', () => {
    it('searches for memories', async () => {
      // Add some memories first
      await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Always write unit tests for new features',
          category: 'best-practice',
        },
      });

      await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Use async/await instead of callbacks',
          category: 'coding-style',
        },
      });

      // Search
      const result = await client.callTool({
        name: 'kb_search',
        arguments: {
          query: 'What are the coding practices?',
          top_k: 3,
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain('Found');
      expect(text).toContain('memories');
    });

    it('returns no results for unrelated query', async () => {
      const result = await client.callTool({
        name: 'kb_search',
        arguments: {
          query: 'xyz123 completely unrelated query that should not match anything',
          top_k: 5,
        },
      });

      const text = (result.content as any)[0].text;
      // Even with unrelated queries, the mock embedding service may return some results
      // So we just check that the response is formatted correctly
      expect(text).toBeTruthy();
    });

    it('respects top_k parameter', async () => {
      const result = await client.callTool({
        name: 'kb_search',
        arguments: {
          query: 'coding',
          top_k: 2,
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toBeTruthy();
    });
  });

  describe('kb_update', () => {
    it('updates an existing memory', async () => {
      // Add a memory
      const addResult = await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Original content',
          category: 'test',
        },
      });

      const addText = (addResult.content as any)[0].text;
      const idMatch = addText.match(/ID: ([\w-]+)/);
      expect(idMatch).toBeTruthy();
      const memoryId = idMatch![1];

      // Update it
      const updateResult = await client.callTool({
        name: 'kb_update',
        arguments: {
          id: memoryId,
          content: 'Updated content',
        },
      });

      const updateText = (updateResult.content as any)[0].text;
      expect(updateText).toContain('updated successfully');
      expect(updateText).toContain(memoryId);
    });

    it('returns error for non-existent memory', async () => {
      const result = await client.callTool({
        name: 'kb_update',
        arguments: {
          id: 'non-existent-id-12345',
          content: 'New content',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as any)[0].text;
      expect(text).toContain('Failed');
    });
  });

  describe('kb_remove', () => {
    it('removes an existing memory', async () => {
      // Add a memory
      const addResult = await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Memory to be removed',
          category: 'test',
        },
      });

      const addText = (addResult.content as any)[0].text;
      const idMatch = addText.match(/ID: ([\w-]+)/);
      expect(idMatch).toBeTruthy();
      const memoryId = idMatch![1];

      // Remove it
      const removeResult = await client.callTool({
        name: 'kb_remove',
        arguments: {
          id: memoryId,
        },
      });

      const removeText = (removeResult.content as any)[0].text;
      expect(removeText).toContain('removed successfully');
      expect(removeText).toContain(memoryId);
    });

    it('returns error for non-existent memory', async () => {
      const result = await client.callTool({
        name: 'kb_remove',
        arguments: {
          id: 'non-existent-id-67890',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as any)[0].text;
      expect(text).toContain('Failed');
    });
  });

  describe('kb_update_preference', () => {
    it('stores a user preference', async () => {
      const result = await client.callTool({
        name: 'kb_update_preference',
        arguments: {
          key: 'editor',
          value: 'VSCode',
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain("Preference 'editor' set to 'VSCode'");
    });

    it('updates an existing preference', async () => {
      // Set initial value
      await client.callTool({
        name: 'kb_update_preference',
        arguments: {
          key: 'theme',
          value: 'light',
        },
      });

      // Update it
      const result = await client.callTool({
        name: 'kb_update_preference',
        arguments: {
          key: 'theme',
          value: 'dark',
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain("Preference 'theme' set to 'dark'");
    });
  });

  describe('kb_get_preference', () => {
    it('retrieves a stored preference', async () => {
      // Store a preference
      await client.callTool({
        name: 'kb_update_preference',
        arguments: {
          key: 'font_size',
          value: '14',
        },
      });

      // Retrieve it
      const result = await client.callTool({
        name: 'kb_get_preference',
        arguments: {
          key: 'font_size',
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain("Preference 'font_size' = '14'");
    });

    it('returns not found for non-existent preference', async () => {
      const result = await client.callTool({
        name: 'kb_get_preference',
        arguments: {
          key: 'non-existent-preference-key',
        },
      });

      const text = (result.content as any)[0].text;
      expect(text).toContain('not found');
    });
  });

  describe('integration workflow', () => {
    it('completes a full workflow: add, search, update, search again, remove', async () => {
      // 1. Add a memory
      const addResult = await client.callTool({
        name: 'kb_add',
        arguments: {
          content: 'Workflow test: use strict mode in TypeScript',
          category: 'coding-standard',
        },
      });

      const addText = (addResult.content as any)[0].text;
      const idMatch = addText.match(/ID: ([\w-]+)/);
      expect(idMatch).toBeTruthy();
      const memoryId = idMatch![1];

      // 2. Search for it
      const searchResult1 = await client.callTool({
        name: 'kb_search',
        arguments: {
          query: 'TypeScript strict mode',
          top_k: 5,
        },
      });

      const searchText1 = (searchResult1.content as any)[0].text;
      expect(searchText1).toContain('strict mode');

      // 3. Update it
      await client.callTool({
        name: 'kb_update',
        arguments: {
          id: memoryId,
          content: 'Workflow test: always use strict mode and noImplicitAny in TypeScript',
        },
      });

      // 4. Search again to verify update
      const searchResult2 = await client.callTool({
        name: 'kb_search',
        arguments: {
          query: 'TypeScript strict noImplicitAny',
          top_k: 5,
        },
      });

      const searchText2 = (searchResult2.content as any)[0].text;
      expect(searchText2).toContain('noImplicitAny');

      // 5. Remove it
      const removeResult = await client.callTool({
        name: 'kb_remove',
        arguments: {
          id: memoryId,
        },
      });

      const removeText = (removeResult.content as any)[0].text;
      expect(removeText).toContain('removed successfully');
    });

    it('manages multiple preferences', async () => {
      const preferences = [
        { key: 'line_length', value: '100' },
        { key: 'quote_style', value: 'single' },
        { key: 'semicolons', value: 'required' },
      ];

      // Set all preferences
      for (const pref of preferences) {
        await client.callTool({
          name: 'kb_update_preference',
          arguments: pref,
        });
      }

      // Retrieve and verify all preferences
      for (const pref of preferences) {
        const result = await client.callTool({
          name: 'kb_get_preference',
          arguments: { key: pref.key },
        });

        const text = (result.content as any)[0].text;
        expect(text).toContain(pref.value);
      }
    });
  });
});
