# WhatsApp-to-GitHub Dev Bot — Implementation Plan

> A WhatsApp bot that receives coding instructions, generates code via Claude API,
> commits to GitHub, and replies with the commit link.

## Overview

- **Language**: TypeScript (Node.js)
- **Location**: `C:\Users\vedant\Projects\dev-bot`
- **Approach**: Build core pipeline first, enhancements later
- **Docker/MCP**: Deferred — add after core pipeline works

---

## System Architecture

```
WhatsApp (Phone)
    │
    ▼
Baileys Client (src/whatsapp/client.ts)
    │
    ▼
Message Parser (src/whatsapp/parser.ts)
    │
    ▼
Task Queue (src/processor/queue.ts)
    │
    ▼
Processing Pipeline (src/processor/pipeline.ts)
    ├── Memory/Context (src/memory/context.ts)
    ├── Claude API (src/ai/claude.ts)
    ├── Git Manager (src/git/manager.ts)
    └── Cost Tracker (src/analytics/tracker.ts)
    │
    ▼
WhatsApp Reply (commit URL)
```

---

## Project Structure

```
dev-bot/
├── src/
│   ├── index.ts                 # Entry point, wire everything together
│   ├── config.ts                # Load + validate env vars with zod
│   ├── whatsapp/
│   │   ├── client.ts            # Baileys client setup, QR auth, message listener
│   │   └── parser.ts            # Parse messages into TaskRequest | CommandRequest
│   ├── processor/
│   │   ├── queue.ts             # Simple async task queue (in-memory)
│   │   └── pipeline.ts          # Orchestrate: context → Claude → git → reply
│   ├── ai/
│   │   └── claude.ts            # Claude API client, prompt building, response parsing
│   ├── git/
│   │   └── manager.ts           # Clone, pull, commit, push via simple-git
│   ├── memory/
│   │   └── context.ts           # Load AGENTS.md + global steering files
│   └── analytics/
│       └── tracker.ts           # SQLite cost tracking + budget enforcement
├── global/
│   ├── STEERING.md              # Global dev preferences
│   ├── CODING_STYLE.md          # Code conventions
│   └── FRAMEWORKS.md            # Preferred tech stack
├── repos/                       # Cloned GitHub repositories go here
├── auth_info/                   # Baileys WhatsApp session (auto-created)
├── package.json
├── tsconfig.json
├── .env.example
├── .env                         # Your actual secrets (git-ignored)
├── .gitignore
└── IMPLEMENTATION_PLAN.md       # This file
```

---

## Dependencies

### Production
| Package | Purpose |
|---------|---------|
| `@whiskeysockets/baileys` | WhatsApp Web multi-device API |
| `@anthropic-ai/sdk` | Claude API client |
| `simple-git` | Local git operations (clone, commit, push) |
| `@octokit/rest` | GitHub REST API (verify repos, get branches) |
| `better-sqlite3` | SQLite for cost tracking analytics |
| `pino` | Logger (required by Baileys) |
| `dotenv` | Load .env file |
| `zod` | Schema validation for config + message parsing |

### Dev
| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `tsx` | Run .ts files directly in dev mode |
| `@types/better-sqlite3` | Type definitions |
| `@types/node` | Node.js type definitions |

### Install Commands
```bash
npm init -y
npm install @whiskeysockets/baileys @anthropic-ai/sdk simple-git @octokit/rest better-sqlite3 pino dotenv zod
npm install -D typescript tsx @types/better-sqlite3 @types/node
```

---

## Environment Variables

Create `.env` with:
```env
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GITHUB_USERNAME=vedant
AUTHORIZED_PHONE=919876543210@s.whatsapp.net
DAILY_BUDGET_USD=5.00
```

---

## Implementation Phases (Build Order)

### Phase 0: Project Scaffold
**What**: Initialize npm project, TypeScript config, environment setup.

**Files to create:**

#### `package.json`
```json
{
  "name": "dev-bot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  }
}
```

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "repos"]
}
```

#### `.env.example`
```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
GITHUB_TOKEN=ghp_your-token-here
GITHUB_USERNAME=your-github-username
AUTHORIZED_PHONE=919876543210@s.whatsapp.net
DAILY_BUDGET_USD=5.00
```

#### `.gitignore`
```
node_modules/
dist/
.env
repos/
auth_info/
*.db
```

#### `src/config.ts`
- Use zod to define and validate all env vars
- Export a typed `config` object
- Throw clear errors on missing/invalid values
- Load dotenv at the top

```typescript
import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_USERNAME: z.string().min(1),
  AUTHORIZED_PHONE: z.string().min(1),
  DAILY_BUDGET_USD: z.coerce.number().default(5.0),
});

export const config = configSchema.parse(process.env);
export type Config = z.infer<typeof configSchema>;
```

---

### Phase 1: Git Operations (`src/git/manager.ts`)
**Why first**: Can be tested standalone from CLI without WhatsApp.

**Functions:**
```typescript
class GitManager {
  constructor(githubToken: string, githubUsername: string, reposDir: string)

  // Clone repo if not present, pull if exists
  async ensureRepo(repoName: string): Promise<string>  // returns repo path

  // List files in repo (filtered by extension)
  async getRepoFiles(repoName: string, extensions?: string[]): Promise<string[]>

  // Read a single file from repo
  async readRepoFile(repoName: string, filePath: string): Promise<string>

  // Apply file changes, commit, push, return commit URL
  async applyChanges(
    repoName: string,
    files: Array<{ filePath: string; content: string }>,
    commitMessage: string
  ): Promise<{ commitUrl: string; sha: string }>

  // Get default branch name (main vs master)
  async getDefaultBranch(repoName: string): Promise<string>
}
```

**Key details:**
- Clone URL format: `https://{token}@github.com/{username}/{repo}.git`
- Before commit: always `git pull --rebase` to avoid conflicts
- After push: construct URL as `https://github.com/{username}/{repo}/commit/{sha}`
- Validate: never write to `.git/`, `node_modules/`, or lock files

---

### Phase 2: Project Memory (`src/memory/context.ts`)
**Functions:**
```typescript
class ContextManager {
  constructor(reposDir: string, globalDir: string)

  // Load AGENTS.md from repo directory
  loadProjectContext(repoName: string): string | null

  // Load all global config files
  loadGlobalConfig(): { steering: string; codingStyle: string; frameworks: string }

  // Build complete system prompt for Claude
  buildSystemPrompt(repoName: string): string

  // Append new context to AGENTS.md after successful commit
  updateAgentsMd(repoName: string, summary: string): void
}
```

**System prompt template:**
```
You are a coding assistant. You will receive a task and must produce code changes.

## Project: {repoName}
{AGENTS.md content}

## Global Preferences
{STEERING.md content}

## Coding Style
{CODING_STYLE.md content}

## Output Format
For each file you want to create or modify, use this exact format:

--- FILE: path/to/file.ts ---
[complete file content here]
--- END FILE ---

--- COMMIT: your commit message here ---

Only output files that need changes. Include the COMPLETE file content, not diffs.
```

**Create default global files on first run:**

`global/STEERING.md`:
```markdown
# Global Development Preferences

## Code Style
- 2 space indentation
- Single quotes for strings
- Trailing commas
- Max line length: 100

## Commit Messages
- Format: "feat: description" or "fix: description"
- Types: feat, fix, docs, refactor, test, chore

## Security Rules
- Never commit secrets or .env files
- Always validate user inputs
- Use parameterized queries for databases
```

`global/CODING_STYLE.md`:
```markdown
# Coding Style Guide

- Prefer async/await over raw promises
- Use TypeScript strict mode
- Prefer const over let, never use var
- Use descriptive variable names
- Keep functions small and focused
```

`global/FRAMEWORKS.md`:
```markdown
# Preferred Frameworks & Tools

- Frontend: React, Next.js, TailwindCSS
- Backend: Node.js, Express, Fastify
- Database: PostgreSQL, SQLite
- ORM: Prisma, Drizzle
- Testing: Vitest, Jest
- Validation: Zod
```

---

### Phase 3: Claude API Integration (`src/ai/claude.ts`)
**Functions:**
```typescript
interface FileChange {
  filePath: string;
  content: string;
}

interface GenerationResult {
  files: FileChange[];
  commitMessage: string;
  tokensIn: number;
  tokensOut: number;
}

class ClaudeClient {
  constructor(apiKey: string)

  // Generate code changes for a task
  async generateChanges(
    systemPrompt: string,
    task: string,
    existingFiles: Array<{ path: string; content: string }>
  ): Promise<GenerationResult>

  // Parse Claude's response into structured file changes
  private parseResponse(response: string): { files: FileChange[]; commitMessage: string }
}
```

**Key details:**
- Model: `claude-sonnet-4-20250514` (good balance of speed/quality/cost)
- Max tokens: 4096 for output
- Parse response using regex to extract `--- FILE: ... ---` blocks
- Extract commit message from `--- COMMIT: ... ---` block
- Read `usage.input_tokens` and `usage.output_tokens` from API response
- Cost calculation: Sonnet pricing ($3/1M input, $15/1M output)

**Response parsing regex:**
```typescript
const FILE_PATTERN = /--- FILE: (.+?) ---\n([\s\S]*?)--- END FILE ---/g;
const COMMIT_PATTERN = /--- COMMIT: (.+?) ---/;
```

---

### Phase 4: Processing Pipeline (`src/processor/pipeline.ts`)
**The core orchestrator that connects all components.**

```typescript
class Pipeline {
  constructor(
    gitManager: GitManager,
    contextManager: ContextManager,
    claudeClient: ClaudeClient,
    costTracker: CostTracker,
    sendMessage: (text: string) => Promise<void>  // WhatsApp reply function
  )

  async processTask(repoName: string, task: string): Promise<string> {
    // 1. Check budget
    sendMessage("Checking budget...");
    if (!costTracker.checkBudget()) {
      throw new Error("Daily budget exceeded");
    }

    // 2. Ensure repo is cloned and up to date
    sendMessage(`Pulling latest from ${repoName}...`);
    await gitManager.ensureRepo(repoName);

    // 3. Load project context
    const systemPrompt = contextManager.buildSystemPrompt(repoName);

    // 4. Gather existing files for context
    sendMessage("Reading project files...");
    const files = await gitManager.getRepoFiles(repoName);
    const existingFiles = [];
    for (const file of files.slice(0, 50)) {  // Limit to 50 files
      const content = await gitManager.readRepoFile(repoName, file);
      if (content.length < 10000) {  // Skip very large files
        existingFiles.push({ path: file, content });
      }
    }

    // 5. Generate code with Claude
    sendMessage("Generating code with Claude...");
    const result = await claudeClient.generateChanges(systemPrompt, task, existingFiles);

    // 6. Apply changes and commit
    sendMessage(`Committing ${result.files.length} file(s)...`);
    const { commitUrl } = await gitManager.applyChanges(
      repoName, result.files, result.commitMessage
    );

    // 7. Track cost
    costTracker.recordRequest({
      repoName,
      requestText: task,
      tokensInput: result.tokensIn,
      tokensOutput: result.tokensOut,
      success: true,
    });

    // 8. Update AGENTS.md
    contextManager.updateAgentsMd(repoName,
      `- ${result.commitMessage} (${new Date().toISOString().split('T')[0]})`
    );

    // 9. Return commit URL
    return commitUrl;
  }
}
```

---

### Phase 5: WhatsApp Client (`src/whatsapp/client.ts`)
```typescript
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';

class WhatsAppClient {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private messageHandler: ((sender: string, text: string) => void) | null = null;

  constructor(private authorizedPhone: string) {}

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    this.socket = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,  // QR code shown in terminal on first run
    });

    // Save credentials on update
    this.socket.ev.on('creds.update', saveCreds);

    // Handle connection updates (reconnect on disconnect)
    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode
            !== DisconnectReason.loggedOut;
        if (shouldReconnect) this.connect();
      }
      if (connection === 'open') {
        console.log('WhatsApp connected');
      }
    });

    // Listen for messages
    this.socket.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        const sender = msg.key.remoteJid;
        if (sender !== this.authorizedPhone) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (text && this.messageHandler) {
          this.messageHandler(sender, text);
        }
      }
    });
  }

  onMessage(handler: (sender: string, text: string) => void): void {
    this.messageHandler = handler;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    await this.socket?.sendMessage(jid, { text });
  }
}
```

**Key details:**
- First run: QR code prints in terminal, scan with WhatsApp
- Session persisted in `./auth_info/` — no QR needed on subsequent runs
- Auto-reconnect on disconnect (unless logged out)
- Only process messages from `AUTHORIZED_PHONE`
- Ignore messages sent by the bot itself (`fromMe`)

---

### Phase 6: Message Parser (`src/whatsapp/parser.ts`)
```typescript
import { z } from 'zod';

type ParsedMessage =
  | { type: 'task'; repo: string; task: string }
  | { type: 'command'; command: 'status' | 'cost' | 'help' | 'repos' };

function parseMessage(text: string): ParsedMessage {
  const trimmed = text.trim().toLowerCase();

  // Check for commands first
  if (['status', 'cost', 'help', 'repos'].includes(trimmed)) {
    return { type: 'command', command: trimmed as any };
  }

  // Pattern 1: "repo-name: task description"
  const colonMatch = text.match(/^([\w-]+):\s*(.+)$/s);
  if (colonMatch) {
    return { type: 'task', repo: colonMatch[1], task: colonMatch[2].trim() };
  }

  // Pattern 2: "task description to repo-name"
  const toMatch = text.match(/^(.+)\s+to\s+([\w-]+)$/s);
  if (toMatch) {
    return { type: 'task', repo: toMatch[2], task: toMatch[1].trim() };
  }

  // Pattern 3: "task description in repo-name"
  const inMatch = text.match(/^(.+)\s+in\s+([\w-]+)$/s);
  if (inMatch) {
    return { type: 'task', repo: inMatch[2], task: inMatch[1].trim() };
  }

  // Can't parse — ask for clarification
  throw new Error(
    'Could not parse request. Use format:\n' +
    '• "repo-name: task description"\n' +
    '• "task description to repo-name"\n' +
    '• "task description in repo-name"'
  );
}
```

---

### Phase 7: Cost Tracker (`src/analytics/tracker.ts`)
```typescript
import Database from 'better-sqlite3';

class CostTracker {
  private db: Database.Database;

  // Sonnet pricing per 1M tokens
  private static INPUT_COST = 3.0;
  private static OUTPUT_COST = 15.0;

  constructor(dbPath: string = './analytics.db') {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        repo_name TEXT NOT NULL,
        request_text TEXT NOT NULL,
        tokens_input INTEGER NOT NULL,
        tokens_output INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        processing_time_ms INTEGER,
        success BOOLEAN NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY,
        total_requests INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0,
        repos_modified INTEGER DEFAULT 0
      );
    `);
  }

  recordRequest(data: {
    repoName: string;
    requestText: string;
    tokensInput: number;
    tokensOutput: number;
    processingTimeMs?: number;
    success: boolean;
  }): void {
    const cost =
      (data.tokensInput / 1_000_000) * CostTracker.INPUT_COST +
      (data.tokensOutput / 1_000_000) * CostTracker.OUTPUT_COST;

    this.db.prepare(`
      INSERT INTO requests (repo_name, request_text, tokens_input, tokens_output,
                           cost_usd, processing_time_ms, success)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.repoName, data.requestText, data.tokensInput, data.tokensOutput,
      cost, data.processingTimeMs ?? null, data.success ? 1 : 0
    );
  }

  checkBudget(dailyLimit: number): boolean {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total
      FROM requests
      WHERE date(timestamp) = date('now')
    `).get() as { total: number };
    return row.total < dailyLimit;
  }

  getDailySummary(): string {
    const today = this.db.prepare(`
      SELECT COUNT(*) as requests, COALESCE(SUM(cost_usd), 0) as cost,
             COALESCE(SUM(tokens_input + tokens_output), 0) as tokens
      FROM requests WHERE date(timestamp) = date('now')
    `).get() as any;

    const month = this.db.prepare(`
      SELECT COUNT(*) as requests, COALESCE(SUM(cost_usd), 0) as cost
      FROM requests WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
    `).get() as any;

    return [
      `Today: ${today.requests} requests, $${today.cost.toFixed(2)}`,
      `This month: ${month.requests} requests, $${month.cost.toFixed(2)}`,
    ].join('\n');
  }
}
```

---

### Phase 8: Task Queue (`src/processor/queue.ts`)
```typescript
type Task = {
  id: string;
  repoName: string;
  taskDescription: string;
  senderId: string;
};

class TaskQueue {
  private queue: Task[] = [];
  private processing = false;
  private processor: ((task: Task) => Promise<void>) | null = null;

  setProcessor(fn: (task: Task) => Promise<void>): void {
    this.processor = fn;
  }

  async enqueue(task: Task): Promise<void> {
    this.queue.push(task);
    if (!this.processing) {
      await this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0 || !this.processor) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const task = this.queue.shift()!;

    try {
      await this.processor(task);
    } catch (error) {
      console.error(`Task failed: ${task.id}`, error);
    }

    await this.processNext();
  }

  get length(): number {
    return this.queue.length;
  }
}
```

---

### Phase 9: Entry Point (`src/index.ts`)
```typescript
import { config } from './config.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { parseMessage } from './whatsapp/parser.js';
import { GitManager } from './git/manager.js';
import { ContextManager } from './memory/context.js';
import { ClaudeClient } from './ai/claude.js';
import { CostTracker } from './analytics/tracker.js';
import { Pipeline } from './processor/pipeline.js';
import { TaskQueue } from './processor/queue.js';
import { randomUUID } from 'crypto';

async function main() {
  console.log('Starting Dev Bot...');

  // Initialize components
  const gitManager = new GitManager(config.GITHUB_TOKEN, config.GITHUB_USERNAME, './repos');
  const contextManager = new ContextManager('./repos', './global');
  const claudeClient = new ClaudeClient(config.ANTHROPIC_API_KEY);
  const costTracker = new CostTracker('./analytics.db');
  const whatsapp = new WhatsAppClient(config.AUTHORIZED_PHONE);
  const queue = new TaskQueue();

  // Connect WhatsApp
  await whatsapp.connect();

  // Set up queue processor
  queue.setProcessor(async (task) => {
    const sendReply = (text: string) =>
      whatsapp.sendMessage(task.senderId, text);

    const pipeline = new Pipeline(
      gitManager, contextManager, claudeClient, costTracker, sendReply
    );

    try {
      const commitUrl = await pipeline.processTask(task.repoName, task.taskDescription);
      await sendReply(`Done! ${commitUrl}`);
    } catch (error: any) {
      await sendReply(`Error: ${error.message}`);
    }
  });

  // Handle incoming messages
  whatsapp.onMessage(async (sender, text) => {
    try {
      const parsed = parseMessage(text);

      if (parsed.type === 'command') {
        switch (parsed.command) {
          case 'help':
            await whatsapp.sendMessage(sender,
              'Commands:\n' +
              '• "repo-name: task" — generate code\n' +
              '• "status" — queue status\n' +
              '• "cost" — usage analytics\n' +
              '• "repos" — list repos\n' +
              '• "help" — this message'
            );
            break;
          case 'cost':
            await whatsapp.sendMessage(sender, costTracker.getDailySummary());
            break;
          case 'status':
            await whatsapp.sendMessage(sender,
              `Queue: ${queue.length} task(s) pending`
            );
            break;
          case 'repos':
            // List directories in ./repos
            await whatsapp.sendMessage(sender, 'Repos: (check ./repos directory)');
            break;
        }
        return;
      }

      // Task request
      await whatsapp.sendMessage(sender,
        `Queued: "${parsed.task}" for ${parsed.repo}`
      );
      await queue.enqueue({
        id: randomUUID(),
        repoName: parsed.repo,
        taskDescription: parsed.task,
        senderId: sender,
      });

    } catch (error: any) {
      await whatsapp.sendMessage(sender, error.message);
    }
  });

  console.log('Dev Bot running. Waiting for WhatsApp messages...');
}

main().catch(console.error);
```

---

## Implementation Order (Critical Path)

| Step | Phase | Component | Why This Order |
|------|-------|-----------|---------------|
| 1 | 0 | Scaffold | Foundation: npm, TypeScript, env config |
| 2 | 1 | Git Manager | Can test standalone: clone, commit, push |
| 3 | 2 | Memory/Context | Can test standalone: load files, build prompts |
| 4 | 3 | Claude Client | Can test with hardcoded prompts |
| 5 | 4 | Pipeline | Connects Git + Claude + Memory (test via CLI) |
| 6 | 5 | WhatsApp Client | Now connect the UI layer |
| 7 | 6 | Message Parser | Parse WhatsApp messages into tasks |
| 8 | 7 | Cost Tracker | Track spending (SQLite) |
| 9 | 8 | Task Queue | Handle concurrent requests |
| 10 | 9 | Entry Point | Wire everything together |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Claude generates invalid/broken code | Validate file paths; never overwrite `.git/`, `node_modules/`, lock files |
| Git push fails (auth, conflicts) | Always pull before commit; clear error messages back to WhatsApp |
| WhatsApp session drops | Baileys auto-reconnect; persist auth state in `./auth_info/` |
| Large repos blow up Claude context | Send only 50 files max, skip files >10KB, filter by extension |
| Cost overruns | Daily budget check before each request; hard stop at limit |
| Claude response doesn't match expected format | Robust regex parsing with fallback error handling |

---

## Verification Checklist

- [ ] `npm run dev` — TypeScript compiles clean, process starts
- [ ] Git test — clone a test repo, make a dummy commit, verify it appears on GitHub
- [ ] Claude test — send a small task, verify file change output parses correctly
- [ ] Pipeline test — run full pipeline on a test repo ("Add a README")
- [ ] WhatsApp test — scan QR code, send "help", verify bot responds
- [ ] End-to-end — send "Add hello world to test-repo" via WhatsApp, verify commit on GitHub
- [ ] Cost test — send "cost" command, verify analytics response

---

## Future Enhancements (Post-MVP)

- [ ] MCP Build Server (Docker) — isolated build/test environment
- [ ] Prompt caching — reuse project context for 90% cost reduction
- [ ] Multi-file chunking — break large features into 150-200 line commits
- [ ] Branch support — create feature branches instead of committing to main
- [ ] Conversation mode — follow-up messages refine the same task
- [ ] File filtering — smart selection of which files to send as context
- [ ] Budget alerts — WhatsApp notification at 80% of daily budget
