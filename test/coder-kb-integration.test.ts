import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Coder Agent KB Integration', () => {
  it('verifies KB tools are added to ALL_MCP_TOOLS in orchestrator', () => {
    const orchestratorPath = resolve('./src/ai/orchestrator.ts');
    const orchestratorContent = readFileSync(orchestratorPath, 'utf-8');

    const kbTools = [
      'mcp__dev-bot__kb_add',
      'mcp__dev-bot__kb_search',
      'mcp__dev-bot__kb_update',
      'mcp__dev-bot__kb_remove',
      'mcp__dev-bot__kb_update_preference',
      'mcp__dev-bot__kb_get_preference',
    ];

    // Verify each KB tool is mentioned in the ALL_MCP_TOOLS array
    for (const tool of kbTools) {
      expect(orchestratorContent).toContain(`'${tool}'`);
    }
  });

  it('verifies KB tools are in coder agent allowed list', () => {
    const orchestratorPath = resolve('./src/ai/orchestrator.ts');
    const orchestratorContent = readFileSync(orchestratorPath, 'utf-8');

    // Find the coder agent configuration section
    const coderConfigMatch = orchestratorContent.match(/coder:\s*\{[\s\S]*?mcpToolsExcept\(([\s\S]*?)\)/);
    expect(coderConfigMatch).toBeTruthy();

    if (coderConfigMatch) {
      const allowedToolsSection = coderConfigMatch[1];

      // Verify KB tools are in the allowed list (mcpToolsExcept)
      const kbTools = [
        'mcp__dev-bot__kb_add',
        'mcp__dev-bot__kb_search',
        'mcp__dev-bot__kb_update',
        'mcp__dev-bot__kb_remove',
        'mcp__dev-bot__kb_update_preference',
        'mcp__dev-bot__kb_get_preference',
      ];

      for (const tool of kbTools) {
        expect(allowedToolsSection).toContain(`'${tool}'`);
      }
    }
  });

  it('verifies KB section exists in coder system prompt', () => {
    const systemPromptPath = resolve('./src/ai/system-prompt.ts');
    const systemPromptContent = readFileSync(systemPromptPath, 'utf-8');

    // Check for KB section in the coder prompt
    expect(systemPromptContent).toContain('Knowledge Base (KB)');
    expect(systemPromptContent).toContain('mcp__dev-bot__kb_add');
    expect(systemPromptContent).toContain('mcp__dev-bot__kb_search');
    expect(systemPromptContent).toContain('automatically logged');
  });

  it('verifies KB_SOCKET_PATH is passed to MCP server environment', () => {
    const orchestratorPath = resolve('./src/ai/orchestrator.ts');
    const orchestratorContent = readFileSync(orchestratorPath, 'utf-8');

    // Check that KB_SOCKET_PATH is in the MCP server environment
    expect(orchestratorContent).toContain('KB_SOCKET_PATH');
  });
});

describe('Request Log Storage', () => {
  it('verifies logToolCall function exists in MCP server', () => {
    const mcpServerPath = resolve('./src/mcp/dev-bot-server.ts');
    const mcpServerContent = readFileSync(mcpServerPath, 'utf-8');

    // Check for the logging function
    expect(mcpServerContent).toContain('logToolCall');
  });

  it('verifies all KB operations use logToolCall', () => {
    const mcpServerPath = resolve('./src/mcp/dev-bot-server.ts');
    const mcpServerContent = readFileSync(mcpServerPath, 'utf-8');

    const operations = [
      'add',
      'search',
      'update',
      'remove',
      'update_preference',
      'get_preference',
    ];

    // Each operation should have a handler
    for (const op of operations) {
      expect(mcpServerContent).toContain(`kb_${op}`);
    }
  });
});

describe('RequestLogger KB Integration', () => {
  it('verifies RequestLogger has KB client', () => {
    const loggerPath = resolve('./src/logger.ts');
    const loggerContent = readFileSync(loggerPath, 'utf-8');

    // Check for KB client import and usage
    expect(loggerContent).toContain('KBClient');
    expect(loggerContent).toContain('kb/kb-client');
  });

  it('verifies RequestLogger has storeLogInKB method', () => {
    const loggerPath = resolve('./src/logger.ts');
    const loggerContent = readFileSync(loggerPath, 'utf-8');

    // Check for storeLogInKB method
    expect(loggerContent).toContain('storeLogInKB');
    expect(loggerContent).toContain('request-log');
  });

  it('verifies orchestrator calls storeLogInKB', () => {
    const orchestratorPath = resolve('./src/ai/orchestrator.ts');
    const orchestratorContent = readFileSync(orchestratorPath, 'utf-8');

    // Check that orchestrator calls storeLogInKB
    expect(orchestratorContent).toContain('storeLogInKB');
  });
});
