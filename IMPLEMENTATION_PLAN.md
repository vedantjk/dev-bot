# WhatsApp-to-GitHub Dev Bot — Implementation Plan

> A WhatsApp bot that receives coding instructions, uses Claude as an orchestrator
> with MCP servers for tool operations, and replies with commit links.

## Overview

- **Language**: TypeScript (Node.js)
- **Location**: `C:\Users\vedant\Projects\dev-bot`
- **Architecture**: Claude-powered orchestrator with MCP (Model Context Protocol) servers
- **Approach**: Agentic tool-use loop — Claude decides what tools to call

---

## System Architecture

```
WhatsApp (Phone)
    │
    ▼
index.ts (serial lock, sends "Working on it...")
    │
    ▼
orchestrator.ts (Claude API agentic tool-use loop)
    │
    ├── MCP: @modelcontextprotocol/server-filesystem
    │     └── read_file, write_file, edit_file, list_directory, etc.
    │
    └── MCP: dev-bot-server (custom)
          └── git_clone, git_pull, git_diff, git_commit_and_push, git_status,
              create_github_repo, delete_file, write_steering_file,
              docker_build, send_status
    │
    ▼
WhatsApp Reply (final message + commit URL)
```

---

## Project Structure

```
dev-bot/
├── src/
│   ├── index.ts                 # Entry point — WhatsApp → orchestrator wiring
│   ├── config.ts                # Load + validate env vars with Zod
│   ├── whatsapp/
│   │   └── client.ts            # Baileys client setup, QR auth, message listener
│   ├── ai/
│   │   ├── orchestrator.ts      # MCP client setup + Claude agentic loop
│   │   └── system-prompt.ts     # Per-agent system prompts (coder, reviewer, committer)
│   └── mcp/
│       └── dev-bot-server.ts    # Custom MCP server (git, github, docker, steering tools)
├── global/
│   ├── STEERING.md              # Global dev preferences
│   ├── CODING_STYLE.md          # Code conventions
│   ├── FRAMEWORKS.md            # Preferred tech stack
│   └── REVIEW_STANDARDS.md     # Auto-appended best practices from reviews
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

## MCP Servers

### 1. Community: Filesystem (`@modelcontextprotocol/server-filesystem`)
- Spawned as child process with `./repos` as allowed directory
- Provides: `read_file`, `write_file`, `edit_file`, `list_directory`, `directory_tree`, `search_files`, `create_directory`, `move_file`, `get_file_info`
- Agent uses paths like `repos/my-project/src/index.ts`

### 2. Custom: Dev Bot Server (`src/mcp/dev-bot-server.ts`)
Built with `@modelcontextprotocol/sdk/server` + `simple-git` + `@octokit/rest` + `dockerode`.

| Tool | Purpose |
|------|---------|
| `git_clone` | Clone a repo to `./repos/{name}` |
| `git_pull` | Pull latest changes |
| `git_diff` | Show unified diff (optional `staged` flag) |
| `git_commit_and_push` | Stage all, commit, push, return commit URL |
| `git_status` | Show working tree status |
| `create_github_repo` | Create a new repo on GitHub via Octokit |
| `delete_file` | Delete a file inside `repos/` (sandboxed) |
| `write_steering_file` | Append best-practice entries to `global/*.md` (append-only) |
| `docker_build` | Build a Docker image from repo Dockerfile (with timeout) |
| `send_status` | Send progress message to WhatsApp (intercepted by orchestrator) |

---

## Orchestrator Design (`src/ai/orchestrator.ts`)

### Startup
1. Spawn filesystem MCP server: `npx @modelcontextprotocol/server-filesystem ./repos`
2. Spawn custom MCP server: `npx tsx src/mcp/dev-bot-server.ts` (with env vars)
3. Connect MCP clients to both via `StdioClientTransport`
4. Call `client.listTools()` on each → collect all tool definitions
5. Convert MCP tool schemas to Anthropic API tool format

### Agentic Loop (per request)
1. Build messages array with user's WhatsApp text
2. Call Claude API with system prompt + all tools
3. If `stop_reason === 'tool_use'`:
   - For each tool_use block, route to correct MCP server via `client.callTool()`
   - `send_status` is intercepted and handled in-process (calls WhatsApp directly)
   - Feed results back as tool_result messages
   - Continue loop
4. If `stop_reason === 'end_turn'`: extract text, return as final WhatsApp reply
5. Safety: max 25 turns

### Config
- Model: `claude-sonnet-4-20250514`
- Max tokens: 8192
- Max turns: 25

---

## Dependencies

### Production
| Package | Purpose |
|---------|---------|
| `@whiskeysockets/baileys` | WhatsApp Web multi-device API |
| `@anthropic-ai/sdk` | Claude API client |
| `@modelcontextprotocol/sdk` | MCP client + server SDK |
| `@modelcontextprotocol/server-filesystem` | Community filesystem MCP server |
| `simple-git` | Local git operations (clone, commit, push) |
| `@octokit/rest` | GitHub REST API (create repos) |
| `pino` | Logger (required by Baileys) |
| `dotenv` | Load .env file |
| `zod` | Schema validation for config + MCP tool schemas |
| `dockerode` | Docker Engine API client for build verification |

### Dev
| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `tsx` | Run .ts files directly in dev mode |
| `@types/node` | Node.js type definitions |

---

## Environment Variables

Create `.env` with:
```env
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GITHUB_USERNAME=vedantjk
AUTHORIZED_CHAT=120363022735140025@g.us
DAILY_BUDGET_USD=5.00
```

---

## Implementation Status

| Component | File | Status |
|-----------|------|--------|
| Project Scaffold | package.json, tsconfig.json | ✅ Done |
| WhatsApp Client | src/whatsapp/client.ts | ✅ Done |
| Config | src/config.ts | ✅ Done |
| Global Steering | global/*.md | ✅ Done |
| Custom MCP Server | src/mcp/dev-bot-server.ts | ✅ Done |
| System Prompt | src/ai/system-prompt.ts | ✅ Done |
| Orchestrator | src/ai/orchestrator.ts | ✅ Done |
| Entry Point | src/index.ts | ✅ Done |

---

## Verification Checklist

- [x] `npm run dev` — TypeScript compiles clean
- [x] WhatsApp test — scan QR code, connect, receive group messages
- [ ] MCP test — orchestrator spawns both MCP servers, lists tools
- [ ] Claude test — send a small task, verify tool-use loop works
- [ ] End-to-end — send "Create a new repo called test-project" via WhatsApp
- [ ] End-to-end — send "Add a README.md to test-project" → verify commit on GitHub

---

## MVP Backlog

- [ ] **Mid-execution message injection** — if the user sends a message while the bot is working, pause the agentic loop and incorporate the new input before continuing. Currently the serial lock rejects messages during execution. The challenge: Claude API calls are blocking, so injection can only happen between turns (when control returns to the orchestrator). Approach: buffer incoming messages during execution, and before each Claude API call check the buffer — if there's a new message, append it to the conversation as a user message. Won't interrupt a long tool call or an in-flight API request, but catches the gap between turns. A multi-agent setup (planner + executor) would give more natural injection points.
- [ ] Cost tracking with SQLite (budget enforcement per request)
- [ ] Prompt caching for system prompt + project context
- [ ] Branch support (feature branches instead of main)
- [ ] Conversation memory (follow-up messages refine same task)
- [ ] **Vector-based knowledge base with semantic search** — replace the current `global/*.md` file-injection approach in `system-prompt.ts` with a proper vector KB. Current approach reads all markdown files and injects them verbatim into the system prompt, which doesn't scale and wastes tokens on irrelevant context. A vector KB would: (1) embed project docs, coding standards, and past review learnings into a vector store, (2) retrieve only the chunks relevant to the current task via semantic search, (3) reduce system prompt size and improve context relevance. Consider using an embedding model + local vector store (e.g. sqlite-vec, chromadb) or a hosted solution.

## Future Enhancements

- [x] ~~Docker MCP server for isolated build/test environments~~ — implemented as `docker_build` tool via `dockerode`
- [ ] Budget alerts at 80% of daily limit
