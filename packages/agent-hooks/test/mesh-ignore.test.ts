/**
 * Tests for path-scoped mesh suppression (packages/agent-hooks/src/mesh-ignore.ts).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInsideMeshRoot, resolveMeshRoot } from '../src/agent-hooks-common.js';
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

describe('isInsideMeshRoot', () => {
  it('returns true for the mesh root itself', () => {
    expect(isInsideMeshRoot('.mesh')).toBe(true);
  });

  it('returns true for a direct child', () => {
    expect(isInsideMeshRoot('.mesh/wiki')).toBe(true);
  });

  it('returns true for a deeply nested path', () => {
    expect(isInsideMeshRoot('.mesh/wiki/reference/codex/instruction-loading')).toBe(true);
    expect(isInsideMeshRoot('.mesh/codex-parity/some/deep/doc')).toBe(true);
  });

  it('returns false for a sibling directory that starts with .mesh', () => {
    expect(isInsideMeshRoot('.meshes/x')).toBe(false);
    expect(isInsideMeshRoot('.mesh-notes/x')).toBe(false);
  });

  it('returns false for an ordinary source path', () => {
    expect(isInsideMeshRoot('packages/agent-hooks/src/stop.ts')).toBe(false);
    expect(isInsideMeshRoot('src/index.ts')).toBe(false);
  });

  describe('with a custom mesh root', () => {
    const customRoot = 'docs/mesh';

    it('returns true for the custom root itself', () => {
      expect(isInsideMeshRoot('docs/mesh', customRoot)).toBe(true);
    });

    it('returns true for a path nested under the custom root', () => {
      expect(isInsideMeshRoot('docs/mesh/x/y', customRoot)).toBe(true);
    });

    it('returns false for a sibling that shares the prefix', () => {
      expect(isInsideMeshRoot('docs/meshes/x', customRoot)).toBe(false);
      expect(isInsideMeshRoot('docs/mesh-notes/x', customRoot)).toBe(false);
    });

    it('returns false for the default .mesh root when the configured root is docs/mesh', () => {
      expect(isInsideMeshRoot('.mesh/x', customRoot)).toBe(false);
    });

    it('normalizes a trailing slash on the provided root', () => {
      expect(isInsideMeshRoot('docs/mesh/slug', 'docs/mesh/')).toBe(true);
      expect(isInsideMeshRoot('docs/mesh', 'docs/mesh/')).toBe(true);
    });
  });
});

describe('resolveMeshRoot', () => {
  it('falls back to .mesh when no env var or git config is set', () => {
    const repo = makeTempRepo();
    try {
      const original = process.env['GIT_MESH_DIR'];
      delete process.env['GIT_MESH_DIR'];
      try {
        expect(resolveMeshRoot(repo.root)).toBe('.mesh');
      } finally {
        if (original !== undefined) process.env['GIT_MESH_DIR'] = original;
      }
    } finally {
      repo.cleanup();
    }
  });

  it('returns the value from git config git-mesh.dir when set', () => {
    const repo = makeTempRepo();
    try {
      const original = process.env['GIT_MESH_DIR'];
      delete process.env['GIT_MESH_DIR'];
      try {
        execFileSync('git', ['-C', repo.root, 'config', 'git-mesh.dir', 'docs/mesh'], { stdio: 'ignore' });
        expect(resolveMeshRoot(repo.root)).toBe('docs/mesh');
      } finally {
        if (original !== undefined) process.env['GIT_MESH_DIR'] = original;
      }
    } finally {
      repo.cleanup();
    }
  });

  it('GIT_MESH_DIR env var takes precedence over git config', () => {
    const repo = makeTempRepo();
    try {
      const original = process.env['GIT_MESH_DIR'];
      process.env['GIT_MESH_DIR'] = 'env/mesh';
      try {
        execFileSync('git', ['-C', repo.root, 'config', 'git-mesh.dir', 'docs/mesh'], { stdio: 'ignore' });
        expect(resolveMeshRoot(repo.root)).toBe('env/mesh');
      } finally {
        if (original !== undefined) {
          process.env['GIT_MESH_DIR'] = original;
        } else {
          delete process.env['GIT_MESH_DIR'];
        }
      }
    } finally {
      repo.cleanup();
    }
  });
});
