/**
 * Integration tests for the dispatcher pipeline
 * (packages/agent-hooks/src/dispatcher.ts).
 *
 * Tests exported functions against real git repos in temp directories.
 * Uses node:fs and node:child_process -- no vi.mock.
 *
 * Every repo-based test uses try/finally with makeTempRepo() directly
 * to avoid cross-test state leakage. No shared beforeEach/afterEach.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AnchorSpec,
  claimDirFor,
  claimedDir,
  type PostCommitRecord,
  type PreCommitRecord,
  parsePorcelain,
  postCommitDir,
  preCommitDir,
  readJsonFile
} from '../src/agent-hooks-common.js';
import {
  anchorsIntersectChangedPaths,
  areAnchorsClean,
  buildAgentPrompt,
  buildClaudeArgs,
  getChangedPaths,
  getCurrentBranch,
  getHeadSha,
  type Logger,
  manualRunMarkerPath,
  parseArgs,
  parsePostRewriteInput,
  postRewriteDemote,
  promote,
  reclaim,
  sweepClaimDir,
  writeManualDispatchScript
} from '../src/dispatcher.js';
import { makeTempRepo } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A claim directory older than this is reclaimed by dispatcher.ts's reclaim().
// Kept in sync with dispatcher.ts's private CLAIM_STALE_MS (20 minutes) --
// not exported, so tests re-derive it here with a margin for backdating.
const CLAIM_STALE_MS = 20 * 60 * 1000;

function configureGit(dir: string): void {
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

function writeFileAndCommit(dir: string, filePath: string, content: string, msg: string): void {
  const absPath = nodePath.join(dir, filePath);
  fs.mkdirSync(nodePath.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
  execFileSync('git', ['add', '--', filePath], { cwd: dir });
  execFileSync('git', ['commit', '-m', msg], { cwd: dir });
}

function writeFileOnly(dir: string, filePath: string, content: string): void {
  const absPath = nodePath.join(dir, filePath);
  fs.mkdirSync(nodePath.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

function writePreCommitFile(repoRoot: string, filename: string, record: PreCommitRecord): string {
  const dir = preCommitDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = nodePath.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
  return filePath;
}

function writePostCommitFile(repoRoot: string, filename: string, record: PostCommitRecord): string {
  const dir = postCommitDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = nodePath.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
  return filePath;
}

/** Write a record into a claim directory, backdating the directory's mtime by `ageMs`. */
function writeClaimDirFile(
  repoRoot: string,
  claimId: string,
  filename: string,
  record: PostCommitRecord,
  ageMs = 0
): string {
  const dir = claimDirFor(repoRoot, claimId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = nodePath.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, past, past);
  }
  return filePath;
}

function makeTestLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    info: (m: string) => lines.push(`INFO: ${m}`),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => lines.push(`ERROR: ${m}`)
  };
  return { logger, lines };
}

function anchor(path: string, kind: AnchorSpec['kind'] = 'write', start?: number, end?: number): AnchorSpec {
  if (start !== undefined && end !== undefined) {
    return { path, kind, range: { start, end } };
  }
  return { path, kind };
}

function initRepo(
  initialFile = 'readme.md',
  initialContent = 'init',
  commitMsg = 'init'
): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  configureGit(repo.root);
  writeFileAndCommit(repo.root, initialFile, initialContent, commitMsg);
  return repo;
}

function initRepoWithPrev(file1 = 'init.md', content1 = 'init'): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  configureGit(repo.root);
  writeFileAndCommit(repo.root, file1, content1, 'init');
  writeFileAndCommit(repo.root, '.gitkeep', '', 'keep');
  return repo;
}

function branchName(repoRoot: string): string {
  return getCurrentBranch(repoRoot) ?? 'master';
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Porcelain format contract', () => {
  describe('parsePorcelain', () => {
    it('parses well-formed stale rows', () => {
      const input = ['my-mesh\tsrc/foo.ts\t10-20', 'other-mesh\tsrc/bar.ts\t5-15'].join('\n');
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ name: 'my-mesh', path: 'src/foo.ts', start: 10, end: 20 });
      expect(rows[1]).toEqual({ name: 'other-mesh', path: 'src/bar.ts', start: 5, end: 15 });
    });
    it('parses whole-file anchors', () => {
      const input = 'my-mesh\tsrc/app.ts\t1-100\n';
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ name: 'my-mesh', path: 'src/app.ts', start: 1, end: 100 });
    });
    it('returns empty array for empty input', () => {
      expect(parsePorcelain('')).toEqual([]);
    });
    it('skips blank lines', () => {
      const input = '\n\nmy-mesh\tsrc/foo.ts\t10-20\n\n';
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(1);
    });
    it('skips malformed lines (missing tab)', () => {
      const input = 'no-tabs-here\nmy-mesh\tsrc/foo.ts\t10-20';
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(1);
    });
    it('skips lines with missing range dash', () => {
      const input = 'my-mesh\tsrc/foo.ts\t10\nvalid\tsrc/bar.ts\t1-5';
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('valid');
    });
    it('skips lines with non-numeric range parts', () => {
      const input = 'bad\tsrc/foo.ts\ta-b\nvalid\tsrc/bar.ts\t1-5';
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('valid');
    });
    it('handles trailing newline', () => {
      const input = 'my-mesh\tsrc/foo.ts\t10-20\n';
      const rows = parsePorcelain(input);
      expect(rows).toHaveLength(1);
    });
  });
});

describe('Anchor utilities', () => {
  describe('anchorsIntersectChangedPaths', () => {
    it('returns true when anchor path is in changed paths', () => {
      const changed = new Set(['src/foo.ts', 'src/bar.ts']);
      expect(anchorsIntersectChangedPaths([anchor('src/foo.ts')], changed)).toBe(true);
    });
    it('returns false when no anchor path matches', () => {
      const changed = new Set(['src/other.ts']);
      expect(anchorsIntersectChangedPaths([anchor('src/foo.ts')], changed)).toBe(false);
    });
    it('returns true when at least one anchor matches', () => {
      const changed = new Set(['src/target.ts']);
      expect(
        anchorsIntersectChangedPaths([anchor('src/a.ts'), anchor('src/target.ts'), anchor('src/b.ts')], changed)
      ).toBe(true);
    });
    it('returns false for empty anchors', () => {
      const changed = new Set(['src/foo.ts']);
      expect(anchorsIntersectChangedPaths([], changed)).toBe(false);
    });
  });
});

describe('Branch and change-set helpers', () => {
  describe('getCurrentBranch', () => {
    it('returns a branch name when on a branch', () => {
      const { root, cleanup } = makeTempRepo();
      try {
        configureGit(root);
        writeFileAndCommit(root, 'readme.md', 'initial', 'init');
        expect(getCurrentBranch(root)).toBeTruthy();
      } finally {
        cleanup();
      }
    });
    it('returns null when HEAD is detached', () => {
      const { root, cleanup } = makeTempRepo();
      try {
        configureGit(root);
        writeFileAndCommit(root, 'readme.md', 'initial', 'init');
        const sha = getHeadSha(root);
        execFileSync('git', ['checkout', '--detach', sha], { cwd: root });
        expect(getCurrentBranch(root)).toBeNull();
      } finally {
        cleanup();
      }
    });
  });
  describe('getChangedPaths', () => {
    it('returns changed paths from a non-root HEAD commit', () => {
      const repo = initRepoWithPrev();
      const { root, cleanup } = repo;
      try {
        writeFileAndCommit(root, 'src/foo.ts', 'content', 'add foo');
        const paths = getChangedPaths(root);
        expect(paths.has('src/foo.ts')).toBe(true);
      } finally {
        cleanup();
      }
    });
    it('returns multiple changed paths from a single commit', () => {
      const repo = initRepoWithPrev();
      const { root, cleanup } = repo;
      try {
        const absA = nodePath.join(root, 'a.ts');
        const absB = nodePath.join(root, 'b.ts');
        fs.writeFileSync(absA, 'a', 'utf8');
        fs.writeFileSync(absB, 'b', 'utf8');
        execFileSync('git', ['add', 'a.ts', 'b.ts'], { cwd: root });
        execFileSync('git', ['commit', '-m', 'add a and b'], { cwd: root });
        const paths = getChangedPaths(root);
        expect(paths.has('a.ts')).toBe(true);
        expect(paths.has('b.ts')).toBe(true);
      } finally {
        cleanup();
      }
    });
  });
});

// ===========================================================================
// Post-rewrite demotion tests
// ===========================================================================

describe('Post-rewrite demotion', () => {
  describe('parsePostRewriteInput', () => {
    it('parses well-formed stdin lines', () => {
      const input = 'abc123def456 def456abc789 refs/heads/main\n111222333444 555666777888\n';
      const map = parsePostRewriteInput(input);
      expect(map.size).toBe(2);
      expect(map.get('abc123def456')).toBe('def456abc789');
      expect(map.get('111222333444')).toBe('555666777888');
    });
    it('skips lines with fewer than 2 parts', () => {
      const input = 'only-one\nabcdefgh ijklmnop\n';
      const map = parsePostRewriteInput(input);
      expect(map.size).toBe(1);
      expect(map.get('abcdefgh')).toBe('ijklmnop');
    });
    it('skips lines with short SHA parts', () => {
      const input = 'short def456abc789\nabcdef123456 def456abc789\n';
      const map = parsePostRewriteInput(input);
      expect(map.size).toBe(1);
      expect(map.get('abcdef123456')).toBe('def456abc789');
    });
    it('returns empty map for empty input', () => {
      expect(parsePostRewriteInput('').size).toBe(0);
    });
    it('returns empty map for whitespace-only input', () => {
      expect(parsePostRewriteInput('  \n  \n').size).toBe(0);
    });
  });
  describe('postRewriteDemote', () => {
    it('demotes a matching post-commit record back to pre-commit', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const sha = getHeadSha(root);
        const branch = branchName(root);
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha,
          branch
        };
        writePostCommitFile(root, 'demote-me.json', record);

        const shaMap = new Map<string, string>([[sha, '0000000000000000000000000000000000000000']]);
        const { logger } = makeTestLogger();
        postRewriteDemote(logger, root, shaMap);

        // Record should have been removed from post-commit
        const postDir = postCommitDir(root);
        expect(fs.readdirSync(postDir).filter((f) => f.endsWith('.json'))).toHaveLength(0);

        // Record should appear in pre-commit (with sha/branch stripped)
        const preDir = preCommitDir(root);
        expect(fs.existsSync(preDir)).toBe(true);
        const preFiles = fs.readdirSync(preDir).filter((f) => f.endsWith('.json'));
        expect(preFiles).toHaveLength(1);
        expect(preFiles[0]).toBe('demote-me.json');

        const demoted = readJsonFile<PreCommitRecord>(nodePath.join(preDir, 'demote-me.json'));
        expect(demoted.anchors).toHaveLength(1);
        expect((demoted as unknown as Record<string, unknown>).sha).toBeUndefined();
        expect((demoted as unknown as Record<string, unknown>).branch).toBeUndefined();
      } finally {
        cleanup();
      }
    });
    it('does not demote a record whose SHA is not in the map', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: '1111111111111111111111111111111111111111',
          branch
        };
        writePostCommitFile(root, 'stay-put.json', record);
        const shaMap = new Map<string, string>([['aaaaaaaa', 'bbbbbbbb']]);
        const { logger } = makeTestLogger();
        postRewriteDemote(logger, root, shaMap);
        expect(fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
    it('does nothing when shaMap is empty', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: '1111111111111111111111111111111111111111',
          branch
        };
        writePostCommitFile(root, 'stay-put.json', record);
        const { logger } = makeTestLogger();
        postRewriteDemote(logger, root, new Map());
        expect(fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
    it('does nothing when there are no post-commit records', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const { logger } = makeTestLogger();
        expect(() => postRewriteDemote(logger, root, new Map([['aaaaaa', 'bbbbbb']]))).not.toThrow();
      } finally {
        cleanup();
      }
    });
  });
});

// ===========================================================================
// Queue lifecycle tests
// ===========================================================================

describe('Queue lifecycle', () => {
  describe('promote', () => {
    it('promotes a pre-commit record to post-commit with SHA and branch stamped', () => {
      const repo = initRepoWithPrev('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writePreCommitFile(root, 'rec-1.json', {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString()
        });

        writeFileAndCommit(root, 'src/foo.ts', 'v2', 'modify foo');

        const changedPaths = getChangedPaths(root);
        const { logger } = makeTestLogger();
        promote(logger, root, changedPaths, false);

        expect(fs.readdirSync(preCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(0);

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles).toHaveLength(1);

        const promoted = readJsonFile<PostCommitRecord>(nodePath.join(postCommitDir(root), postFiles[0]));
        expect(promoted.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(promoted.branch).toBe(branchName(root));
        expect(promoted.anchors).toHaveLength(1);
        expect(promoted.anchors[0].path).toBe('src/foo.ts');
      } finally {
        cleanup();
      }
    });
    it('does NOT promote a record whose anchors do not intersect changed paths', () => {
      const repo = initRepoWithPrev('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writePreCommitFile(root, 'rec-1.json', {
          anchors: [anchor('src/bar.ts')],
          created_at: new Date().toISOString()
        });
        writeFileAndCommit(root, 'src/foo.ts', 'v2', 'modify foo');
        const changedPaths = getChangedPaths(root);
        const { logger } = makeTestLogger();
        promote(logger, root, changedPaths, false);

        expect(fs.readdirSync(preCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(1);
        const postDirPath = postCommitDir(root);
        expect(
          fs.existsSync(postDirPath) ? fs.readdirSync(postDirPath).filter((f) => f.endsWith('.json')).length : 0
        ).toBe(0);
      } finally {
        cleanup();
      }
    });
    it('does NOT promote a record with dirty anchor paths', () => {
      const repo = initRepoWithPrev('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writePreCommitFile(root, 'rec-1.json', {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString()
        });

        writeFileOnly(root, 'src/foo.ts', 'dirty content');
        writeFileAndCommit(root, 'other.ts', 'other', 'other commit');

        const changedPaths = getChangedPaths(root);
        const { logger } = makeTestLogger();
        promote(logger, root, changedPaths, true);

        expect(fs.readdirSync(preCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(1);
        const postDirPath = postCommitDir(root);
        expect(
          fs.existsSync(postDirPath) ? fs.readdirSync(postDirPath).filter((f) => f.endsWith('.json')).length : 0
        ).toBe(0);
      } finally {
        cleanup();
      }
    });
    it('promotes with sweepAll: true, ignoring intersection check', () => {
      const repo = initRepoWithPrev('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writePreCommitFile(root, 'rec-1.json', {
          anchors: [anchor('src/unchanged.ts')],
          created_at: new Date().toISOString()
        });
        writeFileAndCommit(root, 'src/foo.ts', 'v2', 'modify foo');

        const changedPaths = getChangedPaths(root);
        const { logger } = makeTestLogger();
        promote(logger, root, changedPaths, true);

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
    it('promotes with detached HEAD', () => {
      const repo = initRepoWithPrev('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writePreCommitFile(root, 'rec-1.json', {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString()
        });

        const sha = getHeadSha(root);
        execFileSync('git', ['checkout', '--detach', sha], { cwd: root });

        writeFileOnly(root, 'src/foo.ts', 'v2');
        execFileSync('git', ['add', '--', 'src/foo.ts'], { cwd: root });
        execFileSync('git', ['commit', '-m', 'modify foo detached'], { cwd: root });

        const changedPaths = getChangedPaths(root);
        const { logger } = makeTestLogger();
        promote(logger, root, changedPaths, false);

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles).toHaveLength(1);

        const promoted = readJsonFile<PostCommitRecord>(nodePath.join(postCommitDir(root), postFiles[0]));
        expect(promoted.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(promoted.branch).toBeNull();
      } finally {
        cleanup();
      }
    });
    it('handles empty pre-commit directory gracefully', () => {
      const repo = initRepoWithPrev();
      const { root, cleanup } = repo;
      try {
        const changedPaths = new Set(['src/foo.ts']);
        const { logger } = makeTestLogger();
        expect(() => promote(logger, root, changedPaths, false)).not.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  describe('reclaim', () => {
    it('reclaims records from a stale claim directory back to post-commit', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: 'a'.repeat(40),
          branch
        };
        writeClaimDirFile(root, 'stale-claim', 'rec-1.json', record, CLAIM_STALE_MS + 60_000);

        const { logger } = makeTestLogger();
        reclaim(logger, root);

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles).toHaveLength(1);
        expect(postFiles[0]).toBe('rec-1.json');
        expect(fs.existsSync(claimDirFor(root, 'stale-claim'))).toBe(false);
      } finally {
        cleanup();
      }
    });
    it('does not reclaim a fresh (non-stale) claim directory', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: 'a'.repeat(40),
          branch
        };
        writeClaimDirFile(root, 'fresh-claim', 'rec-1.json', record);

        const { logger } = makeTestLogger();
        reclaim(logger, root);

        expect(fs.existsSync(claimDirFor(root, 'fresh-claim'))).toBe(true);
        const claimFiles = fs.readdirSync(claimDirFor(root, 'fresh-claim'));
        expect(claimFiles).toHaveLength(1);
        const postDirPath = postCommitDir(root);
        expect(
          fs.existsSync(postDirPath) ? fs.readdirSync(postDirPath).filter((f) => f.endsWith('.json')).length : 0
        ).toBe(0);
      } finally {
        cleanup();
      }
    });
    it('reclaims multiple stale claim directories independently', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        const record = (path: string): PostCommitRecord => ({
          anchors: [anchor(path)],
          created_at: new Date().toISOString(),
          sha: 'a'.repeat(40),
          branch
        });
        writeClaimDirFile(root, 'stale-1', 'a.json', record('a.ts'), CLAIM_STALE_MS + 60_000);
        writeClaimDirFile(root, 'stale-2', 'b.json', record('b.ts'), CLAIM_STALE_MS + 60_000);

        const { logger } = makeTestLogger();
        reclaim(logger, root);

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles.sort()).toEqual(['a.json', 'b.json']);
        expect(fs.existsSync(claimDirFor(root, 'stale-1'))).toBe(false);
        expect(fs.existsSync(claimDirFor(root, 'stale-2'))).toBe(false);
      } finally {
        cleanup();
      }
    });
    it('handles empty or missing claimed directory gracefully', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const { logger } = makeTestLogger();
        expect(() => reclaim(logger, root)).not.toThrow();
        fs.mkdirSync(claimedDir(root), { recursive: true });
        expect(() => reclaim(logger, root)).not.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  describe('sweepClaimDir', () => {
    it('moves remaining records back to post-commit and removes the claim directory', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: 'a'.repeat(40),
          branch
        };
        writeClaimDirFile(root, 'claim-1', 'a.json', record);
        writeClaimDirFile(root, 'claim-1', 'b.json', { ...record, anchors: [anchor('src/bar.ts')] });

        const { logger } = makeTestLogger();
        sweepClaimDir(logger, root, 'claim-1');

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles.sort()).toEqual(['a.json', 'b.json']);
        expect(fs.existsSync(claimDirFor(root, 'claim-1'))).toBe(false);
      } finally {
        cleanup();
      }
    });
    it('removes an empty claim directory without error', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        fs.mkdirSync(claimDirFor(root, 'empty-claim'), { recursive: true });
        const { logger } = makeTestLogger();
        expect(() => sweepClaimDir(logger, root, 'empty-claim')).not.toThrow();
        expect(fs.existsSync(claimDirFor(root, 'empty-claim'))).toBe(false);
      } finally {
        cleanup();
      }
    });
    it('does nothing when the claim directory does not exist', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const { logger } = makeTestLogger();
        expect(() => sweepClaimDir(logger, root, 'never-existed')).not.toThrow();
      } finally {
        cleanup();
      }
    });
  });
});

// ===========================================================================
// claimDirFor tests
// ===========================================================================

describe('claimDirFor', () => {
  it('joins the claimed directory with the claim id', () => {
    const repo = initRepo();
    const { root, cleanup } = repo;
    try {
      expect(claimDirFor(root, 'abc')).toBe(nodePath.join(claimedDir(root), 'abc'));
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// Utility functions tests
// ===========================================================================

describe('Utility functions', () => {
  describe('getHeadSha', () => {
    it('returns the SHA of HEAD', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const sha = getHeadSha(root);
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      } finally {
        cleanup();
      }
    });
  });
  describe('areAnchorsClean', () => {
    it('returns true when anchor paths are committed', () => {
      const repo = initRepo('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        expect(areAnchorsClean(root, [anchor('src/foo.ts')])).toBe(true);
      } finally {
        cleanup();
      }
    });
    it('returns false when anchor path has uncommitted changes', () => {
      const repo = initRepo('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writeFileOnly(root, 'src/foo.ts', 'dirty');
        expect(areAnchorsClean(root, [anchor('src/foo.ts')])).toBe(false);
      } finally {
        cleanup();
      }
    });
  });
});

// ===========================================================================
// buildAgentPrompt test (pure function, no git needed)
// ===========================================================================

describe('buildAgentPrompt', () => {
  it('substitutes repoRoot, meshDir, postCommitDir, and claimDir into the template', () => {
    const prompt = buildAgentPrompt(
      '/tmp/repo',
      '.mesh',
      '/tmp/repo/.git/git-mesh/post-commit',
      '/tmp/repo/.git/git-mesh/post-commit/claimed/claim-1'
    );
    expect(prompt).toContain('/tmp/repo');
    expect(prompt).toContain('.mesh');
    expect(prompt).toContain('/tmp/repo/.git/git-mesh/post-commit');
    expect(prompt).toContain('/tmp/repo/.git/git-mesh/post-commit/claimed/claim-1');
    expect(prompt).not.toContain('{{');
  });
  it('describes the self-claiming, self-landing workflow', () => {
    const prompt = buildAgentPrompt('/tmp/repo', '.mesh', '/tmp/post', '/tmp/claim');
    expect(prompt).toMatch(/EnterWorktree/);
    expect(prompt).toMatch(/rebase/i);
    expect(prompt.toLowerCase()).toContain('git mesh stale');
  });
});

// ===========================================================================
// buildClaudeArgs test (pure function, no git needed)
// ===========================================================================

describe('buildClaudeArgs', () => {
  it('builds -p/--resume/--settings args with the claim id as the resume session', () => {
    const repo = initRepo();
    const { root, cleanup } = repo;
    let args: string[];
    try {
      args = buildClaudeArgs(root, '.mesh', 'claim-123');
    } finally {
      cleanup();
    }
    expect(args[0]).toBe('-p');
    expect(typeof args[1]).toBe('string');
    expect(args[2]).toBe('--resume');
    expect(args[3]).toBe('claim-123');
    expect(args[4]).toBe('--settings');
    const settings = JSON.parse(args[5]);
    expect(settings.permissions.allow).toContain('EnterWorktree');
    expect(settings.permissions.allow).toContain('ExitWorktree');
    expect(settings.permissions.allow).toContain('Agent');
    expect(settings.permissions.deny).toContain('AskUserQuestion');
    expect(settings).not.toHaveProperty('allowedTools');
    expect(settings).not.toHaveProperty('deniedTools');
    expect(settings).not.toHaveProperty('editFileScope');
    expect(settings).not.toHaveProperty('writeFileScope');
  });
});

// ===========================================================================
// Manual dispatch tests
// ===========================================================================

describe('manualRunMarkerPath', () => {
  it('resolves to <meshDir>/.manual-run under the repo root', () => {
    expect(manualRunMarkerPath('/tmp/repo', '.mesh')).toBe(nodePath.join('/tmp/repo', '.mesh', '.manual-run'));
  });
});

describe('writeManualDispatchScript', () => {
  it('writes an executable script embedding the claim dir and claude invocation, without sweeping the claim dir', () => {
    const repo = initRepo();
    const { root, cleanup } = repo;
    try {
      const claimId = 'manual-claim-1';
      const claimDir = claimDirFor(root, claimId);
      fs.mkdirSync(claimDir, { recursive: true });

      const { logger } = makeTestLogger();
      const now = new Date('2026-07-08T16:30:00.000Z');
      const scriptPath = writeManualDispatchScript(logger, root, '.mesh', claimId, now);

      expect(scriptPath).toBe(nodePath.join(root, '.mesh', 'manual-hook-dispatch-2026-07-08T16-30-00-000Z.sh'));
      expect(fs.existsSync(scriptPath)).toBe(true);

      const mode = fs.statSync(scriptPath).mode;
      expect(mode & 0o111).toBeTruthy(); // executable bits set

      const content = fs.readFileSync(scriptPath, 'utf8');
      expect(content).toMatch(/^#!\/bin\/sh/);
      expect(content).toContain(claimDir);
      expect(content).toContain('claude');
      expect(content).toContain('--resume');
      expect(content).toContain(claimId);
      expect(content).toContain('--settings');

      // The claim directory must be left in place (not swept) for the script
      // to be runnable later against the exact same claim.
      expect(fs.existsSync(claimDir)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('single-quote-escapes embedded quotes in the prompt/settings safely', () => {
    const repo = initRepo();
    const { root, cleanup } = repo;
    try {
      const claimId = 'claim-with-quotes';
      fs.mkdirSync(claimDirFor(root, claimId), { recursive: true });
      const { logger } = makeTestLogger();
      const scriptPath = writeManualDispatchScript(
        logger,
        root,
        '.mesh',
        claimId,
        new Date('2026-01-01T00:00:00.000Z')
      );
      const content = fs.readFileSync(scriptPath, 'utf8');
      expect(content).toContain('exec ');
      // The prompt/settings JSON contain apostrophes and double quotes
      // (e.g. "don't"-style text, JSON string values); every embedded `'`
      // must be escaped as `'\''` so the shell never sees a premature string
      // terminator. `sh -n` syntax-checks the script without executing it.
      execFileSync('sh', ['-n', scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// parseArgs test
// ===========================================================================

describe('parseArgs', () => {
  it('parses --repo-root', () => {
    const args = parseArgs(['node', 'dispatcher.mjs', '--repo-root', '/tmp/repo']);
    expect(args).not.toBeNull();
    expect(args!.repoRoot).toBe('/tmp/repo');
    expect(args!.postRewrite).toBe(false);
    expect(args!.commitSha).toBeUndefined();
  });
  it('parses --post-rewrite flag', () => {
    const args = parseArgs(['node', 'dispatcher.mjs', '--repo-root', '/tmp/repo', '--post-rewrite']);
    expect(args).not.toBeNull();
    expect(args!.postRewrite).toBe(true);
  });
  it('parses --commit-sha', () => {
    const args = parseArgs(['node', 'dispatcher.mjs', '--repo-root', '/tmp/repo', '--commit-sha', 'abc123def456']);
    expect(args).not.toBeNull();
    expect(args!.commitSha).toBe('abc123def456');
  });
  it('returns null when --repo-root is missing', () => {
    expect(parseArgs(['node', 'dispatcher.mjs'])).toBeNull();
  });
});
