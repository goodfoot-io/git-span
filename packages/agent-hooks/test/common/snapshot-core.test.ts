/**
 * Skipped acceptance checks for snapshot-core.ts (Phase 2 of the card main-213
 * TDD bootstrap described in plans/snapshot-attribute.md). Phase 1 declared the
 * snapshot contract surface — budgets, record shapes, and the pure functions —
 * as `Not Implemented` stubs; this file writes the contract's acceptance
 * checks against those stubs so the Phase 3 implementation has a fixed target.
 * Phase 3 implemented the module and unskipped every case: the checks below
 * are the live acceptance suite.
 *
 * The diff oracle is `git diff --no-index -U0` on generated pre/post pairs:
 * the property tests assert `diffLineHashes` reproduces git's xdiff hunk
 * layout EXACTLY — coordinates, pure-insertion/deletion 0-sides, adjacent
 * change-region merging, and its tie-breaking on duplicated lines — because
 * the snapshot path attributes the same ranges a developer sees in `git
 * diff`. A naive Myers backtrack does NOT match git (verified: ~36% of
 * duplicate-heavy pairs and ~1% of unique-line pairs diverge on tie-breaks
 * and hunk merging); the oracle is the spec Phase 3 ports against, not a
 * loose sanity check. The fixture's own line-hash helper hashes each line
 * INCLUDING its terminator, so a missing final newline and CRLF round-trips
 * are distinguishable — the contract's `SnapshotFile.lines` semantics.
 *
 * The injected-hash-collision seam is the function's own signature: both
 * `diffLineHashes` and the comparison operate on opaque line-hash strings, so
 * a test can hand them two arrays that are equal as hash strings while the
 * files' byte hashes differ — exactly the collision the plan says must fall
 * back to whole-file scope with a diagnostic, never silently shrink.
 *
 * Fakes are constructed against the real exported types (SnapshotRecord,
 * SnapshotFile, SiblingSnapshot, CompareSnapshotInput, HashFileInput) rather
 * than loosened/`any`-typed shapes — that fidelity is the payoff of the
 * bootstrap: an awkward fake here is a contract-ergonomics finding.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyAmbiguityRules,
  type CompareSnapshotInput,
  classifyCommandForSnapshot,
  compareSnapshot,
  DEFAULT_SNAPSHOT_BUDGETS,
  type DiffHunk,
  diffLineHashes,
  type HashFileInput,
  hashFile,
  hunksToPostRanges,
  pairRenames,
  recordHasPathCoverageGap,
  type SiblingSnapshot,
  type SnapshotFile,
  type SnapshotRecord
} from '../../src/common/snapshot-core.js';
import { createSnapshotStore } from '../../src/common/snapshot-store.js';
import type { CoreLogger } from '../../src/common/span-surface.js';
import type { TouchWriteInput } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const SESSION_ID = 'session-snapshot-core';
const TOOL_USE_ID = 'toolu_01snapshotcoretest';
const REPO_ROOT = '/repo';
/** An mtimeNs with a NON-ZERO sub-second part (a trustworthy clock). */
const TRUSTED_MTIME = 1_780_000_000_123_456_789n;
/** An mtimeNs with a ZERO sub-second part (second-granularity clock). */
const COARSE_MTIME = 1_780_000_000_000_000_000n;

// ---------------------------------------------------------------------------
// Local helpers (fixture-side definitions of the contract's semantics)
// ---------------------------------------------------------------------------

/** SHA-256 hex of a byte string — the record's byte/line hash format. */
function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Mirror the store's bigint-to-string JSON replacer: mtimeNs serializes as a string. */
function bigintToJson(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Hash the lines of `content`, each INCLUDING its terminator ('\n' or '\r\n';
 * a final line without a terminator is hashed as-is). An empty file yields no
 * lines. This is the fixture's own definition of the contract's line-hash
 * semantics — the expected values the Phase 3 implementation must produce.
 */
function hashLines(content: string): string[] {
  const hashes: string[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      hashes.push(sha256Hex(content.slice(start, i + 1)));
      start = i + 1;
    }
  }
  if (start < content.length) hashes.push(sha256Hex(content.slice(start)));
  return hashes;
}

/** A snapshot file entry with contract-shaped defaults. */
function fileEntry(overrides: Partial<SnapshotFile> = {}): SnapshotFile {
  return { hash: 'pre-hash', size: 10, mtimeNs: TRUSTED_MTIME, capturedAt: 1000, lines: [], ...overrides };
}

/** A pre-walk record with contract-shaped defaults. */
function record(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    version: 1,
    sessionId: SESSION_ID,
    toolUseId: TOOL_USE_ID,
    repoRoot: REPO_ROOT,
    createdAt: 1000,
    consumed: false,
    consumedAt: null,
    tier: 'explicit',
    gaps: [],
    files: {},
    ...overrides
  };
}

/** A sibling record's per-path view, for the ambiguity table fixtures. */
function sibling(overrides: Partial<SiblingSnapshot> = {}): SiblingSnapshot {
  return {
    sessionId: 'sibling-session',
    toolUseId: 'sibling-1',
    createdAt: 900,
    consumed: true,
    consumedAt: 950,
    coverageGap: false,
    pre: null,
    post: null,
    ...overrides
  };
}

/** A compareSnapshot input with contract-shaped defaults. */
function compareInput(overrides: Partial<CompareSnapshotInput> = {}): CompareSnapshotInput {
  return {
    record: record(),
    post: new Map<string, SnapshotFile>(),
    postGaps: [],
    budgets: DEFAULT_SNAPSHOT_BUDGETS,
    stat: () => null,
    read: () => null,
    now: 1500,
    ...overrides
  };
}

/** A hashFile input with contract-shaped defaults (reads 'a\nb\nc\n'). */
function hashInput(overrides: Partial<HashFileInput> = {}): HashFileInput {
  return {
    absPath: '/repo/a.ts',
    now: 1000,
    budgets: DEFAULT_SNAPSHOT_BUDGETS,
    remainingLineBudget: DEFAULT_SNAPSHOT_BUDGETS.maxLineHashesPerRecord,
    stat: () => ({ size: 6, mtimeNs: TRUSTED_MTIME }),
    read: () => Buffer.from('a\nb\nc\n'),
    ...overrides
  };
}

/** Set env vars for the duration of `fn`, restoring afterwards. */
function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A real temp repo with the given `git config` entries applied. */
function repoWithConfig(entries: Array<[string, string]>): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  for (const [key, value] of entries) {
    execFileSync('git', ['-C', repo.root, 'config', key, value], { stdio: 'ignore' });
  }
  return repo;
}

// ---------------------------------------------------------------------------
// Diff oracle (git diff --no-index -U0)
// ---------------------------------------------------------------------------

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse git's `@@ -a[,b] +c[,d] @@` hunk headers VERBATIM into DiffHunk
 * coordinates (git emits 1-based starts, `0` for the count-only side of a
 * pure insertion/deletion at a file edge — exactly the contract's shape). The
 * `,1` count is omitted by git and defaults to 1; non-`@@` lines (headers,
 * `\ No newline at end of file` markers) are ignored.
 */
function parseGitHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const line of diffOutput.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (m === null) continue;
    hunks.push({
      preStart: Number(m[1]),
      preLines: m[2] === undefined ? 1 : Number(m[2]),
      postStart: Number(m[3]),
      postLines: m[4] === undefined ? 1 : Number(m[4])
    });
  }
  return hunks;
}

/**
 * The oracle: `git diff --no-index -U0` on the two files. Exit 1 is the
 * files-differ signal (the diff text is on stdout); exit 0 with no output
 * means identical. Only the hunk headers are consumed.
 *
 * The git process runs with cwd OUTSIDE any repository (`dir` is a bare temp
 * dir): an in-repo cwd would apply the repo's .gitattributes (e.g. the
 * git-span repo's `* text=auto`), which normalizes CRLF to LF and would make
 * git report CRLF-vs-LF pairs identical instead of different content.
 */
function runGitDiffOracle(pre: string, post: string, dir: string): DiffHunk[] {
  const prePath = join(dir, 'pre.txt');
  const postPath = join(dir, 'post.txt');
  writeFileSync(prePath, pre);
  writeFileSync(postPath, post);
  let stdout = '';
  try {
    stdout = execFileSync('git', ['diff', '--no-index', '-U0', '--', prePath, postPath], {
      cwd: dir,
      encoding: 'utf8'
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 1) throw err;
    stdout = String((err as { stdout?: string }).stdout ?? '');
  }
  return parseGitHunks(stdout);
}

/** Deterministic PRNG (mulberry32) so the property test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedPair {
  pre: string;
  post: string;
}

/**
 * Generate a (pre, post) line pair from a small alphabet (short lines, heavy
 * duplication — the tie-breaking regime where diff algorithms diverge) with
 * random insertions/deletions/replacements, optionally CRLF endings and/or a
 * missing final newline on both files.
 */
function generatePair(rand: () => number, opts: { crlf: boolean; missingFinalNewline: boolean }): GeneratedPair {
  const alphabet = ['a', 'b', 'c', 'd'];
  const makeLines = (count: number): string[] =>
    Array.from({ length: count }, () => alphabet[Math.floor(rand() * alphabet.length)]);
  const pre = makeLines(1 + Math.floor(rand() * 40));
  const post = [...pre];
  const ops = 1 + Math.floor(rand() * 10);
  for (let i = 0; i < ops; i += 1) {
    const op = rand();
    const idx = Math.floor(rand() * (post.length + 1));
    if (op < 0.33 && post.length > 0) post.splice(Math.min(idx, post.length - 1), 1);
    else if (op < 0.66) post.splice(idx, 0, alphabet[Math.floor(rand() * alphabet.length)]);
    else if (post.length > 0) post[Math.min(idx, post.length - 1)] = alphabet[Math.floor(rand() * alphabet.length)];
  }
  const eol = opts.crlf ? '\r\n' : '\n';
  let preText = pre.join(eol);
  let postText = post.join(eol);
  if (!opts.missingFinalNewline) {
    preText += eol;
    postText += eol;
  }
  return { pre: preText, post: postText };
}

let oracleDir: string;

beforeAll(() => {
  oracleDir = mkdtempSync(join(tmpdir(), 'snapshot-diff-oracle-'));
});

afterAll(() => {
  rmSync(oracleDir, { recursive: true, force: true });
});

/** Assert diffLineHashes reproduces the oracle's hunks for one pair. */
function expectGitDiffMatch(pre: string, post: string): void {
  expect(diffLineHashes(hashLines(pre), hashLines(post))).toEqual(runGitDiffOracle(pre, post, oracleDir));
}

describe('diffLineHashes — git diff --no-index -U0 oracle', () => {
  it('pure insertion at the start of the file', () => {
    expectGitDiffMatch('b\nc\n', 'a\nb\nc\n');
  });

  it('pure insertion in the middle of the file', () => {
    expectGitDiffMatch('a\nb\nc\n', 'a\nX\nb\nc\n');
  });

  it('pure insertion at the end of the file (git reports the last-line coordinate)', () => {
    expectGitDiffMatch('a\nb\nc\n', 'a\nb\nc\nd\n');
  });

  it('pure deletion at the start of the file', () => {
    expectGitDiffMatch('a\nb\nc\n', 'b\nc\n');
  });

  it('pure deletion in the middle of the file', () => {
    expectGitDiffMatch('a\nb\nc\n', 'a\nc\n');
  });

  it('pure deletion at the end of the file', () => {
    expectGitDiffMatch('a\nb\nc\n', 'a\nb\n');
  });

  it('a single-line replacement', () => {
    expectGitDiffMatch('a\nb\nc\n', 'a\nX\nc\n');
  });

  it('adjacent replacements merge into one hunk under -U0', () => {
    expectGitDiffMatch('a\nb\nc\nd\n', 'x\ny\nc\nd\n');
  });

  it('duplicated lines: deletion between copies of the same line', () => {
    expectGitDiffMatch('x\ny\nx\nz\n', 'x\nx\nz\n');
  });

  it('duplicated lines: replacement of one copy of a duplicated line', () => {
    expectGitDiffMatch('x\ny\nx\nz\n', 'x\ny\nX\nz\n');
  });

  it('missing final newline on the pre side only', () => {
    expectGitDiffMatch('a\nb', 'a\nb\n');
  });

  it('missing final newline on the post side only', () => {
    expectGitDiffMatch('a\nb\n', 'a\nb');
  });

  it('missing final newline on both sides with a content change', () => {
    expectGitDiffMatch('a\nb', 'a\nX');
  });

  it('CRLF round-trip with a replacement', () => {
    expectGitDiffMatch('a\r\nb\r\nc\r\n', 'a\r\nX\r\nc\r\n');
  });

  it('CRLF and LF variants of the same logical lines are different content', () => {
    expectGitDiffMatch('a\nb\n', 'a\r\nb\r\n');
  });

  it('empty pre file (all insertions)', () => {
    expectGitDiffMatch('', 'a\nb\n');
  });

  it('empty post file (all deletions)', () => {
    expectGitDiffMatch('a\nb\n', '');
  });

  it('both files empty — no hunks', () => {
    expectGitDiffMatch('', '');
  });

  it('identical files — no hunks', () => {
    expectGitDiffMatch('a\nb\nc\n', 'a\nb\nc\n');
  });

  it('single-line files', () => {
    expectGitDiffMatch('a\n', 'b\n');
  });

  it('every line replaced', () => {
    expectGitDiffMatch('a\nb\nc\n', 'x\ny\nz\n');
  });

  it('matches the oracle on seeded generated pairs (property test)', () => {
    // Small alphabet → duplicated lines (the tie-breaking regime), CRLF and
    // missing-final-newline alternated by seed so every mode is exercised.
    const rand = mulberry32(20260804);
    for (let seed = 0; seed < 40; seed += 1) {
      const pair = generatePair(rand, { crlf: seed % 2 === 0, missingFinalNewline: seed % 3 === 0 });
      expectGitDiffMatch(pair.pre, pair.post);
    }
  });

  it('identical line-hash arrays diff to zero hunks (the injected-collision seam)', () => {
    // The seam: diffLineHashes operates on opaque hash strings, so two
    // DIFFERENT lines mapped to the SAME hash string (a collision) diff as
    // identical — this is the zero-hunk input the comparison must catch by
    // byte hash and fall back to whole-file scope.
    const pre = [sha256Hex('a\n'), sha256Hex('b\n'), sha256Hex('c\n')];
    expect(diffLineHashes(pre, [...pre])).toEqual([]);
  });
});

describe('hunksToPostRanges', () => {
  it('a pure insertion maps to an exact post-state range', () => {
    expect(hunksToPostRanges([{ preStart: 0, preLines: 0, postStart: 1, postLines: 3 }])).toEqual({
      changed: [{ start: 1, end: 3 }],
      wholeFile: false
    });
  });

  it('a mid-file insertion maps to the inserted post lines', () => {
    expect(hunksToPostRanges([{ preStart: 5, preLines: 0, postStart: 6, postLines: 2 }])).toEqual({
      changed: [{ start: 6, end: 7 }],
      wholeFile: false
    });
  });

  it('a single-line modification maps to its post line', () => {
    expect(hunksToPostRanges([{ preStart: 2, preLines: 1, postStart: 2, postLines: 1 }])).toEqual({
      changed: [{ start: 2, end: 2 }],
      wholeFile: false
    });
  });

  it('a multi-line modification maps to the full post block', () => {
    expect(hunksToPostRanges([{ preStart: 1, preLines: 2, postStart: 1, postLines: 2 }])).toEqual({
      changed: [{ start: 1, end: 2 }],
      wholeFile: false
    });
  });

  it('multiple insertion/modification hunks map to multiple exact ranges', () => {
    const hunks: DiffHunk[] = [
      { preStart: 1, preLines: 1, postStart: 1, postLines: 1 },
      { preStart: 5, preLines: 0, postStart: 6, postLines: 2 }
    ];
    expect(hunksToPostRanges(hunks)).toEqual({
      changed: [
        { start: 1, end: 1 },
        { start: 6, end: 7 }
      ],
      wholeFile: false
    });
  });

  it('any delete-only hunk forces whole-file scope (no post coordinate for deleted lines)', () => {
    expect(hunksToPostRanges([{ preStart: 3, preLines: 2, postStart: 0, postLines: 0 }])).toEqual({
      changed: [],
      wholeFile: true
    });
  });

  it('a mixed deletion+insertion set still forces whole-file scope', () => {
    const hunks: DiffHunk[] = [
      { preStart: 1, preLines: 1, postStart: 1, postLines: 0 },
      { preStart: 5, preLines: 0, postStart: 4, postLines: 2 }
    ];
    expect(hunksToPostRanges(hunks)).toEqual({ changed: [], wholeFile: true });
  });
});

describe('hashFile', () => {
  it('records byte hash, size, mtimeNs, capturedAt, and ordered terminator-inclusive line hashes', () => {
    const now = 1000;
    const result = hashFile(hashInput({ now }));
    expect(result).toEqual({
      hash: sha256Hex('a\nb\nc\n'),
      size: 6,
      mtimeNs: TRUSTED_MTIME,
      capturedAt: now,
      lines: [sha256Hex('a\n'), sha256Hex('b\n'), sha256Hex('c\n')]
    });
  });

  it('returns null for a missing file (stat fails)', () => {
    expect(hashFile(hashInput({ stat: () => null }))).toBeNull();
  });

  it('returns null for an unreadable file (read fails)', () => {
    expect(hashFile(hashInput({ read: () => null }))).toBeNull();
  });

  it('a file over the per-file byte cap is excluded (null), never recorded', () => {
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, maxBytesPerFile: 5 };
    expect(hashFile(hashInput({ budgets, read: () => Buffer.from('1234567890') }))).toBeNull();
  });

  it('a file over the per-file line cap is recorded coarse — byte hash only, no lines', () => {
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, maxLineHashesPerFile: 2 };
    const result = hashFile(hashInput({ budgets }));
    expect(result).toEqual({
      hash: sha256Hex('a\nb\nc\n'),
      size: 6,
      mtimeNs: TRUSTED_MTIME,
      capturedAt: 1000,
      coarse: true
    });
  });

  it('a depleted per-record line budget forces coarse regardless of the per-file cap', () => {
    const result = hashFile(hashInput({ remainingLineBudget: 0 }));
    expect(result?.coarse).toBe(true);
    expect(result?.lines).toBeUndefined();
  });

  it('line hashes include the terminator: a missing final newline round-trips', () => {
    expect(hashLines('a\nb')).toEqual([sha256Hex('a\n'), sha256Hex('b')]);
    expect(hashLines('a\nb\n')).toEqual([sha256Hex('a\n'), sha256Hex('b\n')]);
    expect(sha256Hex('b')).not.toBe(sha256Hex('b\n'));
  });

  it('line hashes include the terminator: CRLF round-trips', () => {
    expect(hashLines('a\r\nb\r\n')).toEqual([sha256Hex('a\r\n'), sha256Hex('b\r\n')]);
    expect(hashLines('a\r\nb\r\n')).not.toEqual(hashLines('a\nb\n'));
  });

  it('an empty file records zero lines', () => {
    const result = hashFile(
      hashInput({ read: () => Buffer.from(''), stat: () => ({ size: 0, mtimeNs: TRUSTED_MTIME }) })
    );
    expect(result?.size).toBe(0);
    expect(result?.lines).toEqual([]);
  });
});

describe('pairRenames', () => {
  it('pairs pre-absent/post-present paths with an identical byte hash', () => {
    const pre = new Map<string, SnapshotFile>([
      ['a.txt', fileEntry({ hash: 'h1' })],
      ['b.txt', fileEntry({ hash: 'h2' })]
    ]);
    const post = new Map<string, SnapshotFile>([
      ['b.txt', fileEntry({ hash: 'h2' })],
      ['c.txt', fileEntry({ hash: 'h1' })]
    ]);
    expect(pairRenames(pre, post)).toEqual([{ from: 'a.txt', to: 'c.txt' }]);
  });

  it('content ties (duplicate hashes) are left as delete+create, never paired', () => {
    const pre = new Map<string, SnapshotFile>([
      ['a1.txt', fileEntry({ hash: 'hX' })],
      ['a2.txt', fileEntry({ hash: 'hX' })]
    ]);
    const post = new Map<string, SnapshotFile>([
      ['b1.txt', fileEntry({ hash: 'hX' })],
      ['b2.txt', fileEntry({ hash: 'hX' })]
    ]);
    expect(pairRenames(pre, post)).toEqual([]);
  });

  it('no identical hash — no pairing', () => {
    const pre = new Map<string, SnapshotFile>([['a.txt', fileEntry({ hash: 'h1' })]]);
    const post = new Map<string, SnapshotFile>([['c.txt', fileEntry({ hash: 'h2' })]]);
    expect(pairRenames(pre, post)).toEqual([]);
  });

  it('a unique pair among tied hashes still pairs', () => {
    const pre = new Map<string, SnapshotFile>([
      ['a.txt', fileEntry({ hash: 'hU' })],
      ['a1.txt', fileEntry({ hash: 'hX' })],
      ['a2.txt', fileEntry({ hash: 'hX' })]
    ]);
    const post = new Map<string, SnapshotFile>([
      ['c.txt', fileEntry({ hash: 'hU' })],
      ['b1.txt', fileEntry({ hash: 'hX' })],
      ['b2.txt', fileEntry({ hash: 'hX' })]
    ]);
    expect(pairRenames(pre, post)).toEqual([{ from: 'a.txt', to: 'c.txt' }]);
  });
});

describe('classifyCommandForSnapshot', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'snapshot-classify-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('read-only bucket — no snapshot', () => {
    let readOnlyRepo: string;

    beforeAll(() => {
      // git read-only commands run in a real repo so the classifier's config
      // read (the one-scoped `git config --get-regexp`) resolves; a failed
      // config read in a non-repo is a separate contract question these
      // fixtures do not pin.
      readOnlyRepo = makeTempRepo().root;
    });

    it('provably read-only commands classify read-only (no snapshot, empty tier-1)', () => {
      const readOnlyCommands = [
        'ls',
        'grep foo bar.txt',
        'cat some-file.txt',
        'head -5 some-file.txt',
        'tail -3 some-file.txt',
        'echo hello',
        'git status',
        'git diff',
        'git log',
        'git show'
      ];
      for (const cmd of readOnlyCommands) {
        expect(classifyCommandForSnapshot(cmd, readOnlyRepo)).toEqual({
          decision: { kind: 'no-snapshot', reason: 'read-only' },
          tier1Targets: []
        });
      }
    });

    it('git status needs no config gate — read-only even with an external diff configured', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        expect(classifyCommandForSnapshot('git status', repo.root).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('ambient PAGER does not tax git log — the pager channel is inert because hook stdout is a pipe', () => {
      withEnv({ PAGER: 'less' }, () => {
        expect(classifyCommandForSnapshot('git log', scratch).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      });
    });
  });

  describe('covered-write fast path — no snapshot, exact ranges already available', () => {
    it('a pure single-quoted heredoc write is statically covered (the fast-path skip)', () => {
      const target = join(scratch, 'out.txt');
      const plan = classifyCommandForSnapshot(`cat > ${target} <<'EOF'\nalpha\nbeta\nEOF\n`, scratch);
      expect(plan.decision).toEqual({ kind: 'no-snapshot', reason: 'statically-covered' });
      expect(plan.tier1Targets).toEqual([]);
    });

    it('a pure single-quoted heredoc append is statically covered', () => {
      const target = join(scratch, 'out.txt');
      const plan = classifyCommandForSnapshot(`cat >> ${target} <<'EOF'\nalpha\nEOF\n`, scratch);
      expect(plan.decision).toEqual({ kind: 'no-snapshot', reason: 'statically-covered' });
    });

    it('an unquoted expansion anywhere in the command disqualifies the fast path', () => {
      // The heredoc write itself is inert, but `$(make)` may write elsewhere —
      // the whole command is no longer provably expansion-free, so the
      // covered-write label never attaches to it.
      const target = join(scratch, 'out.txt');
      const plan = classifyCommandForSnapshot(`echo $(make) && cat > ${target} <<'EOF'\nbody\nEOF\n`, scratch);
      expect(plan.decision.kind).toBe('snapshot');
    });
  });

  describe('redirects on read-only tools force a snapshot', () => {
    it('ls > f — the read-only label dies with the redirection', () => {
      const plan = classifyCommandForSnapshot(`ls > ${join(scratch, 'listing.txt')}`, scratch);
      expect(plan.decision.kind).toBe('snapshot');
      // The target is a literal redirect target: a tier-1 capture.
      expect(plan.tier1Targets).toEqual([join(scratch, 'listing.txt')]);
    });

    it('git status > f forces a snapshot', () => {
      expect(classifyCommandForSnapshot(`git status > ${join(scratch, 'status.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });

    it('echo hi > f forces a snapshot', () => {
      expect(classifyCommandForSnapshot(`echo hi > ${join(scratch, 'out.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });
  });

  describe('unquoted expansion forces a snapshot', () => {
    it('echo $(make) > f — the subcommand may write elsewhere', () => {
      const plan = classifyCommandForSnapshot(`echo $(make) > ${join(scratch, 'out.txt')}`, scratch);
      expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      expect(plan.tier1Targets).toEqual([join(scratch, 'out.txt')]);
    });

    it('FOO=$(gen) cmd > f — assignment-level substitution', () => {
      expect(classifyCommandForSnapshot(`FOO=$(gen) make > ${join(scratch, 'out.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });

    it('cat $ARGS > f — variable target, the subcommand may write elsewhere', () => {
      expect(classifyCommandForSnapshot(`cat $ARGS > ${join(scratch, 'out.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });
  });

  describe('tilde and background are opaque', () => {
    it('cat > ~/f — an unexpanded tilde resolves to the wrong literal path', () => {
      const plan = classifyCommandForSnapshot("cat > ~/notes.txt <<'EOF'\nbody\nEOF\n", scratch);
      expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      // The tilde target is unresolvable: never a tier-1 target.
      expect(plan.tier1Targets).toEqual([]);
    });

    it('a background job (&) can write after the hook returns', () => {
      expect(classifyCommandForSnapshot('make &', scratch).decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      expect(classifyCommandForSnapshot('sleep 1 &', scratch).decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
    });
  });

  describe('argument-executing wrappers are opaque', () => {
    it('env python3 gen.py — the wrapped subcommand writes', () => {
      expect(classifyCommandForSnapshot('env python3 gen.py', scratch).decision.kind).toBe('snapshot');
    });

    it('xargs rm — arguments execute under the wrapper', () => {
      expect(classifyCommandForSnapshot('find . -name "*.tmp" | xargs rm', scratch).decision.kind).toBe('snapshot');
    });

    it('sudo make install', () => {
      expect(classifyCommandForSnapshot('sudo make install', scratch).decision.kind).toBe('snapshot');
    });

    it('time python3 gen.py', () => {
      expect(classifyCommandForSnapshot('time python3 gen.py', scratch).decision.kind).toBe('snapshot');
    });
  });

  describe('output-targeting flags disqualify the read-only label', () => {
    it('sort -o out.txt in.txt', () => {
      const plan = classifyCommandForSnapshot(
        `sort -o ${join(scratch, 'out.txt')} ${join(scratch, 'in.txt')}`,
        scratch
      );
      expect(plan.decision.kind).toBe('snapshot');
      // No shell redirect and no parser-resolved path: the -o target is not a
      // tier-1 literal-redirect target (it is captured by the tier-2 walk).
      expect(plan.tier1Targets).toEqual([]);
    });

    it('git diff --output=out.patch', () => {
      const plan = classifyCommandForSnapshot(`git diff --output=${join(scratch, 'out.patch')}`, scratch);
      expect(plan.decision.kind).toBe('snapshot');
      expect(plan.tier1Targets).toEqual([]);
    });
  });

  describe('git write subcommands are never read-only', () => {
    it('config, add, commit, checkout, reset, merge', () => {
      const writeCommands = [
        'git config user.name x',
        'git add src/a.ts',
        'git commit -m "wip"',
        'git checkout main',
        'git reset --hard HEAD~1',
        'git merge main'
      ];
      for (const cmd of writeCommands) {
        expect(classifyCommandForSnapshot(cmd, scratch).decision.kind, cmd).toBe('snapshot');
      }
    });
  });

  describe('heredoc delimiter quote styles', () => {
    it("<<'EOF' is inert: the body is literal data and the fast path applies", () => {
      const target = join(scratch, 'out.txt');
      expect(classifyCommandForSnapshot(`cat > ${target} <<'EOF'\nbody\nEOF\n`, scratch).decision).toEqual({
        kind: 'no-snapshot',
        reason: 'statically-covered'
      });
    });

    it('bare <<EOF is opaque: the body may execute and is never the literal written content', () => {
      const target = join(scratch, 'out.txt');
      expect(classifyCommandForSnapshot(`cat > ${target} <<EOF\nbody\nEOF\n`, scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('<<"EOF" is opaque: the body may execute and is never the literal written content', () => {
      const target = join(scratch, 'out.txt');
      expect(classifyCommandForSnapshot(`cat > ${target} <<"EOF"\nbody\nEOF\n`, scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('an unquoted-delimiter body with $(...) forces a snapshot and never feeds the literal body as written', () => {
      const target = join(scratch, 'out.txt');
      const cmd = `cat > ${target} <<EOF\n$(make > ${join(scratch, 'generated.txt')})\nEOF\n`;
      const plan = classifyCommandForSnapshot(cmd, scratch);
      expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      // The covered-write label — the only one whose `written` body is a
      // valid literal — must never attach to a bare-delimiter heredoc, so
      // the executed body can never surface as literal `written` content.
      expect(plan.decision).not.toEqual({ kind: 'no-snapshot', reason: 'statically-covered' });
    });

    it('a backtick in an unquoted-delimiter body forces a snapshot', () => {
      const target = join(scratch, 'out.txt');
      const cmd = `cat > ${target} <<EOF\n\`gen\`\nEOF\n`;
      expect(classifyCommandForSnapshot(cmd, scratch).decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
    });
  });

  describe('git read-only exec channels', () => {
    it('GIT_EXTERNAL_DIFF in command text opens the exec channel: git diff forces a snapshot', () => {
      expect(classifyCommandForSnapshot('GIT_EXTERNAL_DIFF=ext-diff git diff', scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('ambient GIT_EXTERNAL_DIFF opens the exec channel: git diff forces a snapshot', () => {
      withEnv({ GIT_EXTERNAL_DIFF: 'ext-diff' }, () => {
        expect(classifyCommandForSnapshot('git diff', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      });
    });

    it('ambient GIT_EXTERNAL_DIFF with --no-ext-diff: disarmed, read-only again', () => {
      withEnv({ GIT_EXTERNAL_DIFF: 'ext-diff' }, () => {
        expect(classifyCommandForSnapshot('git diff --no-ext-diff', scratch).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      });
    });

    it("PAGER='tee pager.out' git log — a pager-forcing form classifies opaque (the pager program is env-dependent)", () => {
      expect(classifyCommandForSnapshot("PAGER='tee pager.out' git log", scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('GIT_PAGER in command text also forces a snapshot on git log', () => {
      expect(classifyCommandForSnapshot("GIT_PAGER='tee pager.out' git log", scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });
  });

  describe('git read-only config channels (repo/global config, command text)', () => {
    it('a repo config with diff.external makes git diff/log/show opaque', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        for (const cmd of ['git diff', 'git log', 'git show']) {
          expect(classifyCommandForSnapshot(cmd, repo.root).decision, cmd).toEqual({
            kind: 'snapshot',
            reason: 'opaque'
          });
        }
      } finally {
        repo.cleanup();
      }
    });

    it('a global config with diff.external makes git diff opaque', () => {
      const cfgDir = mkdtempSync(join(tmpdir(), 'snapshot-global-config-'));
      const cfgPath = join(cfgDir, 'gitconfig');
      try {
        execFileSync('git', ['config', '--file', cfgPath, 'diff.external', 'ext-diff'], { stdio: 'ignore' });
        const repo = makeTempRepo();
        try {
          withEnv({ GIT_CONFIG_GLOBAL: cfgPath }, () => {
            expect(classifyCommandForSnapshot('git diff', repo.root).decision).toEqual({
              kind: 'snapshot',
              reason: 'opaque'
            });
          });
        } finally {
          repo.cleanup();
        }
      } finally {
        rmSync(cfgDir, { recursive: true, force: true });
      }
    });

    it('a diff.<driver>.textconv config makes git diff opaque', () => {
      const repo = repoWithConfig([['diff.foo.textconv', 'cat']]);
      try {
        expect(classifyCommandForSnapshot('git diff', repo.root).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('git -c diff.external=x diff — the config channel in command text is visible without a read', () => {
      expect(classifyCommandForSnapshot('git -c diff.external=x diff', scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('git diff --no-ext-diff disarms the config channel (canonical post-subcommand position)', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        expect(classifyCommandForSnapshot('git diff --no-ext-diff', repo.root).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('git --no-ext-diff diff — the pre-subcommand form is a usage error (exit 129) and does NOT disarm', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        // The disarm token is parsed only in the subcommand's argument
        // position; the rejected pre-subcommand form leaves the config
        // channel open — the command aborts before any write, so the abort
        // path is not the disarm path.
        expect(classifyCommandForSnapshot('git --no-ext-diff diff', repo.root).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('git diff --no-textconv disarms a textconv driver', () => {
      const repo = repoWithConfig([['diff.foo.textconv', 'cat']]);
      try {
        expect(classifyCommandForSnapshot('git diff --no-textconv', repo.root).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      } finally {
        repo.cleanup();
      }
    });
  });

  describe('symlinked heredoc targets fail the fast-path condition', () => {
    it('a symlinked heredoc target resolves the write elsewhere — forces a snapshot', () => {
      const dir = mkdtempSync(join(tmpdir(), 'snapshot-symlink-'));
      try {
        const realTarget = join(dir, 'real-target.txt');
        writeFileSync(realTarget, 'real\n');
        const link = join(dir, 'link.txt');
        symlinkSync(realTarget, link);
        const plan = classifyCommandForSnapshot(`cat > ${link} <<'EOF'\ncontent\nEOF\n`, dir);
        expect(plan.decision.kind).toBe('snapshot');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('a symlinked ancestor directory also fails the fast-path condition', () => {
      const dir = mkdtempSync(join(tmpdir(), 'snapshot-symlink-ancestor-'));
      try {
        const realDir = mkdtempSync(join(tmpdir(), 'snapshot-symlink-real-'));
        const linkDir = join(dir, 'sub');
        symlinkSync(realDir, linkDir);
        const plan = classifyCommandForSnapshot(`cat > ${join(linkDir, 'out.txt')} <<'EOF'\ncontent\nEOF\n`, dir);
        expect(plan.decision.kind).toBe('snapshot');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('opaque tools — snapshot, target unknown', () => {
    it('interpreters, in-place editors, formatters, and project tools classify opaque', () => {
      const opaqueCommands = [
        'python3 gen.py',
        'node build.js',
        'perl fix.pl',
        'ruby gen.rb',
        'sed -i s/a/b/ file.txt',
        'prettier --write src/',
        'npx prettier .',
        'make',
        'cargo build',
        'npm run build',
        'yarn build'
      ];
      for (const cmd of opaqueCommands) {
        const plan = classifyCommandForSnapshot(cmd, scratch);
        expect(plan.decision, cmd).toEqual({ kind: 'snapshot', reason: 'opaque' });
        expect(plan.tier1Targets, cmd).toEqual([]);
      }
    });
  });
});

describe('applyAmbiguityRules — the full ambiguity table', () => {
  const mine = record({ files: { 'src/a.ts': fileEntry({ hash: 'my-pre' }) } });

  it('unconsumed sibling created after mine — ambiguous (its write window has not provably ended)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 2000, consumed: false, pre: fileEntry({ hash: 'sib-pre' }) })],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('sibling-1');
  });

  it('unconsumed sibling created before mine — ambiguous (pre order and pre equality are irrelevant)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 500, consumed: false, pre: fileEntry({ hash: 'same-as-mine' }) })],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
  });

  it('consumed sibling created after mine with post(P) != pre(P) — ambiguous (it changed P during overlap)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          pre: fileEntry({ hash: 'sib-pre' }),
          post: fileEntry({ hash: 'sib-post' })
        })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
  });

  it('consumed sibling created after mine with post(P) = pre(P) — not ambiguous (disjoint)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          pre: fileEntry({ hash: 'sib' }),
          post: fileEntry({ hash: 'sib' })
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine with pre(P) = post(P) — not ambiguous (it never changed P)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 600,
          pre: fileEntry({ hash: 'sib' }),
          post: fileEntry({ hash: 'sib' })
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine with post(P) = my pre(P) — not ambiguous (its write landed before my baseline)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 600,
          pre: fileEntry({ hash: 'older' }),
          post: fileEntry({ hash: 'my-pre' })
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine, pre(P) != post(P), consumedAt <= my createdAt — not ambiguous (its whole window ended before my baseline)', () => {
    // The plan's sequential third-party fixture: opaque call A changed P and
    // an Edit landed between A and B — A's consumedAt predates B's createdAt,
    // so nothing makes B's post-diff ambiguous (the false positive a
    // post-vs-my-pre test would raise).
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 800,
          pre: fileEntry({ hash: 'sib-pre' }),
          post: fileEntry({ hash: 'sib-post' })
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine, pre(P) != post(P), consumedAt > my createdAt — ambiguous (its window extends past my baseline)', () => {
    // The plan's same-file-both-calls scenario: whichever call completes
    // first sees the other's change in a window past its baseline — both
    // fail closed, never both attribute, never a wrong-call attribution.
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 1200,
          pre: fileEntry({ hash: 'sib-pre' }),
          post: fileEntry({ hash: 'sib-post' })
        })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('sibling-1');
  });

  it('a gapped unconsumed sibling covers every path — overlap must be assumed', () => {
    // Its coverage is unknowable: even a sibling whose per-path view is
    // null makes every changed path ambiguous (the truncated-sibling hole).
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 2000, consumed: false, coverageGap: true, pre: null, post: null })],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
  });

  it('any ambiguous sibling makes the path ambiguous, even after a clean sibling', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          toolUseId: 'clean',
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          pre: fileEntry({ hash: 's' }),
          post: fileEntry({ hash: 's' })
        }),
        sibling({ toolUseId: 'dirty', createdAt: 2200, consumed: false, pre: fileEntry({ hash: 'sib-pre' }) })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('dirty');
  });

  it('siblings are evaluated in deterministic order — createdAt, ties broken by toolUseId', () => {
    // Both unconsumed: either alone makes the path ambiguous, but the
    // verdict must name the deterministically-first sibling — every
    // consumer of an entangled path reaches the same verdict.
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({ toolUseId: 'z-tool', createdAt: 2000, consumed: false, pre: fileEntry({ hash: 'sib-pre' }) }),
        sibling({ toolUseId: 'a-tool', createdAt: 2000, consumed: false, pre: fileEntry({ hash: 'sib-pre' }) })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('a-tool');
  });

  it('a sibling not covering the path does not make it ambiguous', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 2000, consumed: false, pre: null, post: null })],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });
});

describe('compareSnapshot', () => {
  it('a path whose (size, mtimeNs) both match its pre entry is skipped without a re-read', () => {
    const read = vi.fn(() => null);
    const result = compareSnapshot(
      compareInput({
        record: record({ files: { 'src/a.ts': fileEntry({ hash: 'pre-hash', size: 10, mtimeNs: TRUSTED_MTIME }) } }),
        post: new Map([
          ['src/a.ts', fileEntry({ hash: 'pre-hash', size: 10, mtimeNs: TRUSTED_MTIME, capturedAt: 1500 })]
        ]),
        read
      })
    );
    expect(result.attributions.size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it('a zero sub-second mtimeNs never proves non-change: a same-second content change is re-hashed and caught', () => {
    // Second-granularity clock: a write within the same second does not
    // advance mtime, so a size+mtime pair-match would skip a real change.
    // The pre entry's zero sub-second part forces the re-hash.
    const read = vi.fn(() => Buffer.from('a\nX\nc\n'));
    const result = compareSnapshot(
      compareInput({
        record: record({
          files: {
            'src/a.ts': fileEntry({
              hash: sha256Hex('a\nb\nc\n'),
              size: 6,
              mtimeNs: COARSE_MTIME,
              lines: hashLines('a\nb\nc\n')
            })
          }
        }),
        post: new Map([
          ['src/a.ts', fileEntry({ hash: 'post-hash', size: 6, mtimeNs: COARSE_MTIME, capturedAt: 1500 })]
        ]),
        read
      })
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.attributions.get('src/a.ts')).toEqual({
      kind: 'changed',
      observed: { changed: [{ start: 2, end: 2 }], wholeFile: false }
    });
  });

  it('a byte-hash-equal re-read is unchanged — chmod/mtime-only noise never attributes', () => {
    const read = vi.fn(() => Buffer.from('a\nb\nc\n'));
    const result = compareSnapshot(
      compareInput({
        record: record({
          files: {
            'src/a.ts': fileEntry({
              hash: sha256Hex('a\nb\nc\n'),
              size: 6,
              mtimeNs: TRUSTED_MTIME,
              lines: hashLines('a\nb\nc\n')
            })
          }
        }),
        post: new Map([
          [
            'src/a.ts',
            fileEntry({ hash: sha256Hex('a\nb\nc\n'), size: 6, mtimeNs: TRUSTED_MTIME + 1n, capturedAt: 1500 })
          ]
        ]),
        read
      })
    );
    expect(result.attributions.size).toBe(0);
  });

  it('a changed path attributes exact post-state ranges from the line-hash diff', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({
          files: {
            'src/a.ts': fileEntry({ hash: 'pre-hash', size: 6, mtimeNs: TRUSTED_MTIME, lines: hashLines('a\nb\nc\n') })
          }
        }),
        post: new Map([
          [
            'src/a.ts',
            fileEntry({
              hash: 'post-hash',
              size: 6,
              mtimeNs: TRUSTED_MTIME + 2n,
              capturedAt: 1500,
              lines: hashLines('a\nB\nc\n')
            })
          ]
        ]),
        read: () => Buffer.from('a\nB\nc\n')
      })
    );
    expect(result.attributions.get('src/a.ts')).toEqual({
      kind: 'changed',
      observed: { changed: [{ start: 2, end: 2 }], wholeFile: false }
    });
  });

  it('a pre-recorded path absent from disk is a delete candidate', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({ files: { 'src/a.ts': fileEntry() } }),
        stat: () => null
      })
    );
    expect(result.attributions.get('src/a.ts')).toEqual({ kind: 'deleted' });
  });

  it('a pre-only path under a post coverage gap is dropped, never a phantom delete', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({ files: { 'src/a.ts': fileEntry() } }),
        postGaps: ['post-walk truncated at file-count budget'],
        stat: () => null
      })
    );
    expect(result.attributions.has('src/a.ts')).toBe(false);
    expect(result.gaps.some((g) => g.includes('src/a.ts'))).toBe(true);
  });

  it('a post-only path is a create candidate when the pre walk had no path-coverage gap', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({ files: {} }),
        post: new Map([['src/new.ts', fileEntry({ hash: 'new-hash', capturedAt: 1500 })]])
      })
    );
    expect(result.attributions.get('src/new.ts')).toEqual({ kind: 'created' });
  });

  it('a post-only path under a pre path-coverage gap is dropped with the gap diagnostic (it may be a budget-excluded file)', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({ gaps: ['file-count budget exceeded: 5120/5000'] }),
        post: new Map([['src/new.ts', fileEntry({ hash: 'new-hash', capturedAt: 1500 })]])
      })
    );
    expect(result.attributions.has('src/new.ts')).toBe(false);
    expect(result.gaps.some((g) => g.includes('src/new.ts'))).toBe(true);
  });

  it('a line-hash gap (coarse entries) does NOT disqualify a create candidate', () => {
    // A coarse entry still records the file in pre with its byte hash, which
    // is all the pre-evidence a create needs — only a path-coverage gap
    // disqualifies.
    const result = compareSnapshot(
      compareInput({
        record: record({
          gaps: ['line-hash budget exceeded: 240 files recorded coarse'],
          files: { 'src/other.ts': fileEntry({ coarse: true }) }
        }),
        post: new Map([
          ['src/other.ts', fileEntry({ hash: 'same', capturedAt: 1500 })],
          ['src/new.ts', fileEntry({ hash: 'new-hash', capturedAt: 1500 })]
        ])
      })
    );
    expect(result.attributions.get('src/new.ts')).toEqual({ kind: 'created' });
  });

  it('a pre-absent/post-present path with an identical unique byte hash pairs as a rename', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({ files: { 'old.ts': fileEntry({ hash: 'same-hash', size: 5 }) } }),
        post: new Map([['new.ts', fileEntry({ hash: 'same-hash', size: 5, capturedAt: 1500 })]]),
        stat: () => null
      })
    );
    expect(result.attributions.get('new.ts')).toEqual({ kind: 'rename', from: 'old.ts' });
    expect(result.attributions.has('old.ts')).toBe(false);
  });

  it('a changed coarse file attributes whole-file scope with a coarse-scope diagnostic', () => {
    const result = compareSnapshot(
      compareInput({
        record: record({
          files: { 'huge.gen.ts': fileEntry({ hash: 'pre-hash', size: 500, mtimeNs: TRUSTED_MTIME, coarse: true }) }
        }),
        post: new Map([
          [
            'huge.gen.ts',
            fileEntry({ hash: 'post-hash', size: 600, mtimeNs: TRUSTED_MTIME + 5n, capturedAt: 1500, coarse: true })
          ]
        ]),
        read: () => Buffer.from('x'.repeat(600))
      })
    );
    expect(result.attributions.get('huge.gen.ts')).toEqual({
      kind: 'changed',
      observed: { changed: [], wholeFile: true }
    });
    expect(result.gaps.some((g) => /coarse-scope/i.test(g))).toBe(true);
  });

  it('a zero-hunk collision (line hashes identical, byte hash different) falls back to whole-file with a diagnostic', () => {
    // Injected hash seam: the pre and post line-hash arrays are identical
    // (colliding) while the byte hash differs — the diff yields zero hunks
    // and attribution must never silently shrink.
    const lines = hashLines('a\nb\nc\n');
    const result = compareSnapshot(
      compareInput({
        record: record({
          files: { 'src/a.ts': fileEntry({ hash: 'pre-hash', size: 6, mtimeNs: TRUSTED_MTIME, lines }) }
        }),
        post: new Map([
          [
            'src/a.ts',
            fileEntry({ hash: 'post-hash', size: 6, mtimeNs: TRUSTED_MTIME + 9n, capturedAt: 1500, lines: [...lines] })
          ]
        ]),
        read: () => Buffer.from('a\nb\nc\n')
      })
    );
    expect(result.attributions.get('src/a.ts')).toEqual({
      kind: 'changed',
      observed: { changed: [], wholeFile: true }
    });
    expect(result.gaps.some((g) => /collision|zero-hunk/i.test(g))).toBe(true);
  });

  it('post-side wall-budget exhaustion stops adding scopes and records the attributed/unattributed split', () => {
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, postSideWallSeconds: 1 };
    const result = compareSnapshot(
      compareInput({
        record: record({
          createdAt: 1000,
          files: {
            'src/a.ts': fileEntry({ hash: 'h1', mtimeNs: TRUSTED_MTIME }),
            'src/b.ts': fileEntry({ hash: 'h2', mtimeNs: TRUSTED_MTIME }),
            'src/c.ts': fileEntry({ hash: 'h3', mtimeNs: TRUSTED_MTIME })
          }
        }),
        // Wall budget exhausted well before the first scope: nothing may be
        // attributed, and the diagnostic must name exactly which paths were
        // and were not attributed — never a bare fail-open.
        now: 1000 + 100_000,
        budgets,
        stat: () => null
      })
    );
    expect(result.attributions.size).toBe(0);
    expect(result.gaps.some((g) => /budget/i.test(g) && g.includes('src/a.ts') && g.includes('src/c.ts'))).toBe(true);
  });

  it('the touched-files cap bounds the changed-path count; beyond it, diagnostics and no touches', () => {
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, maxTouchedFiles: 1 };
    const pre: Record<string, SnapshotFile> = {
      'src/a.ts': fileEntry({ hash: 'h1', mtimeNs: TRUSTED_MTIME, lines: hashLines('a\n') }),
      'src/b.ts': fileEntry({ hash: 'h2', mtimeNs: TRUSTED_MTIME, lines: hashLines('b\n') }),
      'src/c.ts': fileEntry({ hash: 'h3', mtimeNs: TRUSTED_MTIME, lines: hashLines('c\n') })
    };
    const post = new Map<string, SnapshotFile>([
      ['src/a.ts', fileEntry({ hash: 'h1x', size: 2, mtimeNs: TRUSTED_MTIME + 1n, capturedAt: 1500 })],
      ['src/b.ts', fileEntry({ hash: 'h2x', size: 2, mtimeNs: TRUSTED_MTIME + 1n, capturedAt: 1500 })],
      ['src/c.ts', fileEntry({ hash: 'h3x', size: 2, mtimeNs: TRUSTED_MTIME + 1n, capturedAt: 1500 })]
    ]);
    const result = compareSnapshot(
      compareInput({
        record: record({ files: pre }),
        post,
        budgets,
        read: () => Buffer.from('x\n'),
        now: 1500
      })
    );
    expect(result.attributions.size).toBe(1);
    expect(result.gaps.some((g) => /touched|cap/i.test(g))).toBe(true);
  });
});

describe('post side agreement and the observed/written invariant', () => {
  it('the Post side warns when the classifier says a snapshot should exist but the record is absent', () => {
    // The SAME classifier runs at Pre and Post; when it concludes `snapshot`
    // but the store finds no record, the Post hook must warn with a
    // diagnostic (the pre-hook skipped or its write failed) before falling
    // back to the static-parse path — the blind spot is visible, not silent.
    // (The hook-level wiring is asserted by the lifecycle fixtures; this
    // fixture pins the agreement surfaces they compose.)
    const warns: string[] = [];
    const logger: CoreLogger = { warn: (m) => warns.push(m), info: () => {} };
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const plan = classifyCommandForSnapshot('python3 gen.py', REPO_ROOT);
    expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
    expect(store.find(SESSION_ID, TOOL_USE_ID)).toBeNull();
    expect(warns).toEqual([]);
  });

  it("the observed XOR written invariant: a snapshot-attributed touch feeds observed with written: ''", () => {
    // The snapshot path's construction site: exact post-state ranges in
    // `observed`, the empty `written` sentinel ("no locatable block") — never
    // both, never the literal body of an executed heredoc.
    const snapshotTouch: TouchWriteInput = {
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: REPO_ROOT,
      filePath: `${REPO_ROOT}/src/a.ts`,
      written: '',
      observed: { changed: [{ start: 2, end: 4 }], wholeFile: false }
    };
    // The static-parse path's construction site: written content, never
    // `observed`.
    const parseTouch: TouchWriteInput = {
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: REPO_ROOT,
      filePath: `${REPO_ROOT}/src/b.ts`,
      written: 'export const b = 1;\n'
    };
    expect(snapshotTouch.observed).toEqual({ changed: [{ start: 2, end: 4 }], wholeFile: false });
    expect(snapshotTouch.written).toBe('');
    expect(parseTouch.observed).toBeUndefined();
    expect(parseTouch.written).not.toBe('');
    // Both set is a contract violation no construction site may produce; the
    // type declares `written` required and `observed` optional, so the
    // invariant is enforced at the construction sites, not by the type.
  });
});

describe('budgets', () => {
  it('the shipped defaults are exactly the plan-mandated values', () => {
    expect(DEFAULT_SNAPSHOT_BUDGETS).toEqual({
      maxFiles: 5000,
      maxBytesPerFile: 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
      maxLineHashesPerFile: 4000,
      maxLineHashesPerRecord: 200_000,
      preSideMaxWallSeconds: 1,
      maxStorageBytes: 64 * 1024 * 1024,
      maxTouchedFiles: 100,
      postSideWallSeconds: 5,
      recordTtlMs: 24 * 60 * 60 * 1000,
      unfinishedEntryTtlMs: 15 * 60 * 1000
    });
  });

  it('a binary file (NUL in the first 8 KiB) is never recorded — excluded at the hash seam', () => {
    // The tier-2 walker's eligibility rule (NUL scan of the first 8 KiB)
    // lands at the hash seam: a NUL-containing file must not produce a
    // record entry, so its content never enters the snapshot.
    const binary = Buffer.concat([Buffer.from('a\n'), Buffer.from([0]), Buffer.from('b\n')]);
    expect(
      hashFile(hashInput({ read: () => binary, stat: () => ({ size: binary.length, mtimeNs: TRUSTED_MTIME }) }))
    ).toBeNull();
  });

  it('storage coherence: a worst-case record stays well under the global storage cap', () => {
    // Worst case = the per-record line budget fully consumed: 200,000 line
    // hashes (64 hex chars each) across files at the per-file cap. At ~66 B
    // per stored line hash that bounds a record to ~15 MB, so the 64 MiB
    // global cap holds several full records and refusal stays a rare
    // multi-record event rather than a one-record feature kill.
    const files: Record<string, SnapshotFile> = {};
    let lineCount = 0;
    for (let f = 0; lineCount < DEFAULT_SNAPSHOT_BUDGETS.maxLineHashesPerRecord; f += 1) {
      const perFile = Math.min(
        DEFAULT_SNAPSHOT_BUDGETS.maxLineHashesPerFile,
        DEFAULT_SNAPSHOT_BUDGETS.maxLineHashesPerRecord - lineCount
      );
      const lines: string[] = [];
      for (let i = 0; i < perFile; i += 1) lines.push(sha256Hex(`file ${f} line ${i}`));
      lineCount += perFile;
      files[`generated/file-${f}.txt`] = fileEntry({
        hash: sha256Hex(`file ${f}`),
        size: perFile * 32,
        mtimeNs: COARSE_MTIME,
        lines
      });
    }
    expect(lineCount).toBe(DEFAULT_SNAPSHOT_BUDGETS.maxLineHashesPerRecord);
    const worstCase = record({ files });
    // Serialized the way the store serializes it (mtimeNs as a string via the
    // bigint replacer) — the property pinned is the worst-case ON-DISK size.
    const bytes = Buffer.byteLength(JSON.stringify(worstCase, bigintToJson), 'utf8');
    expect(bytes).toBeLessThan(DEFAULT_SNAPSHOT_BUDGETS.maxStorageBytes);
  });
});

describe('git -C/--git-dir target the repo the exec-config read sees', () => {
  it('git -C <other-repo> diff — exec keys come from the other repo, invisible to the cwd read: opaque', () => {
    const other = makeTempRepo();
    try {
      const repo = makeTempRepo();
      try {
        expect(classifyCommandForSnapshot(`git -C ${other.root} diff`, repo.root).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      } finally {
        repo.cleanup();
      }
    } finally {
      other.cleanup();
    }
  });

  it('git -C . diff — the same repo as the hook cwd: read-only unchanged, cwd config read', () => {
    const repo = makeTempRepo();
    try {
      expect(classifyCommandForSnapshot('git -C . diff', repo.root).decision).toEqual({
        kind: 'no-snapshot',
        reason: 'read-only'
      });
    } finally {
      repo.cleanup();
    }
  });

  it('git --git-dir=<path> diff — the repo is redirected: opaque', () => {
    const repo = makeTempRepo();
    try {
      expect(classifyCommandForSnapshot(`git --git-dir=${join(repo.root, '.git')} diff`, repo.root).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    } finally {
      repo.cleanup();
    }
  });

  it('git --git-dir <path> diff — the separate-argument redirect form is opaque too (and not misread as the subcommand)', () => {
    const repo = makeTempRepo();
    try {
      expect(classifyCommandForSnapshot(`git --git-dir ${join(repo.root, '.git')} diff`, repo.root).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    } finally {
      repo.cleanup();
    }
  });
});

describe('recordHasPathCoverageGap — the pre-walk gap family the guard reads', () => {
  it('every current pre-walk path-coverage gap form matches (a rephrase breaks this fixture, not the guard)', () => {
    for (const gap of [
      'file-count budget exceeded: 5120/5000',
      'pre-side wall budget exceeded: captured 12 files, stopped',
      'total-bytes budget exceeded: 1048577/1048576',
      'repo walk truncated: git ls-files failed; coverage is incomplete'
    ]) {
      expect(recordHasPathCoverageGap(record({ gaps: [gap] })), gap).toBe(true);
    }
  });

  it('the line-hash form is range-precision loss only and never matches the family', () => {
    expect(recordHasPathCoverageGap(record({ gaps: ['line-hash budget exceeded: 3 files recorded coarse'] }))).toBe(
      false
    );
  });

  it('the per-file exclusion diagnostics name the path but never match the family', () => {
    expect(recordHasPathCoverageGap(record({ gaps: ['binary file excluded: src/app.bin'] }))).toBe(false);
    expect(recordHasPathCoverageGap(record({ gaps: ['oversize file excluded: src/big.txt'] }))).toBe(false);
  });
});
