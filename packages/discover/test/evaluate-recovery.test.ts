/**
 * Unit tests for scripts/evaluate-recovery.mts's `.span/**` ground-truth
 * loader and recovery classification — the two pieces of new, hand-written
 * logic in that script (near-clique-grouping plan, Stage 5). The script's
 * live-repo run itself is exercised manually (`yarn evaluate-recovery`), not
 * here — this suite is about the loader parsing the real `.span/**` shape
 * correctly and failing loudly on malformed/missing input, plus the
 * strict/near classification helper, both independent of any real repo
 * history.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyRecovery,
  loadGroundTruthSpan,
  loadGroundTruthSpans,
  parseSpanFile
} from '../scripts/evaluate-recovery.mjs';

describe('parseSpanFile', () => {
  it('parses whole-file and range anchors from a real .span/** shape', () => {
    const content = [
      'packages/git-span-core/src/lib.rs#L27-L28 rk64:925472c09f25dcae',
      'packages/git-span/src/cli/merge_driver.rs rk64:624b66599fb2bbe0',
      '',
      'Some free-form description text.'
    ].join('\n');

    const span = parseSpanFile('git-span/structural-merge-kernel', content);

    expect(span.name).toBe('git-span/structural-merge-kernel');
    expect(span.anchors).toEqual([
      { path: 'packages/git-span-core/src/lib.rs', startLine: 27, endLine: 28 },
      { path: 'packages/git-span/src/cli/merge_driver.rs' }
    ]);
    expect(span.paths).toEqual(
      new Set(['packages/git-span-core/src/lib.rs', 'packages/git-span/src/cli/merge_driver.rs'])
    );
  });

  it('stops at the first blank line, ignoring the description body', () => {
    const content =
      'a.ts rk64:aaaaaaaaaaaaaaaa\nb.ts rk64:bbbbbbbbbbbbbbbb\n\nrk64: this looks like an anchor line but is prose\n';
    const span = parseSpanFile('fixture-span', content);
    expect(span.anchors).toHaveLength(2);
  });

  it('throws on a malformed anchor line rather than silently skipping it', () => {
    const content = 'a.ts rk64:aaaaaaaaaaaaaaaa\nthis is not a valid anchor line\n';
    expect(() => parseSpanFile('broken-span', content)).toThrow(/malformed/i);
  });

  it('throws on an empty file rather than returning zero anchors silently', () => {
    expect(() => parseSpanFile('empty-span', '')).toThrow(/no anchor lines/i);
  });

  it('throws when the first line is prose rather than an anchor line', () => {
    // The very first non-blank line is expected to be an anchor line; prose
    // right at the top is caught by the same malformed-line check that
    // catches any other non-conforming line, not a separate "empty" path.
    expect(() => parseSpanFile('prose-only-span', 'This file has no anchors at all, just words.\n')).toThrow(
      /malformed/i
    );
  });
});

describe('loadGroundTruthSpan', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-eval-fixture-'));
    fs.mkdirSync(path.join(repoRoot, '.span', 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.span', 'nested', 'real-span'),
      'x.ts rk64:1111111111111111\ny.ts#L1-L2 rk64:2222222222222222\n\nA real coupling.\n'
    );
    fs.writeFileSync(path.join(repoRoot, '.span', 'nested', 'malformed-span'), 'not an anchor line at all\n');
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('reads and parses a real span file from disk', () => {
    const span = loadGroundTruthSpan(repoRoot, 'nested/real-span');
    expect(span.paths).toEqual(new Set(['x.ts', 'y.ts']));
  });

  it('fails loudly (throws) rather than silently returning zero groups on a missing file', () => {
    expect(() => loadGroundTruthSpan(repoRoot, 'nested/does-not-exist')).toThrow(/could not read/i);
  });

  it('fails loudly on a malformed file read from disk, not just from parseSpanFile directly', () => {
    expect(() => loadGroundTruthSpan(repoRoot, 'nested/malformed-span')).toThrow(/malformed/i);
  });

  it('loadGroundTruthSpans loads every named span and throws on the first missing one', () => {
    const spans = loadGroundTruthSpans(repoRoot, ['nested/real-span']);
    expect(spans).toHaveLength(1);

    expect(() => loadGroundTruthSpans(repoRoot, ['nested/real-span', 'nested/missing'])).toThrow(/could not read/i);
  });
});

describe('parses the real .span/** ground-truth corpus in this repository', () => {
  it("loads all 13 named spans from this repo's real .span/** without throwing", () => {
    // Walk up from this test file's location to the monorepo root (mirrors
    // the script's own default repoRoot derivation) so this test proves the
    // loader against the real corpus, not just synthetic fixtures.
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const spans = loadGroundTruthSpans(repoRoot);
    expect(spans).toHaveLength(13);
    for (const span of spans) expect(span.paths.size).toBeGreaterThanOrEqual(2);
  });
});

describe('classifyRecovery', () => {
  const groundTruth = {
    name: 'fixture',
    anchors: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
    paths: new Set(['a.ts', 'b.ts', 'c.ts'])
  };

  it('classifies "strict" when a reported group exactly matches the ground-truth file set', () => {
    const groups = [{ anchors: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }] }];
    expect(classifyRecovery(groundTruth, groups)).toBe('strict');
  });

  it('classifies "near" when a reported group differs by exactly one file', () => {
    const groups = [{ anchors: [{ path: 'a.ts' }, { path: 'b.ts' }] }];
    expect(classifyRecovery(groundTruth, groups)).toBe('near');
  });

  it('classifies "near" when a reported group has one extra file beyond the ground truth', () => {
    const groups = [{ anchors: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }, { path: 'd.ts' }] }];
    expect(classifyRecovery(groundTruth, groups)).toBe('near');
  });

  it('classifies "none" when no reported group comes within one file', () => {
    const groups = [{ anchors: [{ path: 'a.ts' }, { path: 'z.ts' }] }];
    expect(classifyRecovery(groundTruth, groups)).toBe('none');
  });

  it('classifies "none" against an empty reported-groups list', () => {
    expect(classifyRecovery(groundTruth, [])).toBe('none');
  });

  it('prefers "strict" even when a different reported group would only be "near"', () => {
    const groups = [
      { anchors: [{ path: 'a.ts' }, { path: 'b.ts' }] },
      { anchors: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }] }
    ];
    expect(classifyRecovery(groundTruth, groups)).toBe('strict');
  });
});
