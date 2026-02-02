import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import simpleGit from 'simple-git';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? '';
const REPOS_DIR = process.env.REPOS_DIR ?? './repos';

function repoPath(repoName: string): string {
  return resolve(REPOS_DIR, repoName);
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args);
  return stdout.trim();
}

const server = new McpServer({
  name: 'dev-bot-server',
  version: '1.0.0',
});

// --- git_clone ---
server.tool(
  'git_clone',
  'Clone a GitHub repo to the local repos directory',
  { repo_name: z.string().describe('Name of the GitHub repository to clone') },
  async ({ repo_name }) => {
    const dest = repoPath(repo_name);
    if (existsSync(dest)) {
      return {
        content: [{ type: 'text', text: `Repository already exists at ${dest}. Use git_pull to update.` }],
      };
    }
    const out = await gh(['repo', 'clone', `${GITHUB_USERNAME}/${repo_name}`, dest]);
    return {
      content: [{ type: 'text', text: `Cloned ${repo_name} to ${dest}${out ? '\n' + out : ''}` }],
    };
  },
);

// --- git_pull ---
server.tool(
  'git_pull',
  'Pull latest changes for a repository',
  { repo_name: z.string().describe('Name of the repository to pull') },
  async ({ repo_name }) => {
    const dest = repoPath(repo_name);
    if (!existsSync(dest)) {
      return {
        content: [{ type: 'text', text: `Repository ${repo_name} not found. Clone it first.` }],
        isError: true,
      };
    }
    const git = simpleGit(dest);
    const result = await git.pull();
    return {
      content: [{ type: 'text', text: `Pulled ${repo_name}: ${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions` }],
    };
  },
);

// --- git_status ---
server.tool(
  'git_status',
  'Show the working tree status of a repository',
  { repo_name: z.string().describe('Name of the repository') },
  async ({ repo_name }) => {
    const dest = repoPath(repo_name);
    if (!existsSync(dest)) {
      return {
        content: [{ type: 'text', text: `Repository ${repo_name} not found. Clone it first.` }],
        isError: true,
      };
    }
    const git = simpleGit(dest);
    const status = await git.status();
    const lines = [
      `Branch: ${status.current}`,
      `Modified: ${status.modified.join(', ') || 'none'}`,
      `Created: ${status.created.join(', ') || 'none'}`,
      `Deleted: ${status.deleted.join(', ') || 'none'}`,
      `Not added: ${status.not_added.join(', ') || 'none'}`,
    ];
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },
);

// --- git_commit_and_push ---
server.tool(
  'git_commit_and_push',
  'Stage all changes, commit, and push to remote. Returns the commit URL.',
  {
    repo_name: z.string().describe('Name of the repository'),
    commit_message: z.string().describe('Commit message (use conventional commits format)'),
  },
  async ({ repo_name, commit_message }) => {
    const dest = repoPath(repo_name);
    if (!existsSync(dest)) {
      return {
        content: [{ type: 'text', text: `Repository ${repo_name} not found.` }],
        isError: true,
      };
    }
    const git = simpleGit(dest);

    await git.add('-A');
    const commitResult = await git.commit(commit_message);

    if (!commitResult.commit) {
      return {
        content: [{ type: 'text', text: 'Nothing to commit — working tree clean.' }],
      };
    }

    await git.push();
    const sha = commitResult.commit;
    const commitUrl = `https://github.com/${GITHUB_USERNAME}/${repo_name}/commit/${sha}`;
    return {
      content: [{ type: 'text', text: `Committed and pushed: ${commitUrl}` }],
    };
  },
);

// --- create_github_repo ---
server.tool(
  'create_github_repo',
  'Create a new repository on GitHub',
  {
    name: z.string().describe('Repository name'),
    description: z.string().optional().describe('Repository description'),
    is_private: z.boolean().optional().default(false).describe('Whether the repo should be private'),
  },
  async ({ name, description, is_private }) => {
    try {
      const args = ['repo', 'create', `${GITHUB_USERNAME}/${name}`, '--add-readme'];
      if (is_private) {
        args.push('--private');
      } else {
        args.push('--public');
      }
      if (description) {
        args.push('--description', description);
      }
      const out = await gh(args);
      return {
        content: [{ type: 'text', text: `Created repository: ${out || `https://github.com/${GITHUB_USERNAME}/${name}`}` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to create repo: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// --- send_status ---
server.tool(
  'send_status',
  'Send a progress/status message to the user on WhatsApp',
  { message: z.string().describe('Status message to send to the user') },
  async ({ message }) => {
    if (typeof process.send === 'function') {
      process.send({ type: 'whatsapp', message });
      return {
        content: [{ type: 'text', text: `Status sent: "${message}"` }],
      };
    }
    return {
      content: [{ type: 'text', text: 'IPC not available — running without parent process.' }],
      isError: true,
    };
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('dev-bot-server failed to start:', err);
  process.exit(1);
});
