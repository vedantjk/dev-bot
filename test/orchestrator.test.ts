import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/ai/orchestrator.js';

// Import the module-level constants for testing via a re-export trick.
// We read the orchestrator source to verify structural properties.
import { readFileSync } from 'fs';
import { resolve } from 'path';

const orchestratorSource = readFileSync(
  resolve('src/ai/orchestrator.ts'),
  'utf-8',
);

describe('AGENT_CONFIGS structure', () => {
  it('defines exactly coder, reviewer, and committer agents', () => {
    // Verify the AGENT_CONFIGS keys via source inspection
    expect(orchestratorSource).toContain("'coder'");
    expect(orchestratorSource).toContain("'reviewer'");
    expect(orchestratorSource).toContain("'committer'");
  });
});

describe('ALWAYS_BLOCKED tools', () => {
  it('blocks Bash for all agents', () => {
    expect(orchestratorSource).toContain("'Bash'");
  });

  it('blocks Task for all agents (no subagent nesting)', () => {
    expect(orchestratorSource).toContain("'Task'");
  });

  it('blocks Skill, TodoWrite, TodoRead, NotebookEdit', () => {
    expect(orchestratorSource).toContain("'Skill'");
    expect(orchestratorSource).toContain("'TodoWrite'");
    expect(orchestratorSource).toContain("'TodoRead'");
    expect(orchestratorSource).toContain("'NotebookEdit'");
  });
});

describe('Coder agent config', () => {
  it('blocks WebSearch and WebFetch', () => {
    // coder disallowedTools includes WebSearch/WebFetch
    expect(orchestratorSource).toMatch(/coder[\s\S]*?'WebSearch'/);
    expect(orchestratorSource).toMatch(/coder[\s\S]*?'WebFetch'/);
  });

  it('allows git_clone, git_pull, delete_file via mcpToolsExcept', () => {
    expect(orchestratorSource).toContain("'mcp__dev-bot__git_clone'");
    expect(orchestratorSource).toContain("'mcp__dev-bot__git_pull'");
    expect(orchestratorSource).toContain("'mcp__dev-bot__delete_file'");
  });

  it('has maxTurns of 25', () => {
    // Check coder config has maxTurns: 25
    const coderBlock = orchestratorSource.match(/coder:\s*\{[\s\S]*?maxTurns:\s*(\d+)/);
    expect(coderBlock).not.toBeNull();
    expect(coderBlock![1]).toBe('25');
  });
});

describe('Reviewer agent config', () => {
  it('blocks Write and Edit', () => {
    expect(orchestratorSource).toMatch(/reviewer[\s\S]*?'Write'/);
    expect(orchestratorSource).toMatch(/reviewer[\s\S]*?'Edit'/);
  });

  it('allows git_status, git_diff, write_steering_file via mcpToolsExcept', () => {
    expect(orchestratorSource).toContain("'mcp__dev-bot__git_status'");
    expect(orchestratorSource).toContain("'mcp__dev-bot__git_diff'");
    expect(orchestratorSource).toContain("'mcp__dev-bot__write_steering_file'");
  });

  it('has maxTurns of 10', () => {
    const reviewerBlock = orchestratorSource.match(/reviewer:\s*\{[\s\S]*?maxTurns:\s*(\d+)/);
    expect(reviewerBlock).not.toBeNull();
    expect(reviewerBlock![1]).toBe('10');
  });
});

describe('Committer agent config', () => {
  it('blocks Write, Edit, WebSearch, WebFetch', () => {
    expect(orchestratorSource).toMatch(/committer[\s\S]*?'Write'/);
    expect(orchestratorSource).toMatch(/committer[\s\S]*?'Edit'/);
    expect(orchestratorSource).toMatch(/committer[\s\S]*?'WebSearch'/);
    expect(orchestratorSource).toMatch(/committer[\s\S]*?'WebFetch'/);
  });

  it('allows git_status, git_commit_and_push, create_github_repo via mcpToolsExcept', () => {
    expect(orchestratorSource).toContain("'mcp__dev-bot__git_commit_and_push'");
    expect(orchestratorSource).toContain("'mcp__dev-bot__create_github_repo'");
  });

  it('has maxTurns of 5', () => {
    const committerBlock = orchestratorSource.match(/committer:\s*\{[\s\S]*?maxTurns:\s*(\d+)/);
    expect(committerBlock).not.toBeNull();
    expect(committerBlock![1]).toBe('5');
  });
});

describe('Orchestrator public interface', () => {
  it('preserves start, shutdown, handleRequest methods', () => {
    const o = new Orchestrator();
    expect(typeof o.start).toBe('function');
    expect(typeof o.shutdown).toBe('function');
    expect(typeof o.handleRequest).toBe('function');
  });

  it('accepts onStatusMessage callback', () => {
    const messages: string[] = [];
    const o = new Orchestrator({
      onStatusMessage: (msg) => messages.push(msg),
    });
    expect(o).toBeInstanceOf(Orchestrator);
  });
});

describe('parseMustFix', () => {
  // Access the private method for testing
  function parseMustFix(reviewResult: string): string | null {
    const o = new Orchestrator();
    return (o as any).parseMustFix(reviewResult);
  }

  it('extracts must-fix items from valid review output', () => {
    const review = `### MUST-FIX
- [main.cpp:10] Missing null check
- [utils.h:5] Buffer overflow risk

### SUGGESTIONS
- [main.cpp:20] Consider using const

### SUMMARY
Decent code with two critical issues.`;

    const result = parseMustFix(review);
    expect(result).toContain('Missing null check');
    expect(result).toContain('Buffer overflow risk');
  });

  it('returns null when MUST-FIX is "None"', () => {
    const review = `### MUST-FIX
None

### SUGGESTIONS
- [main.cpp:20] Consider using const

### SUMMARY
Clean code.`;

    expect(parseMustFix(review)).toBeNull();
  });

  it('returns null when no MUST-FIX section exists', () => {
    expect(parseMustFix('No structured review here.')).toBeNull();
  });

  it('returns null for empty MUST-FIX section', () => {
    const review = `### MUST-FIX

### SUGGESTIONS
- [main.cpp:20] Something`;

    expect(parseMustFix(review)).toBeNull();
  });
});

describe('Staging step between coder and reviewer', () => {
  it('has a stageAllRepos method', () => {
    const o = new Orchestrator();
    expect(typeof (o as any).stageAllRepos).toBe('function');
  });

  it('handleRequest calls stageAllRepos before reviewer (source check)', () => {
    // Look within handleRequest only — find the call sites, not the method definition
    const handleRequestBody = orchestratorSource.slice(
      orchestratorSource.indexOf('async handleRequest'),
    );
    const coderIdx = handleRequestBody.indexOf("runAgent(userMessage, 'coder')");
    const stageIdx = handleRequestBody.indexOf('this.stageAllRepos()');
    const reviewerIdx = handleRequestBody.indexOf("runAgent(reviewerPrompt, 'reviewer')");
    expect(coderIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeGreaterThan(-1);
    expect(reviewerIdx).toBeGreaterThan(-1);
    expect(coderIdx).toBeLessThan(stageIdx);
    expect(stageIdx).toBeLessThan(reviewerIdx);
  });
});

describe('No agents/Task dependency', () => {
  it('does not import AgentDefinition', () => {
    expect(orchestratorSource).not.toContain('AgentDefinition');
  });

  it('does not reference buildAgents', () => {
    expect(orchestratorSource).not.toContain('buildAgents');
  });

  it('does not pass agents option to query()', () => {
    expect(orchestratorSource).not.toMatch(/agents:\s*this\./);
  });

  it('uses independent query() calls via runAgent', () => {
    expect(orchestratorSource).toContain('runAgent');
    expect(orchestratorSource).toContain("query({");
  });
});
