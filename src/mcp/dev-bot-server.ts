import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import simpleGit from 'simple-git';
import { existsSync, unlinkSync, appendFileSync } from 'fs';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Docker from 'dockerode';

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

// --- git_diff ---
server.tool(
  'git_diff',
  'Show unified diff of changes in a repository. Returns filenames and line numbers.',
  {
    repo_name: z.string().describe('Name of the repository'),
    staged: z.boolean().optional().default(false).describe('If true, show only staged changes'),
  },
  async ({ repo_name, staged }) => {
    const dest = repoPath(repo_name);
    if (!existsSync(dest)) {
      return {
        content: [{ type: 'text', text: `Repository ${repo_name} not found. Clone it first.` }],
        isError: true,
      };
    }
    const git = simpleGit(dest);
    const diff = staged ? await git.diff(['--staged']) : await git.diff();
    if (!diff.trim()) {
      return {
        content: [{ type: 'text', text: 'No differences found.' }],
      };
    }
    return {
      content: [{ type: 'text', text: diff }],
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

// --- delete_file ---
server.tool(
  'delete_file',
  'Delete a file inside a repository. Only works within the repos/ directory.',
  { file_path: z.string().describe('Absolute path to the file to delete') },
  async ({ file_path }) => {
    const absolute = resolve(file_path);
    const reposRoot = resolve(REPOS_DIR);

    if (!absolute.startsWith(reposRoot)) {
      return {
        content: [{ type: 'text', text: `Refused: path must be inside ${reposRoot}` }],
        isError: true,
      };
    }

    if (!existsSync(absolute)) {
      return {
        content: [{ type: 'text', text: `File not found: ${absolute}` }],
        isError: true,
      };
    }

    unlinkSync(absolute);
    return {
      content: [{ type: 'text', text: `Deleted: ${absolute}` }],
    };
  },
);

// --- send_status ---
// The orchestrator intercepts this tool call from the assistant message stream
// and forwards the message to WhatsApp. This handler is a simple acknowledgement.
server.tool(
  'send_status',
  'Send a progress/status message to the user on WhatsApp',
  { message: z.string().describe('Status message to send to the user') },
  async ({ message }) => {
    return {
      content: [{ type: 'text', text: `Status sent: "${message}"` }],
    };
  },
);

// --- write_steering_file ---
const GLOBAL_DIR = process.env.GLOBAL_DIR ?? './global';

server.tool(
  'write_steering_file',
  'Append a best-practice entry to a global steering markdown file (e.g. REVIEW_STANDARDS.md). Append-only.',
  {
    filename: z.string().describe('Markdown filename (e.g. REVIEW_STANDARDS.md). No path separators allowed.'),
    content: z.string().describe('Content to append to the file'),
  },
  async ({ filename, content }) => {
    if (!filename.endsWith('.md')) {
      return {
        content: [{ type: 'text', text: 'Refused: filename must end with .md' }],
        isError: true,
      };
    }
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return {
        content: [{ type: 'text', text: 'Refused: filename must not contain path separators or traversal' }],
        isError: true,
      };
    }
    const filePath = resolve(GLOBAL_DIR, filename);
    appendFileSync(filePath, '\n' + content.trim() + '\n', 'utf-8');
    return {
      content: [{ type: 'text', text: `Appended to ${filename}` }],
    };
  },
);

// --- docker_build ---
const docker = new Docker();

server.tool(
  'docker_build',
  'Build a Docker image from a Dockerfile in the repo root. Returns build output.',
  {
    repo_name: z.string().describe('Name of the repository in repos/'),
    timeout: z.number().optional().default(120).describe('Max seconds before killing the build (default 120)'),
  },
  async ({ repo_name, timeout }) => {
    const dest = repoPath(repo_name);
    if (!existsSync(dest)) {
      return {
        content: [{ type: 'text', text: `Repository ${repo_name} not found. Clone it first.` }],
        isError: true,
      };
    }

    const dockerfilePath = join(dest, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      return {
        content: [{ type: 'text', text: `No Dockerfile found in ${repo_name}. Create a Dockerfile first.` }],
        isError: true,
      };
    }

    const outputLines: string[] = [];

    try {
      const stream = await docker.buildImage(
        { context: dest, src: ['.'] },
        { rm: true },
      );

      const buildPromise = new Promise<void>((resolveP, rejectP) => {
        docker.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) {
              rejectP(err);
            } else {
              resolveP();
            }
          },
          (event: any) => {
            if (event.stream) {
              outputLines.push(event.stream.replace(/\n$/, ''));
            }
            if (event.error) {
              outputLines.push(event.error);
            }
          },
        );
      });

      const timeoutPromise = new Promise<never>((_, rejectP) => {
        setTimeout(() => {
          (stream as any).destroy?.();
          rejectP(new Error('Build timed out'));
        }, timeout * 1000);
      });

      await Promise.race([buildPromise, timeoutPromise]);

      const tail = outputLines.slice(-50).join('\n');
      return {
        content: [{ type: 'text', text: `Build succeeded.\n\n${tail}` }],
      };
    } catch (err: any) {
      if (err.message === 'Build timed out') {
        return {
          content: [{ type: 'text', text: `Build timed out after ${timeout}s.` }],
          isError: true,
        };
      }
      const tail = outputLines.length > 0
        ? outputLines.slice(-50).join('\n')
        : err.message;
      return {
        content: [{ type: 'text', text: `Build failed.\n\n${tail}` }],
        isError: true,
      };
    }
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
