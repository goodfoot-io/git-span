/**
 * Tests for the `.span/.advisorignore` path exclusion list
 * (packages/agent-hooks/src/common/advisor-ignore.ts).
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAdvisorIgnored, loadAdvisorIgnore, parseAdvisorIgnore } from '../../src/common/advisor-ignore.js';
import { makeTempRepo } from '../helpers.js';

describe('parseAdvisorIgnore', () => {
  it('parses one pattern per non-comment line', () => {
    const rules = parseAdvisorIgnore('packages/agent-hooks/generated/**\ndocs/vendored\n');
    expect(rules).toHaveLength(2);
    expect(rules[0].pattern).toBe('packages/agent-hooks/generated/**');
    expect(rules[1].pattern).toBe('docs/vendored');
  });

  it('skips blank lines and comments', () => {
    const rules = parseAdvisorIgnore('# a comment\n\n   \ndocs/vendored\n# trailing\n');
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe('docs/vendored');
  });
});

describe('isAdvisorIgnored — path matching (reuses .hookignore grammar)', () => {
  it('matches an anchored directory pattern and everything beneath it', () => {
    const rules = parseAdvisorIgnore('packages/agent-hooks/generated\n');
    expect(isAdvisorIgnored(rules, 'packages/agent-hooks/generated/out.ts')).toBe(true);
    expect(isAdvisorIgnored(rules, 'packages/agent-hooks/generated/deep/out.ts')).toBe(true);
  });

  it('does not match a sibling or unrelated path', () => {
    const rules = parseAdvisorIgnore('packages/agent-hooks/generated\n');
    expect(isAdvisorIgnored(rules, 'packages/agent-hooks/src/advisor-core.ts')).toBe(false);
    expect(isAdvisorIgnored(rules, 'packages/git-span/src/lib.rs')).toBe(false);
  });

  it('matches an unanchored single-component pattern at any depth', () => {
    const rules = parseAdvisorIgnore('vendored\n');
    expect(isAdvisorIgnored(rules, 'docs/vendored/readme.md')).toBe(true);
    expect(isAdvisorIgnored(rules, 'packages/git-span/vendored/lib.rs')).toBe(true);
    expect(isAdvisorIgnored(rules, 'packages/git-span/src/lib.rs')).toBe(false);
  });
});

describe('loadAdvisorIgnore', () => {
  it('returns rules from .span/.advisorignore', () => {
    const repo = makeTempRepo();
    try {
      fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
      fs.writeFileSync(nodePath.join(repo.root, '.span', '.advisorignore'), 'docs/vendored\n');
      const rules = loadAdvisorIgnore(repo.root);
      expect(rules).toHaveLength(1);
      expect(isAdvisorIgnored(rules, 'docs/vendored/readme.md')).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('fails open (empty rule set) when neither the file nor the .span directory exists', () => {
    const repo = makeTempRepo();
    try {
      expect(loadAdvisorIgnore(repo.root)).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
