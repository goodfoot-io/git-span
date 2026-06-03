/**
 * Tests for path-scoped mesh suppression (packages/agent-hooks/src/mesh-ignore.ts).
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMeshSuppressed, loadHookIgnore, parseHookIgnore } from '../src/mesh-ignore.js';
import { makeTempRepo } from './helpers.js';

describe('parseHookIgnore', () => {
  it('parses a pattern with comma-separated prefixes', () => {
    const rules = parseHookIgnore('packages/agent-hooks/src wiki,marketing\n');
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe('packages/agent-hooks/src');
    expect(rules[0].prefixes).toEqual(['wiki', 'marketing']);
  });

  it('skips blank lines and comments', () => {
    const rules = parseHookIgnore('# a comment\n\n   \npackages wiki\n# trailing\n');
    expect(rules).toHaveLength(1);
    expect(rules[0].prefixes).toEqual(['wiki']);
  });

  it('skips malformed lines lacking prefixes', () => {
    expect(parseHookIgnore('packages\n')).toHaveLength(0);
    expect(parseHookIgnore('packages   \n')).toHaveLength(0);
  });

  it('trims whitespace around prefixes', () => {
    const rules = parseHookIgnore('src wiki');
    expect(rules[0].prefixes).toEqual(['wiki']);
  });
});

describe('isMeshSuppressed — slug prefix semantics', () => {
  const rules = parseHookIgnore('packages/agent-hooks/src wiki,marketing\n');

  it('suppresses a slug that is exactly the prefix', () => {
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki')).toBe(true);
  });

  it('suppresses a slug under the prefix', () => {
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/onboarding')).toBe(true);
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'marketing/launch')).toBe(true);
  });

  it('does not suppress a slug that merely starts with the prefix string', () => {
    // `wikipedia` is not under the `wiki` prefix.
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wikipedia/page')).toBe(false);
  });

  it('does not suppress an unrelated slug', () => {
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'billing/checkout')).toBe(false);
  });
});

describe('isMeshSuppressed — path matching', () => {
  it('anchored pattern matches the directory and everything beneath', () => {
    const rules = parseHookIgnore('packages/agent-hooks/src wiki\n');
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/deep/nested.ts', 'wiki/x')).toBe(true);
  });

  it('anchored pattern does not match a sibling path', () => {
    const rules = parseHookIgnore('packages/agent-hooks/src wiki\n');
    expect(isMeshSuppressed(rules, 'packages/git-mesh/src/lib.rs', 'wiki/x')).toBe(false);
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/test/x.ts', 'wiki/x')).toBe(false);
  });

  it('unanchored single-component pattern matches at any depth', () => {
    const rules = parseHookIgnore('docs wiki\n');
    expect(isMeshSuppressed(rules, 'docs/intro.md', 'wiki/x')).toBe(true);
    expect(isMeshSuppressed(rules, 'packages/git-mesh/docs/profiling.md', 'wiki/x')).toBe(true);
    expect(isMeshSuppressed(rules, 'packages/git-mesh/src/lib.rs', 'wiki/x')).toBe(false);
  });

  it('directory-only pattern (trailing slash) does not match a same-named file', () => {
    const rules = parseHookIgnore('src/ wiki\n');
    // `src` as a directory component → suppressed
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    // a file literally named `src` (no children) → leaf excluded, not matched
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src', 'wiki/x')).toBe(false);
  });

  it('* wildcard matches within a single segment', () => {
    const rules = parseHookIgnore('packages/*/src wiki\n');
    expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    expect(isMeshSuppressed(rules, 'packages/git-mesh/src/lib.rs', 'wiki/x')).toBe(true);
    // * does not cross a slash
    expect(isMeshSuppressed(rules, 'packages/a/b/src/x.ts', 'wiki/x')).toBe(false);
  });

  it('** wildcard matches across segments', () => {
    const rules = parseHookIgnore('packages/**/src wiki\n');
    expect(isMeshSuppressed(rules, 'packages/a/b/src/x.ts', 'wiki/x')).toBe(true);
  });
});

describe('loadHookIgnore', () => {
  it('returns rules from .mesh/.hookignore', () => {
    const repo = makeTempRepo();
    try {
      fs.mkdirSync(nodePath.join(repo.root, '.mesh'), { recursive: true });
      fs.writeFileSync(nodePath.join(repo.root, '.mesh', '.hookignore'), 'packages/agent-hooks/src wiki\n');
      const rules = loadHookIgnore(repo.root);
      expect(rules).toHaveLength(1);
      expect(isMeshSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('fails open when the file is absent', () => {
    const repo = makeTempRepo();
    try {
      expect(loadHookIgnore(repo.root)).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
