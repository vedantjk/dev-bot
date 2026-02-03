import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildCoderPrompt,
  buildReviewerPrompt,
  buildCommitterPrompt,
} from '../src/ai/system-prompt.js';

describe('buildCoderPrompt', () => {
  const prompt = buildCoderPrompt();

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('identifies itself as a coder agent', () => {
    expect(prompt).toContain('Coder Agent');
  });

  it('includes repo setup instructions', () => {
    expect(prompt).toContain('mcp__dev-bot__git_clone');
    expect(prompt).toContain('mcp__dev-bot__git_pull');
  });

  it('instructs NOT to commit or push', () => {
    expect(prompt).toContain('Do NOT commit or push');
  });

  it('instructs to work within repos/', () => {
    expect(prompt).toContain('repos/');
  });

  it('forbids writing to protected paths', () => {
    expect(prompt).toContain('.git/');
    expect(prompt).toContain('node_modules/');
    expect(prompt).toContain('.env');
  });

  it('includes developer preferences section', () => {
    expect(prompt).toContain('Developer Preferences');
  });
});

describe('buildReviewerPrompt', () => {
  const prompt = buildReviewerPrompt();

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('identifies itself as a reviewer agent', () => {
    expect(prompt).toContain('Reviewer Agent');
  });

  it('requires MUST-FIX / SUGGESTIONS / SUMMARY structure', () => {
    expect(prompt).toContain('### MUST-FIX');
    expect(prompt).toContain('### SUGGESTIONS');
    expect(prompt).toContain('### SUMMARY');
  });

  it('specifies the [filename:line_number] format', () => {
    expect(prompt).toContain('[filename:line_number]');
  });

  it('instructs to use git_diff with staged=true', () => {
    expect(prompt).toContain('mcp__dev-bot__git_diff');
    expect(prompt).toContain('staged=true');
  });

  it('instructs to use write_steering_file for best practices', () => {
    expect(prompt).toContain('write_steering_file');
    expect(prompt).toContain('REVIEW_STANDARDS.md');
  });

  it('forbids writing or editing code', () => {
    expect(prompt).toContain('do NOT write or edit code files');
  });

  it('includes developer preferences section', () => {
    expect(prompt).toContain('Developer Preferences');
  });
});

describe('buildCommitterPrompt', () => {
  const prompt = buildCommitterPrompt();

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('identifies itself as a committer agent', () => {
    expect(prompt).toContain('Committer Agent');
  });

  it('instructs to use git_status', () => {
    expect(prompt).toContain('mcp__dev-bot__git_status');
  });

  it('instructs to use git_commit_and_push', () => {
    expect(prompt).toContain('mcp__dev-bot__git_commit_and_push');
  });

  it('uses conventional commit format', () => {
    expect(prompt).toContain('feat:');
    expect(prompt).toContain('fix:');
  });

  it('forbids modifying files', () => {
    expect(prompt).toContain('Do NOT modify any files');
  });
});

describe('buildSystemPrompt (backward compat alias)', () => {
  it('returns the same string as buildCoderPrompt', () => {
    expect(buildSystemPrompt()).toBe(buildCoderPrompt());
  });
});
