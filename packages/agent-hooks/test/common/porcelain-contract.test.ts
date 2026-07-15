/**
 * Porcelain contract test: verifies that the git span porcelain output formats
 * are parseable by the shared parsePorcelain / parseStalePorcelain functions.
 *
 * These tests exercise the actual `git span stale --format porcelain` and
 * `git span list --porcelain` commands against a real temporary git repo with
 * a span, then validate the output through the same parsers the dispatcher
 * uses. The two commands emit different porcelain shapes: `list --porcelain`
 * is `<name>\t<path>\t<start>-<end>`, while `stale --format porcelain` is a
 * `# porcelain v2` header followed by `<status>\t<src>\t<name>\t<path>\t<start>\t<end>` rows.
 *
 * If `git span` is not available on PATH, all tests in this file are skipped
 * with a descriptive message.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePorcelain, parseStalePorcelain } from '../../src/common/agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Git-span availability check
// ---------------------------------------------------------------------------

const hasGitSpan = (() => {
  try {
    execFileSync('git', ['span', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const suite = hasGitSpan ? describe : describe.skip;

suite('Porcelain contract (git span)', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  interface TestRepo {
    root: string;
    cleanup: () => void;
  }

  function createTestRepo(): TestRepo {
    const root = fs.mkdtempSync(nodePath.join(fs.realpathSync.native('/tmp'), 'porcelain-'));
    execFileSync('git', ['init', '-q', '-b', 'main', root], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@test.com'], {
      stdio: 'ignore'
    });
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false'], {
      stdio: 'ignore'
    });
    return {
      root,
      cleanup: () => fs.rmSync(root, { recursive: true, force: true })
    };
  }

  function writeFile(repoRoot: string, relPath: string, content: string): void {
    const full = nodePath.join(repoRoot, relPath);
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }

  function gitAddCommit(repoRoot: string, msg: string): void {
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', msg], { stdio: 'ignore' });
  }

  function addSpan(repoRoot: string, name: string, anchor: string): void {
    execFileSync('git', ['span', 'add', name, anchor], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    execFileSync('git', ['span', 'why', name, '-m', `span ${name}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
  }

  // ---------------------------------------------------------------------------
  // Setup / teardown
  // ---------------------------------------------------------------------------

  let repo: TestRepo;
  let repoRoot: string;

  beforeEach(() => {
    repo = createTestRepo();
    repoRoot = repo.root;
  });

  afterEach(() => {
    repo.cleanup();
  });

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  describe('git span list --porcelain', () => {
    it('produces parseable rows for existing spans', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\nline4\nline5\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a span and commit
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L5');
      gitAddCommit(repoRoot, 'add span');

      // Run list --porcelain with the source path as filter
      const out = execFileSync('git', ['-C', repoRoot, 'span', 'list', '--porcelain', 'src/app.ts'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);

      // Every line should be parseable into valid rows
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.name).toBe('string');
        expect(row.name.length).toBeGreaterThan(0);
        expect(typeof row.path).toBe('string');
        expect(row.path.length).toBeGreaterThan(0);
        expect(Number.isFinite(row.start)).toBe(true);
        expect(Number.isFinite(row.end)).toBe(true);
        expect(row.start).toBeGreaterThanOrEqual(1);
        expect(row.end).toBeGreaterThanOrEqual(row.start);
      }

      // Our specific span should be present
      const ourSpan = rows.find((r) => r.name === 'my-module');
      expect(ourSpan).toBeDefined();
      expect(ourSpan!.path).toBe('src/app.ts');
      expect(ourSpan!.start).toBe(1);
      expect(ourSpan!.end).toBe(5);
    });

    it('produces no rows for a path with no spans', () => {
      writeFile(repoRoot, 'src/other.ts', 'content');
      gitAddCommit(repoRoot, 'initial');

      const out = execFileSync('git', ['-C', repoRoot, 'span', 'list', '--porcelain', 'src/other.ts'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toHaveLength(0);
    });

    it('produces no rows when no targets are given and no spans exist', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');

      const out = execFileSync('git', ['-C', repoRoot, 'span', 'list', '--porcelain'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toEqual([]);
    });
  });

  describe('git span stale --format porcelain', () => {
    it('produces parseable rows for stale anchors', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a span and commit
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      gitAddCommit(repoRoot, 'add span');

      // Modify the source file so the anchor becomes stale
      writeFile(repoRoot, 'src/app.ts', 'CHANGED\nline2\nline3\n');

      // Run stale --format porcelain with the source path
      const out = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'stale', '--format', 'porcelain', '--no-exit-code', 'src/app.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const rows = parseStalePorcelain(out);

      // The stale anchor should be reported
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.name).toBe('string');
        expect(row.name.length).toBeGreaterThan(0);
        expect(typeof row.path).toBe('string');
        expect(row.path.length).toBeGreaterThan(0);
        expect(Number.isFinite(row.start)).toBe(true);
        expect(Number.isFinite(row.end)).toBe(true);
        expect(row.start).toBeGreaterThanOrEqual(1);
        expect(row.end).toBeGreaterThanOrEqual(row.start);
      }

      // Our specific span should be reported as stale
      const ourSpan = rows.find((r) => r.name === 'my-module');
      expect(ourSpan).toBeDefined();
      expect(ourSpan!.path).toBe('src/app.ts');
    });

    it('produces no rows for anchors that are not stale', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a span and commit
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      gitAddCommit(repoRoot, 'add span');

      // Don't modify the source -- anchors should not be stale
      const out = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'stale', '--format', 'porcelain', '--no-exit-code', 'src/app.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const rows = parseStalePorcelain(out);
      expect(rows).toHaveLength(0);
    });

    it('produces no rows when no targets are given and no spans are stale', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L1');
      gitAddCommit(repoRoot, 'add span');

      const out = execFileSync('git', ['-C', repoRoot, 'span', 'stale', '--format', 'porcelain', '--no-exit-code'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parseStalePorcelain(out);
      expect(rows).toEqual([]);
    });

    it('fails closed for a nonexistent path', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L1');
      gitAddCommit(repoRoot, 'add span');

      expect(() =>
        execFileSync(
          'git',
          ['-C', repoRoot, 'span', 'stale', '--format', 'porcelain', '--no-exit-code', 'nonexistent.ts'],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8'
          }
        )
      ).toThrow();
    });
  });

  describe('combined list + stale contract', () => {
    it('list rows subset of stale rows when anchors are stale', () => {
      writeFile(repoRoot, 'src/app.ts', 'a\nb\nc\n');
      gitAddCommit(repoRoot, 'initial');

      // Add both a span and a second file that is not spanned
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      writeFile(repoRoot, 'src/other.ts', 'x\ny\nz\n');
      gitAddCommit(repoRoot, 'add span and other file');

      // Make the anchored file stale
      writeFile(repoRoot, 'src/app.ts', 'MODIFIED\nb\nc\n');

      // List with the source paths
      const listOut = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'list', '--porcelain', 'src/app.ts', 'src/other.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const listRows = parsePorcelain(listOut);
      expect(listRows.length).toBeGreaterThan(0);

      // Stale with the source path
      const staleOut = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'stale', '--format', 'porcelain', '--no-exit-code', 'src/app.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const staleRows = parseStalePorcelain(staleOut);
      expect(staleRows.length).toBeGreaterThan(0);

      // The stale rows should be a subset of list rows (same name+path+range)
      for (const stale of staleRows) {
        const match = listRows.find(
          (l) => l.name === stale.name && l.path === stale.path && l.start === stale.start && l.end === stale.end
        );
        expect(match).toBeDefined();
      }
    });
  });
});
