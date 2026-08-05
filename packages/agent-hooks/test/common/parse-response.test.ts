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
 * truncated/interrupted contract. The round-2 evaluation-fix batch adds the
 * stdin-fed fail-closed fixtures (piped/redirected non-git search bins read
 * stream positions, never files), the whole-tree git grep anchoring
 * (pathspec magic and `--full-name` from a subdir), the diff `--relative`
 * and two-arg blob-blob exclusions, the blame-above-ANSI ordering, the
 * renumbering-pipeline fail-closed fixtures, and the numbered-garbage
 * whole-file-fallback exclusion. The round-3 evaluation-fix batch adds the
 * pickaxe/log value-flag fixtures (`-S`/`-G`/`--grep`/`--since` space-form
 * colon values decode like the glued control) and the verbatim sed/awk
 * truncator fixtures (numeric-address and NR-condition scripts decode to
 * the same spans as the head control; rewritten or non-allowlisted scripts
 * still fail closed). The round-3 R3-3 batch INVERTS the renumberer
 * closure to a provably-verbatim allowlist: unlisted renumberers (perl,
 * python3, mawk — verified on this system — and tr's digit rewrite) over
 * digit-named files fail closed, while plain digit-named-arg searches,
 * plain grep filters without numbered evidence, stream-position perl
 * truncators (`print if $. <= 2`), and shape-preserving `tr -d` deletions
 * (`tr -d '\r'`) stay open. The round-4 R4-2 batch closes the FILE-OPERAND
 * hole in the same allowlist: a post-gated stage naming a file reads that
 * file instead of the pipe, so cat/head/tail/sort/grep/rg over
 * `crafted.txt` (crafted records on never-searched files and no-match
 * lines) fail closed, while stdin markers (`cat -`), bare `cat`, and
 * pattern-only `grep -e` filters stay open. The round-5 R5-1 batch closes
 * the CHAIN-SIBLING hole in the same gate: a stage joined by `;`/`&&`/`||`/
 * newline (either direction) mixes its output into the same response, so
 * crafted-file reads through chains (including the no-match `||` form whose
 * ENTIRE response is the crafted file) fail closed, while a verbatim chain
 * sibling (head reading closed stdin adds nothing) and a pipe feeder
 * consumed by the gated stage stay open. The round-5 pattern-from-flag
 * batch restores precision for gated-stage `-e`/`-f`/`--regexp` forms
 * (separate and glued): every positional is a search root when the pattern
 * came from a flag, so single-file one-file layout and multi-file roots
 * decode genuine spans instead of losing them. The round-6 R6-1 batch
 * closes the GLUED-REDIRECT hole in both gates: a `<` glued to a flag,
 * pattern, or consumed `-e`/`-f` value (`head -2<crafted.txt`, `grep
 * needle<crafted.txt`, `rg -f patterns.txt<crafted.txt`) is a stdin
 * redirect to bash but invisible to token-level checks, so the quote-aware
 * hasUnquotedRedirect scan fails every such stage closed — while a quoted
 * literal `<` in a pattern (`rg -n 'x<needle' lt.ts`) and a glued redirect
 * under explicit roots stay open. Only the adapter-envelope checks remain
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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  '2024-log.txt': 'alpha\n',
  // A 20-record file for the verbatim truncator fixtures: a sed/awk stage
  // that cuts records (`sed -n '1,2p'`, `sed '12q'`, `awk 'NR<=2'`) must
  // preserve the surviving records' positions exactly like `head -2`.
  'src/needles.ts': 'needle\n'.repeat(20),
  // Digit-named files for the round-3 R3-3 renumberer fixtures: an unlisted
  // renumberer (`perl -ne 'print "$.:$_"'`) turns the genuine
  // `path:line:text` records into stream positions, so file i decodes at
  // line i — phantom lines (file 2's line 2, file 3's line 3 are no-match
  // lines here) while the genuine line-1 matches go unrecorded. All three
  // carry the needle at line 1 so the real search emits one record per file.
  'digits/1': 'needle\n',
  'digits/2': 'needle\nx\n',
  'digits/3': 'needle\nx\nx\n',
  // A crafted record file for the round-4 R4-2 file-operand fixtures: a
  // post-gated stage that names it as a FILE OPERAND reads this file
  // instead of the pipe, and its crafted records decode as phantom spans —
  // `2:2:` names file 2 line 2 (a no-match line; the genuine match is line
  // 1) and `3:1:` names file 3, which the gated stage (`rg -n needle 1 2`)
  // never searched at all.
  'digits/crafted.txt': '2:2:needle at 2\n3:1:needle at 3\n',
  // A pattern file for the round-5 pattern-from-flag fixtures: `-f`/`--file`
  // takes its pattern from this file, so the gated stage's positionals are
  // all search roots, not pattern-then-roots.
  'digits/patterns.txt': 'needle\n',
  // A literal `<` INSIDE a quoted pattern for the round-6 R6-1 quote-aware
  // fixtures: bash reads it as part of the pattern, never as a redirect, so
  // the single-file search stays genuine.
  'digits/lt.ts': 'x<needle\n'
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

/**
 * Execute a binary with stdin actually piped — the real shape of a
 * stdin-fed search (a `printf | rg` pipeline or a `< file` redirect):
 * rg/grep with no path args read the pipe, so the captured records are
 * stream positions (`1:needle`), never file positions.
 */
function runCaptureStdin(input: string, bin: string, argv: string[], cwd: string): RunResult {
  try {
    return {
      stdout: execFileSync(bin, argv, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }),
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

/** Execute a shell pipeline (`sh -c`) — the pipeline fixtures run real stages end to end. */
function runPipeline(command: string, cwd: string): RunResult {
  try {
    return {
      stdout: execFileSync('sh', ['-c', command], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
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
  expected: ExpectedSpan[],
  captureCwd?: string
): GoldenFixture {
  // The capture cwd may differ from the fixture cwd: `--relative` output
  // depends on the cwd it runs from (bare `--relative` is cwd-relative),
  // while the parser derives the effective dir from the command text.
  const { stdout, exitStatus } = runGit(captureCwd ?? root, argv);
  return { name, command, cwd: root, stdout, exitStatus, expected, files };
}

/** A real-pipeline fixture: the stage pipeline runs end to end via `sh -c`. */
function pipelineFixture(name: string, command: string, root: string, expected: ExpectedSpan[]): GoldenFixture {
  const { stdout, exitStatus } = runPipeline(command, root);
  return { name, command, cwd: root, stdout, exitStatus, expected, files: SEARCH_FILES };
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
  // record). Magic makes git grep search the WHOLE tree from a subdir, so
  // the permitted root anchors to the worktree root discovered from the
  // effective dir; the cwd-relative `../2024-log.txt` record decodes against
  // the cwd base and passes containment inside that root.
  {
    const ps = runGit(join(root, 'src'), ['grep', '-n', 'alpha', '--', ':/']);
    const psExpected = searchExpected(SEARCH_FILES, allFiles, 'alpha', 0, 0).map((s) => ({
      // Records are cwd-relative from the subdir: src/* emits the bare
      // name, the repo-top 2024-log.txt emits `../2024-log.txt`.
      path: s.path === '2024-log.txt' ? '../2024-log.txt' : s.path.slice('src/'.length),
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

  // `--full-name` re-anchors git grep's records to repo-root-relative paths
  // regardless of cwd — from a subdir the bare `a.ts` becomes `src/a.ts` —
  // so both the resolution base and the permitted root move to the worktree
  // root. (The real git option is `--full-name`; `--full-tree` does not
  // exist on git 2.47.3 and errors with a usage response.)
  {
    const fn = runGit(join(root, 'src'), ['grep', '-n', '--full-name', 'alpha', '--', ':/']);
    fixtures.push({
      name: 'git-grep-full-name-magic',
      command: 'git grep -n --full-name alpha -- :/',
      cwd: join(root, 'src'),
      stdout: fn.stdout,
      exitStatus: fn.exitStatus,
      expected: searchExpected(SEARCH_FILES, allFiles, 'alpha', 0, 0),
      files: SEARCH_FILES
    });
    // Subdir-scoped search with --full-name: git still limits the search to
    // the subdir (its pathspec scope, not the display option's), but every
    // record is repo-root-relative and must resolve inside the worktree
    // root while containment stays anchored to the subdir scope.
    const fnPlain = runGit(join(root, 'src'), ['grep', '-n', '--full-name', 'alpha']);
    fixtures.push({
      name: 'git-grep-full-name-plain',
      command: 'git grep -n --full-name alpha',
      cwd: join(root, 'src'),
      stdout: fnPlain.stdout,
      exitStatus: fnPlain.exitStatus,
      expected: searchExpected(SEARCH_FILES, srcFiles, 'alpha', 0, 0),
      files: SEARCH_FILES
    });
  }

  // A non-git search bin with NO path args fed by a pipe or redirect reads
  // its stdin — its records are stream positions, never file positions, so
  // the response-derived decode must fail closed (no touches) even though
  // the captured records look exactly like a normal search's. The fixture
  // stdout is what the binary REALLY emits when stdin is piped
  // (`1:needle` — rg numbers the stream lines). git grep never reads stdin
  // and is exempt; explicit path args keep the file-search semantics.
  fixtures.push({
    name: 'rg-stdin-piped',
    command: 'printf "needle\\n" | rg -n needle',
    cwd: root,
    stdout: runCaptureStdin('needle\n', '/usr/bin/rg', ['-n', 'needle'], root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'rg-stdin-redirect',
    command: 'rg -n needle < needle.txt',
    cwd: root,
    stdout: runCaptureStdin('needle\n', '/usr/bin/rg', ['-n', 'needle'], root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'grep-stdin-piped',
    command: 'printf "needle\\n" | grep -n needle',
    cwd: root,
    stdout: runCaptureStdin('needle\n', '/usr/bin/grep', ['-n', 'needle'], root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  // The exemptions: git grep ignores stdin entirely (whole-tree search
  // still decodes), an explicit digit-named path arg keeps the one-file
  // layout (the pipe is the search's INPUT, not its target), and a path
  // arg in the gated stage keeps file-position semantics regardless of
  // what upstream feeds it.
  fixtures.push({
    name: 'git-grep-stdin-exempt',
    command: 'printf "needle\\n" | git grep -n alpha',
    cwd: root,
    stdout: runGit(root, ['grep', '-n', 'alpha']).stdout,
    exitStatus: 0,
    expected: searchExpected(SEARCH_FILES, allFiles, 'alpha', 0, 0),
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'rg-stdin-digit-path-arg',
    command: 'cd coll && rg -n needle 9',
    cwd: root,
    stdout: runCapture('/usr/bin/rg', ['-n', 'needle', '9'], join(root, 'coll')).stdout,
    exitStatus: 0,
    expected: [{ path: 'coll/9', lineStart: 1, lineEnd: 1 }],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'rg-stdin-with-path-args',
    command: 'cat stream.txt | rg -n alpha src/a.ts',
    cwd: root,
    stdout: runCapture('/usr/bin/rg', ['-n', 'alpha', 'src/a.ts'], root).stdout,
    exitStatus: 0,
    expected: searchExpected(SEARCH_FILES, ['src/a.ts'], 'alpha', 0, 0),
    files: SEARCH_FILES
  });

  // Post-gated pipeline stages that RENUMBER or reformat the search output
  // destroy the record-to-line correspondence: `nl -ba` and `cat -n` prefix
  // their own position column (a phantom "line 1" span appears at the
  // bottom), `awk '{print NR ":" $0}'` and `grep -n` overwrite it (every
  // record silently misses). All fail closed — no response-derived touches.
  // Truncating stages (`head`) only cut records and stay open.
  fixtures.push({
    name: 'pipe-rg-nl-ba',
    command: 'rg -n needle coll | nl -ba',
    cwd: root,
    stdout: runPipeline('rg -n needle coll | nl -ba', root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'pipe-rg-cat-n',
    command: 'rg -n needle coll | cat -n',
    cwd: root,
    stdout: runPipeline('rg -n needle coll | cat -n', root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'pipe-rg-awk',
    command: 'rg -n needle coll | awk \'{print NR ":" $0}\'',
    cwd: root,
    stdout: runPipeline('rg -n needle coll | awk \'{print NR ":" $0}\'', root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'pipe-rg-grep-n',
    command: 'rg -n needle coll | grep -n needle',
    cwd: root,
    stdout: runPipeline('rg -n needle coll | grep -n needle', root).stdout,
    exitStatus: 0,
    expected: [],
    files: SEARCH_FILES
  });
  fixtures.push({
    name: 'pipe-rg-head-2',
    command: 'rg -n needle coll | head -2',
    cwd: root,
    stdout: runPipeline('rg -n needle coll | head -2', root).stdout,
    exitStatus: 0,
    expected: [{ path: 'coll/9', lineStart: 1, lineEnd: 1 }],
    files: SEARCH_FILES
  });

  // Truncating sed/awk stages whose scripts PROVABLY pass the earlier
  // records through byte-verbatim cut the response exactly like `head`: the
  // surviving records still carry the gated stage's file lines, so the
  // decoded spans must equal the head -2 control on the same 20-record
  // input. The expression-shape allowlist (numeric-address p/q/d for sed,
  // condition-only NR comparisons for awk) is the ONLY discriminator — no
  // record-shape check may reopen the digit-named-file fabrication class.
  fixtures.push(
    pipelineFixture('pipe-rg-sed-np', "rg -n needle src/needles.ts | sed -n '1,2p'", root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 2 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-sed-q', "rg -n needle src/needles.ts | sed '12q'", root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 12 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-awk-le', "rg -n needle src/needles.ts | awk 'NR<=2'", root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 2 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-awk-eq', "rg -n needle src/needles.ts | awk 'NR==1'", root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 1 }
    ])
  );
  // The head controls on the same input — each verbatim stage must equal
  // the head stage truncating at its own cut point.
  fixtures.push(
    pipelineFixture('pipe-rg-head-1-needles', 'rg -n needle src/needles.ts | head -1', root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-head-2-needles', 'rg -n needle src/needles.ts | head -2', root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 2 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-head-12-needles', 'rg -n needle src/needles.ts | head -12', root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 12 }
    ])
  );

  // Non-allowlisted sed/awk stages still fail closed: `s///` rewrites strip
  // the positions, brace/field actions renumber, and `1,2!d` — a
  // range-complement delete that HAPPENS to preserve records — is not one
  // of the provable numeric forms, so it fails closed with the rest.
  fixtures.push(pipelineFixture('pipe-rg-sed-sub', "rg -n needle src/needles.ts | sed 's/^[0-9]*://'", root, []));
  fixtures.push(pipelineFixture('pipe-rg-sed-range-delete', "rg -n needle src/needles.ts | sed '1,2!d'", root, []));
  fixtures.push(
    pipelineFixture('pipe-rg-awk-print', 'rg -n needle src/needles.ts | awk \'{print NR ":" $0}\'', root, [])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-awk-fields', "rg -n needle src/needles.ts | awk 'NR<=2 {print $1}'", root, [])
  );

  // Round-3 R3-3: the renumbering closure is name-based and was BYPASSABLE —
  // any renumberer outside the deny list (perl, python3, mawk, tr, …) passed
  // the later-stage scan and its renumbered records reached the decoders.
  // The default is now INVERTED (fail closed) with a provably-verbatim
  // allowlist, so the fabrication shapes below must yield NO spans:
  // `perl -ne 'print "$.:$_"'` prepends its stream ordinal to each record
  // (`1:1:1:needle`), so file i decodes at line i — phantom lines on
  // digits/2 (line 2) and digits/3 (line 3) are no-match lines while the
  // genuine line-1 matches go unrecorded; python3 and mawk renumber through
  // their own bins; `tr '1' '9'` rewrites the digits inside line numbers
  // (line 12 becomes 92 — a phantom line); `tr -d '0-9'` deletes them
  // outright (record shape destroyed).
  {
    const perlRenumber = `cd digits && rg -n needle 1 2 3 | perl -ne 'print "$.:$_"'`;
    fixtures.push({
      name: 'pipe-rg-perl-renumber',
      command: perlRenumber,
      cwd: root,
      stdout: runPipeline(perlRenumber, root).stdout,
      exitStatus: 0,
      expected: [],
      files: SEARCH_FILES
    });
    const pythonRenumber = `cd digits && rg -n needle 1 2 3 | python3 -c "import sys; [print(f'{i}:{l}', end='') for i, l in enumerate(sys.stdin, 1)]"`;
    fixtures.push({
      name: 'pipe-rg-python-renumber',
      command: pythonRenumber,
      cwd: root,
      stdout: runPipeline(pythonRenumber, root).stdout,
      exitStatus: 0,
      expected: [],
      files: SEARCH_FILES
    });
    const mawkRenumber = `cd digits && rg -n needle 1 2 3 | mawk '{print NR ":" $0}'`;
    fixtures.push({
      name: 'pipe-rg-mawk-renumber',
      command: mawkRenumber,
      cwd: root,
      stdout: runPipeline(mawkRenumber, root).stdout,
      exitStatus: 0,
      expected: [],
      files: SEARCH_FILES
    });
  }
  fixtures.push(pipelineFixture('pipe-rg-tr-sub', "rg -n needle src/needles.ts | tr '1' '9'", root, []));
  fixtures.push(pipelineFixture('pipe-rg-tr-d-digits', "rg -n needle src/needles.ts | tr -d '0-9'", root, []));

  // The allowlisted carve-outs stay open: a stream-position perl truncator
  // (`print if $. <= 2` — bare print emits $_ verbatim including its
  // trailing newline) cuts exactly like `head -2`, and `tr -d '\r'` (the
  // CRLF idiom — a set with no digits, colons, or newline escapes) deletes
  // nothing from the LF-terminated records. The legit digit-named-arg
  // search (no later stage; the files are real, so the existence backstop
  // passes) and a plain `grep -v` filter (grep-family without numbered
  // evidence) keep their spans too.
  fixtures.push(
    pipelineFixture('pipe-rg-perl-truncate', "rg -n needle src/needles.ts | perl -ne 'print if $. <= 2'", root, [
      { path: 'src/needles.ts', lineStart: 1, lineEnd: 2 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-perl-single', "rg -n needle src/needles.ts | perl -ne 'print if $. == 2'", root, [
      { path: 'src/needles.ts', lineStart: 2, lineEnd: 2 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-tr-crlf', "rg -n alpha src/a.ts | tr -d '\\r'", root, [
      { path: 'src/a.ts', lineStart: 1, lineEnd: 1 },
      { path: 'src/a.ts', lineStart: 4, lineEnd: 4 }
    ])
  );
  {
    const digits = 'cd digits && rg -n needle 1 2 3';
    fixtures.push({
      name: 'rg-digits-named-args',
      command: digits,
      cwd: root,
      stdout: runPipeline(digits, root).stdout,
      exitStatus: 0,
      expected: [
        { path: 'digits/1', lineStart: 1, lineEnd: 1 },
        { path: 'digits/2', lineStart: 1, lineEnd: 1 },
        { path: 'digits/3', lineStart: 1, lineEnd: 1 }
      ],
      files: SEARCH_FILES
    });
  }
  fixtures.push(
    pipelineFixture('pipe-rg-grep-v-skip', 'rg -n alpha src/a.ts | grep -v skip', root, [
      { path: 'src/a.ts', lineStart: 1, lineEnd: 1 },
      { path: 'src/a.ts', lineStart: 4, lineEnd: 4 }
    ])
  );

  // Round-4 R4-2: a post-gated stage that names a FILE OPERAND reads that
  // file instead of the pipe — its output is not the gated stage's records,
  // and the crafted records below (`2:2:needle at 2`, `3:1:needle at 3`)
  // decode as phantom spans on files the search never matched (or never
  // searched). Every allowlisted bin — cat, the six pass-through bins, and
  // the grep family — must fail closed on file operands. The `--`
  // terminator form (`cat -- crafted.txt`) is closed the same way, while
  // the stdin markers (`cat -`, bare `cat`) and pattern-only grep filters
  // (`grep -e needle`) keep reading the pipe and stay open.
  {
    const crafted = 'crafted.txt';
    const fileOperandStages: Array<[string, string]> = [
      ['cat', `cat ${crafted}`],
      ['cat-terminator', `cat -- ${crafted}`],
      ['head', `head -1 ${crafted}`],
      ['tail', `tail -1 ${crafted}`],
      ['sort', `sort ${crafted}`],
      ['grep', `grep needle ${crafted}`],
      ['grep-e', `grep -e needle ${crafted}`],
      ['rg', `rg needle ${crafted}`]
    ];
    for (const [suffix, stage] of fileOperandStages) {
      fixtures.push({
        name: `pipe-rg-file-operand-${suffix}`,
        command: `cd digits && rg -n needle 1 2 | ${stage}`,
        cwd: root,
        stdout: runPipeline(`cd digits && rg -n needle 1 2 | ${stage}`, root).stdout,
        exitStatus: 0,
        expected: [],
        files: SEARCH_FILES
      });
    }
    fixtures.push({
      name: 'pipe-rg-file-operand-one-file-cat',
      command: `cd digits && rg -n needle 1 | cat ${crafted}`,
      cwd: root,
      stdout: runPipeline(`cd digits && rg -n needle 1 | cat ${crafted}`, root).stdout,
      exitStatus: 0,
      expected: [],
      files: SEARCH_FILES
    });
  }
  fixtures.push(
    pipelineFixture('pipe-rg-cat-stdin', 'cd digits && rg -n needle 1 2 | cat -', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 },
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-cat-bare', 'cd digits && rg -n needle 1 2 | cat', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 },
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('pipe-rg-grep-e-pattern', 'cd digits && rg -n needle 1 2 | grep -e needle', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 },
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );

  // Round-5 R5-1: a chain sibling (joined by `;`, `&&`, `||`, `&`, or a
  // newline — every non-pipe joiner — in either direction) mixes its own
  // output into the SAME response, so the provably-verbatim check that
  // governs pipe stages applies to every sibling stage: a crafted file read
  // by any sibling decodes as phantom spans, and the `||` form with a
  // no-match search leaves the ENTIRE response as the crafted file. The
  // earlier-stage forms (`cat crafted.txt ; rg …`, `echo '2:2:…' ; rg …`)
  // are closed by the same check, and a non-allowlisted after-stage
  // (`&& echo done`) closes too — echo could emit crafted records. A
  // verbatim chain sibling (head reads the closed stdin and adds nothing)
  // and a pipe feeder consumed by the gated stage (`cat 1 | rg -n needle
  // 2` — the search with explicit roots ignores stdin) stay open.
  {
    const crafted = 'crafted.txt';
    const chainSiblings: Array<[string, string, string]> = [
      ['semicolon', `; cat ${crafted}`, 'rg -n needle 1 2'],
      ['andand', `&& cat ${crafted}`, 'rg -n needle 1 2'],
      ['oror-nomatch', `|| cat ${crafted}`, 'rg -n zzz 1 2'],
      ['newline', `\ncat ${crafted}`, 'rg -n needle 1 2'],
      ['echo-after', '&& echo done', 'rg -n needle 1 2'],
      ['perl-renumber', `&& perl -ne 'print "$.:$_"' ${crafted}`, 'rg -n needle 1 2 3'],
      ['awk-renumber', `; awk '{print NR ":" $0}' ${crafted}`, 'rg -n needle 1 2 3']
    ];
    for (const [suffix, stage, gated] of chainSiblings) {
      const command = `cd digits && ${gated} ${stage}`;
      fixtures.push({
        name: `chain-sibling-${suffix}`,
        command,
        cwd: root,
        stdout: runPipeline(command, root).stdout,
        exitStatus: 0,
        expected: [],
        files: SEARCH_FILES
      });
    }
    const earlierStages: Array<[string, string]> = [
      ['earlier-cat', `cat ${crafted} ; `],
      ['earlier-echo', `echo '2:2:needle at 2' ; `]
    ];
    for (const [suffix, stage] of earlierStages) {
      const command = `cd digits && ${stage}rg -n needle 1 2`;
      fixtures.push({
        name: `chain-sibling-${suffix}`,
        command,
        cwd: root,
        stdout: runPipeline(command, root).stdout,
        exitStatus: 0,
        expected: [],
        files: SEARCH_FILES
      });
    }
    const command = `cd digits && rg -n needle 1 2 | cat ; cat ${crafted}`;
    fixtures.push({
      name: 'chain-sibling-pipe-then-chain',
      command,
      cwd: root,
      stdout: runPipeline(command, root).stdout,
      exitStatus: 0,
      expected: [],
      files: SEARCH_FILES
    });
  }
  fixtures.push(
    pipelineFixture('chain-sibling-head-verbatim', 'cd digits && rg -n needle 1 2 ; head -2', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 },
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('chain-feeder-consumed', 'cd digits && cat 1 | rg -n needle 2', root, [
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );

  // Round-5 pattern-from-flag precision: when the pattern came from a flag
  // value (`-e`/`-f`/`--regexp`/`--file`, separate or glued), every
  // positional is a search root — single-file forms hit the one-file layout
  // and multi-file forms anchor the roots, instead of the first positional
  // being eaten as the pattern and the touches lost.
  fixtures.push(
    pipelineFixture('rg-e-one-file', "cd digits && rg -n -e 'needle|alpha' 1", root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('rg-e-multi', 'cd digits && rg -n -e needle 1 2', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 },
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('grep-f-patternfile', 'cd digits && grep -n -f patterns.txt 1', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('rg-regexp-glued', 'cd digits && rg -n --regexp=needle 1', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('rg-e-glued', 'cd digits && rg -n -eneedle 1', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 }
    ])
  );

  // Round-6 R6-1: a stdin redirect GLUED to a preceding token
  // (`head -2<crafted.txt` is `head -2 < crafted.txt` to bash) is invisible
  // to token-level gates — the token starts with a flag or fills the
  // pattern slot, and a consumed `-e`/`-f` value is never inspected. The
  // quote-aware hasUnquotedRedirect check fails closed on every stage whose
  // text carries an unquoted `<`: verbatim bins and grep-family siblings
  // read the crafted file instead of the pipe, and a gated rg/grep with a
  // glued redirect and no roots becomes a stdin-fed search. A quoted
  // literal `<` in a pattern (`rg -n 'x<needle' lt.ts`) is NOT a redirect
  // and stays open, and a glued redirect with explicit roots
  // (`rg -e needle<crafted.txt 1 2` — the search ignores stdin) stays open
  // too.
  {
    const crafted = 'crafted.txt';
    const gluedStages: Array<[string, string]> = [
      ['head', `head -2<${crafted}`],
      ['head-lines', `head --lines=1<${crafted}`],
      ['sort', `sort -k2<${crafted}`],
      ['grep', `grep needle<${crafted}`],
      ['grep-e', `grep -e needle<${crafted}`]
    ];
    for (const [suffix, stage] of gluedStages) {
      const command = `cd digits && rg -n needle 1 2 | ${stage}`;
      fixtures.push({
        name: `pipe-rg-glued-redirect-${suffix}`,
        command,
        cwd: root,
        stdout: runPipeline(command, root).stdout,
        exitStatus: 0,
        expected: [],
        files: SEARCH_FILES
      });
    }
    const chainGlued: Array<[string, string]> = [
      ['semicolon', `; head -2<${crafted}`],
      ['pipe-head', `; head -2<${crafted} | cat`]
    ];
    for (const [suffix, stage] of chainGlued) {
      const command = `cd digits && rg -n needle 1 2 ${stage}`;
      fixtures.push({
        name: `chain-sibling-glued-redirect-${suffix}`,
        command,
        cwd: root,
        stdout: runPipeline(command, root).stdout,
        exitStatus: 0,
        expected: [],
        files: SEARCH_FILES
      });
    }
    // The gated stage's own glued redirect: the `-e`/`-f` VALUE carries the
    // redirect, so no standalone `<` token survives argv splitting — only
    // the raw-text scan sees it, and the stdin-fed rule fires.
    const gatedGlued: Array<[string, string]> = [
      ['rg-e', 'rg -n -e needle<crafted.txt'],
      ['grep-e', 'grep -n -e needle<crafted.txt'],
      ['rg-f', 'rg -n -f patterns.txt<crafted.txt'],
      ['grep-f', 'grep -n -f patterns.txt<crafted.txt']
    ];
    for (const [suffix, stage] of gatedGlued) {
      const command = `cd digits && ${stage}`;
      fixtures.push({
        name: `gated-glued-redirect-${suffix}`,
        command,
        cwd: root,
        stdout: runPipeline(command, root).stdout,
        exitStatus: 0,
        expected: [],
        files: SEARCH_FILES
      });
    }
  }
  fixtures.push(
    pipelineFixture('rg-quoted-angle-pattern', "cd digits && rg -n 'x<needle' lt.ts", root, [
      { path: 'digits/lt.ts', lineStart: 1, lineEnd: 1 }
    ])
  );
  fixtures.push(
    pipelineFixture('rg-e-glued-redirect-roots', 'cd digits && rg -n -e needle<crafted.txt 1 2', root, [
      { path: 'digits/1', lineStart: 1, lineEnd: 1 },
      { path: 'digits/2', lineStart: 1, lineEnd: 1 }
    ])
  );

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

  // `git diff --relative` (bare) from a subdir emits cwd-relative paths
  // (`diff --git a/a.txt` for sub/a.txt) and EXCLUDES changes outside the
  // cwd — the diff must resolve against the effective dir, never the repo
  // root. The same-named root file is the decoy: resolving the bare `a.txt`
  // against the root would touch the wrong file. `--relative=<path>`
  // resolves against the repo ROOT (git 2.47.3), so the `<path>` form from
  // the root must decode to sub/a.txt too, not to a cwd-relative file.
  {
    const repo = makeGitRepo();
    repos.push(repo);
    const base = { 'a.txt': 'r1\nr2\nr3\n', 'sub/a.txt': 'l1\nl2\nl3\nl4\nl5\nl6\n' };
    writeFiles(repo.root, base);
    commitAll(repo.root, 'base');
    const modified = { 'a.txt': 'r1\nr2\nCHANGED\n', 'sub/a.txt': 'l1\nl2\nCHANGED\nl4\nl5\nl6\n' };
    writeFiles(repo.root, modified);
    fixtures.push(
      diffFixture(
        'git-diff-relative-bare',
        'cd sub && git diff --no-color -U1 --relative',
        ['diff', '--no-color', '-U1', '--relative'],
        repo.root,
        modified,
        [{ path: 'sub/a.txt', lineStart: 2, lineEnd: 4 }],
        // Captured from the subdir: bare --relative is cwd-relative, so the
        // record is `a.txt` — the parser must resolve it against the
        // effective dir (sub), where the decoy root a.txt is out of scope.
        join(repo.root, 'sub')
      )
    );
    fixtures.push(
      diffFixture(
        'git-diff-relative-path',
        'git diff --no-color -U1 --relative=sub',
        ['diff', '--no-color', '-U1', '--relative=sub'],
        repo.root,
        modified,
        [{ path: 'sub/a.txt', lineStart: 2, lineEnd: 4 }]
      )
    );
  }

  {
    const repo = makeGitRepo();
    repos.push(repo);
    const base = { 'sub/a.txt': 'l1\nl2\nl3\nl4\nl5\nl6\n' };
    writeFiles(repo.root, base);
    commitAll(repo.root, 'base');
    const modified = { 'sub/a.txt': 'l1\nl2\nCHANGED\nl4\nl5\nl6\n' };
    writeFiles(repo.root, modified);
    // No same-named root file: the cwd-relative `a.txt` record resolves to
    // nothing at the repo root, so only the effective-dir resolution can
    // produce the touch.
    fixtures.push(
      diffFixture(
        'git-diff-relative-bare-nodedoy',
        'cd sub && git diff --no-color -U1 --relative',
        ['diff', '--no-color', '-U1', '--relative'],
        repo.root,
        modified,
        [{ path: 'sub/a.txt', lineStart: 2, lineEnd: 4 }],
        join(repo.root, 'sub')
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

  // A two-arg blob-blob `git diff <rev>:<path> <rev>:<path>` emits a NORMAL
  // unified diff naming working-tree paths (`diff --git a/a.txt b/a.txt`)
  // while git reads only the two blobs — the worktree's a.txt is never
  // touched. Any diff positional containing `:` that is not an existing
  // file marks the content idiom (here the full shas make the exclusion
  // unambiguous); the diff-shaped stdout must not decode into touches.
  {
    const repo = makeGitRepo();
    repos.push(repo);
    writeFiles(repo.root, { 'a.txt': 'l1\nl2\nl3\n' });
    commitAll(repo.root, 'base');
    writeFiles(repo.root, { 'a.txt': 'l1\nCHANGED\nl3\n' });
    commitAll(repo.root, 'change');
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.root, encoding: 'utf8' }).trim();
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: repo.root, encoding: 'utf8' }).trim();
    const blobBlob = runGit(repo.root, ['diff', '--no-color', `${baseSha}:a.txt`, `${headSha}:a.txt`]);
    fixtures.push({
      name: 'git-diff-blob-blob',
      command: `git diff --no-color ${baseSha}:a.txt ${headSha}:a.txt`,
      cwd: repo.root,
      stdout: blobBlob.stdout,
      exitStatus: blobBlob.exitStatus,
      expected: [],
      files: { 'a.txt': 'l1\nCHANGED\nl3\n' }
    });
  }

  // `git log -p` pickaxe/grep value flags (round-3): `-S`/`-G`/`--grep`/
  // `--since` consume their values as SEPARATE tokens whose colons are
  // value content, never rev:path positionals — `git log -p -S ':auth'` is
  // the classic archaeology idiom (exit 0 against the real binary) and the
  // diff gate must not reject the whole invocation. The glued `-S:auth`
  // control proves exact-token membership keeps glued values safe by
  // construction.
  {
    const repo = makeGitRepo();
    repos.push(repo);
    writeFiles(repo.root, { 'auth.txt': 'line1\nline2\nline3\n' });
    commitAll(repo.root, 'base');
    writeFiles(repo.root, { 'auth.txt': "line1\ntoken ':auth' added\nline2\nline3\n" });
    commitAll(repo.root, 'add :fix token');
    const files = { 'auth.txt': "line1\ntoken ':auth' added\nline2\nline3\n" };
    // The change commit adds the token line (hunk `@@ -1,3 +1,4 @@` →
    // lines 1-4); `--since '2024-01-01T12:00:00'` also shows the base
    // commit's creation hunk (`@@ -0,0 +1,3 @@` → lines 1-3) — the union is
    // still lines 1-4.
    const added = [{ path: 'auth.txt', lineStart: 1, lineEnd: 4 }];
    fixtures.push(
      diffFixture(
        'git-log-pickaxe-space',
        "git log -p --no-color -S ':auth'",
        ['log', '-p', '--no-color', '-S', ':auth'],
        repo.root,
        files,
        added
      )
    );
    fixtures.push(
      diffFixture(
        'git-log-pickaxe-glued',
        'git log -p --no-color -S:auth',
        ['log', '-p', '--no-color', '-S:auth'],
        repo.root,
        files,
        added
      )
    );
    fixtures.push(
      diffFixture(
        'git-log-pickaxe-regex',
        "git log -p --no-color -G ':\\w+'",
        ['log', '-p', '--no-color', '-G', ':\\w+'],
        repo.root,
        files,
        added
      )
    );
    fixtures.push(
      diffFixture(
        'git-log-grep-colon',
        "git log -p --no-color --grep ':fix'",
        ['log', '-p', '--no-color', '--grep', ':fix'],
        repo.root,
        files,
        added
      )
    );
    fixtures.push(
      diffFixture(
        'git-log-since-iso',
        "git log -p --no-color --since '2024-01-01T12:00:00'",
        ['log', '-p', '--no-color', '--since', '2024-01-01T12:00:00'],
        repo.root,
        files,
        added
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

    it('a numbered search with unparseable stdout fails closed — the fallback is unnumbered-only', () => {
      // The response holds no parseable record, so the only way a touch can
      // appear is the whole-file fallback. `rg -n` is a numbered search: its
      // records were requested with positions, and a positionless response
      // is broken (the positions were destroyed, e.g. by a reformatting
      // stage), so the fallback must NOT fire and the parse fails closed.
      // `grep` without -n is the fallback's own regime: the same unparseable
      // stdout still restores the whole-file read.
      const numbered = fixture('rg-one-file');
      expect(numbered.command).toContain('-n');
      expect(
        parseResponse({ command: numbered.command, cwd: numbered.cwd, stdout: 'a line of unparseable output\n' })
      ).toEqual([]);
      const unnumbered = fixture('grep-fallback');
      expect(unnumbered.command).not.toContain('-n');
      expect(
        parseResponse({ command: unnumbered.command, cwd: unnumbered.cwd, stdout: 'a line of unparseable output\n' })
      ).toEqual(sortedSpans(resolveExpected(unnumbered)));
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

    it('the command-text matcher fires before the ANSI rejection', () => {
      // The blame span's evidence is the command text, not the response — an
      // ANSI-laden blame stdout must not suppress it (the ANSI rejection is
      // a response-derived decode gate and cannot apply to a command-derived
      // span; the branch ordering pins that).
      const f = fixture('git-blame-l-range');
      expect(parseResponse({ command: f.command, cwd: f.cwd, stdout: `\x1b[31m${f.stdout}` })).toEqual(
        sortedSpans(resolveExpected(f))
      );
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
      // Magic searches the WHOLE tree from a subdir, so the permitted root
      // anchors to the worktree root found from the effective dir; the
      // cwd-relative records — including the out-of-tree `../2024-log.txt`
      // — resolve against the cwd base and pass containment in that root.
      const ps = fixture('git-grep-pathspec-top');
      expect(ps.stdout).not.toBe('');
      expect(ps.stdout).toContain('../2024-log.txt:1:alpha');
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

  describe('git diff --relative', () => {
    it('bare --relative resolves cwd-relative paths against the effective dir, not the repo root', () => {
      // From a subdir, bare `--relative` emits `a.txt` for sub/a.txt and
      // excludes changes outside the cwd. The decoy root a.txt is also
      // modified: resolving the bare record against the repo root would
      // touch the wrong file, and the no-decoy repo proves the effective-dir
      // resolution is required even when nothing else exists there.
      for (const name of ['git-diff-relative-bare', 'git-diff-relative-bare-nodedoy']) {
        const f = fixture(name);
        expect(f.stdout).toContain('diff --git a/a.txt');
        expect(f.stdout).not.toContain('diff --git a/sub/a.txt');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });

    it('--relative=<path> resolves against the repo root', () => {
      // `--relative=sub` from the root emits `a.txt` for root/sub/a.txt; the
      // record must resolve to the repo-root-anchored path, never a
      // cwd-relative one (the decoy root a.txt would be wrongly touched).
      const f = fixture('git-diff-relative-path');
      expect(f.stdout).toContain('diff --git a/a.txt');
      expect(f.stdout).not.toContain('diff --git a/sub/a.txt');
      expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
    });
  });

  describe('git diff two-arg blob-blob comparisons', () => {
    it('names working-tree paths while reading only blobs — no decode', () => {
      // `git diff <rev>:<path> <rev>:<path>` emits a normal unified diff
      // (`diff --git a/a.txt b/a.txt`) but reads only the two blobs; the
      // worktree a.txt is never touched. Any `:`-containing positional that
      // is not an existing file marks the content idiom, so the diff-shaped
      // stdout must not fabricate touches.
      const f = fixture('git-diff-blob-blob');
      expect(f.stdout).not.toBe('');
      expect(f.stdout).toContain('diff --git a/a.txt b/a.txt');
      expect(parseFixture(f)).toEqual([]);
    });
  });

  describe('git log pickaxe and value flags', () => {
    it('space-form -S/-G/--grep/--since values containing colons decode like the glued control', () => {
      // The pickaxe and log-filter flags consume their values as separate
      // tokens; a colon inside such a value (`-S ':auth'`, `-G ':\w+'`,
      // `--grep ':fix'`, `--since '2024-01-01T12:00:00'`) is value content,
      // never a rev:path positional. The probe previously rejected the whole
      // `git log -p` invocation (0 spans) — a real archaeology idiom that is
      // exit 0 against git 2.47.3. The glued `-S:auth` control rides along:
      // exact-token valueFlags membership keeps glued values safe by
      // construction.
      for (const name of [
        'git-log-pickaxe-space',
        'git-log-pickaxe-glued',
        'git-log-pickaxe-regex',
        'git-log-grep-colon',
        'git-log-since-iso'
      ]) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(f.stdout).toContain('diff --git a/auth.txt');
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

    it('stdin-fed non-git search bins fail closed: piped and redirected records are stream positions', () => {
      // rg/grep with NO path args and stdin fed by a pipe or `<` redirect
      // number the STREAM (`1:needle`), not files. The captured stdout is
      // byte-for-byte what the real binary emits on piped stdin — a shape
      // that would otherwise decode as one-file `line:text` records — and
      // the parser must refuse it entirely. Each fixture asserts the
      // command-level rule, not the record shape.
      for (const name of ['rg-stdin-piped', 'rg-stdin-redirect', 'grep-stdin-piped']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });

    it('git grep is stdin-exempt, and explicit path args keep file semantics', () => {
      // `printf | git grep` still searches the committed tree — git grep
      // never reads stdin — so the whole-tree records decode normally.
      const gg = fixture('git-grep-stdin-exempt');
      expect(sortedSpans(parseFixture(gg))).toEqual(sortedSpans(resolveExpected(gg)));
      // `rg -n needle 9` from coll: `9` is an explicit (digits-named) path
      // arg — the pipe upstream is the search's INPUT, and the one-file
      // layout must attribute the records to coll/9.
      const digit = fixture('rg-stdin-digit-path-arg');
      expect(sortedSpans(parseFixture(digit))).toEqual(sortedSpans(resolveExpected(digit)));
      // Path args present: the records are file positions even when a pipe
      // feeds the stage.
      const withPaths = fixture('rg-stdin-with-path-args');
      expect(sortedSpans(parseFixture(withPaths))).toEqual(sortedSpans(resolveExpected(withPaths)));
    });

    it('renumbering post-gated stages destroy the line correspondence and fail closed', () => {
      // `nl -ba`/`cat -n` prefix their own position column (a phantom line-1
      // span would land at the bottom); `awk {print NR ":" $0}` and
      // `grep -n` overwrite rg's column (every record silently misses its
      // line). None of these responses may produce touches.
      for (const name of ['pipe-rg-nl-ba', 'pipe-rg-cat-n', 'pipe-rg-awk', 'pipe-rg-grep-n']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
      // Control: a truncating stage (`head -2`) cuts records but preserves
      // their positions — the response stays green.
      const head = fixture('pipe-rg-head-2');
      expect(head.stdout).toBe('coll/9:1:needle\n');
      expect(sortedSpans(parseFixture(head))).toEqual(sortedSpans(resolveExpected(head)));
    });

    it('verbatim sed/awk truncators decode to the same spans as the head control', () => {
      // A sed/awk stage whose script provably passes whole records through
      // byte-verbatim cuts the response exactly like `head`: `sed -n '1,2p'`
      // and `sed '12q'` print whole records, `awk 'NR<=2'` and `awk 'NR==1'`
      // select them with the default print action — the round-2 renumberer
      // rule killed these pipelines unconditionally while `| head -2` in the
      // same position stayed green. The allowlist discriminates on the
      // script EXPRESSION only — never on record shape, which would reopen
      // the digit-named-file fabrication class. Each stage is compared
      // against the head stage truncating at its own cut point.
      const controls: Record<string, string> = {
        'pipe-rg-sed-np': 'pipe-rg-head-2-needles',
        'pipe-rg-sed-q': 'pipe-rg-head-12-needles',
        'pipe-rg-awk-le': 'pipe-rg-head-2-needles',
        'pipe-rg-awk-eq': 'pipe-rg-head-1-needles'
      };
      for (const [name, controlName] of Object.entries(controls)) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(f.stdout).toContain(':needle');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(parseFixture(fixture(controlName))));
      }
    });

    it('non-allowlisted sed/awk scripts still fail closed', () => {
      // `s///` rewrites strip the positions, brace/field actions renumber,
      // and `1,2!d` — a range-complement delete that HAPPENS to preserve
      // records — is not one of the provable numeric forms, so it fails
      // closed with everything outside the expression allowlist.
      for (const name of ['pipe-rg-sed-sub', 'pipe-rg-sed-range-delete', 'pipe-rg-awk-print', 'pipe-rg-awk-fields']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Round-3 R3-3: the renumberer closure, inverted to a provably-verbatim
  // allowlist (perl/python/mawk/tr shapes that the old deny list let
  // through)
  // -------------------------------------------------------------------------

  describe('renumberer closure — inverted allowlist default (round-3 R3-3)', () => {
    it('unlisted renumberers over digit-named files fail closed', () => {
      // `perl -ne 'print "$.:$_"'`, python3, and mawk all prepend their
      // stream ordinal to each record (`1:1:1:needle`), so every record
      // decodes as path=ordinal at line=ordinal — phantom lines on
      // digits/2 and digits/3 while the genuine line-1 matches go
      // unrecorded. None of the bins is provably verbatim, so each whole
      // pipeline must attribute nothing.
      for (const name of ['pipe-rg-perl-renumber', 'pipe-rg-python-renumber', 'pipe-rg-mawk-renumber']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });

    it('tr digit rewrites and digit deletions fail closed', () => {
      // `tr '1' '9'` substitutes digits inside the line-number column
      // (line 12 becomes 92 — a phantom line); `tr -d '0-9'` deletes the
      // line numbers outright (record shape destroyed). Neither is a
      // shape-preserving deletion, so both fail closed.
      for (const name of ['pipe-rg-tr-sub', 'pipe-rg-tr-d-digits']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });

    it('verbatim perl truncators decode like the head control', () => {
      // A stream-position guard with bare `print` emits `$_` byte-verbatim
      // (including its trailing newline — records stay complete for the
      // terminating-newline rule), so the selected records keep the gated
      // stage's file lines: `perl -ne 'print if $. <= 2'` equals the head
      // -2 control, and `print if $. == 2` pins a single line-2 span.
      const truncate = fixture('pipe-rg-perl-truncate');
      expect(truncate.stdout).not.toBe('');
      expect(truncate.stdout).toContain(':needle');
      expect(sortedSpans(parseFixture(truncate))).toEqual(sortedSpans(resolveExpected(truncate)));
      expect(sortedSpans(parseFixture(truncate))).toEqual(sortedSpans(parseFixture(fixture('pipe-rg-head-2-needles'))));
      const single = fixture('pipe-rg-perl-single');
      expect(single.stdout).not.toBe('');
      expect(sortedSpans(parseFixture(single))).toEqual(sortedSpans(resolveExpected(single)));
      // The split `-n -e` argv form is allowlisted identically: same
      // script, same stdout, same spans.
      expect(
        sortedSpans(
          parseResponse({
            command: `rg -n needle src/needles.ts | perl -n -e 'print if $. <= 2'`,
            cwd: truncate.cwd,
            stdout: truncate.stdout,
            exitStatus: truncate.exitStatus
          })
        )
      ).toEqual(sortedSpans(resolveExpected(truncate)));
    });

    it('shape-preserving tr -d stays open; plain digit-named searches and plain grep filters too', () => {
      // `tr -d '\r'` (the CRLF idiom) deletes a set with no digits, colons,
      // or newline escapes — the LF-terminated records pass through
      // byte-verbatim, so the spans surface.
      const crlf = fixture('pipe-rg-tr-crlf');
      expect(crlf.stdout).not.toBe('');
      expect(sortedSpans(parseFixture(crlf))).toEqual(sortedSpans(resolveExpected(crlf)));
      // A plain `rg -n needle 1 2 3` over the digit-named files (no later
      // stage) keeps its genuine spans — the files are real, so the
      // existence backstop passes them through.
      const digits = fixture('rg-digits-named-args');
      expect(digits.stdout).not.toBe('');
      expect(sortedSpans(parseFixture(digits))).toEqual(sortedSpans(resolveExpected(digits)));
      // A plain grep filter without numbered evidence passes whole records
      // through verbatim — the spans survive.
      const skip = fixture('pipe-rg-grep-v-skip');
      expect(sortedSpans(parseFixture(skip))).toEqual(sortedSpans(resolveExpected(skip)));
    });
  });

  // -------------------------------------------------------------------------
  // Round-4 R4-2: file operands on the pass-through allowlist (cat, the six
  // bins, the grep family) read a FILE instead of the pipe — fabricated
  // records
  // -------------------------------------------------------------------------

  describe('file operands close the pass-through allowlist (round-4 R4-2)', () => {
    it('every allowlisted bin fails closed on a file operand', () => {
      // Each stage names `crafted.txt` (records `2:2:needle at 2`,
      // `3:1:needle at 3`) — the bin reads THAT file instead of the pipe,
      // and the crafted records decode as phantom spans: file 2 line 2 is a
      // no-match line (the genuine match is line 1), and file 3 was never
      // searched by the gated stage at all. The `--` terminator form is
      // closed the same way. Without the guard the fabricated spans would
      // surface, so each fixture asserts non-empty stdout AND zero spans.
      const names = [
        'pipe-rg-file-operand-cat',
        'pipe-rg-file-operand-cat-terminator',
        'pipe-rg-file-operand-head',
        'pipe-rg-file-operand-tail',
        'pipe-rg-file-operand-sort',
        'pipe-rg-file-operand-grep',
        'pipe-rg-file-operand-grep-e',
        'pipe-rg-file-operand-rg',
        'pipe-rg-file-operand-one-file-cat'
      ];
      for (const name of names) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });

    it('stdin markers, bare cat, and pattern-only grep filters stay open', () => {
      // `cat -` (the stdin marker), bare `cat`, and `grep -e needle` (the
      // pattern comes from a flag value — no positionals) all read the
      // pipe, so the genuine spans of the gated `rg -n needle 1 2` survive.
      for (const name of ['pipe-rg-cat-stdin', 'pipe-rg-cat-bare', 'pipe-rg-grep-e-pattern']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });
  });

  describe('chain siblings close the pipeline gate in both directions (round-5 R5-1)', () => {
    it('every chain sibling reading a crafted file fails closed — either order, every joiner', () => {
      // A `;`/`&&`/`||`/newline sibling (either direction) mixes its own
      // output into the SAME response, so a crafted file read by any of
      // them decodes as phantom spans. The `||` no-match form leaves the
      // ENTIRE response as the crafted file; the earlier-stage forms put
      // the crafted records before the genuine ones; the pipe-then-chain
      // form carries a verbatim pipe stage ahead of the crafted chain
      // stage; the perl/awk forms renumber the crafted file into stream
      // positions; `&& echo done` proves a non-allowlisted after-stage
      // closes even when it emits no records. Every fixture asserts
      // non-empty stdout AND zero spans.
      const names = [
        'chain-sibling-semicolon',
        'chain-sibling-andand',
        'chain-sibling-oror-nomatch',
        'chain-sibling-newline',
        'chain-sibling-echo-after',
        'chain-sibling-perl-renumber',
        'chain-sibling-awk-renumber',
        'chain-sibling-earlier-cat',
        'chain-sibling-earlier-echo',
        'chain-sibling-pipe-then-chain'
      ];
      for (const name of names) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });

    it('verbatim chain siblings and consumed pipe feeders stay open', () => {
      // `head -2` as a chain sibling reads the closed stdin and adds
      // nothing, so the gated stage's records decode intact; `cat 1 | rg
      // -n needle 2` feeds the gated stage through a pipe, which it
      // ignores (explicit roots), so the feeder's records never reach the
      // response.
      for (const name of ['chain-sibling-head-verbatim', 'chain-feeder-consumed']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });
  });

  describe('pattern-from-flag search roots (round-5 precision)', () => {
    it('a pattern from -e/-f/--regexp/--file makes every positional a root', () => {
      // When the pattern comes from a flag value (separate or glued), the
      // gated stage's positionals are all search roots: the single-file
      // forms hit the one-file layout and the multi-file form anchors both
      // roots, instead of the first positional being eaten as the pattern
      // and the touches lost.
      const names = ['rg-e-one-file', 'rg-e-multi', 'grep-f-patternfile', 'rg-regexp-glued', 'rg-e-glued'];
      for (const name of names) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });
  });

  describe('glued stdin redirects fail closed (round-6 R6-1)', () => {
    it('a `<` glued to a flag, pattern, or value token redirects stdin — every shape fails closed with non-empty stdout', () => {
      // `head -2<crafted.txt` is `head -2 < crafted.txt` to bash, but argv
      // splitting never surfaces a standalone `<` token: verbatim bins and
      // grep-family siblings read the crafted file instead of the pipe, and
      // a gated rg/grep whose `-e`/`-f` VALUE carries the redirect (no roots
      // left) becomes a stdin-fed search. Every fixture asserts non-empty
      // stdout AND zero spans — the crafted records must never decode.
      const names = [
        'pipe-rg-glued-redirect-head',
        'pipe-rg-glued-redirect-head-lines',
        'pipe-rg-glued-redirect-sort',
        'pipe-rg-glued-redirect-grep',
        'pipe-rg-glued-redirect-grep-e',
        'chain-sibling-glued-redirect-semicolon',
        'chain-sibling-glued-redirect-pipe-head',
        'gated-glued-redirect-rg-e',
        'gated-glued-redirect-grep-e',
        'gated-glued-redirect-rg-f',
        'gated-glued-redirect-grep-f'
      ];
      for (const name of names) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(parseFixture(f)).toEqual([]);
      }
    });

    it('a quoted literal `<` and a glued redirect with explicit roots stay open', () => {
      // `rg -n 'x<needle' lt.ts` — the `<` is INSIDE the quotes, so bash
      // reads it as part of the pattern, never as a redirect; and
      // `rg -n -e needle<crafted.txt 1 2` — the glued redirect is present,
      // but explicit roots make the search ignore stdin, so the genuine
      // records decode.
      for (const name of ['rg-quoted-angle-pattern', 'rg-e-glued-redirect-roots']) {
        const f = fixture(name);
        expect(f.stdout).not.toBe('');
        expect(sortedSpans(parseFixture(f))).toEqual(sortedSpans(resolveExpected(f)));
      }
    });
  });

  describe('distinct-span cap', () => {
    // The recursive layout's existence backstop drops records whose decoded
    // path is not a real file, so the synthetic cap fixtures need f01..f60
    // to actually exist in the repo during the test.
    const capFiles = Array.from({ length: 60 }, (_, i) => `f${String(i + 1).padStart(2, '0')}.ts`);
    beforeAll(() => {
      for (const name of capFiles) writeFileSync(join(root, name), 'x\n');
    });
    afterAll(() => {
      for (const name of capFiles) rmSync(join(root, name), { force: true });
    });

    it('caps at MAX_RESPONSE_SPANS, fail-closed beyond, never capping a coalesced window', () => {
      // Synthetic recursive output over N distinct files, all real on disk
      // (the existence backstop passes them through). At the cap every span
      // surfaces; beyond it exactly the cap is emitted in deterministic path
      // order and the rest fail closed.
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
      // The backstop itself: a decoded path that does not exist on disk
      // never touches, even when the record is well-formed.
      const ghost = parseResponse({ command: 'rg -n foo', cwd: root, stdout: 'f99.ts:1:x\n' });
      expect(ghost).toEqual([]);
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
