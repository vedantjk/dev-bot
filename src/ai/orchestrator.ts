import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from '../config.js';
import { buildSystemPrompt } from './system-prompt.js';

interface McpToolEntry {
  client: Client;
  name: string;
}

interface OrchestratorOptions {
  onStatusMessage?: (message: string) => void;
}

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;
const MAX_TURNS = 25;

// Sonnet pricing per 1M tokens
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M
    + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

export class Orchestrator {
  private anthropic: Anthropic;
  private mcpClients: Client[] = [];
  private transports: StdioClientTransport[] = [];
  private toolMap: Map<string, McpToolEntry> = new Map();
  private anthropicTools: Anthropic.Tool[] = [];
  private systemPrompt: string;
  private onStatusMessage: ((message: string) => void) | null = null;

  constructor(options?: OrchestratorOptions) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.systemPrompt = buildSystemPrompt();
    this.onStatusMessage = options?.onStatusMessage ?? null;
  }

  async start(): Promise<void> {
    await this.spawnFilesystemServer();
    await this.spawnDevBotServer();
    await this.collectTools();
    console.log(`Orchestrator ready with ${this.anthropicTools.length} tools`);
  }

  async shutdown(): Promise<void> {
    for (const client of this.mcpClients) {
      try {
        await client.close();
      } catch {}
    }
    for (const transport of this.transports) {
      try {
        await transport.close();
      } catch {}
    }
  }

  private async spawnFilesystemServer(): Promise<void> {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', './repos'],
      stderr: 'pipe',
    });

    const client = new Client({ name: 'fs-client', version: '1.0.0' });
    await client.connect(transport);

    this.mcpClients.push(client);
    this.transports.push(transport);
    console.log('Filesystem MCP server connected');
  }

  private async spawnDevBotServer(): Promise<void> {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/mcp/dev-bot-server.ts'],
      env: {
        ...process.env as Record<string, string>,
        GITHUB_USERNAME: config.GITHUB_USERNAME,
        REPOS_DIR: './repos',
      },
      stderr: 'pipe',
    });

    const client = new Client({ name: 'devbot-client', version: '1.0.0' });
    await client.connect(transport);

    this.mcpClients.push(client);
    this.transports.push(transport);
    console.log('Dev Bot MCP server connected');
  }

  private async collectTools(): Promise<void> {
    for (const client of this.mcpClients) {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        this.toolMap.set(tool.name, { client, name: tool.name });
        this.anthropicTools.push({
          name: tool.name,
          description: tool.description ?? '',
          input_schema: {
            type: 'object' as const,
            properties: tool.inputSchema.properties ?? {},
            required: tool.inputSchema.required,
          },
        });
      }
    }
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    // Intercept send_status — handle in parent process directly
    if (name === 'send_status') {
      const message = String(input.message ?? '');
      if (this.onStatusMessage) {
        this.onStatusMessage(message);
      }
      return { content: `Status sent: "${message}"`, isError: false };
    }

    const entry = this.toolMap.get(name);
    if (!entry) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    const result = await entry.client.callTool({
      name,
      arguments: input,
    });

    const textContent = (result.content as any[])
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n') ?? '';

    return { content: textContent, isError: result.isError === true };
  }

  async handleRequest(userMessage: string): Promise<string> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`REQUEST: ${userMessage}`);
    console.log('='.repeat(60));

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    let totalIn = 0;
    let totalOut = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      console.log(`\n--- Turn ${turn + 1}/${MAX_TURNS} ---`);

      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: this.systemPrompt,
        tools: this.anthropicTools,
        messages,
      });

      totalIn += response.usage.input_tokens;
      totalOut += response.usage.output_tokens;
      const turnCost = calcCost(response.usage.input_tokens, response.usage.output_tokens);

      console.log(`  stop_reason: ${response.stop_reason}`);
      console.log(`  tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out ($${turnCost.toFixed(4)})`);

      // Log any text blocks Claude produced this turn
      for (const block of response.content) {
        if (block.type === 'text') {
          console.log(`  [text] ${block.text.slice(0, 200)}${block.text.length > 200 ? '...' : ''}`);
        }
      }

      if (response.stop_reason === 'end_turn') {
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        );
        const reply = textBlocks.map((b) => b.text).join('\n') || '(no response)';
        const totalCost = calcCost(totalIn, totalOut);
        console.log(`\nFINAL REPLY: ${reply.slice(0, 300)}${reply.length > 300 ? '...' : ''}`);
        console.log(`TOTAL: ${totalIn} in / ${totalOut} out | ${turn + 1} turns | $${totalCost.toFixed(4)}`);
        console.log('='.repeat(60));
        return reply;
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const inputStr = JSON.stringify(block.input);
          console.log(`  [tool_call] ${block.name}(${inputStr.slice(0, 150)}${inputStr.length > 150 ? '...' : ''})`);

          try {
            const { content, isError } = await this.executeTool(
              block.name,
              block.input as Record<string, unknown>,
            );
            console.log(`  [tool_result] ${isError ? 'ERROR: ' : ''}${content.slice(0, 150)}${content.length > 150 ? '...' : ''}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content,
              is_error: isError,
            });
          } catch (err: any) {
            console.log(`  [tool_error] ${err.message}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Tool error: ${err.message}`,
              is_error: true,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop reason
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      return textBlocks.map((b) => b.text).join('\n') || '(unexpected stop)';
    }

    return 'Max turns reached. The task may be incomplete.';
  }
}
