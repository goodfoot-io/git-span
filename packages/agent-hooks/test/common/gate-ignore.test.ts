/**
 * Tests for the `.span/.gateignore` path exclusion list
 * (packages/agent-hooks/src/common/gate-ignore.ts).
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGateIgnored, loadGateIgnore, parseGateIgnore } from '../../src/common/gate-ignore.js';
import { makeTempRepo } from '../helpers.js';

describe('parseGateIgnore', () => {
  it('parses one pattern per non-comment line', () => {
    const rules = parseGateIgnore('packages/agent-hooks/generated/**\ndocs/vendored\n');
    expect(rules).toHaveLength(2);
    expect(rules[0].pattern).toBe('packages/agent-hooks/generated/**');
    expect(rules[1].pattern).toBe('docs/vendored');
  });

  it('skips blank lines and comments', () => {
    const rules = parseGateIgnore('# a comment\n\n   \ndocs/vendored\n# trailing\n');
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe('docs/vendored');
  });
});

describe('isGateIgnored — path matching (reuses .hookignore grammar)', () => {
  it('matches an anchored directory pattern and everything beneath it', () => {
    const rules = parseGateIgnore('packages/agent-hooks/generated\n');
    expect(isGateIgnored(rules, 'packages/agent-hooks/generated/out.ts')).toBe(true);
    expect(isGateIgnored(rules, 'packages/agent-hooks/generated/deep/out.ts')).toBe(true);
  });

  it('does not match a sibling or unrelated path', () => {
    const rules = parseGateIgnore('packages/agent-hooks/generated\n');
    expect(isGateIgnored(rules, 'packages/agent-hooks/src/gate-core.ts')).toBe(false);
    expect(isGateIgnored(rules, 'packages/git-span/src/lib.rs')).toBe(false);
  });

  it('matches an unanchored single-component pattern at any depth', () => {
    const rules = parseGateIgnore('vendored\n');
    expect(isGateIgnored(rules, 'docs/vendored/readme.md')).toBe(true);
    expect(isGateIgnored(rules, 'packages/git-span/vendored/lib.rs')).toBe(true);
    expect(isGateIgnored(rules, 'packages/git-span/src/lib.rs')).toBe(false);
  });
});

describe('loadGateIgnore', () => {
  it('returns rules from .span/.gateignore', () => {
    const repo = makeTempRepo();
    try {
      fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
      fs.writeFileSync(nodePath.join(repo.root, '.span', '.gateignore'), 'docs/vendored\n');
      const rules = loadGateIgnore(repo.root);
      expect(rules).toHaveLength(1);
      expect(isGateIgnored(rules, 'docs/vendored/readme.md')).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('fails open (empty rule set) when neither the file nor the .span directory exists', () => {
    const repo = makeTempRepo();
    try {
      expect(loadGateIgnore(repo.root)).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
