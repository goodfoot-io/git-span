/**
 * Tests for the commit-message path-group signal: the applies() gate, the
 * 2-5 distinct-path acceptance window, message-quality score scaling, the
 * ranged-refs and corroboration bonuses, and release-commit exclusion — all
 * exercised against in-memory RepoScan/RepoHistory fixtures.
 *
 * @summary Verifies commitMessagesSignal against synthetic history fixtures.
 */

import { describe, expect, it } from 'vitest';
import { commitMessagesSignal } from '../../src/signals/commitMessages.js';
import type { CommitMeta, DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

/**
 * Build a minimal RepoScan for a fixed set of files, with optional scannable
 * text content for range-anchor resolution.
 *
 * @param files - Every tracked file path the fixture scan should list.
 * @param textFiles - Content for the subset of `files` that should be scannable.
 * @returns A minimal RepoScan built from the given files and content.
 */
function makeScan(files: readonly string[], textFiles: Readonly<Record<string, string>> = {}): RepoScan {
  const text = new Map<string, string>();
  const lines = new Map<string, readonly string[]>();
  for (const [path, content] of Object.entries(textFiles)) {
    text.set(path, content);
    lines.set(path, content.split('\n'));
  }
  const topLevelDirs = new Set<string>();
  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash > 0) topLevelDirs.add(file.slice(0, slash));
  }
  return { root: '/repo', files: [...files].sort(), text, lines, topLevelDirs, docsDirs: [] };
}

/**
 * Build a CommitMeta fixture with deterministic non-release defaults.
 *
 * @param sha - Commit hash (need not be a real 40-char sha for these tests).
 * @param subject - Commit subject line.
 * @param files - Changed files, rename-resolved.
 * @param overrides - Field overrides, e.g. `{ isRelease: true }`.
 * @returns A complete CommitMeta.
 */
function commit(
  sha: string,
  subject: string,
  files: readonly string[],
  overrides: Partial<CommitMeta> = {}
): CommitMeta {
  return { sha, timestamp: 1700000000, author: 'a@x', subject, files: [...files], isRelease: false, ...overrides };
}

/**
 * Wrap commits and their messages in a minimal RepoHistory fixture.
 *
 * @param commits - Commits under test.
 * @param messages - sha -> full message, for the subset of commits with one.
 * @param messageQuality - Repository-wide message quality to simulate.
 * @returns A RepoHistory with empty change groups.
 */
function historyFixture(
  commits: readonly CommitMeta[],
  messages: Readonly<Record<string, string>>,
  messageQuality: number
): RepoHistory {
  return { commits, messages: new Map(Object.entries(messages)), changeGroups: [], messageQuality };
}

/**
 * Build a DiscoverConfig with sensible test defaults.
 *
 * @param overrides - Field overrides.
 * @returns A complete config object.
 */
function makeConfig(overrides: Partial<DiscoverConfig> = {}): DiscoverConfig {
  return {
    exclude: [],
    maxCandidates: 300,
    minScore: 0.5,
    useCommitMessages: true,
    maxFileBytes: 524288,
    ...overrides
  };
}

/**
 * Generate `n` unrelated filler commits, only useful for clearing the
 * applies() commit-count threshold.
 *
 * @param n - Number of filler commits to generate.
 * @returns `n` distinct non-release commits, each touching one unique file.
 */
function fillerCommits(n: number): CommitMeta[] {
  return Array.from({ length: n }, (_, i) => commit(`filler${i}`, `filler ${i}`, [`filler${i}.ts`]));
}

describe('commitMessagesSignal.applies', () => {
  const scan = makeScan(['a.ts']);

  it('is false when useCommitMessages is disabled in config', () => {
    const history = historyFixture(fillerCommits(20), {}, 0.5);
    expect(commitMessagesSignal.applies(scan, history, makeConfig({ useCommitMessages: false }))).toBe(false);
  });

  it('is false when there are fewer than 20 commits', () => {
    const history = historyFixture(fillerCommits(19), {}, 0.5);
    expect(commitMessagesSignal.applies(scan, history, makeConfig())).toBe(false);
  });

  it('is false when messageQuality is below 0.05', () => {
    const history = historyFixture(fillerCommits(20), {}, 0.04);
    expect(commitMessagesSignal.applies(scan, history, makeConfig())).toBe(false);
  });

  it('is true once commit count, message quality, and config all clear their thresholds', () => {
    const history = historyFixture(fillerCommits(20), {}, 0.05);
    expect(commitMessagesSignal.applies(scan, history, makeConfig())).toBe(true);
  });
});

describe('commitMessagesSignal.run', () => {
  it('couples 3 files a commit message names together', () => {
    const files = ['packages/a/one.ts', 'packages/a/two.ts', 'packages/a/three.ts'];
    const scan = makeScan(files);
    const c = commit('sha1', 'wire up one/two/three', files);
    const message = 'Wire packages/a/one.ts to packages/a/two.ts and packages/a/three.ts together.';
    const history = historyFixture([c], { sha1: message }, 0.35);

    const candidates = commitMessagesSignal.run(scan, history, makeConfig());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.locs.map((l) => l.path).sort()).toEqual([...files].sort());
    expect(candidates[0]?.evidence).toEqual(['msg:sha1']);
    expect(candidates[0]?.score).toBeCloseTo(0.6, 5);
  });

  it('produces nothing when a message names more than 5 distinct files', () => {
    const files = Array.from({ length: 7 }, (_, i) => `packages/a/file${i}.ts`);
    const scan = makeScan(files);
    const c = commit('sha2', 'touch many files', files);
    const history = historyFixture([c], { sha2: files.join(', ') }, 0.35);

    expect(commitMessagesSignal.run(scan, history, makeConfig())).toHaveLength(0);
  });

  it('produces nothing when a message names only a single file', () => {
    const files = ['packages/a/one.ts'];
    const scan = makeScan(files);
    const c = commit('sha3', 'small fix', files);
    const history = historyFixture([c], { sha3: 'Small fix in packages/a/one.ts.' }, 0.35);

    expect(commitMessagesSignal.run(scan, history, makeConfig())).toHaveLength(0);
  });

  it('scales score down for a repository with poor commit-message quality', () => {
    const files = ['packages/a/one.ts', 'packages/a/two.ts'];
    const scan = makeScan(files);
    const c = commit('sha4', 'wire one and two', files);
    const message = 'Wire packages/a/one.ts to packages/a/two.ts.';

    const low = commitMessagesSignal.run(scan, historyFixture([c], { sha4: message }, 0.05), makeConfig());
    const high = commitMessagesSignal.run(scan, historyFixture([c], { sha4: message }, 0.35), makeConfig());

    expect(low[0]?.score).toBeCloseTo(0.387, 5);
    expect(high[0]?.score).toBeCloseTo(0.63, 5);
    expect(low[0]?.score ?? 0).toBeLessThan(high[0]?.score ?? 0);
  });

  it('skips release commits even when their message names enough real paths', () => {
    const files = ['packages/a/one.ts', 'packages/a/two.ts'];
    const scan = makeScan(files);
    const c = commit('sha5', 'v1.2.3', files, { isRelease: true });
    const message = 'Wire packages/a/one.ts to packages/a/two.ts.';
    const history = historyFixture([c], { sha5: message }, 0.35);

    expect(commitMessagesSignal.run(scan, history, makeConfig())).toHaveLength(0);
  });

  it('adds a bonus when at least 2 named refs carry an explicit line range', () => {
    const files = ['packages/a/one.ts', 'packages/a/two.ts'];
    const tenLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const scan = makeScan(files, { 'packages/a/one.ts': tenLines, 'packages/a/two.ts': tenLines });
    const c = commit('sha6', 'wire one and two', ['other.ts']);
    const message = 'See packages/a/one.ts#L2-L4 and packages/a/two.ts#L3-L5.';
    const history = historyFixture([c], { sha6: message }, 0.35);

    const candidates = commitMessagesSignal.run(scan, history, makeConfig());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.score).toBeCloseTo(0.68, 5);
  });
});
