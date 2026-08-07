/**
 * Porcelain contract test: verifies that the git span porcelain output formats
 * are parseable by the shared parsePorcelain / parseDriftPorcelain functions.
 *
 * These tests exercise the actual `git span drift --format porcelain` and
 * `git span list --porcelain` commands against a real temporary git repo with
 * a span, then validate the output through the same parsers touch-core and
 * advisor-core use. The two commands emit different porcelain shapes: `list --porcelain`
 * is `<name>\t<path>\t<start>-<end>`, while `drift --format porcelain` is a
 * `# porcelain v2` header followed by `<status>\t<src>\t<name>\t<path>\t<start>\t<end>` rows.
 *
 * If `git span` is not available on PATH, all tests in this file are skipped
 * with a descriptive message.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isDebt,
  isEnvironmentalStatus,
  PORCELAIN_STATUSES,
  type PorcelainStatus,
  parseDriftPorcelain,
  parsePorcelain
} from '../../src/common/agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Git-span availability check
// ---------------------------------------------------------------------------

const hasGitSpan = (() => {
  // Bounded check: a broken/placeholder git-span binary must fail fast here
  // rather than hang or recurse (see git-span-fork-bomb incident report).
  const result = spawnSync('git', ['span', '--version'], { stdio: 'ignore', timeout: 5_000 });
  return result.status === 0;
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
    execFileSync('git', ['span', 'why', name, `span ${name}`], {
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

  describe('git span drift --format porcelain', () => {
    it('produces parseable rows for drifted anchors', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a span and commit
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      gitAddCommit(repoRoot, 'add span');

      // Modify the source file so the anchor becomes drifted
      writeFile(repoRoot, 'src/app.ts', 'CHANGED\nline2\nline3\n');

      // Run drift --format porcelain with the source path
      const out = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'drift', '--format', 'porcelain', '--no-exit-code', 'src/app.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const rows = parseDriftPorcelain(out);

      // The drifted anchor should be reported
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

      // Our specific span should be reported as drifted, with a real status
      // token from the documented vocabulary (content changed → CHANGED).
      const ourSpan = rows.find((r) => r.name === 'my-module');
      expect(ourSpan).toBeDefined();
      expect(ourSpan!.path).toBe('src/app.ts');
      expect(PORCELAIN_STATUSES).toContain(ourSpan!.status);
      expect(ourSpan!.status).toBe('CHANGED');
      expect(isDebt(ourSpan!.status)).toBe(true);
    });

    it('produces no rows for anchors that are not drifted', () => {
      // Create source file and commit
      writeFile(repoRoot, 'src/app.ts', 'line1\nline2\nline3\n');
      gitAddCommit(repoRoot, 'initial');

      // Add a span and commit
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      gitAddCommit(repoRoot, 'add span');

      // Don't modify the source -- anchors should not be drifted
      const out = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'drift', '--format', 'porcelain', '--no-exit-code', 'src/app.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const rows = parseDriftPorcelain(out);
      expect(rows).toHaveLength(0);
    });

    it('produces no rows when no targets are given and no spans are drifted', () => {
      writeFile(repoRoot, 'src/app.ts', 'content');
      gitAddCommit(repoRoot, 'initial');
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L1');
      gitAddCommit(repoRoot, 'add span');

      const out = execFileSync('git', ['-C', repoRoot, 'span', 'drift', '--format', 'porcelain', '--no-exit-code'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      const rows = parseDriftPorcelain(out);
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
          ['-C', repoRoot, 'span', 'drift', '--format', 'porcelain', '--no-exit-code', 'nonexistent.ts'],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8'
          }
        )
      ).toThrow();
    });
  });

  describe('combined list + drift contract', () => {
    it('list rows subset of drift rows when anchors are drifted', () => {
      writeFile(repoRoot, 'src/app.ts', 'a\nb\nc\n');
      gitAddCommit(repoRoot, 'initial');

      // Add both a span and a second file that is not spanned
      addSpan(repoRoot, 'my-module', 'src/app.ts#L1-L2');
      writeFile(repoRoot, 'src/other.ts', 'x\ny\nz\n');
      gitAddCommit(repoRoot, 'add span and other file');

      // Make the anchored file drift
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

      // Drift with the source path
      const driftOut = execFileSync(
        'git',
        ['-C', repoRoot, 'span', 'drift', '--format', 'porcelain', '--no-exit-code', 'src/app.ts'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        }
      );
      const driftRows = parseDriftPorcelain(driftOut);
      expect(driftRows.length).toBeGreaterThan(0);

      // The drift rows should be a subset of list rows (same name+path+range)
      for (const drift of driftRows) {
        const match = listRows.find(
          (l) => l.name === drift.name && l.path === drift.path && l.start === drift.start && l.end === drift.end
        );
        expect(match).toBeDefined();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Status vocabulary + isDebt — pure, no git-span CLI required, always runs.
// ---------------------------------------------------------------------------

/**
 * Synthesizes a `drift --format porcelain` block for the given status tokens
 * so the full vocabulary (including terminal/error statuses the real CLI is
 * hard to provoke in a unit test, e.g. CONFLICT/SUBMODULE/LFS_*) can be
 * exercised against the real parser.
 */
function syntheticDriftPorcelain(statuses: readonly string[]): string {
  const header = '# porcelain v2';
  const rows = statuses.map((status, i) => `${status}\tW\tspan-${i}\tsrc/file-${i}.ts\t1\t2`);
  return [header, ...rows].join('\n');
}

describe('parseDriftPorcelain — full status vocabulary', () => {
  it('parses every documented status token, preserving row order and fields', () => {
    const rows = parseDriftPorcelain(syntheticDriftPorcelain(PORCELAIN_STATUSES));
    expect(rows).toHaveLength(PORCELAIN_STATUSES.length);
    rows.forEach((row, i) => {
      expect(row.status).toBe(PORCELAIN_STATUSES[i]);
      expect(row.name).toBe(`span-${i}`);
      expect(row.path).toBe(`src/file-${i}.ts`);
    });
  });

  it('skips a row whose status token is not in the known vocabulary', () => {
    const input = [
      '# porcelain v2',
      'NOT_A_REAL_STATUS\tW\tspan-x\tsrc/x.ts\t1\t2',
      'FRESH\tW\tspan-y\tsrc/y.ts\t1\t2'
    ].join('\n');
    const rows = parseDriftPorcelain(input);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('span-y');
  });

  it('parses whole-file status rows with (whole)/- columns', () => {
    const input = ['# porcelain v2', 'DELETED\t-\tspan-whole\tsrc/gone.ts\t(whole)\t-'].join('\n');
    const rows = parseDriftPorcelain(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'DELETED', name: 'span-whole', path: 'src/gone.ts', start: 0, end: 0 });
  });
});

describe('isDebt — the debt invariant', () => {
  const neverDebt: readonly PorcelainStatus[] = ['FRESH', 'MOVED', 'RESOLVED_PENDING_COMMIT'];
  const alwaysDebt: readonly PorcelainStatus[] = PORCELAIN_STATUSES.filter(
    (s) => !(neverDebt as readonly string[]).includes(s)
  );

  it('never classifies FRESH, MOVED, or RESOLVED_PENDING_COMMIT as debt', () => {
    for (const status of neverDebt) {
      expect(isDebt(status)).toBe(false);
    }
  });

  it('classifies every remaining status — semantic drift and terminal/error states — as debt', () => {
    for (const status of alwaysDebt) {
      expect(isDebt(status)).toBe(true);
    }
  });

  it('covers the entire documented vocabulary with no status left unclassified', () => {
    expect(new Set([...neverDebt, ...alwaysDebt])).toEqual(new Set(PORCELAIN_STATUSES));
  });
});

describe('isEnvironmentalStatus — the fixable/unresolvable split within debt', () => {
  const environmental: readonly PorcelainStatus[] = [
    'CONFLICT',
    'SUBMODULE',
    'LFS_NOT_FETCHED',
    'LFS_NOT_INSTALLED',
    'PROMISOR_MISSING',
    'SPARSE_EXCLUDED',
    'FILTER_FAILED',
    'IO_ERROR'
  ];

  it('classifies exactly the terminal/environmental statuses', () => {
    for (const status of environmental) {
      expect(isEnvironmentalStatus(status)).toBe(true);
    }
  });

  it('never classifies FRESH/MOVED/RESOLVED_PENDING_COMMIT or the semantic-drift statuses as environmental', () => {
    for (const status of ['FRESH', 'MOVED', 'RESOLVED_PENDING_COMMIT', 'CHANGED', 'DELETED'] as PorcelainStatus[]) {
      expect(isEnvironmentalStatus(status)).toBe(false);
    }
  });

  it('every environmental status is also debt (a strict subset of isDebt)', () => {
    for (const status of environmental) {
      expect(isDebt(status)).toBe(true);
    }
  });
});
