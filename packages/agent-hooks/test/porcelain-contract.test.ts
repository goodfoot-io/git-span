/**
 * Porcelain contract test: verifies that the git mesh porcelain output format
 * is parseable by the shared parsePorcelain function.
 *
 * These tests exercise the actual `git mesh stale --porcelain --batch` and
 * `git mesh list --porcelain --batch` commands against a real temporary git
 * repo with a mesh, then validate the output through the same parser the
 * dispatcher uses.
 *
 * If `git mesh` is not available on PATH, all tests in this file are skipped
 * with a descriptive message.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePorcelain } from '../src/agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Git-mesh availability check
// ---------------------------------------------------------------------------

const hasGitMesh = (() => {
  try {
    execFileSync('git', ['mesh', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const suite = hasGitMesh ? describe : describe.skip;

suite('Porcelain contract (git mesh)', () => {
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

  function addMesh(repoRoot: string, name: string, anchor: string): void {
    execFileSync('git', ['mesh', 'add', name, anchor], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    execFileSync('git', ['mesh', 'why', name, '-m', `mesh ${name}`], {
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

  describe('git mesh list --porcelain --batch', () => {
    it('produces parseable rows for existing meshes', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\nline4\nline5\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a mesh and commit
      addMesh(repoRoot, 'my-module', 'src/app.ts#L1-L5');
      gitAddCommit(repoRoot, 'add mesh');

      // Run list --porcelain --batch with the source path as filter
      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'list', '--porcelain', '--batch'], {
        input: 'src/app.ts\n',
        stdio: ['pipe', 'pipe', 'pipe'],
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

      // Our specific mesh should be present
      const ourMesh = rows.find((r) => r.name === 'my-module');
      expect(ourMesh).toBeDefined();
      expect(ourMesh!.path).toBe('src/app.ts');
      expect(ourMesh!.start).toBe(1);
      expect(ourMesh!.end).toBe(5);
    });

    it('produces no rows for a path with no meshes', () => {
      writeFile(repoRoot, 'src/other.ts', 'content');
      gitAddCommit(repoRoot, 'initial');

      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'list', '--porcelain', '--batch'], {
        input: 'src/other.ts\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toHaveLength(0);
    });

    it('handles empty stdin gracefully', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');

      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'list', '--porcelain', '--batch'], {
        input: '',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toEqual([]);
    });
  });

  describe('git mesh stale --porcelain --batch', () => {
    it('produces parseable rows for stale anchors', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a mesh and commit
      addMesh(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      gitAddCommit(repoRoot, 'add mesh');

      // Modify the source file so the anchor becomes stale
      writeFile(repoRoot, 'src/app.ts', 'CHANGED\nline2\nline3\n');

      // Run stale --porcelain --batch with the anchor spec on stdin
      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'stale', '--porcelain', '--batch'], {
        input: 'src/app.ts#L1-L2\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);

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

      // Our specific mesh should be reported as stale
      const ourMesh = rows.find((r) => r.name === 'my-module');
      expect(ourMesh).toBeDefined();
      expect(ourMesh!.path).toBe('src/app.ts');
    });

    it('produces no rows for anchors that are not stale', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a mesh and commit
      addMesh(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      gitAddCommit(repoRoot, 'add mesh');

      // Don't modify the source -- anchors should not be stale
      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'stale', '--porcelain', '--batch'], {
        input: 'src/app.ts#L1-L2\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toHaveLength(0);
    });

    it('handles empty stdin gracefully', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');
      addMesh(repoRoot, 'my-module', 'src/app.ts#L1-L1');
      gitAddCommit(repoRoot, 'add mesh');

      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'stale', '--porcelain', '--batch'], {
        input: '',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toEqual([]);
    });

    it('produces no rows for nonexistent anchor paths', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');
      addMesh(repoRoot, 'my-module', 'src/app.ts#L1-L1');
      gitAddCommit(repoRoot, 'add mesh');

      const out = execFileSync('git', ['-C', repoRoot, 'mesh', 'stale', '--porcelain', '--batch'], {
        input: 'nonexistent.ts#L1-L5\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parsePorcelain(out);
      expect(rows).toHaveLength(0);
    });
  });

  describe('combined list + stale contract', () => {
    it('list rows subset of stale rows when anchors are stale', () => {
      writeFile(repoRoot, 'src/app.ts', 'a\nb\nc\n');
      gitAddCommit(repoRoot, 'initial');

      // Add both a mesh and a second file that is not meshed
      addMesh(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      writeFile(repoRoot, 'src/other.ts', 'x\ny\nz\n');
      gitAddCommit(repoRoot, 'add mesh and other file');

      // Make the anchored file stale
      writeFile(repoRoot, 'src/app.ts', 'MODIFIED\nb\nc\n');

      // List with the source path
      const listOut = execFileSync('git', ['-C', repoRoot, 'mesh', 'list', '--porcelain', '--batch'], {
        input: 'src/app.ts\nsrc/other.ts\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const listRows = parsePorcelain(listOut);
      expect(listRows.length).toBeGreaterThan(0);

      // Stale with the anchor spec
      const staleOut = execFileSync('git', ['-C', repoRoot, 'mesh', 'stale', '--porcelain', '--batch'], {
        input: 'src/app.ts#L1-L2\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const staleRows = parsePorcelain(staleOut);
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
