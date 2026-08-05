/**
 * Acceptance checks for common/parse-response.ts (TDD bootstrap described in
 * plans/initial.md). Phase 1 declared `ResponseParseInput` and `parseResponse`
 * (plus the search/diff record types) as not-implemented stubs; this file
 * writes the contract's acceptance checks against those stubs so Phase 3's
 * implementation has a fixed target. Phase 3a implemented command gating,
 * scope restriction, and the search-layout decoders; Phase 3b the unified-diff
 * decoder; Phase 3c the `git blame -L` command-text matcher; Phase 3d the
 * hostile-output, ANSI-rejection, truncated-flag, and cut-everything
 * truncation checks — all enabled here. The evaluation-fix batch adds the
 * fixtures for every verified finding: unnumbered-content and digits-named
 * files never parsing as numbered, the rev:path exclusion, subdir-run diff
 * decoding, dash-pathed context windows, git-grep rev/pathspec shapes, the
 * pipeline attribution, the distinct-span cap, and the two-regime
 * truncated/interrupted contract. Only the adapter-envelope checks remain
 * `it.skip` for Phase 3e.
 *
 * The golden-matrix harness below builds the fixture store by executing the
 * REAL binaries — /usr/bin/rg (ripgrep 14.1.1), /usr/bin/grep (GNU grep
 * 3.11), and git (2.47.3), the versions pinned in
 * notes/response-envelope-shapes.md — via execFileSync in throwaway temp
 * repos (test/helpers.ts's makeTempRepo). The interactive shell wraps `grep`
 * in an ugrep function, so fixtures exec the real binary path by
 * construction. Each fixture is a sanitized (command, real stdout, expected
 * touch spans) triple; expected spans are derived by the independent oracle
 * helpers below (matching lines + context windows, or hand-pinned hunk
 * ranges), never from the parser itself.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedSpan } from '../../src/common/parse-command.js';
import { MAX_RESPONSE_SPANS, parseResponse, type ResponseParseInput } from '../../src/common/parse-response.js';
import { makeTempRepo } from '../helpers.js';

// ---------------------------------------------------------------------------
// Golden-matrix harness
// ---------------------------------------------------------------------------

/** The committed search-fixture tree every search layout runs against. */
const SEARCH_FILES: Record<string, string> = {
  'src/a.ts': 'alpha\nbeta\ngamma\nalpha beta\ndelta\nsigma\ncafé: with colon\n日本語\n',
  'src/b.ts': 'one\nalpha\ntwo\nalpha two\nthree\nsigma\n',
  // Matches at lines 3 and 7 — with -C 1 the tool emits two `--`-separated
  // windows ([2,4] and [6,8]) with a gap at line 5.
  'src/c.ts': 'zero\none\nalpha\nthree\nfour\nfive\nalpha\nsix\n',
  // Matches at lines 3 and 4 — overlapping windows the tool merges.
  'src/d.ts': 'zero\none\nalpha\nalpha\ntwo\nthree\n',
  'src/unicode.ts': 'café\nnaïve\n日本語テキスト\ncafé au lait\n',
  // A dash inside the path: `-C` context records are `path-line-text`, and
  // without anchoring to this exact path the window collapses to the bare
  // match line.
  'src/my-file.ts': 'zero\none\nalpha\nthree\n',
  // A pure-digits filename: a recursive `rg -n needle` run here emits
  // "9:1:needle" first — `path:line:text` for the file "9", never the
  // one-file layout (which would need an explicit file arg and would touch
  // the wrong position).
  'coll/9': 'needle\n',
  // Unnumbered single-file probes: digits in the CONTENT (a "123: TODO item"
  // matching line) or in the FILENAME (2024-log.txt under `rg -l`) are not
  // positions and must fall back to the whole-file read.
  'notes.md': 'TODO item\n123: TODO item\nend\n',
  '2024-log.txt': 'alpha\n'
};

interface ExpectedSpan {
  /** Repo-relative path. */
  path: string;
  lineStart: number;
  lineEnd: number;
}

interface GoldenFixture {
  name: string;
  /** The command line as an adapter would see it (binary name without its /usr/bin prefix). */
  command: string;
  /** Absolute cwd the real binary ran in. */
  cwd: string;
  /** Verbatim stdout captured from the real binary run. */
  stdout: string;
  /** Exit status of the real run — metadata only, never gates (git diff --exit-code is 1 on differences). */
  exitStatus: number;
  /** Expected read touches (repo-relative), derived by the independent oracle. */
  expected: ExpectedSpan[];
  /** File contents the fixture read from, keyed repo-relative — the oracle's inputs. */
  files: Record<string, string>;
}

interface RunResult {
  stdout: string;
  exitStatus: number;
}

interface GoldenMatrix {
  fixtures: GoldenFixture[];
  /** Throwaway git repos backing the diff fixtures (cleaned up by the suite). */
  repos: Array<{ root: string; cleanup: () => void }>;
}

// -- Oracle helpers: expected touches computed independently of the parser ---

/** 1-based lines of `content` whose text contains `pattern`. */
function matchingLines(content: string, pattern: string): number[] {
  const text = content.endsWith('\n') ? content.slice(0, -1) : content;
  return text
    .split('\n')
    .map((line, i) => (line.includes(pattern) ? i + 1 : 0))
    .filter((n) => n > 0);
}

/** 1-based line count of `content`. */
function lineCount(content: string): number {
  const text = content.endsWith('\n') ? content.slice(0, -1) : content;
  return text === '' ? 0 : text.split('\n').length;
}

/**
 * Merge hit lines' ±before/after context windows into contiguous
 * [start, end] ranges clamped to the file's line count. Windows that touch
 * or overlap merge — the plan's coalescing contract.
 */
function contextRanges(hits: number[], before: number, after: number, lines: number): Array<[number, number]> {
  if (hits.length === 0) return [];
  const windows = hits
    .sort((a, b) => a - b)
    .map((h) => [Math.max(1, h - before), Math.min(lines, h + after)] as [number, number]);
  const merged: Array<[number, number]> = [];
  let [start, end] = windows[0];
  for (const [s, e] of windows.slice(1)) {
    if (s <= end + 1) {
      end = Math.max(end, e);
    } else {
      merged.push([start, end]);
      [start, end] = [s, e];
    }
  }
  merged.push([start, end]);
  return merged;
}

/** Expected spans for a search over `scope` paths with per-hit before/after context. */
function searchExpected(
  files: Record<string, string>,
  scope: string[],
  pattern: string,
  before: number,
  after: number
): ExpectedSpan[] {
  const spans: ExpectedSpan[] = [];
  for (const path of scope) {
    const content = files[path];
    if (content === undefined) continue;
    for (const [start, end] of contextRanges(matchingLines(content, pattern), before, after, lineCount(content))) {
      spans.push({ path, lineStart: start, lineEnd: end });
    }
  }
  return spans;
}

/** Expected spans for a whole-file read of `path`. */
function wholeFileExpected(files: Record<string, string>, path: string): ExpectedSpan[] {
  const content = files[path];
  if (content === undefined) return [];
  return [{ path, lineStart: 1, lineEnd: lineCount(content) }];
}

// -- Real-binary runners ----------------------------------------------------

/**
 * Execute a real binary, capturing stdout and exit status without throwing
 * on non-zero exits. stdin is closed (['ignore']) so rg/grep never read it:
 * with execFileSync's default pipe stdin, an rg invocation with no path args
 * treats the pipe as its search input, sees EOF, and exits 1 — a fixture
 * must capture what the binary searches when run at a real terminal (the
 * directory), not what it reads from a closed pipe.
 */
function runCapture(bin: string, argv: string[], cwd: string): RunResult {
  try {
    return {
      stdout: execFileSync(bin, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      exitStatus: 0
    };
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : String(e.stdout ?? ''),
      exitStatus: e.status ?? -1
    };
  }
}

function runGit(cwd: string, argv: string[]): RunResult {
  return runCapture('git', argv, cwd);
}

function gitConfig(root: string): void {
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root, stdio: 'ignore' });
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root, stdio: 'ignore' });
}

/** A throwaway git repo for one diff fixture, configured for commits. */
function makeGitRepo(): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  gitConfig(repo.root);
  return repo;
}

function searchFixture(
  name: string,
  command: string,
  bin: string,
  argv: string[],
  cwd: string,
  expected: ExpectedSpan[]
): GoldenFixture {
  const { stdout, exitStatus } = runCapture(bin, argv, cwd);
  return { name, command, cwd, stdout, exitStatus, expected, files: SEARCH_FILES };
}

function diffFixture(
  name: string,
  command: string,
  argv: string[],
  root: string,
  files: Record<string, string>,
  expected: ExpectedSpan[]
): GoldenFixture {
  const { stdout, exitStatus } = runGit(root, argv);
  return { name, command, cwd: root, stdout, exitStatus, expected, files };
}

// -- Matrix builder ---------------------------------------------------------

function buildGoldenMatrix(root: string): GoldenMatrix {
  const fixtures: GoldenFixture[] = [];
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  const allFiles = Object.keys(SEARCH_FILES);
  // Commands that take a `src` path arg only ever emit src/ records; the
  // tree also holds top-level files (notes.md, 2024-log.txt, coll/9) that a
  // whole-repo search would see but a `src`-scoped one must not expect.
  const srcFiles = allFiles.filter((p) => p.startsWith('src/'));
  // `git grep -n alpha` with no path args searches the whole committed tree,
  // so its expected spans cover every file that contains alpha — including
  // the top-level 2024-log.txt.
  const recursive = searchExpected(SEARCH_FILES, srcFiles, 'alpha', 0, 0);
  fixtures.push(
    searchFixture('rg-recursive', 'rg -n alpha src', '/usr/bin/rg', ['-n', 'alpha', 'src'], root, recursive)
  );
  fixtures.push(
    searchFixture('grep-recursive', 'grep -rn alpha src', '/usr/bin/grep', ['-rn', 'alpha', 'src'], root, recursive)
  );
  fixtures.push(
    searchFixture(
      'git-grep-recursive',
      'git grep -n alpha',
      'git',
      ['grep', '-n', 'alpha'],
      root,
      searchExpected(SEARCH_FILES, allFiles, 'alpha', 0, 0)
    )
  );

  fixtures.push(
    searchFixture(
      'rg-heading',
      'rg -n --heading alpha src',
      '/usr/bin/rg',
      ['-n', '--heading', 'alpha', 'src'],
      root,
      recursive
    )
  );

  fixtures.push(
    searchFixture(
      'rg-context-c1',
      'rg -n -C 1 alpha src/c.ts src/d.ts',
      '/usr/bin/rg',
      ['-n', '-C', '1', 'alpha', 'src/c.ts', 'src/d.ts'],
      root,
      searchExpected(SEARCH_FILES, ['src/c.ts', 'src/d.ts'], 'alpha', 1, 1)
    )
  );

  fixtures.push(
    searchFixture(
      'rg-context-ab',
      'rg -n -A 1 -B 2 alpha src',
      '/usr/bin/rg',
      ['-n', '-A', '1', '-B', '2', 'alpha', 'src'],
      root,
      searchExpected(SEARCH_FILES, srcFiles, 'alpha', 2, 1)
    )
  );

  // grep -z: each matching file arrives as one NUL-terminated `path:1:…`
  // record holding the entire file content — the only well-defined touch is
  // the whole file.
  fixtures.push(
    searchFixture(
      'grep-null-z',
      'grep -rnz alpha src',
      '/usr/bin/grep',
      ['-rnz', 'alpha', 'src'],
      root,
      srcFiles
        .filter((path) => SEARCH_FILES[path].includes('alpha'))
        .flatMap((path) => wholeFileExpected(SEARCH_FILES, path))
    )
  );

  fixtures.push(
    searchFixture(
      'rg-one-file',
      'rg -n alpha src/a.ts',
      '/usr/bin/rg',
      ['-n', 'alpha', 'src/a.ts'],
      root,
      searchExpected(SEARCH_FILES, ['src/a.ts'], 'alpha', 0, 0)
    )
  );

  // Unnumbered output must never parse as numbered: `grep` without -n prints
  // bare matching lines, and a content line that merely LOOKS numbered
  // ("123: TODO item") is content, not a position. `rg -l` prints file names
  // only — a digits-leading name is a file, not a line. Both restore the
  // contract-mandated whole-file fallback instead of inventing a position.
  fixtures.push(
    searchFixture(
      'grep-unnumbered-digits-content',
      'grep TODO notes.md',
      '/usr/bin/grep',
      ['TODO', 'notes.md'],
      root,
      wholeFileExpected(SEARCH_FILES, 'notes.md')
    )
  );
  fixtures.push(
    searchFixture(
      'rg-list-digits-filename',
      'rg -l alpha 2024-log.txt',
      '/usr/bin/rg',
      ['-l', 'alpha', '2024-log.txt'],
      root,
      wholeFileExpected(SEARCH_FILES, '2024-log.txt')
    )
  );

  // A dash inside the path: context records are `path-line-text`, so the
  // response's own match records must anchor them or the -C window on
  // my-file.ts collapses to the bare match line. The sibling d.ts (dash-free)
  // rides along to prove both shapes decode in one response.
  fixtures.push(
    searchFixture(
      'rg-context-dash-path',
      'rg -n -C 1 alpha src/my-file.ts src/d.ts',
      '/usr/bin/rg',
      ['-n', '-C', '1', 'alpha', 'src/my-file.ts', 'src/d.ts'],
      root,
      searchExpected(SEARCH_FILES, ['src/my-file.ts', 'src/d.ts'], 'alpha', 1, 1)
    )
  );

  // A pure-digits filename emitted first ("9:1:needle") must not collapse a
  // recursive search to the one-file layout — with no explicit file arg (and
  // a directory arg below, which is not a file) the recursive reading wins.
  {
    const { stdout, exitStatus } = runCapture('/usr/bin/rg', ['-n', 'needle'], join(root, 'coll'));
    fixtures.push({
      name: 'rg-digits-named-file',
      command: 'cd coll && rg -n needle',
      cwd: root,
      stdout,
      exitStatus,
      expected: [{ path: 'coll/9', lineStart: 1, lineEnd: 1 }],
      files: SEARCH_FILES
    });
  }

  // `git grep <rev>` fuses the rev into the record path ("HEAD:src/a.ts:…");
  // those records drop as path-ambiguous — fail-closed and defensible, so
  // the fixture pins the documented behavior (no touches, no fallback).
  fixtures.push(
    searchFixture('git-grep-rev-arg', 'git grep -n alpha HEAD', 'git', ['grep', '-n', 'alpha', 'HEAD'], root, [])
  );

  // Git pathspec magic (`:/`) is not a filesystem path — it must never
  // become a permitted root (a literal `cwd/:/` would reject every decoded
  // record). Dropped, roots fall back to the effective cwd and the records
  // (cwd-relative, as git grep emits them from a subdir) resolve normally.
  {
    const ps = runGit(join(root, 'src'), ['grep', '-n', 'alpha', '--', ':/']);
    // `:/` is the repo-top pathspec, so the search covers the whole tree; the
    // parser must never treat the magic token as a permitted root (a literal
    // `cwd/:/` would reject every record). From a subdir git grep emits
    // cwd-relative paths; the out-of-tree `../2024-log.txt` record is dropped
    // by scope restriction and the src/ records decode normally.
    const psExpected = searchExpected(SEARCH_FILES, srcFiles, 'alpha', 0, 0).map((s) => ({
      path: s.path.slice('src/'.length),
      lineStart: s.lineStart,
      lineEnd: s.lineEnd
    }));
    fixtures.push({
      name: 'git-grep-pathspec-top',
      command: 'git grep -n alpha -- :/',
      cwd: join(root, 'src'),
      stdout: ps.stdout,
      exitStatus: ps.exitStatus,
      expected: psExpected,
      files: SEARCH_FILES
    });
  }

  // Whole-file no-line-number fallback: bare matching lines, no numbers.
  fixtures.push(
    searchFixture(
      'grep-fallback',
      'grep alpha src/a.ts',
      '/usr/bin/grep',
      ['alpha', 'src/a.ts'],
      root,
      wholeFileExpected(SEARCH_FILES, 'src/a.ts')
    )
  );
  // Two explicit files: records cannot be attributed — fallback stays unresolved.
  fixtures.push(
    searchFixture(
      'grep-fallback-multi',
      'grep alpha src/a.ts src/b.ts',
      '/usr/bin/grep',
      ['alpha', 'src/a.ts', 'src/b.ts'],
      root,
      []
    )
  );

  // Unified-diff layouts — one throwaway git repo per fixture.
  {
    const repo = makeGitRepo();
    repos.push(repo);
    const base = { 'a.txt': 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n' };
    writeFiles(repo.root, base);
    commitAll(repo.root, 'base');
    const modified = { 'a.txt': 'line1\nline2\nCHANGED\nline4\nline5\nline6\nNEW\nline8\n' };
    writeFiles(repo.root, modified);
    fixtures.push(
      diffFixture('git-diff-basic', 'git diff --no-color -U1', ['diff', '--no-color', '-U1'], repo.root, modified, [
        { path: 'a.txt', lineStart: 2, lineEnd: 4 },
        { path: 'a.txt', lineStart: 6, lineEnd: 8 }
      ])
    );
    commitAll(repo.root, 'change');
    fixtures.push(
      diffFixture(
        'git-show-diff',
        'git show --format= --no-ext-diff --no-color -U1 HEAD',
        ['show', '--format=', '--no-ext-diff', '--no-color', '-U1', 'HEAD'],
        repo.root,
        modified,
        [
          { path: 'a.txt', lineStart: 2, lineEnd: 4 },
          { path: 'a.txt', lineStart: 6, lineEnd: 8 }
        ]
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    const base = { 'ps.txt': 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n' };
    writeFiles(repo.root, base);
    commitAll(repo.root, 'base');
    const modified = { 'ps.txt': 'l1\nl2\nl3\nl4\nINS1\nINS2\nCHANGED\nl6\nl7\nl8\n' };
    writeFiles(repo.root, modified);
    fixtures.push(
      diffFixture('git-diff-per-side', 'git diff --no-color -U2', ['diff', '--no-color', '-U2'], repo.root, modified, [
        { path: 'ps.txt', lineStart: 3, lineEnd: 9 }
      ])
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    const files = { 'old1.txt': 'l1\nl2\nl3\n', 'old2.txt': 'x1\nx2\nx3\n' };
    writeFiles(repo.root, files);
    commitAll(repo.root, 'base');
    execFileSync('git', ['mv', 'old1.txt', 'new1.txt'], { cwd: repo.root });
    writeFileSync(join(repo.root, 'new1.txt'), 'l1\nl2\nl3\nl4\n');
    execFileSync('git', ['mv', 'old2.txt', 'new2.txt'], { cwd: repo.root });
    execFileSync('git', ['add', '-A'], { cwd: repo.root });
    fixtures.push(
      diffFixture(
        'git-diff-rename',
        'git diff --cached --no-color -M',
        ['diff', '--cached', '--no-color', '-M'],
        repo.root,
        { 'new1.txt': 'l1\nl2\nl3\nl4\n', 'new2.txt': 'x1\nx2\nx3\n' },
        // The 75% rename (old1.txt → new1.txt) carries the only hunk; the
        // 100% rename (old2.txt → new2.txt) has no hunks and no ranges.
        [{ path: 'new1.txt', lineStart: 1, lineEnd: 4 }]
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    writeFiles(repo.root, { 'src.txt': 'l1\nl2\nl3\nl4\n' });
    commitAll(repo.root, 'base');
    writeFileSync(join(repo.root, 'copy1.txt'), 'l1\nCHANGED\nl3\nl4\n');
    writeFileSync(join(repo.root, 'copy2.txt'), 'l1\nl2\nl3\nl4\n');
    execFileSync('git', ['add', '-A'], { cwd: repo.root });
    fixtures.push(
      diffFixture(
        'git-diff-copy',
        'git diff --cached --no-color -C -C',
        ['diff', '--cached', '--no-color', '-C', '-C'],
        repo.root,
        { 'copy1.txt': 'l1\nCHANGED\nl3\nl4\n', 'copy2.txt': 'l1\nl2\nl3\nl4\n' },
        // The 100% copy (copy2.txt) has no hunks and no ranges.
        [{ path: 'copy1.txt', lineStart: 1, lineEnd: 4 }]
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    writeFiles(repo.root, { 'base.txt': 'x\n' });
    commitAll(repo.root, 'base');
    const files = { 'new.txt': 'n1\nn2\nn3\n' };
    writeFiles(repo.root, files);
    execFileSync('git', ['add', 'new.txt'], { cwd: repo.root });
    fixtures.push(
      diffFixture(
        'git-diff-new',
        'git diff --cached --no-color',
        ['diff', '--cached', '--no-color'],
        repo.root,
        files,
        [{ path: 'new.txt', lineStart: 1, lineEnd: 3 }]
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    const files = { 'gone.txt': 'g1\ng2\ng3\ng4\ng5\n' };
    writeFiles(repo.root, files);
    commitAll(repo.root, 'base');
    execFileSync('git', ['rm', '-q', 'gone.txt'], { cwd: repo.root });
    fixtures.push(
      diffFixture(
        'git-diff-delete',
        'git diff --cached --no-color',
        ['diff', '--cached', '--no-color'],
        repo.root,
        files,
        [{ path: 'gone.txt', lineStart: 1, lineEnd: 5 }]
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    writeFileSync(join(repo.root, 'img.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    commitAll(repo.root, 'base');
    writeFileSync(join(repo.root, 'img.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xfd, 0x00]));
    fixtures.push(diffFixture('git-diff-binary', 'git diff --no-color', ['diff', '--no-color'], repo.root, {}, []));
  }

  {
    // A real merge conflict leaves the worktree/index in the state
    // `git diff -c` reports as a combined diff.
    const repo = makeGitRepo();
    repos.push(repo);
    writeFiles(repo.root, { 'm.txt': 'base\n' });
    commitAll(repo.root, 'base');
    const baseBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repo.root,
      encoding: 'utf8'
    }).trim();
    execFileSync('git', ['checkout', '-q', '-b', 'topic'], { cwd: repo.root });
    writeFileSync(join(repo.root, 'm.txt'), 'topic\n');
    commitAll(repo.root, 'topic');
    execFileSync('git', ['checkout', '-q', baseBranch], { cwd: repo.root });
    writeFileSync(join(repo.root, 'm.txt'), 'main\n');
    commitAll(repo.root, 'main-side');
    runGit(repo.root, ['merge', 'topic']); // expected to conflict (exit 1)
    fixtures.push(
      diffFixture('git-diff-combined', 'git diff -c --no-color', ['diff', '-c', '--no-color'], repo.root, {}, [])
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    writeFiles(repo.root, { 'base.txt': 'x\n' });
    commitAll(repo.root, 'base');
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.root, encoding: 'utf8' }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${headSha},sub`], { cwd: repo.root });
    fixtures.push(
      diffFixture(
        'git-diff-submodule',
        'git diff --cached --no-color',
        ['diff', '--cached', '--no-color'],
        repo.root,
        {},
        []
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    const files = { 'blame.txt': 'b1\nb2\nb3\nb4\nb5\nb6\n' };
    writeFiles(repo.root, files);
    commitAll(repo.root, 'base');
    fixtures.push(
      diffFixture(
        'git-blame-l-range',
        'git blame -L 2,4 blame.txt',
        ['blame', '-L', '2,4', 'blame.txt'],
        repo.root,
        files,
        [{ path: 'blame.txt', lineStart: 2, lineEnd: 4 }]
      )
    );
  }

  // Diffs run from below the worktree root: git emits repo-root-relative
  // paths (`diff --git a/sub/a.txt`), so the decoder must anchor to the
  // discovered worktree root, never the subdir cwd — otherwise
  // `<subdir>/sub/a.txt` resolves to nothing and every span is lost. Both
  // the `cd` form and the `git -C` form must decode.
  {
    const repo = makeGitRepo();
    repos.push(repo);
    const base = { 'sub/a.txt': 'l1\nl2\nl3\nl4\nl5\nl6\n' };
    writeFiles(repo.root, base);
    commitAll(repo.root, 'base');
    const modified = { 'sub/a.txt': 'l1\nl2\nCHANGED\nl4\nl5\nl6\n' };
    writeFiles(repo.root, modified);
    fixtures.push(
      diffFixture(
        'git-diff-cd-subdir',
        'cd sub && git diff --no-color -U1',
        ['diff', '--no-color', '-U1'],
        repo.root,
        modified,
        [{ path: 'sub/a.txt', lineStart: 2, lineEnd: 4 }]
      )
    );
    fixtures.push(
      diffFixture(
        'git-diff-C-subdir',
        'git -C sub diff --no-color -U1',
        ['-C', 'sub', 'diff', '--no-color', '-U1'],
        repo.root,
        modified,
        [{ path: 'sub/a.txt', lineStart: 2, lineEnd: 4 }]
      )
    );
  }

  // `git show <rev>:<path>` streams the blob's RAW content. A diff-shaped
  // blob (a vendored .patch) must not decode into fabricated touches on the
  // files its content names — the content idiom is excluded from the diff
  // gate, with and without --stat.
  {
    const repo = makeGitRepo();
    repos.push(repo);
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ' alpha',
      '+beta',
      ''
    ].join('\n');
    writeFiles(repo.root, { 'patches/example2.patch': patch, 'src/a.ts': 'alpha\n' });
    commitAll(repo.root, 'base');
    fixtures.push(
      diffFixture(
        'git-show-revpath',
        'git show HEAD:patches/example2.patch',
        ['show', 'HEAD:patches/example2.patch'],
        repo.root,
        {},
        []
      )
    );
    fixtures.push(
      diffFixture(
        'git-show-revpath-stat',
        'git show --stat HEAD:patches/example2.patch',
        ['show', '--stat', 'HEAD:patches/example2.patch'],
        repo.root,
        {},
        []
      )
    );
  }

  return { fixtures, repos };
}

// ---------------------------------------------------------------------------
// Test helpers over the matrix
// ---------------------------------------------------------------------------

/** Resolve a fixture's repo-relative expected spans against its absolute cwd. */
function resolveExpected(fixture: GoldenFixture): ResolvedSpan[] {
  return fixture.expected.map((e) => ({
    lineStart: e.lineStart,
    lineEnd: e.lineEnd,
    absolutePath: join(fixture.cwd, e.path)
  }));
}

/** Order-independent span comparison (rg/grep emit files in nondeterministic order). */
function sortedSpans(spans: ResolvedSpan[]): ResolvedSpan[] {
  return [...spans].sort(
    (a, b) => a.absolutePath.localeCompare(b.absolutePath) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd
  );
}

/** Drive the stub parser with a fixture's command/cwd/stdout/exitStatus. */
function parseFixture(f: GoldenFixture, overrides: Partial<ResponseParseInput> = {}): ResolvedSpan[] {
  return parseResponse({ command: f.command, cwd: f.cwd, stdout: f.stdout, exitStatus: f.exitStatus, ...overrides });
}

/**
 * The byte offsets to cut a fixture's stdout at: 0, the full length, every
 * record boundary (the byte just past each newline — and each NUL, since
 * null-separated records terminate on NUL), and the midpoint of every line
 * (which lands inside headers, hunk headers, and record text alike).
 */
function cutOffsets(stdout: string): number[] {
  const offsets = new Set<number>([0, stdout.length]);
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] === '\n' || stdout[i] === '\0') offsets.add(i + 1);
  }
  let lineStart = 0;
  for (let i = 0; i <= stdout.length; i++) {
    if (i === stdout.length || stdout[i] === '\n') {
      offsets.add(lineStart + Math.floor((i - lineStart) / 2));
      lineStart = i + 1;
    }
  }
  return [...offsets].sort((a, b) => a - b);
}

/**
 * Whether every span of a cut parse is covered by a span of the full parse on
 * the same path: a cut only ever removes records, so its coalesced spans can
 * be narrower than the full parse's (the first record of a window whose full
 * span also merges an adjacent line) — but it must never touch a line the
 * full parse didn't touch.
 */
function isSpanSubset(parsed: ResolvedSpan[], full: ResolvedSpan[]): boolean {
  return parsed.every((p) =>
    full.some((s) => s.absolutePath === p.absolutePath && p.lineStart >= s.lineStart && p.lineEnd <= s.lineEnd)
  );
}

/**
 * Stand-in for the adapters' Phase 3e envelope normalization
 * (notes/response-envelope-shapes.md): every documented tool_response shape —
 * bare string, current Claude object, legacy object, text-block array —
 * reduces to the same normalized stdout.
 */
function normalizeEnvelope(envelope: unknown): Pick<ResponseParseInput, 'stdout'> {
  if (typeof envelope === 'string') return { stdout: envelope };
  if (Array.isArray(envelope)) {
    return {
      stdout: envelope
        .filter((b): b is { type?: string; text?: string } => typeof b === 'object' && b !== null && 'text' in b)
        .map((b) => b.text ?? '')
        .join('')
    };
  }
  if (typeof envelope === 'object' && envelope !== null) {
    const obj = envelope as Record<string, unknown>;
    const probe = obj.stdout ?? obj.output ?? obj.content ?? obj.text;
    return { stdout: typeof probe === 'string' ? probe : '' };
  }
  return { stdout: '' };
}

// ---------------------------------------------------------------------------
// Skipped acceptance checks
// ---------------------------------------------------------------------------

describe('parse-response (Phase 3a–3c — search layouts, unified diffs, and blame active)', () => {
  let mainRepo: { root: string; cleanup: () => void } | undefined;
  let root: string;
  let fixtures: Map<string, GoldenFixture>;
  let diffRepos: Array<{ root: string; cleanup: () => void }> = [];

  beforeAll(() => {
    mainRepo = makeTempRepo();
    gitConfig(mainRepo.root);
    writeFiles(mainRepo.root, SEARCH_FILES);
    commitAll(mainRepo.root, 'search fixtures'); // also makes `git grep` work
    root = mainRepo.root;
    const matrix = buildGoldenMatrix(root);
    fixtures = new Map(matrix.fixtures.map((f) => [f.name, f]));
    diffRepos = matrix.repos;
  });

  afterAll(() => {
    for (const repo of diffRepos) repo.cleanup();
    mainRepo?.cleanup();
  });

  function fixture(name: string): GoldenFixture {
    const f = fixtures.get(name);
    if (!f) throw new Error(`missing golden fixture: ${name}`);
    return f;
  }

  // -------------------------------------------------------------------------
  // Command gating (plan step 1)
  // -------------------------------------------------------------------------

  describe('command gating', () => {
    it('non-derivable commands never misparse path:line-looking output', () => {
      const f = fixture('rg-recursive');
      // The same rg-shaped stdout under commands the parser must not
      // response-decode — a bare `ls`/`cat`/`echo` whose output happens to
      // look like `path:line:text` must not be misparsed.
      expect(parseFixture(f, { command: 'ls -la src' })).toEqual([]);
      expect(parseFixture(f, { command: 'cat src/a.ts' })).toEqual([]);
      expect(parseFixture(f, { command: 'echo src/a.ts:1:alpha' })).toEqual([]);
      // `git log` without -p is not diff-form — response parsing is additive.
      expect(parseFixture(f, { command: 'git log --oneline' })).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Search layouts (plan step 3)
  // -------------------------------------------------------------------------

  describe('search layouts', () => {
    it('recursive path:line:text — rg, grep, and git grep decode identically', () => {
      for (const name of ['rg-recursive', 'grep-recursive', 'git-grep-recursive']) {
        const f = fixture(name);
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });

    it('context path-line-text groups (-C): per-file windows, `--` separators', () => {
      const f = fixture('rg-context-c1');
      // c.ts emits two `--`-separated windows [2,4] and [6,8] (matches at 3
      // and 7); d.ts one merged window [2,5].
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });

    it('asymmetric -A/-B windows merge per file', () => {
      const f = fixture('rg-context-ab');
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });

    it('--heading: file header lines followed by line:text records', () => {
      const f = fixture('rg-heading');
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });

    it('null-separated (-z): NUL-terminated per-file records decode to whole-file reads', () => {
      const f = fixture('grep-null-z');
      // Every record is `path:1:…` holding the entire file content, so the
      // only well-defined touch is the whole file.
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });

    it('one-file output: bare line:text records attribute to the single explicit file', () => {
      const f = fixture('rg-one-file');
      const spans = sortedSpans(parseFixture(f));
      expect(spans).toEqual(sortedSpans(resolveExpected(f)));
      expect(spans.every((s) => s.absolutePath === join(f.cwd, 'src/a.ts'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Whole-file no-line-number fallback (plan step 3)
  // -------------------------------------------------------------------------

  describe('whole-file no-line-number fallback', () => {
    it('fires only for exactly one explicit file with no parseable numbered record', () => {
      // `grep` without -n prints bare matching lines — no line numbers at
      // all — so the only well-defined touch for the single explicit file
      // is the whole file.
      const single = fixture('grep-fallback');
      expect(sortedSpans(parseFixture(single))).toEqual(sortedSpans(resolveExpected(single)));
      // Two explicit files: no record can be attributed to a specific file —
      // the fallback stays unresolved and no touch is invented.
      const multi = fixture('grep-fallback-multi');
      expect(parseFixture(multi)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Coalescing (plan step 3)
  // -------------------------------------------------------------------------

  describe('coalescing', () => {
    it('adjacent/overlapping derived ranges merge into one span; duplicates never create duplicate surfaces', () => {
      const f = fixture('rg-context-c1');
      const spans = parseFixture(f);
      expect(sortedSpans(spans)).toEqual(sortedSpans(resolveExpected(f)));
      // Re-inject a record for line 4 — already covered by c.ts's first
      // window — and a duplicate of the d.ts overlap region: no new surface
      // may appear.
      const dup = parseResponse({
        command: f.command,
        cwd: f.cwd,
        stdout: `${f.stdout}src/c.ts:4:three\nsrc/d.ts:3:alpha\n`,
        exitStatus: f.exitStatus
      });
      expect(sortedSpans(dup)).toEqual(sortedSpans(resolveExpected(f)));
    });
  });

  // -------------------------------------------------------------------------
  // Scope restriction (plan step 2)
  // -------------------------------------------------------------------------

  describe('scope restriction', () => {
    it('decoded paths outside the command-declared roots are rejected', () => {
      const f = fixture('rg-recursive');
      // The command declares `src` as its only search root; a `../` sibling
      // record and an absolute path sit outside it and must not touch.
      const hostile = `${f.stdout}../outside.txt:9:injected\n/etc/passwd:1:root:x\n`;
      const spans = parseResponse({ command: f.command, cwd: f.cwd, stdout: hostile, exitStatus: f.exitStatus });
      expect(sortedSpans(spans)).toEqual(sortedSpans(resolveExpected(f)));
    });
  });

  // -------------------------------------------------------------------------
  // Unified-diff decoder (plan step 4)
  // -------------------------------------------------------------------------

  describe('unified-diff decode', () => {
    it('decodes diff --git / --- / +++ / @@ hunks into per-file read ranges', () => {
      // The same change through `git diff` and `git show --format=` must
      // decode to the same ranges.
      for (const name of ['git-diff-basic', 'git-show-diff']) {
        const f = fixture(name);
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });

    it('exit status is metadata only — a diff that exits 1 parses identically', () => {
      const f = fixture('git-diff-basic');
      expect(sortedSpans(parseResponse({ command: f.command, cwd: f.cwd, stdout: f.stdout, exitStatus: 1 }))).toEqual(
        sortedSpans(resolveExpected(f))
      );
    });

    it('new files (/dev/null old side) and deletions (/dev/null new side) emit the live side only', () => {
      const nf = fixture('git-diff-new');
      expect(sortedSpans(parseFixture(nf))).toEqual(sortedSpans(resolveExpected(nf)));
      const df = fixture('git-diff-delete');
      expect(sortedSpans(parseFixture(df))).toEqual(sortedSpans(resolveExpected(df)));
    });

    it('rename/copy: the new path is the touch target; hunks-less renames and copies emit nothing', () => {
      const rf = fixture('git-diff-rename');
      expect(sortedSpans(parseFixture(rf))).toEqual(sortedSpans(resolveExpected(rf)));
      const cf = fixture('git-diff-copy');
      expect(sortedSpans(parseFixture(cf))).toEqual(sortedSpans(resolveExpected(cf)));
    });

    it('per-side hunk ranges (old a,b vs new c,d) merge into one span per file', () => {
      const f = fixture('git-diff-per-side');
      // The hunk is `@@ -3,5 +3,7 @@`: the old side covers 3..7, the new
      // side 3..9 — the merged span must be the union 3..9.
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });

    it('a cut-off @@ header drops its hunk', () => {
      // A cut-off `@@` header (missing the closing `@@`) is unparseable and
      // its hunk is ignored — only the first hunk's range survives.
      const d = fixture('git-diff-basic');
      const cutHeader = d.stdout.slice(0, d.stdout.indexOf('@@ -6') + 4);
      expect(sortedSpans(parseResponse({ command: d.command, cwd: d.cwd, stdout: cutHeader }))).toEqual([
        { lineStart: 2, lineEnd: 4, absolutePath: join(d.cwd, 'a.txt') }
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Binary, combined, and submodule diffs (plan step 4)
  // -------------------------------------------------------------------------

  describe('binary, combined, and submodule diffs', () => {
    it('binary markers, combined-diff (@@@) headers, and subproject lines produce no ranges', () => {
      for (const name of ['git-diff-binary', 'git-diff-combined', 'git-diff-submodule']) {
        const f = fixture(name);
        // The outputs are real and non-empty — the decoder must actively
        // refuse each marker rather than finding nothing to parse.
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // git blame -L (plan step 5)
  // -------------------------------------------------------------------------

  describe('git blame -L command-text range', () => {
    it('recognizes an exact literal -L N,M range from the command text', () => {
      const f = fixture('git-blame-l-range');
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });
  });

  // -------------------------------------------------------------------------
  // Truncation, fail-closed (plan step 6)
  // -------------------------------------------------------------------------

  describe('truncation, fail-closed', () => {
    it('a record whose terminating newline is absent is dropped', () => {
      const s = fixture('rg-recursive');
      const full = s.stdout;
      // rg emits files in a nondeterministic order, so derive the final
      // record — the one the cuts below target — from the captured stdout
      // itself rather than assuming a file name.
      const lastLine = full.trimEnd().split('\n').at(-1) ?? '';
      const m = /^([^:]+):(\d+):/.exec(lastLine);
      expect(m).not.toBeNull();
      const finalSpan: ResolvedSpan = {
        absolutePath: join(s.cwd, m?.[1] ?? ''),
        lineStart: Number.parseInt(m?.[2] ?? '0', 10),
        lineEnd: Number.parseInt(m?.[2] ?? '0', 10)
      };
      // Dropping the final record removes exactly its line from its file's
      // spans. The oracle's coalesced spans do not map one-to-one to output
      // records — adjacent matches in one file merge (src/d.ts's lines 3
      // and 4 are a single span), so subtracting the whole span that holds
      // the final line would also drop its neighbor's match. Split the
      // containing span around the removed line instead.
      const expectedWithoutFinal = sortedSpans(
        resolveExpected(s).flatMap((sp) => {
          if (sp.absolutePath !== finalSpan.absolutePath) return [sp];
          if (finalSpan.lineStart < sp.lineStart || finalSpan.lineStart > sp.lineEnd) return [sp];
          const spans: ResolvedSpan[] = [];
          if (finalSpan.lineStart > sp.lineStart) {
            spans.push({ lineStart: sp.lineStart, lineEnd: finalSpan.lineStart - 1, absolutePath: sp.absolutePath });
          }
          if (finalSpan.lineStart < sp.lineEnd) {
            spans.push({ lineStart: finalSpan.lineStart + 1, lineEnd: sp.lineEnd, absolutePath: sp.absolutePath });
          }
          return spans;
        })
      );
      // Every real record ends with a newline; slicing it off leaves the
      // final record unterminated — its match must not touch.
      expect(sortedSpans(parseResponse({ command: s.command, cwd: s.cwd, stdout: full.slice(0, -1) }))).toEqual(
        expectedWithoutFinal
      );
      // A cut into the middle of the final record's text drops it too.
      const midFinalRecord = full.slice(0, full.lastIndexOf(lastLine) + lastLine.indexOf(':') + 1);
      expect(sortedSpans(parseResponse({ command: s.command, cwd: s.cwd, stdout: midFinalRecord }))).toEqual(
        expectedWithoutFinal
      );
    });

    it('truncated (rawOutputPath preview) fails closed; interrupted parses complete records', () => {
      // Plan step 6's two regimes are distinct signals. `truncated` (the
      // adapter's rawOutputPath marker: inline stdout is only a preview) is
      // strict mode — nothing is parsed, not even fully-terminated records.
      const f = fixture('rg-recursive');
      expect(parseResponse({ command: f.command, cwd: f.cwd, stdout: f.stdout, truncated: true })).toEqual([]);
      // `interrupted` is the complete-records regime: an interrupted stream
      // whose stdout holds fully-terminated records must produce spans, not
      // []. The unconditional terminating-newline rule drops the incomplete
      // tail, so the flag's output equals the default path's.
      expect(
        sortedSpans(parseResponse({ command: f.command, cwd: f.cwd, stdout: f.stdout, interrupted: true }))
      ).toEqual(sortedSpans(resolveExpected(f)));
      const cut = f.stdout.slice(0, -1);
      expect(parseResponse({ command: f.command, cwd: f.cwd, stdout: cut, interrupted: true })).toEqual(
        parseResponse({ command: f.command, cwd: f.cwd, stdout: cut })
      );
    });

    it('the truncated gate never suppresses the command-text-derived blame matcher', () => {
      // `git blame -L N,M file` evidence is the command text, not the
      // response — a rawOutputPath preview of a blame run must not suppress
      // the command-derived span.
      const f = fixture('git-blame-l-range');
      expect(parseResponse({ command: f.command, cwd: f.cwd, stdout: f.stdout, truncated: true })).toEqual(
        sortedSpans(resolveExpected(f))
      );
    });

    it('cutting every golden output at byte offsets never lets an incomplete record touch', () => {
      // The universal truncation rule (plan step 6): a record is fully
      // observed only when its terminating newline is present, so every cut
      // of a stream either drops whole records or leaves a partial final
      // record — it may only remove spans, never add one. Cuts land at
      // record boundaries and mid-record (mid-header, mid-hunk, mid-line)
      // alike, across every layout the matrix covers.
      for (const f of fixtures.values()) {
        const full = sortedSpans(parseFixture(f));
        for (const offset of cutOffsets(f.stdout)) {
          const cut = sortedSpans(
            parseResponse({
              command: f.command,
              cwd: f.cwd,
              stdout: f.stdout.slice(0, offset),
              exitStatus: f.exitStatus
            })
          );
          expect(isSpanSubset(cut, full), `${f.name}: cut at byte ${offset}`).toBe(true);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Hostile outputs, fail-closed (plan steps 2 and 6)
  // -------------------------------------------------------------------------

  describe('hostile outputs, fail-closed', () => {
    it('ANSI escape bytes anywhere in the response reject the whole parse', () => {
      const f = fixture('rg-recursive');
      // Neither rg nor git emit color when piped, so an ESC byte means
      // something deliberate is going on — fail closed, invent no touches.
      expect(parseResponse({ command: f.command, cwd: f.cwd, stdout: `[31m${f.stdout}` })).toEqual([]);
    });

    it('traversal records and colon-containing paths are dropped as path-ambiguous', () => {
      const f = fixture('rg-recursive');
      // A traversal path normalizes outside the declared root and is rejected
      // by the containment check; a path containing a colon can't be split
      // into path:line:text unambiguously and is dropped as path-ambiguous.
      const hostile = `${f.stdout}../../../../etc/passwd:1:root:x\nsrc/weird:name.ts:3:alpha\n`;
      expect(sortedSpans(parseResponse({ command: f.command, cwd: f.cwd, stdout: hostile }))).toEqual(
        sortedSpans(resolveExpected(f))
      );
    });
  });

  // -------------------------------------------------------------------------
  // Evaluation fixes: unnumbered output, digits-named files, dash-pathed
  // context windows, git-grep rev/pathspec shapes, rev:path exclusion,
  // subdir-run diffs, pipelines, and the span cap
  // -------------------------------------------------------------------------

  describe('unnumbered output never parses as numbered', () => {
    it('content or filenames that merely look numbered fall back to the whole-file read', () => {
      // (a) `grep TODO notes.md` without -n: the matching line "123: TODO
      // item" is CONTENT — the parser must not touch line 123 of a 3-line
      // file. (b) `rg -l alpha 2024-log.txt`: the output is the digits-named
      // FILE, not a line number. Both restore the contract-mandated
      // whole-file fallback (the probes previously suppressed it by parsing
      // as numbered).
      for (const name of ['grep-unnumbered-digits-content', 'rg-list-digits-filename']) {
        const f = fixture(name);
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });
  });

  describe('digits-named files and the one-file layout', () => {
    it('a digits-named file emitted first never collapses a recursive search to one-file', () => {
      // "9:1:needle" is `path:line:text` for the file "9" — with no explicit
      // file arg the one-file layout cannot apply, and the recursive reading
      // must win instead of dropping the whole response.
      const f = fixture('rg-digits-named-file');
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      // The same through an explicit DIRECTORY arg: one path arg that is not
      // a file (coll) must not qualify for one-file attribution either.
      const dirForm = runCapture('/usr/bin/rg', ['-n', 'needle', 'coll'], root);
      expect(
        sortedSpans(
          parseResponse({
            command: 'rg -n needle coll',
            cwd: root,
            stdout: dirForm.stdout,
            exitStatus: dirForm.exitStatus
          })
        )
      ).toEqual(sortedSpans(resolveExpected(f)));
    });
  });

  describe('context windows on dash-pathed files', () => {
    it('the full -C window survives a dash inside the path', () => {
      // The probe collapsed `[3,3]` instead of `[2,4]` for my-file.ts: its
      // context records (`src/my-file.ts-2-one`) split inside the path and
      // dropped. Anchoring to the response's match-record paths restores the
      // window; the dash-free sibling d.ts rides along.
      const f = fixture('rg-context-dash-path');
      expect(f.stdout).toContain('src/my-file.ts-2-');
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });
  });

  describe('git grep rev args and pathspec magic', () => {
    it('rev args fail closed (documented); pathspec magic never becomes a permitted root', () => {
      const rev = fixture('git-grep-rev-arg');
      // `git grep -n alpha HEAD` fuses the rev into every record path
      // ("HEAD:src/a.ts:1:alpha"); the records drop as path-ambiguous —
      // fail-closed and defensible (the rev is known, but stripping it would
      // guess at a path the response does not carry).
      expect(rev.stdout).not.toBe('');
      expect(parseFixture(rev)).toEqual([]);
      // `:/` is not a filesystem path: as a path arg it made the permitted
      // root the literal `cwd/:/` and every decoded path was rejected.
      // Dropped, roots fall back to the effective cwd and the cwd-relative
      // records resolve normally.
      const ps = fixture('git-grep-pathspec-top');
      expect(ps.stdout).not.toBe('');
      expect(sortedSpans(parseFixture(ps))).toEqual(sortedSpans(resolveExpected(ps)));
    });
  });

  describe('git show <rev>:<path> content idiom', () => {
    it('raw blob content is excluded from the diff gate, with and without --stat', () => {
      // The blob is diff-shaped and names real files — decoding it as
      // diff-form output fabricated a touch on src/a.ts. The rev:path
      // positional marks the content idiom; the response pass yields nothing.
      for (const name of ['git-show-revpath', 'git-show-revpath-stat']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });
  });

  describe('diffs run from below the worktree root', () => {
    it('diff paths anchor to the worktree root, not the subdir cwd', () => {
      // git emits repo-root-relative paths (`diff --git a/sub/a.txt`); the
      // decoder must discover the worktree root from the effective dir (the
      // `cd` target or the `git -C` target) and resolve there — the probe
      // previously produced zero spans from a subdir while the same command
      // from the root worked.
      for (const name of ['git-diff-cd-subdir', 'git-diff-C-subdir']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });
  });

  describe('pipelines', () => {
    it('the response attributes to the first gated stage', () => {
      // `rg -n alpha src | head -5` — the standard output-capping idiom. The
      // final stage (`head`) is not gated, but the response IS the gated
      // stage's output (head only truncates; the terminating-newline rule
      // handles the cut), so the pipeline must parse identically to the
      // gated stage alone and must never come back empty.
      const full = runCapture('/usr/bin/rg', ['-n', 'alpha', 'src'], root);
      const head5 = `${full.stdout.split('\n').slice(0, 5).join('\n')}\n`;
      const piped = parseResponse({ command: 'rg -n alpha src | head -5', cwd: root, stdout: head5 });
      const plain = parseResponse({ command: 'rg -n alpha src', cwd: root, stdout: head5 });
      expect(piped).toEqual(plain);
      expect(piped.length).toBeGreaterThan(0);
    });
  });

  describe('distinct-span cap', () => {
    it('caps at MAX_RESPONSE_SPANS, fail-closed beyond, never capping a coalesced window', () => {
      // Synthetic recursive output over N distinct files (paths resolve
      // inside the cwd root; existence is the touch core's concern, not the
      // parser's). At the cap every span surfaces; beyond it exactly the cap
      // is emitted in deterministic path order and the rest fail closed.
      const many = (n: number): string =>
        Array.from({ length: n }, (_, i) => `f${String(i + 1).padStart(2, '0')}.ts:1:x\n`).join('');
      const parse = (stdout: string): ResolvedSpan[] => parseResponse({ command: 'rg -n foo', cwd: root, stdout });
      expect(parse(many(MAX_RESPONSE_SPANS))).toHaveLength(MAX_RESPONSE_SPANS);
      const capped = parse(many(MAX_RESPONSE_SPANS + 10));
      expect(capped).toHaveLength(MAX_RESPONSE_SPANS);
      expect(capped.map((s) => s.absolutePath)).toEqual(
        Array.from({ length: MAX_RESPONSE_SPANS }, (_, i) => join(root, `f${String(i + 1).padStart(2, '0')}.ts`))
      );
      // A coalesced window covering a huge line range is ONE span and is
      // never capped away: f01.ts's 5000 contiguous records coalesce to a
      // single [1,5000] span, so the response is exactly 50 spans (the cap)
      // and everything surfaces. Discontiguous records (1 and 5000 only)
      // would be two spans and the cap would legitimately engage.
      const f01All = Array.from({ length: 5000 }, (_, i) => `f01.ts:${i + 1}:x\n`).join('');
      const tail = Array.from(
        { length: MAX_RESPONSE_SPANS - 1 },
        (_, i) => `f${String(i + 2).padStart(2, '0')}.ts:1:x\n`
      ).join('');
      const withHuge = parse(f01All + tail);
      expect(withHuge).toHaveLength(MAX_RESPONSE_SPANS);
      expect(withHuge.find((s) => s.absolutePath === join(root, 'f01.ts'))).toEqual({
        lineStart: 1,
        lineEnd: 5000,
        absolutePath: join(root, 'f01.ts')
      });
    });
  });

  // -------------------------------------------------------------------------
  // Adapter envelope normalization contract (plan: adapter wiring)
  // -------------------------------------------------------------------------

  describe('adapter envelope normalization contract (Phase 3e)', () => {
    it('every documented envelope shape feeds the same normalized fields and the same spans', () => {
      const f = fixture('rg-recursive');
      // notes/response-envelope-shapes.md documents the shapes the adapters
      // receive: a bare string (Codex today, and Claude's legacy
      // tool_result), the current Claude object {stdout, stderr,
      // rawOutputPath, interrupted, ...}, the legacy {output, success,
      // exitCode, filePath} object, and text-block arrays. Phase 3e
      // implements this normalization in the adapters; the shared parser
      // must never see a raw envelope.
      const envelopes: unknown[] = [
        f.stdout,
        { stdout: f.stdout, stderr: '', rawOutputPath: undefined, interrupted: false },
        { output: f.stdout, success: true, exitCode: 0, filePath: undefined },
        [{ type: 'text', text: f.stdout }]
      ];
      for (const envelope of envelopes) {
        const normalized = normalizeEnvelope(envelope);
        expect(sortedSpans(parseResponse({ command: f.command, cwd: f.cwd, ...normalized }))).toEqual(
          sortedSpans(resolveExpected(f))
        );
      }
      // rawOutputPath set ⇒ inline stdout is only a preview ⇒ parse nothing.
      expect(parseResponse({ command: f.command, cwd: f.cwd, stdout: f.stdout, truncated: true })).toEqual([]);
    });
  });
});
