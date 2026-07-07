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
  type ClaimedFile,
  claim,
  createScratchWorktree,
  deleteClaim,
  doAnchorsExistAt,
  getChangedPaths,
  getCurrentBranch,
  getHeadSha,
  getWorktreeBranches,
  type Logger,
  landCommit,
  parseArgs,
  parsePidFromClaimed,
  parsePostRewriteInput,
  postRewriteDemote,
  promote,
  reclaim,
  refExists,
  releaseClaim,
  removeScratchWorktree,
  resolveBranch,
  runDetection,
  stripClaimSuffix
} from '../src/dispatcher.js';
import { makeTempRepo } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function writeClaimedFile(repoRoot: string, filename: string, pid: number, record: PostCommitRecord): string {
  const dir = claimedDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const claimedName = `${filename}.pid-${pid}`;
  const filePath = nodePath.join(dir, claimedName);
  fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
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

// ===========================================================================
// Suite 5: PID utility tests
// ===========================================================================

describe('PID utilities', () => {
  describe('parsePidFromClaimed', () => {
    it('extracts PID from claimed filename', () => {
      expect(parsePidFromClaimed('abc-123.json.pid-45678')).toBe(45678);
    });
    it('returns null when no PID suffix present', () => {
      expect(parsePidFromClaimed('abc-123.json')).toBeNull();
    });
    it('returns null for empty string', () => {
      expect(parsePidFromClaimed('')).toBeNull();
    });
    it('extracts PID with multiple dots in original name', () => {
      expect(parsePidFromClaimed('some.record.name.json.pid-999')).toBe(999);
    });
    it('returns null for non-numeric PID', () => {
      expect(parsePidFromClaimed('abc.json.pid-abc')).toBeNull();
    });
  });
  describe('stripClaimSuffix', () => {
    it('removes PID suffix from claimed filename', () => {
      expect(stripClaimSuffix('abc-123.json.pid-45678')).toBe('abc-123.json');
    });
    it('returns original filename when no suffix present', () => {
      expect(stripClaimSuffix('abc-123.json')).toBe('abc-123.json');
    });
    it('returns empty string for empty input', () => {
      expect(stripClaimSuffix('')).toBe('');
    });
    it('handles multiple suffixes correctly', () => {
      expect(stripClaimSuffix('data.json.pid-0')).toBe('data.json');
    });
  });
});

// ===========================================================================
// Suite 2: Porcelain format contract tests
// ===========================================================================

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

// ===========================================================================
// Anchor utilities (pure functions, no git needed)
// ===========================================================================

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

// ===========================================================================
// Suite 3: Branch resolution tests
// ===========================================================================

describe('Branch resolution', () => {
  describe('refExists', () => {
    it('returns SHA for existing branch', () => {
      const { root, cleanup } = makeTempRepo();
      try {
        configureGit(root);
        writeFileAndCommit(root, 'readme.md', 'initial', 'init');
        execFileSync('git', ['branch', 'test-branch'], { cwd: root });
        const sha = refExists(root, 'test-branch');
        expect(sha).toBeTruthy();
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      } finally {
        cleanup();
      }
    });
    it('returns null for nonexistent branch', () => {
      const { root, cleanup } = makeTempRepo();
      try {
        configureGit(root);
        writeFileAndCommit(root, 'readme.md', 'initial', 'init');
        expect(refExists(root, 'nonexistent')).toBeNull();
      } finally {
        cleanup();
      }
    });
  });
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
  describe('getWorktreeBranches', () => {
    it('includes the main worktree branch', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branches = getWorktreeBranches(root);
        expect(branches.size).toBeGreaterThanOrEqual(1);
      } finally {
        cleanup();
      }
    });
    it('finds a linked worktree branch', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      const tmpdir = fs.mkdtempSync(nodePath.join(fs.realpathSync.native('/tmp'), 'wt-'));
      try {
        execFileSync('git', ['branch', 'test-branch'], { cwd: root });
        execFileSync('git', ['worktree', 'add', tmpdir, 'test-branch'], { cwd: root });
        const branches = getWorktreeBranches(root);
        const wtPath = branches.get('test-branch');
        expect(wtPath).toBeTruthy();
      } finally {
        execFileSync('git', ['worktree', 'remove', '--force', tmpdir], { cwd: root, stdio: 'ignore' });
        fs.rmSync(tmpdir, { recursive: true, force: true });
        cleanup();
      }
    });
  });
});

// ===========================================================================
// Suite 4: Post-rewrite demotion tests
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
// Suite 1: Queue lifecycle tests
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
  describe('claim', () => {
    it('claims a post-commit record and stamps the PID', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        writePostCommitFile(root, 'rec-1.json', {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: 'a'.repeat(40),
          branch
        });

        const { logger } = makeTestLogger();
        const claimedRecords = claim(logger, root);
        expect(claimedRecords).toHaveLength(1);
        expect(claimedRecords[0].pid).toBe(process.pid);
        expect(claimedRecords[0].originalName).toBe('rec-1.json');

        const claimFiles = fs.readdirSync(claimedDir(root));
        expect(claimFiles).toHaveLength(1);
        expect(claimFiles[0]).toBe(`rec-1.json.pid-${process.pid}`);
        expect(fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
    it('claims multiple records', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const branch = branchName(root);
        writePostCommitFile(root, 'a.json', {
          anchors: [anchor('a.ts')],
          created_at: '2024-01-01T00:00:00.000Z',
          sha: 'a'.repeat(40),
          branch
        });
        writePostCommitFile(root, 'b.json', {
          anchors: [anchor('b.ts')],
          created_at: '2024-01-01T00:00:00.000Z',
          sha: 'b'.repeat(40),
          branch
        });
        const { logger } = makeTestLogger();
        const claimedRecords = claim(logger, root);
        expect(claimedRecords).toHaveLength(2);
      } finally {
        cleanup();
      }
    });
    it('returns empty array when no post-commit records exist', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const { logger } = makeTestLogger();
        expect(claim(logger, root)).toEqual([]);
      } finally {
        cleanup();
      }
    });
  });
  describe('reclaim', () => {
    it('reclaims records with dead PIDs back to post-commit', () => {
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
        writeClaimedFile(root, 'rec-1.json', 2_147_483_647, record);

        const { logger } = makeTestLogger();
        reclaim(logger, root);

        const postFiles = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles).toHaveLength(1);
        expect(postFiles[0]).toBe('rec-1.json');
        expect(fs.readdirSync(claimedDir(root))).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
    it('does not reclaim records with live PIDs', () => {
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
        writeClaimedFile(root, 'rec-1.json', process.pid, record);

        const { logger } = makeTestLogger();
        reclaim(logger, root);

        const claimFiles = fs.readdirSync(claimedDir(root));
        expect(claimFiles).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
    it('handles empty claimed directory gracefully', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const { logger } = makeTestLogger();
        expect(() => reclaim(logger, root)).not.toThrow();
      } finally {
        cleanup();
      }
    });
  });
  describe('full pipeline', () => {
    it('pre-commit -> post-commit -> claimed -> reclaimed back to post-commit', () => {
      const repo = initRepoWithPrev('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        writePreCommitFile(root, 'pipeline-test.json', {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString()
        });
        writeFileAndCommit(root, 'src/foo.ts', 'v2', 'modify foo');

        // Step 1: Promote
        promote(makeTestLogger().logger, root, getChangedPaths(root), false);
        expect(fs.readdirSync(preCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(0);

        const postFiles1 = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles1).toHaveLength(1);
        expect(postFiles1[0]).toBe('pipeline-test.json');

        // Step 2: Claim
        const claimedRecords = claim(makeTestLogger().logger, root);
        expect(claimedRecords).toHaveLength(1);
        expect(claimedRecords[0].originalName).toBe('pipeline-test.json');

        // Read the record from the CLAIMED path before removing
        const claimPath = claimedRecords[0].path;
        const promotedFromClaim = readJsonFile<PostCommitRecord>(claimPath);

        // Remove the claimed dir and replace with a dead-PID claim
        fs.rmSync(claimedDir(root), { recursive: true, force: true });
        writeClaimedFile(root, 'pipeline-test.json', 2_147_483_647, promotedFromClaim);

        // Step 3: Reclaim
        reclaim(makeTestLogger().logger, root);

        const postFiles2 = fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'));
        expect(postFiles2).toHaveLength(1);
        expect(postFiles2[0]).toBe('pipeline-test.json');
        expect(fs.readdirSync(claimedDir(root))).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
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
  describe('doAnchorsExistAt', () => {
    it('returns true when anchor path exists at the given SHA', () => {
      const repo = initRepo('src/foo.ts', 'v1');
      const { root, cleanup } = repo;
      try {
        const sha = getHeadSha(root);
        expect(doAnchorsExistAt(root, sha, [anchor('src/foo.ts')])).toBe(true);
      } finally {
        cleanup();
      }
    });
    it('returns false when anchor path does not exist at the given SHA', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const sha = getHeadSha(root);
        expect(doAnchorsExistAt(root, sha, [anchor('nonexistent.ts')])).toBe(false);
      } finally {
        cleanup();
      }
    });
  });
  describe('releaseClaim and deleteClaim', () => {
    it('releaseClaim moves a claimed file back to post-commit', () => {
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
        writeClaimedFile(root, 'rec-1.json', process.pid, record);

        const { logger } = makeTestLogger();
        const claimedFile: ClaimedFile = {
          path: nodePath.join(claimedDir(root), `rec-1.json.pid-${process.pid}`),
          pid: process.pid,
          originalName: 'rec-1.json'
        };

        releaseClaim(logger, root, claimedFile);
        expect(fs.readdirSync(postCommitDir(root)).filter((f) => f.endsWith('.json'))).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
    it('deleteClaim removes the claimed file', () => {
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
        writeClaimedFile(root, 'rec-1.json', process.pid, record);

        const { logger } = makeTestLogger();
        const claimedFile: ClaimedFile = {
          path: nodePath.join(claimedDir(root), `rec-1.json.pid-${process.pid}`),
          pid: process.pid,
          originalName: 'rec-1.json'
        };

        deleteClaim(logger, claimedFile);
        expect(fs.existsSync(claimedFile.path)).toBe(false);
      } finally {
        cleanup();
      }
    });
  });
  describe('resolveBranch', () => {
    it('returns stamped branch when tip matches stamped SHA', () => {
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

        const { logger } = makeTestLogger();
        const resolved = resolveBranch(logger, root, record);
        expect(resolved).not.toBeNull();
        expect(resolved!.branch).toBe(branch);
        expect(resolved!.sha).toBe(sha);
      } finally {
        cleanup();
      }
    });
    it('returns null when no branch contains the stamped SHA', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const record: PostCommitRecord = {
          anchors: [anchor('src/foo.ts')],
          created_at: new Date().toISOString(),
          sha: '0000000000000000000000000000000000000000',
          branch: 'nonexistent'
        };
        const { logger } = makeTestLogger();
        const resolved = resolveBranch(logger, root, record);
        expect(resolved).toBeNull();
      } finally {
        cleanup();
      }
    });
  });
  describe('createScratchWorktree and removeScratchWorktree', () => {
    it('creates and removes a scratch worktree', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      try {
        const sha = getHeadSha(root);

        const { logger } = makeTestLogger();
        const scratchPath = createScratchWorktree(logger, root, sha);
        if (!scratchPath) {
          expect(scratchPath).not.toBeNull();
          return;
        }
        expect(fs.existsSync(scratchPath)).toBe(true);

        const wtSha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: scratchPath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        expect(wtSha).toBe(sha);

        removeScratchWorktree(logger, root, scratchPath);
        expect(fs.existsSync(scratchPath)).toBe(false);
      } finally {
        cleanup();
      }
    });
  });
  describe('landCommit', () => {
    it('updates the target branch via CAS when tip matches expected', () => {
      const repo = initRepo();
      const { root, cleanup } = repo;
      let scratchPath: string | null = null;
      try {
        const expectedTip = getHeadSha(root);
        const branch = branchName(root);

        scratchPath = createScratchWorktree({ info: () => {}, warn: () => {}, error: () => {} }, root, expectedTip);
        if (!scratchPath) {
          expect(scratchPath).not.toBeNull();
          return;
        }

        writeFileAndCommit(scratchPath, '.mesh/test.md', 'mesh content', 'agent commit');
        const agentSha = getHeadSha(scratchPath);
        expect(agentSha).not.toBe(expectedTip);

        const { logger } = makeTestLogger();
        const claimedFile: ClaimedFile = {
          path: '/tmp/fake.json',
          pid: process.pid,
          originalName: 'fake.json'
        };

        const result = landCommit(logger, root, scratchPath, branch, expectedTip, claimedFile, []);
        expect(result).toBe(true);

        const newTip = refExists(root, branch);
        expect(newTip).toBe(agentSha);
      } finally {
        if (scratchPath) {
          try {
            execFileSync('git', ['worktree', 'remove', '--force', scratchPath], {
              cwd: root,
              stdio: 'ignore'
            });
          } catch {
            void 0;
          }
          fs.rmSync(scratchPath, { recursive: true, force: true });
        }
        cleanup();
      }
    });
  });
});

// ===========================================================================
// buildAgentPrompt test (pure function, no git needed)
// ===========================================================================

describe('buildAgentPrompt', () => {
  const baseDetection = {
    staleOutput: '',
    listOutput: '',
    staleRows: [] as Array<{ name: string; path: string; start: number; end: number }>,
    listRows: [] as Array<{ name: string; path: string; start: number; end: number }>,
    actionable: false
  };

  it('includes scratch path and instructions', () => {
    const prompt = buildAgentPrompt('/tmp/scratch-abc', baseDetection, [anchor('src/foo.ts', 'write', 1, 10)]);
    expect(prompt).toContain('/tmp/scratch-abc');
    expect(prompt).toContain('.mesh/');
    expect(prompt).toContain('standalone mesh reconciler');
  });
  it('includes stale rows when present', () => {
    const detection = {
      ...baseDetection,
      staleRows: [{ name: 'my-mesh', path: 'src/foo.ts', start: 10, end: 20 }],
      actionable: true
    };
    const prompt = buildAgentPrompt('/tmp/s', detection, [anchor('src/foo.ts')]);
    expect(prompt).toContain('my-mesh');
    expect(prompt).toContain('src/foo.ts');
    expect(prompt).toContain('stale');
  });
  it('reports uncovered writes when anchor paths have no mesh', () => {
    const detection = {
      ...baseDetection,
      listRows: [{ name: 'other', path: 'src/bar.ts', start: 1, end: 100 }]
    };
    const prompt = buildAgentPrompt('/tmp/s', detection, [anchor('src/foo.ts', 'write', 1, 10)]);
    expect(prompt).toContain('Uncovered Writes');
    expect(prompt).toContain('src/foo.ts');
  });
  it('does not report uncovered writes when all anchors have meshes', () => {
    const detection = {
      ...baseDetection,
      listRows: [{ name: 'my-mesh', path: 'src/foo.ts', start: 1, end: 100 }]
    };
    const prompt = buildAgentPrompt('/tmp/s', detection, [anchor('src/foo.ts')]);
    expect(prompt).not.toContain('Uncovered Writes');
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
    expect(args!.triggerWorktree).toBeUndefined();
    expect(args!.commitSha).toBeUndefined();
  });
  it('parses --post-rewrite flag', () => {
    const args = parseArgs(['node', 'dispatcher.mjs', '--repo-root', '/tmp/repo', '--post-rewrite']);
    expect(args).not.toBeNull();
    expect(args!.postRewrite).toBe(true);
  });
  it('parses --trigger-worktree', () => {
    const args = parseArgs(['node', 'dispatcher.mjs', '--repo-root', '/tmp/repo', '--trigger-worktree', '/tmp/wt']);
    expect(args).not.toBeNull();
    expect(args!.triggerWorktree).toBe('/tmp/wt');
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

// ===========================================================================
// Detection tests (requires git-mesh binary in PATH)
// ===========================================================================

const hasGitMesh = (() => {
  try {
    execFileSync('git', ['mesh', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const detectionSuite = hasGitMesh ? describe : describe.skip;

detectionSuite('Detection (git mesh)', () => {
  describe('Same-repo contract test', () => {
    it('produces parseable porcelain output for a real mesh', () => {
      const repo = initRepoWithPrev('src/app.ts', 'line1\nline2\nline3\nline4\nline5\n');
      const { root, cleanup } = repo;
      try {
        execFileSync('git', ['mesh', 'add', 'my-module', 'src/app.ts#L1-L5'], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        });
        execFileSync('git', ['mesh', 'why', 'my-module', '-m', 'test mesh'], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        });
        execFileSync('git', ['add', '.mesh'], { cwd: root });
        execFileSync('git', ['commit', '-m', 'add mesh'], { cwd: root });

        const { logger } = makeTestLogger();
        const filterAnchors = [anchor('src/app.ts', 'write', 1, 5)];
        const result = runDetection(logger, root, root, filterAnchors);
        expect(result).not.toBeNull();

        expect(result!.staleRows).toBeInstanceOf(Array);
        expect(result!.listRows).toBeInstanceOf(Array);

        for (const row of result!.staleRows) {
          expect(typeof row.name).toBe('string');
          expect(typeof row.path).toBe('string');
          expect(Number.isFinite(row.start)).toBe(true);
          expect(Number.isFinite(row.end)).toBe(true);
        }
        for (const row of result!.listRows) {
          expect(typeof row.name).toBe('string');
          expect(typeof row.path).toBe('string');
          expect(Number.isFinite(row.start)).toBe(true);
          expect(Number.isFinite(row.end)).toBe(true);
        }
      } finally {
        cleanup();
      }
    });
  });
});
