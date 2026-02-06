import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import simpleGit from 'simple-git';
import Docker from 'dockerode';

const TEST_DIR = resolve('./test-tmp');
const TEST_REPOS = join(TEST_DIR, 'repos');
const TEST_GLOBAL = join(TEST_DIR, 'global');
const TEST_REPO_NAME = 'test-repo';
const TEST_REPO_PATH = join(TEST_REPOS, TEST_REPO_NAME);

// Check if Docker daemon is available
let dockerAvailable = false;
try {
  const docker = new Docker();
  await docker.ping();
  dockerAvailable = true;
} catch {
  dockerAvailable = false;
}

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  // Clean up any leftover test dir
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }

  // Create temp directories
  mkdirSync(TEST_REPOS, { recursive: true });
  mkdirSync(TEST_GLOBAL, { recursive: true });

  // Seed REVIEW_STANDARDS.md
  writeFileSync(
    join(TEST_GLOBAL, 'REVIEW_STANDARDS.md'),
    '# Review Standards\n\n---\n',
    'utf-8',
  );

  // Create a git repo with an initial commit
  mkdirSync(TEST_REPO_PATH, { recursive: true });
  const git = simpleGit(TEST_REPO_PATH);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'hello world\n', 'utf-8');
  await git.add('-A');
  await git.commit('initial commit');

  // Start MCP server as child process
  transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/dev-bot-server.ts'],
    env: {
      ...process.env,
      REPOS_DIR: TEST_REPOS,
      GLOBAL_DIR: TEST_GLOBAL,
      GITHUB_USERNAME: 'test-user',
      GITHUB_TOKEN: '',
      DEV_BOT_ROOT: resolve('.'),
    },
    cwd: resolve('.'),
  });

  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  try { await transport.close(); } catch { /* ignore */ }
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ---------- Tool discovery ----------

describe('tool listing', () => {
  it('lists all expected tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('git_clone');
    expect(names).toContain('git_pull');
    expect(names).toContain('git_status');
    expect(names).toContain('git_diff');
    expect(names).toContain('git_commit_and_push');
    expect(names).toContain('create_github_repo');
    expect(names).toContain('delete_file');
    expect(names).toContain('send_status');
    expect(names).toContain('write_steering_file');
    expect(names).toContain('docker_build');
  });
});

// ---------- git_diff ----------

describe('git_diff', () => {
  it('returns "No differences found" on a clean repo', async () => {
    const result = await client.callTool({
      name: 'git_diff',
      arguments: { repo_name: TEST_REPO_NAME },
    });
    const text = (result.content as any)[0].text;
    expect(text).toBe('No differences found.');
  });

  it('returns diff content after a file change', async () => {
    // Modify a file
    writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'hello world\nchanged line\n', 'utf-8');

    const result = await client.callTool({
      name: 'git_diff',
      arguments: { repo_name: TEST_REPO_NAME },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('hello.txt');
    expect(text).toContain('+changed line');

    // Restore
    writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'hello world\n', 'utf-8');
  });

  it('returns staged diff when staged=true', async () => {
    // Modify and stage
    writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'staged change\n', 'utf-8');
    const git = simpleGit(TEST_REPO_PATH);
    await git.add('-A');

    const result = await client.callTool({
      name: 'git_diff',
      arguments: { repo_name: TEST_REPO_NAME, staged: true },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('hello.txt');
    expect(text).toContain('+staged change');

    // Unstaged diff should be empty now
    const unstaged = await client.callTool({
      name: 'git_diff',
      arguments: { repo_name: TEST_REPO_NAME, staged: false },
    });
    expect((unstaged.content as any)[0].text).toBe('No differences found.');

    // Reset
    await git.reset(['HEAD', '--', '.']);
    writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'hello world\n', 'utf-8');
  });

  it('returns error for non-existent repo', async () => {
    const result = await client.callTool({
      name: 'git_diff',
      arguments: { repo_name: 'nonexistent-repo' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain('not found');
  });
});

// ---------- git_status ----------

describe('git_status', () => {
  it('shows clean status on a committed repo', async () => {
    const result = await client.callTool({
      name: 'git_status',
      arguments: { repo_name: TEST_REPO_NAME },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('Branch:');
    expect(text).toContain('Modified: none');
  });

  it('shows modified files after a change', async () => {
    writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'modified\n', 'utf-8');

    const result = await client.callTool({
      name: 'git_status',
      arguments: { repo_name: TEST_REPO_NAME },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('hello.txt');

    // Restore
    writeFileSync(join(TEST_REPO_PATH, 'hello.txt'), 'hello world\n', 'utf-8');
  });

  it('allows accessing dev-bot repo with "." keyword', async () => {
    const result = await client.callTool({
      name: 'git_status',
      arguments: { repo_name: '.' },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('Branch:');
  });

  it('allows accessing dev-bot repo with "dev-bot" keyword', async () => {
    const result = await client.callTool({
      name: 'git_status',
      arguments: { repo_name: 'dev-bot' },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('Branch:');
  });
});

// ---------- write_steering_file ----------

describe('write_steering_file', () => {
  it('appends content to a .md file', async () => {
    const result = await client.callTool({
      name: 'write_steering_file',
      arguments: {
        filename: 'REVIEW_STANDARDS.md',
        content: '- Always handle null returns from database queries',
      },
    });
    const text = (result.content as any)[0].text;
    expect(text).toBe('Appended to REVIEW_STANDARDS.md');

    const fileContent = readFileSync(join(TEST_GLOBAL, 'REVIEW_STANDARDS.md'), 'utf-8');
    expect(fileContent).toContain('Always handle null returns from database queries');
  });

  it('appends multiple entries', async () => {
    await client.callTool({
      name: 'write_steering_file',
      arguments: {
        filename: 'REVIEW_STANDARDS.md',
        content: '- Validate input at API boundaries',
      },
    });

    const fileContent = readFileSync(join(TEST_GLOBAL, 'REVIEW_STANDARDS.md'), 'utf-8');
    expect(fileContent).toContain('Always handle null returns');
    expect(fileContent).toContain('Validate input at API boundaries');
  });

  it('rejects non-.md filenames', async () => {
    const result = await client.callTool({
      name: 'write_steering_file',
      arguments: { filename: 'hack.txt', content: 'bad' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain('must end with .md');
  });

  it('rejects filenames with forward slashes', async () => {
    const result = await client.callTool({
      name: 'write_steering_file',
      arguments: { filename: '../etc/passwd.md', content: 'bad' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain('path separators or traversal');
  });

  it('rejects filenames with backslashes', async () => {
    const result = await client.callTool({
      name: 'write_steering_file',
      arguments: { filename: '..\\secret.md', content: 'bad' },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects filenames with .. traversal', async () => {
    const result = await client.callTool({
      name: 'write_steering_file',
      arguments: { filename: '..EXPLOIT.md', content: 'bad' },
    });
    expect(result.isError).toBe(true);
  });

  it('can create a new .md file', async () => {
    const result = await client.callTool({
      name: 'write_steering_file',
      arguments: { filename: 'NEW_STANDARDS.md', content: '# New file' },
    });
    const text = (result.content as any)[0].text;
    expect(text).toBe('Appended to NEW_STANDARDS.md');
    expect(existsSync(join(TEST_GLOBAL, 'NEW_STANDARDS.md'))).toBe(true);
  });
});

// ---------- send_status ----------

describe('send_status', () => {
  it('acknowledges the status message', async () => {
    const result = await client.callTool({
      name: 'send_status',
      arguments: { message: 'Testing in progress...' },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('Status sent');
    expect(text).toContain('Testing in progress...');
  });
});

// ---------- delete_file ----------

describe('delete_file', () => {
  it('deletes a file inside repos/', async () => {
    const filePath = join(TEST_REPO_PATH, 'to-delete.txt');
    writeFileSync(filePath, 'delete me', 'utf-8');
    expect(existsSync(filePath)).toBe(true);

    const result = await client.callTool({
      name: 'delete_file',
      arguments: { file_path: filePath },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain('Deleted');
    expect(existsSync(filePath)).toBe(false);
  });

  it('refuses to delete files outside repos/ and dev-bot root', async () => {
    const outsidePath = join(tmpdir(), `devbot-test-outside-${Date.now()}.txt`);
    writeFileSync(outsidePath, 'should not be deleted', 'utf-8');

    const result = await client.callTool({
      name: 'delete_file',
      arguments: { file_path: outsidePath },
    });
    expect(result.isError).toBe(true);
    expect(existsSync(outsidePath)).toBe(true);

    unlinkSync(outsidePath);
  });

  it('returns error for non-existent file', async () => {
    const result = await client.callTool({
      name: 'delete_file',
      arguments: { file_path: join(TEST_REPO_PATH, 'no-such-file.txt') },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain('not found');
  });
});

// ---------- docker_build ----------

const TEST_DOCKERFILE = join(TEST_REPO_PATH, 'Dockerfile');

describe.skipIf(!dockerAvailable)('docker_build', () => {
  it('returns error when Dockerfile does not exist', async () => {
    const result = await client.callTool({
      name: 'docker_build',
      arguments: { dockerfile: '/nonexistent/path/Dockerfile' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain('not found');
  });

  it('succeeds with a trivial Dockerfile and cleans up image', async () => {
    writeFileSync(TEST_DOCKERFILE, 'FROM alpine\nRUN echo "ok"\n', 'utf-8');

    const tag = `devbot-test-${Date.now()}`;
    const result = await client.callTool({
      name: 'docker_build',
      arguments: { dockerfile: TEST_DOCKERFILE, tag },
    });
    const text = (result.content as any)[0].text;
    expect(result.isError).toBeFalsy();
    expect(text).toContain('Build succeeded');
    expect(text).toContain('cleaned up');

    // Verify the image was removed
    const docker = new Docker();
    await expect(docker.getImage(tag).inspect()).rejects.toThrow();

    unlinkSync(TEST_DOCKERFILE);
  }, 60_000);

  it('returns failure for a broken Dockerfile', async () => {
    writeFileSync(TEST_DOCKERFILE, 'FROM alpine\nRUN exit 1\n', 'utf-8');

    const result = await client.callTool({
      name: 'docker_build',
      arguments: { dockerfile: TEST_DOCKERFILE },
    });
    const text = (result.content as any)[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain('Build failed');

    unlinkSync(TEST_DOCKERFILE);
  }, 60_000);

  it('respects timeout', async () => {
    writeFileSync(TEST_DOCKERFILE, 'FROM alpine\nRUN sleep 999\n', 'utf-8');

    const result = await client.callTool({
      name: 'docker_build',
      arguments: { dockerfile: TEST_DOCKERFILE, timeout: 2 },
    });
    const text = (result.content as any)[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain('timed out');

    unlinkSync(TEST_DOCKERFILE);
  }, 30_000);
});
