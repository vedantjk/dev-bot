import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolve } from 'path';
import { readdirSync } from 'fs';
import simpleGit from 'simple-git';
import { config } from '../config.js';
import { buildCoderPrompt, buildReviewerPrompt, buildCommitterPrompt } from './system-prompt.js';
import { RequestLogger } from '../logger.js';

interface OrchestratorOptions {
  onStatusMessage?: (message: string) => void;
}

type AgentType = 'coder' | 'reviewer' | 'committer';

interface AgentConfig {
  systemPrompt: string;
  disallowedTools: string[];
  maxTurns: number;
}

// Tools we always block for every agent
const ALWAYS_BLOCKED = [
  'Bash', 'Task', 'Skill', 'TodoWrite', 'TodoRead', 'NotebookEdit',
];

// Every MCP tool exposed by dev-bot-server
const ALL_MCP_TOOLS = [
  'mcp__dev-bot__git_clone',
  'mcp__dev-bot__git_pull',
  'mcp__dev-bot__git_status',
  'mcp__dev-bot__git_diff',
  'mcp__dev-bot__git_commit_and_push',
  'mcp__dev-bot__create_github_repo',
  'mcp__dev-bot__delete_file',
  'mcp__dev-bot__send_status',
  'mcp__dev-bot__write_steering_file',
  'mcp__dev-bot__docker_build',
];

/** Return all MCP tool names EXCEPT the ones listed. */
function mcpToolsExcept(...allowed: string[]): string[] {
  return ALL_MCP_TOOLS.filter((t) => !allowed.includes(t));
}

/** Per-agent configs: system prompt, disallowed tools, max turns. */
const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  coder: {
    systemPrompt: buildCoderPrompt(),
    maxTurns: 50,
    disallowedTools: [
      ...ALWAYS_BLOCKED,
      'WebSearch', 'WebFetch',
      ...mcpToolsExcept(
        'mcp__dev-bot__git_clone',
        'mcp__dev-bot__git_pull',
        'mcp__dev-bot__delete_file',
        'mcp__dev-bot__docker_build',
      ),
    ],
  },
  reviewer: {
    systemPrompt: buildReviewerPrompt(),
    maxTurns: 10,
    disallowedTools: [
      ...ALWAYS_BLOCKED,
      'Write', 'Edit',
      ...mcpToolsExcept(
        'mcp__dev-bot__git_status',
        'mcp__dev-bot__git_diff',
        'mcp__dev-bot__write_steering_file',
      ),
    ],
  },
  committer: {
    systemPrompt: buildCommitterPrompt(),
    maxTurns: 5,
    disallowedTools: [
      ...ALWAYS_BLOCKED,
      'Write', 'Edit', 'WebSearch', 'WebFetch',
      ...mcpToolsExcept(
        'mcp__dev-bot__git_status',
        'mcp__dev-bot__git_commit_and_push',
        'mcp__dev-bot__create_github_repo',
      ),
    ],
  },
};

/** Result from a single agent run, including which tools it called. */
interface AgentResult {
  text: string;
  toolsUsed: Set<string>;
}

export class Orchestrator {
  private onStatusMessage: ((message: string) => void) | null;

  constructor(options?: OrchestratorOptions) {
    this.onStatusMessage = options?.onStatusMessage ?? null;
  }

  async start(): Promise<void> {
    console.log('Orchestrator ready (manual chaining mode)');
  }

  async shutdown(): Promise<void> {
    console.log('Orchestrator shutdown');
  }

  /** Run a single agent as an independent query() call. */
  private async runAgent(prompt: string, agent: AgentType, requestLogger: RequestLogger, maxTurnsOverride?: number): Promise<AgentResult> {
    const cfg = AGENT_CONFIGS[agent];
    let finalResult = '(no response)';
    const toolsUsed = new Set<string>();

    console.log(`\n--- ${agent.toUpperCase()} AGENT ---`);
    requestLogger.agentStart(agent, prompt);

    for await (const message of query({
      prompt,
      options: {
        cwd: resolve('.'),
        disallowedTools: cfg.disallowedTools,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: maxTurnsOverride ?? cfg.maxTurns,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: cfg.systemPrompt,
        },
        mcpServers: {
          'dev-bot': {
            command: 'npx',
            args: ['tsx', 'src/mcp/dev-bot-server.ts'],
            env: {
              GITHUB_USERNAME: config.GITHUB_USERNAME,
              GITHUB_TOKEN: config.GITHUB_TOKEN,
              REPOS_DIR: resolve('./repos'),
              GLOBAL_DIR: resolve('./global'),
              DEV_BOT_ROOT: resolve('.'),
            },
          },
        },
        env: {
          ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
        },
      },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        console.log(`  [init] model: ${message.model}, tools: ${message.tools.length}`);
      }

      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
            console.log(`  [text] ${block.text.slice(0, 200)}${block.text.length > 200 ? '...' : ''}`);
            requestLogger.agentThinking(agent, block.text);
          }
          if (typeof block === 'object' && 'name' in block) {
            const toolName = (block as any).name as string;
            const input = JSON.stringify((block as any).input ?? {});
            console.log(`  [tool] ${toolName}(${input.slice(0, 150)}${input.length > 150 ? '...' : ''})`);
            requestLogger.toolUsage(agent, toolName, (block as any).input);
            toolsUsed.add(toolName);
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          finalResult = message.result || '(no response)';
          requestLogger.agentComplete(agent, finalResult, {
            cost: message.total_cost_usd,
            turns: message.num_turns,
            duration: message.duration_ms,
          });
        } else {
          finalResult = `Error: ${message.errors.join('; ')}`;
          requestLogger.agentError(agent, new Error(finalResult));
        }
        console.log(`  [result] ${message.subtype} — $${message.total_cost_usd.toFixed(4)} | ${message.num_turns} turns | ${message.duration_ms}ms`);
      }
    }

    return { text: finalResult, toolsUsed };
  }

  /** Stage all changes in every repo so git diff --staged shows the full picture. */
  private async stageAllRepos(requestLogger: RequestLogger): Promise<void> {
    const reposDir = resolve('./repos');
    try {
      const entries = readdirSync(reposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const repoPath = resolve(reposDir, entry.name);
        const git = simpleGit(repoPath);
        const status = await git.status();
        const hasChanges =
          status.modified.length > 0 ||
          status.created.length > 0 ||
          status.deleted.length > 0 ||
          status.not_added.length > 0;
        if (hasChanges) {
          await git.add('-A');
          console.log(`  [staged] ${entry.name}`);
          requestLogger.gitOperation('stage', entry.name, {
            modified: status.modified.length,
            created: status.created.length,
            deleted: status.deleted.length,
          });
        }
      }
    } catch {
      // repos/ dir may not exist yet — that's fine
    }
  }

  /** Extract MUST-FIX items from reviewer output. Returns null if none. */
  private parseMustFix(reviewResult: string): string | null {
    const match = reviewResult.match(/### MUST-FIX\s*\n([\s\S]*?)(?=### SUGGESTIONS|$)/);
    if (!match) return null;
    const items = match[1].trim();
    if (!items || items.toLowerCase() === 'none') return null;
    return items;
  }

  async handleRequest(userMessage: string): Promise<string> {
    // Create a request logger with unique ID
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const requestLogger = new RequestLogger(requestId);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`REQUEST: ${userMessage}`);
    console.log('='.repeat(60));

    const sendStatus = (msg: string) => {
      console.log(`[status] ${msg}`);
      requestLogger.statusMessage(msg);
      this.onStatusMessage?.(msg);
    };

    try {
      // Phase 1: Coder — set up repo and implement changes
      sendStatus('Coding in progress...');
      const coderRun = await this.runAgent(userMessage, 'coder', requestLogger);
      let coderResult = coderRun.text;

      // Build gate: if the coder didn't run docker_build, run a focused follow-up
      if (!coderRun.toolsUsed.has('mcp__dev-bot__docker_build')) {
        console.log('  [build-gate] docker_build was not called — running build verification pass');
        sendStatus('Running build verification...');
        const buildPrompt = [
          `The user originally requested: "${userMessage}"`,
          '',
          'The coding work is done but the Docker build verification was not run.',
          'Create or update the Dockerfile in the repo root if needed, then run mcp__dev-bot__docker_build to verify the project builds.',
          'If the build fails, fix the issue and rebuild until it passes.',
        ].join('\n');
        const buildRun = await this.runAgent(buildPrompt, 'coder', requestLogger, 15);
        coderResult += '\n\n' + buildRun.text;
      }

      // Stage all changes so the reviewer sees new files via git diff --staged
      await this.stageAllRepos(requestLogger);

      // Phase 2: Reviewer — review the diff
      sendStatus('Reviewing changes...');
      const reviewerPrompt = [
        `The user requested: "${userMessage}"`,
        '',
        'The coder has completed the work. Their summary:',
        coderResult,
        '',
        'Review the changes made in the repository. Use git_diff with staged=true to see all changes including new files.',
      ].join('\n');
      const reviewRun = await this.runAgent(reviewerPrompt, 'reviewer', requestLogger);
      const reviewResult = reviewRun.text;

      // Phase 3: Fix — address MUST-FIX items if any
      let fixResult = '';
      const mustFixItems = this.parseMustFix(reviewResult);
      if (mustFixItems) {
        sendStatus('Fixing review items...');
        const fixPrompt = [
          `The user originally requested: "${userMessage}"`,
          '',
          'A code review found these must-fix issues:',
          mustFixItems,
          '',
          'Fix each issue listed above.',
        ].join('\n');
        const fixRun = await this.runAgent(fixPrompt, 'coder', requestLogger);
        fixResult = fixRun.text;
      }

      // Re-stage if fixes were made
      if (fixResult) {
        await this.stageAllRepos(requestLogger);
      }

      // Phase 4: Commit and push
      sendStatus('Committing and pushing...');
      const commitPrompt = [
        `The user requested: "${userMessage}"`,
        '',
        'All changes have been made and reviewed. Commit and push.',
      ].join('\n');
      const commitRun = await this.runAgent(commitPrompt, 'committer', requestLogger);
      const commitResult = commitRun.text;

      // Phase 5: Compose final reply
      const parts = [`*What was done:*\n${coderResult}`];

      if (reviewResult) {
        parts.push(`*Review findings:*\n${reviewResult}`);
      }
      if (fixResult) {
        parts.push(`*Fixed after review:*\n${fixResult}`);
      }
      if (commitResult) {
        parts.push(commitResult);
      }

      const finalReply = parts.join('\n\n');

      console.log(`\n${'='.repeat(60)}`);
      console.log(`FINAL REPLY: ${finalReply.slice(0, 500)}${finalReply.length > 500 ? '...' : ''}`);
      console.log('='.repeat(60));

      requestLogger.response(finalReply);
      return finalReply;
    } catch (err: any) {
      console.error('Orchestrator error:', err.message);
      requestLogger.error(err);
      throw err;
    }
  }
}
