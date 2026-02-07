# KB Tools Quick Reference Guide

A quick reference for using the KB (Knowledge Base) MCP tools in dev-bot.

## Prerequisites

The kb-service must be running for these tools to work:

```bash
# Linux/macOS
./kb-service/build/kb-service --socket /tmp/dev-bot-kb.sock --db /data/kb.db

# Docker
docker run -v /tmp:/tmp -v kb-data:/data kb-service
```

## Tools Overview

| Tool | Purpose | Use Case |
|------|---------|----------|
| `kb_add` | Store a memory | Remember user preferences, coding standards, project decisions |
| `kb_search` | Find relevant memories | Retrieve context for current task |
| `kb_update` | Modify existing memory | Update outdated information |
| `kb_remove` | Delete a memory | Remove obsolete or incorrect information |
| `kb_update_preference` | Store user setting | Save simple key-value preferences |
| `kb_get_preference` | Retrieve user setting | Get saved preferences |

## Tool Details

### kb_add

Store information in the knowledge base.

**When to use:**
- User shares a preference or requirement
- You discover a project-specific pattern
- You want to remember a decision for future reference

**Parameters:**
```typescript
{
  content: string,     // Required: The information to store
  category?: string,   // Optional: Classification (default: "general")
  id?: string         // Optional: Custom ID (auto-generated if not provided)
}
```

**Categories to use:**
- `preference` - User preferences
- `coding-style` - Code formatting and style choices
- `best-practice` - Team standards and practices
- `workflow` - Development processes
- `architecture` - Design decisions
- `bug` - Known issues and workarounds
- `general` - Anything else

**Examples:**

```typescript
// Remember a coding preference
kb_add({
  content: "User prefers functional programming style with pure functions",
  category: "preference"
})

// Store a project decision
kb_add({
  content: "Database: Using PostgreSQL with Prisma ORM",
  category: "architecture"
})

// Remember a best practice
kb_add({
  content: "Always write unit tests for API endpoints",
  category: "best-practice"
})
```

### kb_search

Search for relevant memories using semantic similarity.

**When to use:**
- Starting a new task (search for related context)
- User asks about previous decisions
- Need to check if something was already discussed

**Parameters:**
```typescript
{
  query: string,    // Required: What you're looking for
  top_k?: number   // Optional: Number of results (default: 5)
}
```

**Examples:**

```typescript
// Find coding preferences
kb_search({
  query: "How should I format the code?",
  top_k: 3
})

// Look up architecture decisions
kb_search({
  query: "What database are we using?",
  top_k: 2
})

// Find related best practices
kb_search({
  query: "Testing requirements for new features",
  top_k: 5
})
```

**Tips:**
- Write queries as natural language questions
- Be specific: "error handling practices" vs "practices"
- Start with top_k=5, increase if needed

### kb_update

Update the content of an existing memory.

**When to use:**
- User corrects previous information
- Requirements change
- Adding more details to existing memory

**Parameters:**
```typescript
{
  id: string,      // Required: Memory ID from kb_add or kb_search
  content: string  // Required: New content
}
```

**Example:**

```typescript
// First, search to find the memory
const results = kb_search({
  query: "indentation preference",
  top_k: 1
})
// Returns: ID: mem_123, content: "User prefers 2-space indentation"

// Then update it
kb_update({
  id: "mem_123",
  content: "User prefers 4-space indentation (updated from 2-space)"
})
```

### kb_remove

Delete a memory from the knowledge base.

**When to use:**
- Information is no longer relevant
- User explicitly asks to forget something
- Duplicate or incorrect entry

**Parameters:**
```typescript
{
  id: string  // Required: Memory ID to remove
}
```

**Example:**

```typescript
kb_remove({
  id: "mem_456"
})
```

### kb_update_preference

Store a simple key-value preference.

**When to use:**
- User preferences that are simple key-value pairs
- Settings that are frequently accessed
- Configuration values

**Parameters:**
```typescript
{
  key: string,    // Required: Preference identifier
  value: string   // Required: Preference value
}
```

**Common preference keys:**
- `editor` - User's preferred editor
- `theme` - UI theme preference
- `indentation` - Code indentation style
- `line_length` - Max line length
- `quote_style` - Single vs double quotes
- `framework` - Preferred framework for new projects

**Examples:**

```typescript
kb_update_preference({
  key: "editor",
  value: "VSCode"
})

kb_update_preference({
  key: "indentation",
  value: "2 spaces"
})

kb_update_preference({
  key: "testing_framework",
  value: "Vitest"
})
```

### kb_get_preference

Retrieve a stored preference value.

**When to use:**
- Need to check a user setting
- Apply user preferences to generated code

**Parameters:**
```typescript
{
  key: string  // Required: Preference key to retrieve
}
```

**Example:**

```typescript
kb_get_preference({
  key: "indentation"
})
// Returns: "2 spaces"
```

## Best Practices

### When to Use KB vs. Conversation History

**Use KB for:**
- Information that should persist across conversations
- User preferences and settings
- Project-specific knowledge
- Decisions and standards

**Use conversation history for:**
- Current task context
- Temporary working information
- Back-and-forth clarifications

### Organizing Information

**Use `kb_add` with categories for:**
- Complex information with context
- Information you'll search for semantically
- Multiple related facts

**Use `kb_update_preference` for:**
- Simple key-value pairs
- Settings you access by exact key
- Frequently accessed values

### Search Strategy

1. **Start broad:** Cast a wide net with general queries
2. **Review results:** Check scores (lower is better)
3. **Refine query:** If needed, be more specific
4. **Increase top_k:** If you didn't find what you need

### Memory Management

**Regular maintenance:**
- Remove outdated memories periodically
- Update memories when requirements change
- Consolidate duplicate information

**Memory naming:**
- Use descriptive content
- Include context in the memory itself
- Avoid abbreviations unless common

## Workflow Examples

### Starting a New Feature

```typescript
// 1. Search for related context
const coding_standards = await kb_search({
  query: "coding standards for new features",
  top_k: 3
});

const testing_requirements = await kb_search({
  query: "testing requirements",
  top_k: 2
});

const preferences = await kb_get_preference({
  key: "framework"
});

// 2. Use this context to implement the feature
// 3. Store new learnings
await kb_add({
  content: "Feature X uses pattern Y for reason Z",
  category: "architecture"
});
```

### User Updates Preferences

```typescript
// User says: "Actually, I prefer 4-space indentation"

// 1. Search for existing preference
const results = await kb_search({
  query: "indentation preference",
  top_k: 1
});

// 2. Update if exists, or add new
if (results.length > 0) {
  await kb_update({
    id: results[0].id,
    content: "User prefers 4-space indentation"
  });
} else {
  await kb_add({
    content: "User prefers 4-space indentation",
    category: "preference"
  });
}

// 3. Also update the simple preference
await kb_update_preference({
  key: "indentation",
  value: "4 spaces"
});
```

### Onboarding New Team Member

```typescript
// Store team knowledge
await kb_add({
  content: "Code review process: Create PR -> Run tests -> Request review from 2+ team members -> Merge after approval",
  category: "workflow"
});

await kb_add({
  content: "Git branching: feature/* for features, fix/* for bugs, hotfix/* for production fixes",
  category: "workflow"
});

await kb_add({
  content: "Testing: Unit tests required for all business logic, integration tests for API endpoints",
  category: "best-practice"
});
```

## Troubleshooting

### "Failed to add memory: Socket error"
→ kb-service is not running. Start it first.

### "Failed to search: Request timeout"
→ kb-service is overloaded or crashed. Check logs and restart.

### Search returns no relevant results
→ Try different query phrasing or increase top_k. May need to add more memories.

### "Preference not found"
→ Use kb_update_preference to set it first.

## Configuration

Set the socket path via environment variable:

```bash
export KB_SOCKET_PATH=/tmp/dev-bot-kb.sock
```

Default: `/tmp/dev-bot-kb.sock`

## Further Reading

- [Testing Guide](../test/README-KB-TESTS.md) - How to test KB tools
- [Implementation Details](../KB_MCP_IMPLEMENTATION.md) - Technical documentation
- [kb-service README](../kb-service/README.md) - Service documentation
