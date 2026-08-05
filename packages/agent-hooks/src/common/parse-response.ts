/**
 * Response-aware derivation of read-touch spans from Bash `tool_response`
 * output, for the grep/ripgrep command families that parse-command.ts
 * deliberately cannot classify from command text alone: the window is anchored
 * to match position, which is data-dependent and lives in the response, not
 * the command. parseResponse is the second evidence source the Claude and
 * Codex adapters merge with parseCommand's spans.
 *
 * The common/ layer convention is load-bearing: modules import only `node:`
 * builtins and sibling modules — zero SDK imports. Envelope normalization
 * (`tool_response` → ResponseParseInput) happens in the adapters, which hand
 * the already-normalized shape down here.
 *
 * Phase 3a of the TDD bootstrap (plans/initial.md) is live: command gating,
 * scope restriction against the command's declared roots, ANSI rejection, the
 * five search-layout decoders, whole-file fallback, and coalescing. Phase 3b
 * added the unified-diff decoder (`git diff`, diff-form `git show`, `git log
 * -p`) with binary/combined/submodule rejection, and Phase 3c the
 * `git blame -L N,M file` command-text matcher. The evaluation fixes add the
 * decisions the plan's risk section deferred, all documented here:
 *
 * - **Truncation, two regimes** (plan step 6): `truncated: true` (the
 *   adapter's `rawOutputPath` preview marker) means parse nothing —
 *   response-derived decode fails closed. `interrupted: true` is the
 *   plan's complete-records regime: fully-terminated records parse and the
 *   incomplete tail drops via the unconditional terminating-newline rule,
 *   so the flag changes nothing the default path already does — it is
 *   contract documentation the adapters map `interrupted` onto (a later
 *   phase changes the adapters; until then they collapse it into
 *   `truncated`, which fails closed safely). Neither flag applies to the
 *   command-text-derived `git blame -L N,M` matcher, whose evidence is the
 *   command, not the response.
 * - **Span cap**: `MAX_RESPONSE_SPANS` bounds how many distinct spans a
 *   response may emit. Measured through the deployed hook, each span costs
 *   ~46 ms of subprocess execs in the touch core (resolveTouchScope + `git
 *   span list` per span; the session memo makes repeat runs cheap, but first
 *   runs pay the full price), against a 10 s hooks.json timeout. 50 spans ≈
 *   2.3 s worst case — well under the timeout with margin even with the
 *   command-derived spans on top. Beyond the cap the bounded set is emitted
 *   (the first 50 in deterministic path order) and the rest fail closed:
 *   every emitted span is a genuine fully-observed record, so emitting the
 *   bounded set invents nothing, and dropping the excess keeps hook latency
 *   bounded on exactly the pathological searches that would otherwise stall
 *   the agent loop. One coalesced span covering a huge window counts once.
 * - **Pipelines**: the response is attributed to the FIRST gated stage
 *   (left-to-right walk; if no stage gates, nothing to parse). In a pipeline
 *   the final stage's stdout is the gated stage's output (head/wc/tail only
 *   truncate; the terminating-newline rule handles the cut), and in an
 *   &&/||/; chain the first gated stage is the most likely owner of
 *   response-shaped records. `cd` tracking applies only until the first
 *   gated stage is found — the evidence was produced in that directory.
 * - **`git show <rev>:<path>`** (raw blob content) is excluded from the diff
 *   gate; a diff-shaped blob must never decode into fabricated touches. The
 *   content idiom is detectable from the command: a `show` positional
 *   containing `:` is a rev:path, not a revision.
 * - **Diff paths are repo-root-relative**: git emits `a/src/x.ts` in diff
 *   output regardless of cwd, so diff decode anchors to the worktree root
 *   (found by walking up from the effective dir for a `.git` entry — no
 *   subprocess, the common layer imports only node: builtins). Search-layout
 *   paths are cwd-relative and keep resolving against the effective dir.
 * - **Unnumbered output never parses as numbered**: the one-file layout
 *   requires command-side numbered evidence (`-n`/`--line-number`), exactly
 *   one explicit file argument that is a real file, no `-H`
 *   (--with-filename, which forces path prefixes), and cross-record
 *   consistency (every record parses as `line:text`). The heading layout
 *   requires the numbered evidence too. A digits-leading record that fails
 *   these checks falls through to the recursive layout — a pure-digits
 *   filename ("9", "123") emitted first must not collapse a whole search to
 *   the one-file layout, and content that merely looks numbered must not
 *   invent positions. Git pathspec magic (`:/`, `:!`, `:^`, `:(...)`) is not
 *   a filesystem path and never becomes a permitted root. `git grep <rev>`
 *   fuses the rev into record paths (`HEAD:a.ts:3:…`); those records drop as
 *   path-ambiguous — fail-closed and defensible, since the rev is known but
 *   stripping it would guess at a path the response does not carry.
 * - **Context records with dashes in the path** decode by anchoring to the
 *   exact paths the response's `path:line:text` match records establish,
 *   with the dash split as the dash-free fallback — a `-C` window on
 *   `src/my-file.ts` must not collapse to the bare match line.
 *
 * The acceptance checks in test/common/parse-response.test.ts were written
 * in Phase 2.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { countFileLines } from './command-resolve.js';
import type { ResolvedSpan } from './parse-command.js';
import { argvOf, splitTopLevel } from './shell-split.js';

/**
 * The normalized tool-response input the adapters hand the shared parser.
 * `stdout` is the (possibly preview) output text; `stderr` and `exitStatus`
 * are carried for diagnostics and are never parse gates — `git diff
 * --exit-code` exits 1 on differences, so exit status must not be treated as
 * failure. Plan step 6's two truncation regimes are distinct fields:
 *
 * - `truncated` (Claude `rawOutputPath` set ⇒ inline stdout is only a
 *   preview) is strict mode: response-derived decode parses nothing and
 *   invents no touches. The command-text-derived `git blame -L` matcher is
 *   exempt — its evidence is the command, not the response.
 * - `interrupted` is the complete-records regime: fully-terminated records
 *   parse and the incomplete tail drops. The unconditional terminating-
 *   newline rule already does exactly that, so the flag is contract
 *   documentation the adapters map `interrupted: true` onto; it never
 *   suppresses a response the default path would parse.
 */
export interface ResponseParseInput {
  command: string;
  cwd: string;
  stdout: string;
  stderr?: string;
  exitStatus?: number; // metadata only — never gates (git diff exits 1 on differences)
  truncated?: boolean;
  interrupted?: boolean;
}

/**
 * The maximum number of distinct spans `parseResponse` may emit. Measured
 * through the deployed hook, each span costs ~46 ms of subprocess execs in
 * the touch core (resolveTouchScope + `git span list` per span; the session
 * memo makes repeat runs cheap, but first runs pay the full price) against a
 * 10 s hooks.json timeout — 50 spans ≈ 2.3 s worst case, well under the
 * timeout with margin even with the command-derived spans on top. The plan's
 * risk section deferred this cap ("fail closed beyond it") to a Phase 3a
 * measurement; the golden matrix's largest realistic outputs stay far below
 * it, so it binds only pathological searches.
 */
export const MAX_RESPONSE_SPANS = 50;

/**
 * A single decoded search-output record. The path/line split is layout-
 * dependent: `path:line:text` (recursive), `path-line:text` (context lines in
 * -A/-B/-C groups carry no number — `line` is null and the record advances
 * the per-file counter instead), `line:text` (one-file layout), or a
 * NUL-terminated `path:1:…` record (`-z`).
 */
export interface SearchRecord {
  path: string;
  /** The record's line number, or null for context lines without one. */
  line: number | null;
  text: string;
}

/** The recognized search output layouts the decoders distinguish. */
export type SearchLayout = 'recursive' | 'context' | 'heading' | 'null-separated' | 'one-file';

/**
 * One file's section of a unified-diff response. `oldPath`/`newPath` are the
 * `a/`-`b/`-prefixed sides with the prefix stripped; null for `/dev/null`
 * (new-file / deleted-file sides).
 */
export interface DiffFileRecord {
  oldPath: string | null;
  newPath: string | null;
  /**
   * Rename/copy metadata (`rename from`/`rename to`, `copy from`/`copy to`):
   * the new path is the touch target.
   */
  rename: { from: string; to: string } | null;
  binary: boolean;
  combined: boolean;
  submodule: boolean;
  hunks: DiffHunk[];
}

/**
 * A unified-diff hunk header (`@@ -a,b +c,d @@`); an omitted count means 1.
 * Per-side ranges are `oldStart..oldStart+oldCount-1` on the old path and
 * `newStart..newStart+newCount-1` on the new path.
 */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

// ---------------------------------------------------------------------------
// Command analysis
// ---------------------------------------------------------------------------

const SEARCH_BINS = new Set(['rg', 'grep', 'egrep', 'fgrep']);

/**
 * Short options that consume a value (rg/grep): -A/-B/-C (context), -e/-f
 * (pattern/file), -m (max count), -g/-t/-T (rg type/glob). Anything else in a
 * short cluster is a plain flag.
 */
const VALUE_SHORT_FLAGS = new Set(['A', 'B', 'C', 'e', 'f', 'm', 'g', 't', 'T']);

/** Long options that consume a separate value argument. */
const VALUE_LONG_FLAGS = new Set([
  'after-context',
  'before-context',
  'context',
  'max-count',
  'regexp',
  'file',
  'glob',
  'iglob',
  'type',
  'type-not',
  'include',
  'exclude',
  'exclude-dir',
  'exclude-from'
]);

function hasShellExpansion(s: string): boolean {
  return /[$`]/.test(s);
}

interface SearchArgvInfo {
  /** Positional path args after the pattern; empty when the command named none. */
  pathArgs: string[];
  /** Whether -A/-B/-C (any context window) was requested. */
  contextFlags: boolean;
  /**
   * Whether the command requested line numbers (`-n`/`--line-number`). rg and
   * grep both default to NO line numbers when piped, so this is the
   * command-side evidence that `line:text`-only output is numbered output —
   * the one-file and heading layouts refuse to apply without it.
   */
  numbered: boolean;
  /** Whether `-H`/`--with-filename` was requested — records carry path prefixes even for a single file. */
  withFilename: boolean;
}

/**
 * Whether `p` is a git pathspec magic prefix (`:/`, `:!`, `:^`, `:(...)`) —
 * a non-filesystem path form that must never become a permitted root. A
 * literal `cwd/:/` root would reject every decoded record; treating pathspec
 * magic like no path args lets roots fall back to the effective cwd.
 */
function isPathspecMagic(p: string): boolean {
  return /^:[/!^.(]/.test(p);
}

/**
 * Scan a search command's argv (starting after the binary, or after the
 * `grep` subcommand for git grep) for the positional args and context flags,
 * consuming option values so they are never mistaken for positionals.
 */
function analyzeSearchArgv(argv: string[], start: number): SearchArgvInfo {
  const positionals: string[] = [];
  let contextFlags = false;
  let numbered = false;
  let withFilename = false;
  let i = start;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (name === 'after-context' || name === 'before-context' || name === 'context') contextFlags = true;
      if (name === 'line-number') numbered = true;
      if (name === 'with-filename') withFilename = true;
      if (eq === -1 && VALUE_LONG_FLAGS.has(name)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (a.startsWith('-') && a !== '-' && a.length > 1) {
      let consumesNext = false;
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === 'A' || c === 'B' || c === 'C') contextFlags = true;
        if (c === 'n') numbered = true;
        if (c === 'H') withFilename = true;
        if (VALUE_SHORT_FLAGS.has(c)) {
          // A value-taking flag consumes the rest of the cluster as its value
          // (-C1) or, when last, the next argument (-C 1).
          consumesNext = j === a.length - 1;
          break;
        }
      }
      i += consumesNext ? 2 : 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  // The first positional is the pattern; the rest are explicit search roots.
  // Git pathspec magic is not a filesystem path and never becomes a root.
  const pathArgs = positionals.length > 0 ? positionals.slice(1).filter((p) => !isPathspecMagic(p)) : [];
  return { pathArgs, contextFlags, numbered, withFilename };
}

interface GitSubcommandInfo {
  /** The `git -C` directory, when present and statically resolvable. */
  dir: string | null;
  dirUnresolvable: boolean;
  /** The subcommand token (`grep`, `diff`, `show`, `log`, `blame`, …). */
  subcommand: string;
  /** Index just past the subcommand, where its argv begins. */
  start: number;
}

/**
 * Locate the subcommand token of a `git` command, honoring `-C`/`-c` like
 * parse-command.ts's findGitSubcommand. Returns null when no subcommand
 * token appears (bare `git`). Which subcommands response-decode is the
 * gate's call, not this scanner's.
 */
function findGitSubcommand(argv: string[]): GitSubcommandInfo | null {
  let dir: string | null = null;
  let dirUnresolvable = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-C') {
      const v = argv[i + 1];
      if (v === undefined) return null;
      if (hasShellExpansion(v)) dirUnresolvable = true;
      else dir = v;
      i += 2;
      continue;
    }
    if (a === '-c') {
      i += 2;
      continue;
    }
    if (a.startsWith('-')) {
      i += 1;
      continue;
    }
    return { dir, dirUnresolvable, subcommand: a, start: i + 1 };
  }
  return null;
}

/** A response-derivable command that passed the gate, with its decoder's inputs. */
type GatedCommand = {
  kind: 'search' | 'diff' | 'blame';
  argv: string[];
  /** Index just past the binary (search) or subcommand (git), where its argv begins. */
  start: number;
  /** The `git -C` directory, when present and statically resolvable. */
  dir: string | null;
  dirUnresolvable: boolean;
};

/** Whether a `git log` invocation is diff-form (`-p`/`--patch` present). */
function hasDiffPatchFlag(argv: string[], start: number): boolean {
  for (let i = start; i < argv.length; i++) {
    if (argv[i] === '-p' || argv[i] === '--patch') return true;
  }
  return false;
}

/**
 * Whether a `git show` invocation is the `<rev>:<path>` content idiom whose
 * stdout is the blob's RAW content, never diff-form. `git show` positionals
 * are revisions, and only a rev:path spec embeds a colon — a diff-shaped
 * vendored blob (a .patch, a format-patch archive) must not decode into
 * fabricated touches on the files its content names. Option values are
 * skipped so `--format %H:%s` (which legitimately contains a colon) cannot
 * false-positive; after `--` the tokens are literal pathspecs, not revs.
 * Only flags that consume a SEPARATE argument skip their value: `--stat` and
 * `--dirstat` take theirs via `=` (`--dirstat=files,10`) or not at all, so a
 * `git show --stat <rev>:<path>` must not swallow the rev:path as a value.
 */
function hasRevPathArg(argv: string[], start: number): boolean {
  const valueFlags = new Set(['--format', '--pretty', '--output', '--word-diff-regex']);
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return false;
    if (a.startsWith('-') && a !== '-') {
      if (!a.includes('=') && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(':')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

/**
 * The lines of `stdout` whose terminating newline is present in the response
 * text. The final split element is either the empty string left by a trailing
 * newline or an unterminated partial record — either way it is not a record,
 * so it is always dropped (the universal truncation rule).
 */
function completeLines(stdout: string): string[] {
  const lines = stdout.split('\n');
  lines.pop();
  return lines;
}

/**
 * Whether every non-empty record of a `line:text` response parses as
 * numbered — the cross-record consistency check that keeps one-file
 * attribution from resting on a single record's shape.
 */
function recordsAreOneFile(stdout: string): boolean {
  const lines = completeLines(stdout);
  if (lines.length === 0) return false;
  return lines.every((line) => line === '' || parseOneFileRecord(line) !== null);
}

/**
 * Decide which search layout a response uses from the shape of its first
 * record, consulting the command's context flags to break the recursive /
 * context ambiguity (both emit `path:line:text` match records). Fail closed:
 * an unrecognized first record means nothing in this response is trusted.
 *
 * The `line:text`-only layouts (one-file, heading) require command-side
 * numbered evidence: rg and grep default to NO line numbers when piped, so a
 * digits-leading record without `-n`/`--line-number` is content, not a
 * position — `grep TODO notes.md` whose matching line is `123: TODO item`
 * must not touch line 123, and `rg -l alpha 2024-log.txt` must not touch
 * line 2024. The one-file layout additionally requires exactly one explicit
 * file argument that is a real file (a directory or no args means records
 * carry path prefixes — a pure-digits filename emitted first must fall
 * through to recursive), no `-H`/`--with-filename` (which forces path
 * prefixes), and cross-record consistency via `recordsAreOneFile`.
 */
function detectLayout(stdout: string, info: SearchArgvInfo, oneFileEligible: boolean): SearchLayout | null {
  if (stdout.includes('\0')) return 'null-separated';
  const lines = completeLines(stdout);
  const first = lines.find((line) => line !== '');
  if (first === undefined) return null;
  if (/^\d+[-:]/.test(first)) {
    if (oneFileEligible && recordsAreOneFile(stdout)) return 'one-file';
    // Not the one-file layout: fall through — a digits-leading record is
    // more plausibly the `path:line:text` record of a digits-named file,
    // which the recursive checks below pick up.
  }
  if (/^[^:]+:\d+/.test(first)) return info.contextFlags ? 'context' : 'recursive';
  // A context window can open with a context record (its -B side), whose
  // `path-line-text` shape is ambiguous when the path itself contains a
  // dash — `src/my-file.ts-2-one` splits inside the path. Every context
  // group is anchored to a `path:line:text` match record whose colon split
  // is unambiguous, so the response's own match records detect the layout.
  if (info.contextFlags && lines.some((line) => line !== '' && /^[^:]+:\d+/.test(line))) return 'context';
  if (/^[^-:]+-\d+-/.test(first)) return info.contextFlags ? 'context' : null;
  if (info.numbered && /^[^:]+$/.test(first)) return 'heading';
  return null;
}

// ---------------------------------------------------------------------------
// Record parsing
// ---------------------------------------------------------------------------

/**
 * Split a record on its first two occurrences of `sep` (the layout's
 * path/line/text separators), so separators inside the text are safe. A path
 * containing a colon, a non-numeric line token, or an empty path is
 * path-ambiguous and dropped.
 */
function parseRecord(line: string, sep: string): { path: string; line: number; text: string } | null {
  const first = line.indexOf(sep);
  if (first === -1) return null;
  const second = line.indexOf(sep, first + 1);
  if (second === -1) return null;
  const path = line.slice(0, first);
  const lineToken = line.slice(first + 1, second);
  const text = line.slice(second + 1);
  if (path === '' || path.includes(':')) return null;
  if (!/^\d+$/.test(lineToken)) return null;
  const lineNumber = Number.parseInt(lineToken, 10);
  if (lineNumber <= 0) return null;
  return { path, line: lineNumber, text };
}

/** One numbered record in the one-file/heading `line:text` or `line-text` style. */
function parseOneFileRecord(line: string): { line: number; text: string } | null {
  const m = /^(\d+)([:-])/.exec(line);
  if (m === null) return null;
  const lineNumber = Number.parseInt(m[1], 10);
  if (lineNumber <= 0) return null;
  return { line: lineNumber, text: line.slice(m[0].length) };
}

/**
 * Decode a context record (`path-line-text`) by anchoring it to the exact
 * paths the response's `path:line:text` match records established: the
 * record must start with a known path followed by `-line-text`. Longest path
 * first, so a path that is a prefix of another (`a-b.ts` vs `a-b-c.ts`)
 * can't shadow it. A dash inside a path makes the plain dash split
 * ambiguous (`src/my-file.ts-4-ctx` splits inside the path and its line
 * token comes out non-numeric), which is why the known-path anchor exists.
 */
function parseContextRecord(line: string, knownPaths: string[]): { path: string; line: number; text: string } | null {
  for (const path of knownPaths) {
    if (!line.startsWith(`${path}-`)) continue;
    const tail = line.slice(path.length + 1);
    const m = /^(\d+)-/.exec(tail);
    if (m === null) continue;
    const lineNumber = Number.parseInt(m[1], 10);
    if (lineNumber <= 0) continue;
    return { path, line: lineNumber, text: tail.slice(m[0].length) };
  }
  return null;
}

/** 1-based line count of response text that holds an entire file's content. */
function lineCount(text: string): number {
  if (text === '') return 0;
  const withoutTrailingNewline = text.endsWith('\n') ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split('\n').length;
}

// ---------------------------------------------------------------------------
// Layout decoders
// ---------------------------------------------------------------------------

/**
 * Decode `stdout` into search records for `layout`. One-file records are
 * attributed to `singleFileArg` (the command's sole explicit file); for any
 * other layout the record paths are the response's own. Null-separated
 * records carry `line: null` and the full file content in `text`, because the
 * only well-defined touch for a `path:1:…` record holding an entire file is
 * the whole file.
 */
function decodeSearchLayout(layout: SearchLayout, stdout: string, singleFileArg: string | null): SearchRecord[] {
  const records: SearchRecord[] = [];
  switch (layout) {
    case 'recursive':
      for (const line of completeLines(stdout)) {
        const rec = parseRecord(line, ':');
        if (rec !== null) records.push(rec);
      }
      break;
    case 'context': {
      // Match records are `path:line:text`; context records are
      // `path-line-text` (the separator is a dash wherever a match record
      // would use a colon). Both carry the real line number; `--` group
      // separators are not records. A dash inside a path breaks the dash
      // split, so the response's match records first establish the files'
      // exact paths and each context record is anchored to a known path
      // prefix before its `-line-text` tail, with the dash-free default as
      // the fallback. Context records can precede their match (-B windows),
      // so the known set is built in a first pass over all lines.
      const lines = completeLines(stdout);
      const known = new Set<string>();
      for (const line of lines) {
        if (line === '--') continue;
        const rec = parseRecord(line, ':');
        if (rec !== null) known.add(rec.path);
      }
      const knownSorted = [...known].sort((a, b) => b.length - a.length);
      for (const line of lines) {
        if (line === '--') continue;
        const rec = parseRecord(line, ':') ?? parseContextRecord(line, knownSorted) ?? parseRecord(line, '-');
        if (rec !== null) records.push(rec);
      }
      break;
    }
    case 'heading':
      // A file header line, then `line:text` records; blank lines separate
      // file sections; any non-record line starts the next file's section.
      {
        let current: string | null = null;
        for (const line of completeLines(stdout)) {
          if (line === '') continue;
          const rec = parseOneFileRecord(line);
          if (rec === null) {
            current = line;
          } else if (current !== null) {
            records.push({ path: current, line: rec.line, text: rec.text });
          }
        }
      }
      break;
    case 'one-file':
      if (singleFileArg !== null) {
        for (const line of completeLines(stdout)) {
          const rec = parseOneFileRecord(line);
          if (rec !== null) records.push({ path: singleFileArg, line: rec.line, text: rec.text });
        }
      }
      break;
    case 'null-separated':
      // `grep -z`: each matching file arrives as one NUL-terminated
      // `path:1:<entire file content>` record. The record is fully observed
      // only when its terminating NUL is present.
      {
        const parts = stdout.split('\0');
        if (!stdout.endsWith('\0')) parts.pop();
        for (const part of parts) {
          if (part === '') continue;
          const rec = parseRecord(part, ':');
          if (rec === null || rec.line !== 1) continue;
          records.push({ path: rec.path, line: null, text: rec.text });
        }
      }
      break;
  }
  return records;
}

// ---------------------------------------------------------------------------
// Scope restriction and coalescing
// ---------------------------------------------------------------------------

/** Whether `abs` resolves inside one of the permitted roots (path-prefix containment). */
function insideRoot(abs: string, roots: string[]): boolean {
  for (const root of roots) {
    if (abs === root || abs.startsWith(root + sep)) return true;
  }
  return false;
}

/** Whether `abs` is an existing regular file (following symlinks). */
function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * The git worktree root containing `startDir`, found by walking up for the
 * first directory holding a `.git` entry — a directory in a regular repo, a
 * `gitdir:` file in a linked worktree or submodule. Diff-form output paths
 * are repo-root-relative regardless of cwd, so diff decode resolves against
 * this root rather than the effective dir; search-layout paths are
 * cwd-relative and stay anchored to the effective dir. No subprocess — the
 * common layer imports only node: builtins. Null when `startDir` is not
 * inside any worktree; diff output is then suspect and the parse fails
 * closed.
 */
function findGitRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Order spans deterministically and cap the count (fail-closed beyond
 * `MAX_RESPONSE_SPANS`): the first 50 spans in path order are emitted, the
 * rest are dropped. Normal parses keep their emission order — the sort only
 * engages when the cap binds.
 */
function capSpans(spans: ResolvedSpan[]): ResolvedSpan[] {
  if (spans.length <= MAX_RESPONSE_SPANS) return spans;
  const ordered = [...spans].sort(
    (a, b) => a.absolutePath.localeCompare(b.absolutePath) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd
  );
  return ordered.slice(0, MAX_RESPONSE_SPANS);
}

/**
 * Coalesce per-file line numbers into contiguous ranges; adjacent and
 * overlapping lines merge, and duplicates never create duplicate surfaces.
 */
function coalesce(lines: number[]): Array<[number, number]> {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n <= end + 1) {
      if (n > end) end = n;
    } else {
      ranges.push([start, end]);
      start = n;
      end = n;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

/**
 * Resolve per-file line sets into spans: paths resolve against `baseDir`,
 * must sit inside one of the permitted `roots` (a traversal path normalizes
 * outside them and is rejected), and their lines coalesce into contiguous
 * ranges.
 */
function spansFor(perFile: Map<string, Set<number>>, baseDir: string, roots: string[]): ResolvedSpan[] {
  const spans: ResolvedSpan[] = [];
  for (const [path, lines] of perFile) {
    const abs = resolvePath(baseDir, path);
    if (!insideRoot(abs, roots)) continue;
    for (const [lineStart, lineEnd] of coalesce([...lines])) {
      spans.push({ lineStart, lineEnd, absolutePath: abs });
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------
// Unified-diff decoder (`git diff`, diff-form `git show`, `git log -p`)
// ---------------------------------------------------------------------------

/**
 * A unified-diff hunk header: `@@ -a[,b] +c[,d] @@`; omitted counts mean 1.
 * A cut-off header (missing the closing `@@`) does not match and its hunk is
 * ignored. Combined-diff `@@@` headers do not match (their records are
 * rejected at the `diff --cc` line anyway).
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Strip the `a/`/`b/` prefix a unified-diff path carries. */
function stripDiffPrefix(p: string): string {
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

/**
 * Parse a `diff --git a/old b/new` file header, `diff --cc`/`--combined`
 * (a real merge-conflict combined diff: no ranges), or return null for
 * non-header lines. A header whose paths are quoted is unparseable — the
 * plan's fail-closed rule for quoted/unescapable paths.
 */
function parseDiffHeader(
  line: string
):
  | { kind: 'file'; oldPath: string | null; newPath: string | null }
  | { kind: 'combined' }
  | { kind: 'unparseable' }
  | null {
  if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) return { kind: 'combined' };
  if (!line.startsWith('diff --git ')) return null;
  const tokens = line.slice('diff --git '.length).trim().split(/\s+/);
  if (tokens.length !== 2 || tokens[0].startsWith('"') || tokens[1].startsWith('"')) return { kind: 'unparseable' };
  return { kind: 'file', oldPath: stripDiffPrefix(tokens[0]), newPath: stripDiffPrefix(tokens[1]) };
}

/**
 * Parse a `--- a/path` / `+++ b/path` side line. `/dev/null` means the side
 * does not exist (new-file / deletion sides). A quoted path is unparseable.
 */
function parseDiffSide(
  line: string,
  marker: '---' | '+++'
): { kind: 'side'; path: string | null } | { kind: 'unparseable' } | null {
  if (!line.startsWith(`${marker} `)) return null;
  const p = line.slice(marker.length + 1);
  if (p.startsWith('"')) return { kind: 'unparseable' };
  return { kind: 'side', path: p === '/dev/null' ? null : stripDiffPrefix(p) };
}

/** One file section of a response, in the decoder's working state. */
interface DiffRecordState {
  oldPath: string | null;
  newPath: string | null;
  /** Rename/copy metadata present (`rename from`/`rename to`, `copy from`/`copy to`): the new path is the only touch target. */
  rename: boolean;
  binary: boolean;
  combined: boolean;
  submodule: boolean;
  /** A quoted/unescapable path: the record produces no range. */
  unusable: boolean;
  /** A hunk header has been seen: later `---`/`+++`-looking lines are hunk body lines, not side headers. */
  sawHunk: boolean;
}

/**
 * Decode a unified-diff response into per-path line sets. Only hunk headers
 * carry positional data — body lines are ignored — and each header's side
 * ranges attach to its side's path (`/dev/null` sides have no path).
 * Binary, combined, submodule, and unparseable records emit nothing;
 * rename/copy records emit the new side only. `index` lines and
 * `\ No newline at end of file` markers are metadata and fall through. The
 * universal terminating-newline rule applies via completeLines.
 */
function decodeUnifiedDiff(stdout: string): Map<string, Set<number>> {
  const perFile = new Map<string, Set<number>>();
  let current: DiffRecordState | null = null;
  for (const line of completeLines(stdout)) {
    const header = parseDiffHeader(line);
    if (header !== null) {
      current = {
        oldPath: header.kind === 'file' ? header.oldPath : null,
        newPath: header.kind === 'file' ? header.newPath : null,
        rename: false,
        binary: false,
        combined: header.kind === 'combined',
        submodule: false,
        unusable: header.kind === 'unparseable',
        sawHunk: false
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('Binary files ')) {
      current.binary = true;
      continue;
    }
    // Submodule markers: a `mode 160000` metadata line, or `Subproject
    // commit` lines (their own +/- body lines). The mode check excludes
    // hunk body lines so file content that mentions the mode can't reject
    // a real record.
    const isBodyLine = line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\');
    if (!isBodyLine && line.includes('mode 160000')) {
      current.submodule = true;
      continue;
    }
    if (line.includes('Subproject commit')) {
      current.submodule = true;
      continue;
    }
    if (
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('copy from ') ||
      line.startsWith('copy to ')
    ) {
      current.rename = true;
      continue;
    }
    if (!current.sawHunk) {
      const oldSide = parseDiffSide(line, '---');
      if (oldSide !== null) {
        if (oldSide.kind === 'unparseable') current.unusable = true;
        else current.oldPath = oldSide.path;
        continue;
      }
      const newSide = parseDiffSide(line, '+++');
      if (newSide !== null) {
        if (newSide.kind === 'unparseable') current.unusable = true;
        else current.newPath = newSide.path;
        continue;
      }
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      current.sawHunk = true;
      emitHunkRange(perFile, current, hunk);
    }
  }
  return perFile;
}

/** Attribute one hunk header's per-side ranges to its record's paths. */
function emitHunkRange(perFile: Map<string, Set<number>>, record: DiffRecordState, hunk: RegExpExecArray): void {
  if (record.binary || record.combined || record.submodule || record.unusable) return;
  const oldStart = Number.parseInt(hunk[1], 10);
  const oldCount = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
  const newStart = Number.parseInt(hunk[3], 10);
  const newCount = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
  // Rename/copy: the new path is the touch target; the old side is dropped
  // (the old path may not exist on disk — it was renamed away).
  if (record.rename) {
    if (record.newPath !== null) addLines(perFile, record.newPath, newStart, newCount);
    return;
  }
  if (record.oldPath !== null) addLines(perFile, record.oldPath, oldStart, oldCount);
  if (record.newPath !== null) addLines(perFile, record.newPath, newStart, newCount);
}

/** Add `count` consecutive 1-based lines starting at `start` to `path`'s set. */
function addLines(perFile: Map<string, Set<number>>, path: string, start: number, count: number): void {
  if (start < 1 || count <= 0) return;
  let lines = perFile.get(path);
  if (lines === undefined) {
    lines = new Set();
    perFile.set(path, lines);
  }
  for (let n = start; n < start + count; n++) lines.add(n);
}

// ---------------------------------------------------------------------------
// `git blame -L` command-text matcher
// ---------------------------------------------------------------------------

/**
 * Match a `git blame -L N,M <file>` invocation from command text: the exact
 * literal `N,M` range from the `-L` value and the single path positional
 * that follows it (earlier positionals are revisions). `git log -L` embeds
 * the path in its spec and parse-command.ts already covers it; blame takes
 * the path as a positional, which the command-only parser does not handle.
 */
function matchBlameRange(
  argv: string[],
  start: number
): { lineStart: number; lineEnd: number; fileArg: string } | null {
  let spec: string | null = null;
  let specIdx = -1;
  const positionals: Array<{ arg: string; idx: number }> = [];
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      for (let j = i + 1; j < argv.length; j++) positionals.push({ arg: argv[j], idx: j });
      break;
    }
    if (a === '-L') {
      spec = argv[i + 1] ?? null;
      specIdx = i;
      i += 1;
      continue;
    }
    if (a.startsWith('-L')) {
      spec = a.slice(2);
      specIdx = i;
      continue;
    }
    if (a.startsWith('-')) continue;
    positionals.push({ arg: a, idx: i });
  }
  if (spec === null) return null;
  const m = /^(\d+),(\d+)$/.exec(spec);
  if (m === null) return null;
  const files = positionals.filter((p) => p.idx > specIdx);
  if (files.length !== 1) return null;
  return {
    lineStart: Number.parseInt(m[1], 10),
    lineEnd: Number.parseInt(m[2], 10),
    fileArg: files[0].arg
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Derives precise per-file read ranges from a response-producing command:
 * command gating, scope restriction against the command's declared roots,
 * search-layout decoding, unified-diff decoding, coalescing, and the
 * fail-closed truncation/hostile-output rules. Returns [] for anything not
 * response-derivable or not fully observed.
 *
 * Phase 3a covers the grep/ripgrep family (`rg`, `grep`, `egrep`, `fgrep`,
 * `git grep`); Phase 3b the diff-form `git diff`/`git show`/`git log -p`
 * unified-diff decoder; Phase 3c the `git blame -L N,M file` command-text
 * matcher.
 */
export function parseResponse(input: ResponseParseInput): ResolvedSpan[] {
  const { command, cwd, stdout } = input;

  // ANSI escape bytes reject the whole parse: neither rg/grep nor git emit
  // color when piped, so an ESC byte means something deliberate is going on.
  if (stdout.includes('\u001b')) return [];

  // Walk the simple commands tracking `cd`, exactly like parse-command.ts.
  // The response is attributed to the FIRST gated stage (left-to-right; a
  // later stage never overrides an earlier gated one): in a pipeline the
  // final stage's stdout is the gated stage's output — head/wc/tail only
  // truncate, and the terminating-newline rule handles the cut — and in an
  // &&/||/; chain the first gated stage is the most likely owner of
  // response-shaped records. `cd` tracking applies only until the first
  // gated stage is found: the evidence was produced in that directory, and a
  // `cd` in a later stage says nothing about where the response was made.
  let currentDir = cwd;
  let gated: GatedCommand | null = null;
  for (const simple of splitTopLevel(command)) {
    const argv = argvOf(simple.text);
    if (argv === null || argv.length === 0) continue;
    if (argv[0] === 'cd') {
      if (gated === null) {
        const target = argv[1];
        if (target !== undefined && target !== '-' && !hasShellExpansion(target)) {
          currentDir = resolvePath(currentDir, target);
        }
      }
      continue;
    }
    if (gated !== null) continue;
    if (SEARCH_BINS.has(argv[0])) {
      gated = { kind: 'search', argv, start: 1, dir: null, dirUnresolvable: false };
    } else if (argv[0] === 'git') {
      const sub = findGitSubcommand(argv);
      if (sub !== null) {
        const base = { argv, start: sub.start, dir: sub.dir, dirUnresolvable: sub.dirUnresolvable };
        if (sub.subcommand === 'grep') gated = { kind: 'search', ...base };
        // `git show <rev>:<path>` streams the blob's RAW content, never a
        // diff — a diff-shaped blob must not decode into fabricated touches
        // on the files its content names, so the content idiom is excluded
        // from the diff gate. `git diff <rev>:<path>` errors instead of
        // emitting content, so only `show` needs the check.
        else if (sub.subcommand === 'show' && !hasRevPathArg(argv, sub.start)) gated = { kind: 'diff', ...base };
        else if (sub.subcommand === 'diff') gated = { kind: 'diff', ...base };
        else if (sub.subcommand === 'log' && hasDiffPatchFlag(argv, sub.start)) gated = { kind: 'diff', ...base };
        else if (sub.subcommand === 'blame') gated = { kind: 'blame', ...base };
      }
    }
  }
  if (gated === null || gated.dirUnresolvable) return [];

  // The directory search paths are relative to — the `git -C` target when
  // present, otherwise the shell cwd after any `cd`.
  const effectiveDir = gated.dir !== null ? resolvePath(currentDir, gated.dir) : currentDir;

  // `git blame -L N,M file` resolves straight from the command text; the
  // response's content is irrelevant to it, so the truncation gate below
  // (which applies to response-derived decode) must not suppress it.
  if (gated.kind === 'blame') {
    const m = matchBlameRange(gated.argv, gated.start);
    if (m === null || hasShellExpansion(m.fileArg) || /[*?]/.test(m.fileArg)) return [];
    return [{ lineStart: m.lineStart, lineEnd: m.lineEnd, absolutePath: resolvePath(effectiveDir, m.fileArg) }];
  }

  // The adapter-supplied truncated flag (Claude rawOutputPath set ⇒ inline
  // stdout is only a preview) declares the response-derived decode
  // untrustworthy — fail closed, parse nothing, invent no touches.
  // `interrupted` is the plan's complete-records regime: fully-terminated
  // records parse and the incomplete tail drops via the unconditional
  // terminating-newline rule, which the default path already applies.
  if (input.truncated) return [];

  if (gated.kind === 'diff') {
    // Diff-form paths are repo-root-relative regardless of cwd, so they
    // resolve against the worktree root discovered from the effective dir
    // (a `.git` entry marks it — no subprocess). The repo root is also the
    // permitted root: a traversal path normalizes outside it and is rejected
    // by the same containment check.
    const repoRoot = findGitRoot(effectiveDir);
    if (repoRoot === null) return [];
    return capSpans(spansFor(decodeUnifiedDiff(stdout), repoRoot, [repoRoot]));
  }

  const info = analyzeSearchArgv(gated.argv, gated.start);

  // Permitted roots: the command's explicit search roots, or the effective
  // cwd when no path args are given (rg/grep search it by default).
  const roots = info.pathArgs.length > 0 ? info.pathArgs.map((p) => resolvePath(effectiveDir, p)) : [effectiveDir];

  const singleFileArg = info.pathArgs.length === 1 ? info.pathArgs[0] : null;
  // One-file eligibility: numbered evidence, exactly one explicit file
  // argument that is a real file (a directory or no args means records carry
  // path prefixes), and no -H/--with-filename (which forces path prefixes).
  const oneFileEligible =
    info.numbered && !info.withFilename && singleFileArg !== null && isFile(resolvePath(effectiveDir, singleFileArg));

  const layout = detectLayout(stdout, info, oneFileEligible);

  const perFile = new Map<string, Set<number>>();
  if (layout !== null) {
    for (const rec of decodeSearchLayout(layout, stdout, singleFileArg)) {
      if (rec.line === null) {
        // Whole-file null-separated record: the text holds the entire file.
        const total = lineCount(rec.text);
        let lines = perFile.get(rec.path);
        if (lines === undefined) {
          lines = new Set();
          perFile.set(rec.path, lines);
        }
        for (let n = 1; n <= total; n++) lines.add(n);
      } else {
        let lines = perFile.get(rec.path);
        if (lines === undefined) {
          lines = new Set();
          perFile.set(rec.path, lines);
        }
        lines.add(rec.line);
      }
    }
  }

  const spans = spansFor(perFile, effectiveDir, roots);

  // Whole-file fallback: non-empty, fully observed output (its terminating
  // newline is present) with no parseable numbered record and exactly one
  // explicit file resolves to a whole-file read of it. The universal
  // terminating-newline rule applies here too: a stream cut before any
  // complete record is not fully observed, so a preview of a numbered
  // output must not be mistaken for unnumbered output and must not invent
  // a whole-file touch. The file must be a readable file (a directory arg
  // leaves the fallback unresolved), and it must sit inside the declared
  // roots — it is one of them by construction.
  if (perFile.size === 0 && stdout !== '' && stdout.endsWith('\n') && singleFileArg !== null) {
    const abs = resolvePath(effectiveDir, singleFileArg);
    const total = countFileLines(abs);
    if (total !== null && total > 0) {
      spans.push({ lineStart: 1, lineEnd: total, absolutePath: abs });
    }
  }

  return capSpans(spans);
}
