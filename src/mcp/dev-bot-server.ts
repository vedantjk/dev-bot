import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import simpleGit from 'simple-git';
import { existsSync, unlinkSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Docker from 'dockerode';
import pino from 'pino';
import { KBClient } from '../kb/kb-client.js';

const execFileAsync = promisify(execFile);

const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? '';
const REPOS_DIR = process.env.REPOS_DIR ?? './repos';
const DEV_BOT_ROOT = process.env.DEV_BOT_ROOT ?? resolve('.');

// Set up logging for MCP server
const LOGS_DIR = resolve(DEV_BOT_ROOT, 'logs');
// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
const logFile = join(LOGS_DIR, `mcp-server-${timestamp}.log`);

const mcpLogger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.destination({
  dest: logFile,
  sync: false,
}));

function repoPath(repoName: string): string {
  // Allow "." or "dev-bot" to reference the dev-bot repo itself
  if (repoName === '.' || repoName === 'dev-bot') {
    return resolve(DEV_BOT_ROOT);
  }
  return resolve(REPOS_DIR, repoName);
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args);
  return stdout.trim();
}

/** Helper to log tool calls */
function logToolCall(toolName: string, input: any, result?: any, error?: any) {
  mcpLogger.info({
    tool: toolName,
    input,
    result: result ? JSON.stringify(result).slice(0, 500) : undefined,
    error: error ? error.message : undefined,
    success: !error,
  }, `Tool: ${toolName}`);
}

/** Helper to log KB operations and store as memories */
async function logAndStoreKBOperation(
  operation: string,
  input: any,
  result?: any,
  error?: any
): Promise<void> {
  logToolCall(`kb_${operation}`, input, result, error);

  // Store KB operation as a memory for future reference
  // Skip logging for 'add' operations with category 'kb-operation' to prevent recursion
  if (!error && !(operation === 'add' && input.category === 'kb-operation')) {
    try {
      const timestamp = new Date().toISOString();
      let memoryContent = `[${timestamp}] KB Operation: ${operation}\n`;

      switch (operation) {
        case 'add':
          memoryContent += `Added memory: "${input.content}" (category: ${input.category || 'general'})`;
          if (result?.id) memoryContent += `\nMemory ID: ${result.id}`;
          break;
        case 'search':
          memoryContent += `Searched for: "${input.query}" (top_k: ${input.top_k || 5})`;
          if (result?.results?.length > 0) {
            memoryContent += `\nFound ${result.results.length} results`;
          }
          break;
        case 'update':
          memoryContent += `Updated memory ${input.id}: "${input.content}"`;
          break;
        case 'remove':
          memoryContent += `Removed memory ${input.id}`;
          break;
        case 'update_preference':
          memoryContent += `Set preference '${input.key}' = '${input.value}'`;
          break;
        case 'get_preference':
          memoryContent += `Retrieved preference '${input.key}'`;
          if (result?.value) memoryContent += ` = '${result.value}'`;
          break;
      }

      // Store the KB operation log as a memory (this won't recurse due to the check above)
      await kbClient.add(memoryContent, 'kb-operation');
    } catch (memError) {
      mcpLogger.warn({
        event: 'kb_memory_storage_failed',
        operation,
        error: memError instanceof Error ? memError.message : String(memError),
      }, 'Failed to store KB operation as memory');
    }
  }
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
    try {
      const dest = repoPath(repo_name);
      if (existsSync(dest)) {
        const result = { content: [{ type: 'text' as const, text: `Repository already exists at ${dest}. Use git_pull to update.` }] };
        logToolCall('git_clone', { repo_name }, result);
        return result;
      }
      const out = await gh(['repo', 'clone', `${GITHUB_USERNAME}/${repo_name}`, dest]);
      const result = { content: [{ type: 'text' as const, text: `Cloned ${repo_name} to ${dest}${out ? '\n' + out : ''}` }] };
      logToolCall('git_clone', { repo_name }, result);
      return result;
    } catch (err: any) {
      logToolCall('git_clone', { repo_name }, undefined, err);
      throw err;
    }
  },
);

// --- git_pull ---
server.tool(
  'git_pull',
  'Pull latest changes for a repository',
  { repo_name: z.string().describe('Name of the repository to pull. Use "." or "dev-bot" for the dev-bot repo itself.') },
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
  { repo_name: z.string().describe('Name of the repository. Use "." or "dev-bot" for the dev-bot repo itself.') },
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
    repo_name: z.string().describe('Name of the repository. Use "." or "dev-bot" for the dev-bot repo itself.'),
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
    repo_name: z.string().describe('Name of the repository. Use "." or "dev-bot" for the dev-bot repo itself.'),
    commit_message: z.string().describe('Commit message (use conventional commits format)'),
  },
  async ({ repo_name, commit_message }) => {
    try {
      const dest = repoPath(repo_name);
      if (!existsSync(dest)) {
        const result = {
          content: [{ type: 'text' as const, text: `Repository ${repo_name} not found.` }],
          isError: true,
        };
        logToolCall('git_commit_and_push', { repo_name, commit_message }, result);
        return result;
      }
      const git = simpleGit(dest);

      await git.add('-A');
      const commitResult = await git.commit(commit_message);

      if (!commitResult.commit) {
        const result = { content: [{ type: 'text' as const, text: 'Nothing to commit — working tree clean.' }] };
        logToolCall('git_commit_and_push', { repo_name, commit_message }, result);
        return result;
      }

      await git.push();
      const sha = commitResult.commit;
      const commitUrl = `https://github.com/${GITHUB_USERNAME}/${repo_name}/commit/${sha}`;
      const result = { content: [{ type: 'text' as const, text: `Committed and pushed: ${commitUrl}` }] };
      logToolCall('git_commit_and_push', { repo_name, commit_message, sha }, result);
      return result;
    } catch (err: any) {
      logToolCall('git_commit_and_push', { repo_name, commit_message }, undefined, err);
      throw err;
    }
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
  'Delete a file inside a known repository directory (repos/ or dev-bot root).',
  { file_path: z.string().describe('Absolute path to the file to delete') },
  async ({ file_path }) => {
    const absolute = resolve(file_path);
    const reposRoot = resolve(REPOS_DIR);
    const devBotRoot = resolve(DEV_BOT_ROOT);

    if (!absolute.startsWith(reposRoot) && !absolute.startsWith(devBotRoot)) {
      return {
        content: [{ type: 'text', text: `Refused: path must be inside ${reposRoot} or ${devBotRoot}` }],
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

// --- KB service client ---
const KB_SOCKET_PATH = process.env.KB_SOCKET_PATH ?? '/tmp/dev-bot-kb.sock';
const kbClient = new KBClient(KB_SOCKET_PATH);

mcpLogger.info('MCP server initialized');

// --- kb_add ---
server.tool(
  'kb_add',
  'Add a memory to the knowledge base. The kb-service must be running.',
  {
    content: z.string().describe('Memory content to store'),
    category: z.string().optional().default('general').describe('Category of the memory (e.g., preference, best-practice, workflow)'),
    id: z.string().optional().describe('Optional custom ID for the memory'),
  },
  async ({ content, category, id }) => {
    try {
      const memoryId = await kbClient.add(content, category, id);
      const result = {
        content: [{ type: 'text' as const, text: `Memory added successfully. ID: ${memoryId}` }],
      };
      await logAndStoreKBOperation('add', { content, category, id }, { id: memoryId });
      return result;
    } catch (err: any) {
      const result = {
        content: [{ type: 'text' as const, text: `Failed to add memory: ${err.message}` }],
        isError: true,
      };
      await logAndStoreKBOperation('add', { content, category, id }, undefined, err);
      return result;
    }
  },
);

// --- kb_search ---
server.tool(
  'kb_search',
  'Search for memories in the knowledge base based on semantic similarity. The kb-service must be running.',
  {
    query: z.string().describe('Search query'),
    top_k: z.number().optional().default(5).describe('Number of results to return (default: 5)'),
  },
  async ({ query, top_k }) => {
    try {
      const results = await kbClient.search(query, top_k);
      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories found matching the query.' }],
        };
      }
      const formatted = results.map((r, i) =>
        `${i + 1}. [${r.category}] ${r.content}\n   Score: ${r.score.toFixed(4)} | ID: ${r.id}`
      ).join('\n\n');
      const result = {
        content: [{ type: 'text' as const, text: `Found ${results.length} memories:\n\n${formatted}` }],
      };
      await logAndStoreKBOperation('search', { query, top_k }, { results });
      return result;
    } catch (err: any) {
      const result = {
        content: [{ type: 'text' as const, text: `Failed to search: ${err.message}` }],
        isError: true,
      };
      await logAndStoreKBOperation('search', { query, top_k }, undefined, err);
      return result;
    }
  },
);

// --- kb_update ---
server.tool(
  'kb_update',
  'Update an existing memory in the knowledge base. The kb-service must be running.',
  {
    id: z.string().describe('Memory ID to update'),
    content: z.string().describe('New content for the memory'),
  },
  async ({ id, content }) => {
    try {
      await kbClient.update(id, content);
      const result = {
        content: [{ type: 'text' as const, text: `Memory ${id} updated successfully.` }],
      };
      await logAndStoreKBOperation('update', { id, content });
      return result;
    } catch (err: any) {
      const result = {
        content: [{ type: 'text' as const, text: `Failed to update memory: ${err.message}` }],
        isError: true,
      };
      await logAndStoreKBOperation('update', { id, content }, undefined, err);
      return result;
    }
  },
);

// --- kb_remove ---
server.tool(
  'kb_remove',
  'Remove a memory from the knowledge base. The kb-service must be running.',
  {
    id: z.string().describe('Memory ID to remove'),
  },
  async ({ id }) => {
    try {
      await kbClient.remove(id);
      const result = {
        content: [{ type: 'text' as const, text: `Memory ${id} removed successfully.` }],
      };
      await logAndStoreKBOperation('remove', { id });
      return result;
    } catch (err: any) {
      const result = {
        content: [{ type: 'text' as const, text: `Failed to remove memory: ${err.message}` }],
        isError: true,
      };
      await logAndStoreKBOperation('remove', { id }, undefined, err);
      return result;
    }
  },
);

// --- kb_update_preference ---
server.tool(
  'kb_update_preference',
  'Store or update a user preference in the knowledge base. The kb-service must be running.',
  {
    key: z.string().describe('Preference key (e.g., "editor", "theme", "indentation")'),
    value: z.string().describe('Preference value'),
  },
  async ({ key, value }) => {
    try {
      await kbClient.updatePreference(key, value);
      const result = {
        content: [{ type: 'text' as const, text: `Preference '${key}' set to '${value}'.` }],
      };
      await logAndStoreKBOperation('update_preference', { key, value });
      return result;
    } catch (err: any) {
      const result = {
        content: [{ type: 'text' as const, text: `Failed to update preference: ${err.message}` }],
        isError: true,
      };
      await logAndStoreKBOperation('update_preference', { key, value }, undefined, err);
      return result;
    }
  },
);

// --- kb_get_preference ---
server.tool(
  'kb_get_preference',
  'Retrieve a user preference from the knowledge base. The kb-service must be running.',
  {
    key: z.string().describe('Preference key to retrieve'),
  },
  async ({ key }) => {
    try {
      const value = await kbClient.getPreference(key);
      if (value === '') {
        return {
          content: [{ type: 'text' as const, text: `Preference '${key}' not found.` }],
        };
      }
      const result = {
        content: [{ type: 'text' as const, text: `Preference '${key}' = '${value}'` }],
      };
      await logAndStoreKBOperation('get_preference', { key }, { value });
      return result;
    } catch (err: any) {
      const result = {
        content: [{ type: 'text' as const, text: `Failed to get preference: ${err.message}` }],
        isError: true,
      };
      await logAndStoreKBOperation('get_preference', { key }, undefined, err);
      return result;
    }
  },
);

/** Best-effort removal of a Docker image by tag or ID. */
async function removeImage(ref: string): Promise<void> {
  try {
    await docker.getImage(ref).remove({ force: true });
  } catch {
    // Ignore — image may already be gone or never fully built.
  }
}

server.tool(
  'docker_build',
  'Build a Docker image from a Dockerfile path. The build context is the Dockerfile\'s parent directory. The image is removed after verification.',
  {
    dockerfile: z.string().describe('Path to the Dockerfile, relative to the project root (e.g. repos/myproject/Dockerfile)'),
    tag: z.string().optional().describe('Image tag (default: auto-generated devbot-<dir>-<timestamp>)'),
    timeout: z.number().optional().default(120).describe('Max seconds before killing the build (default 120)'),
  },
  async ({ dockerfile, tag, timeout }) => {
    const resolvedDockerfile = resolve(DEV_BOT_ROOT, dockerfile);
    if (!existsSync(resolvedDockerfile)) {
      return {
        content: [{ type: 'text', text: `Dockerfile not found: ${resolvedDockerfile}` }],
        isError: true,
      };
    }

    const contextDir = dirname(resolvedDockerfile);
    const dockerfileName = basename(resolvedDockerfile);
    const imageTag = tag ?? `devbot-${basename(contextDir)}-${Date.now()}`;

    const outputLines: string[] = [];
    let builtImageId: string | undefined;
    let buildErrorSeen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const stream = await docker.buildImage(
        { context: contextDir, src: ['.'] },
        { rm: true, t: imageTag, dockerfile: dockerfileName },
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
              buildErrorSeen = true;
            }
            if (event.aux?.ID) {
              builtImageId = event.aux.ID;
            }
          },
        );
      });

      const timeoutPromise = new Promise<never>((_, rejectP) => {
        timer = setTimeout(() => {
          (stream as any).destroy?.();
          rejectP(new Error('Build timed out'));
        }, timeout * 1000);
      });

      await Promise.race([buildPromise, timeoutPromise]);
      clearTimeout(timer);

      const tail = outputLines.slice(-50).join('\n');

      // BuildKit may resolve the stream without an error callback even when
      // a build step fails — detect this via error events in the stream.
      if (buildErrorSeen) {
        await removeImage(imageTag);
        if (builtImageId) await removeImage(builtImageId);
        return {
          content: [{ type: 'text', text: `Build failed.\n\n${tail}` }],
          isError: true,
        };
      }

      // Clean up the verification image so it doesn't accumulate.
      await removeImage(imageTag);

      return {
        content: [{ type: 'text', text: `Build succeeded (image cleaned up).\n\n${tail}` }],
      };
    } catch (err: any) {
      clearTimeout(timer);

      // Best-effort cleanup of partial/timed-out images.
      if (builtImageId) {
        await removeImage(builtImageId);
      }
      await removeImage(imageTag);

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
