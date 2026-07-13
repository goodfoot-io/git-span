/**
 * Tests for path-scoped span suppression (packages/agent-hooks/src/span-ignore.ts).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInsideSpanRoot, resolveSpanRoot } from '../src/agent-hooks-common.js';
import { isSpanSuppressed, loadHookIgnore, parseHookIgnore } from '../src/span-ignore.js';
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

describe('isSpanSuppressed — slug prefix semantics', () => {
  const rules = parseHookIgnore('packages/agent-hooks/src wiki,marketing\n');

  it('suppresses a slug that is exactly the prefix', () => {
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki')).toBe(true);
  });

  it('suppresses a slug under the prefix', () => {
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/onboarding')).toBe(true);
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'marketing/launch')).toBe(true);
  });

  it('does not suppress a slug that merely starts with the prefix string', () => {
    // `wikipedia` is not under the `wiki` prefix.
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wikipedia/page')).toBe(false);
  });

  it('does not suppress an unrelated slug', () => {
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'billing/checkout')).toBe(false);
  });
});

describe('isSpanSuppressed — path matching', () => {
  it('anchored pattern matches the directory and everything beneath', () => {
    const rules = parseHookIgnore('packages/agent-hooks/src wiki\n');
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/deep/nested.ts', 'wiki/x')).toBe(true);
  });

  it('anchored pattern does not match a sibling path', () => {
    const rules = parseHookIgnore('packages/agent-hooks/src wiki\n');
    expect(isSpanSuppressed(rules, 'packages/git-span/src/lib.rs', 'wiki/x')).toBe(false);
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/test/x.ts', 'wiki/x')).toBe(false);
  });

  it('unanchored single-component pattern matches at any depth', () => {
    const rules = parseHookIgnore('docs wiki\n');
    expect(isSpanSuppressed(rules, 'docs/intro.md', 'wiki/x')).toBe(true);
    expect(isSpanSuppressed(rules, 'packages/git-span/docs/profiling.md', 'wiki/x')).toBe(true);
    expect(isSpanSuppressed(rules, 'packages/git-span/src/lib.rs', 'wiki/x')).toBe(false);
  });

  it('directory-only pattern (trailing slash) does not match a same-named file', () => {
    const rules = parseHookIgnore('src/ wiki\n');
    // `src` as a directory component → suppressed
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    // a file literally named `src` (no children) → leaf excluded, not matched
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src', 'wiki/x')).toBe(false);
  });

  it('* wildcard matches within a single segment', () => {
    const rules = parseHookIgnore('packages/*/src wiki\n');
    expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
    expect(isSpanSuppressed(rules, 'packages/git-span/src/lib.rs', 'wiki/x')).toBe(true);
    // * does not cross a slash
    expect(isSpanSuppressed(rules, 'packages/a/b/src/x.ts', 'wiki/x')).toBe(false);
  });

  it('** wildcard matches across segments', () => {
    const rules = parseHookIgnore('packages/**/src wiki\n');
    expect(isSpanSuppressed(rules, 'packages/a/b/src/x.ts', 'wiki/x')).toBe(true);
  });
});

describe('loadHookIgnore', () => {
  it('returns rules from .span/.hookignore', () => {
    const repo = makeTempRepo();
    try {
      fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
      fs.writeFileSync(nodePath.join(repo.root, '.span', '.hookignore'), 'packages/agent-hooks/src wiki\n');
      const rules = loadHookIgnore(repo.root);
      expect(rules).toHaveLength(1);
      expect(isSpanSuppressed(rules, 'packages/agent-hooks/src/stop.ts', 'wiki/x')).toBe(true);
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

describe('isInsideSpanRoot', () => {
  it('returns true for the span root itself', () => {
    expect(isInsideSpanRoot('.span')).toBe(true);
  });

  it('returns true for a direct child', () => {
    expect(isInsideSpanRoot('.span/wiki')).toBe(true);
  });

  it('returns true for a deeply nested path', () => {
    expect(isInsideSpanRoot('.span/wiki/reference/codex/instruction-loading')).toBe(true);
    expect(isInsideSpanRoot('.span/codex-parity/some/deep/doc')).toBe(true);
  });

  it('returns false for a sibling directory that starts with .span', () => {
    expect(isInsideSpanRoot('.spans/x')).toBe(false);
    expect(isInsideSpanRoot('.span-notes/x')).toBe(false);
  });

  it('returns false for an ordinary source path', () => {
    expect(isInsideSpanRoot('packages/agent-hooks/src/stop.ts')).toBe(false);
    expect(isInsideSpanRoot('src/index.ts')).toBe(false);
  });

  describe('with a custom span root', () => {
    const customRoot = 'docs/span';

    it('returns true for the custom root itself', () => {
      expect(isInsideSpanRoot('docs/span', customRoot)).toBe(true);
    });

    it('returns true for a path nested under the custom root', () => {
      expect(isInsideSpanRoot('docs/span/x/y', customRoot)).toBe(true);
    });

    it('returns false for a sibling that shares the prefix', () => {
      expect(isInsideSpanRoot('docs/spans/x', customRoot)).toBe(false);
      expect(isInsideSpanRoot('docs/span-notes/x', customRoot)).toBe(false);
    });

    it('returns false for the default .span root when the configured root is docs/span', () => {
      expect(isInsideSpanRoot('.span/x', customRoot)).toBe(false);
    });

    it('normalizes a trailing slash on the provided root', () => {
      expect(isInsideSpanRoot('docs/span/slug', 'docs/span/')).toBe(true);
      expect(isInsideSpanRoot('docs/span', 'docs/span/')).toBe(true);
    });
  });
});

describe('resolveSpanRoot', () => {
  it('falls back to .span when no env var or git config is set', () => {
    const repo = makeTempRepo();
    try {
      const original = process.env['GIT_SPAN_DIR'];
      delete process.env['GIT_SPAN_DIR'];
      try {
        expect(resolveSpanRoot(repo.root)).toBe('.span');
      } finally {
        if (original !== undefined) process.env['GIT_SPAN_DIR'] = original;
      }
    } finally {
      repo.cleanup();
    }
  });

  it('returns the value from git config git-span.dir when set', () => {
    const repo = makeTempRepo();
    try {
      const original = process.env['GIT_SPAN_DIR'];
      delete process.env['GIT_SPAN_DIR'];
      try {
        execFileSync('git', ['-C', repo.root, 'config', 'git-span.dir', 'docs/span'], { stdio: 'ignore' });
        expect(resolveSpanRoot(repo.root)).toBe('docs/span');
      } finally {
        if (original !== undefined) process.env['GIT_SPAN_DIR'] = original;
      }
    } finally {
      repo.cleanup();
    }
  });

  it('GIT_SPAN_DIR env var takes precedence over git config', () => {
    const repo = makeTempRepo();
    try {
      const original = process.env['GIT_SPAN_DIR'];
      process.env['GIT_SPAN_DIR'] = 'env/span';
      try {
        execFileSync('git', ['-C', repo.root, 'config', 'git-span.dir', 'docs/span'], { stdio: 'ignore' });
        expect(resolveSpanRoot(repo.root)).toBe('env/span');
      } finally {
        if (original !== undefined) {
          process.env['GIT_SPAN_DIR'] = original;
        } else {
          delete process.env['GIT_SPAN_DIR'];
        }
      }
    } finally {
      repo.cleanup();
    }
  });
});
