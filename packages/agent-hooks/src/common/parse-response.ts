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
 * five search-layout decoders, whole-file fallback, and coalescing. The
 * unified-diff and git-blame decoders are later phases — commands in those
 * families return [] until then. The acceptance checks in
 * test/common/parse-response.test.ts were written in Phase 2.
 */
import { resolve as resolvePath, sep } from 'node:path';
import { countFileLines } from './command-resolve.js';
import type { ResolvedSpan } from './parse-command.js';
import { argvOf, splitTopLevel } from './shell-split.js';

/**
 * The normalized tool-response input the adapters hand the shared parser.
 * `stdout` is the (possibly preview) output text; `stderr` and `exitStatus`
 * are carried for diagnostics and are never parse gates — `git diff
 * --exit-code` exits 1 on differences, so exit status must not be treated as
 * failure. `truncated` (Claude `rawOutputPath` set ⇒ inline stdout is only a
 * preview, or `interrupted`) forces the fail-closed rules.
 */
export interface ResponseParseInput {
  command: string;
  cwd: string;
  stdout: string;
  stderr?: string;
  exitStatus?: number; // metadata only — never gates (git diff exits 1 on differences)
  truncated?: boolean;
}

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
}

/**
 * Scan a search command's argv (starting after the binary, or after the
 * `grep` subcommand for git grep) for the positional args and context flags,
 * consuming option values so they are never mistaken for positionals.
 */
function analyzeSearchArgv(argv: string[], start: number): SearchArgvInfo {
  const positionals: string[] = [];
  let contextFlags = false;
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
  const pathArgs = positionals.length > 0 ? positionals.slice(1) : [];
  return { pathArgs, contextFlags };
}

interface GitGrepInfo {
  /** The `git -C` directory, when present and statically resolvable. */
  dir: string | null;
  dirUnresolvable: boolean;
  /** Index just past the `grep` subcommand, where the search argv begins. */
  start: number;
}

/**
 * Locate the `grep` subcommand of a `git` command, honoring `-C`/`-c` like
 * parse-command.ts's findGitSubcommand. Returns null when git runs any other
 * subcommand (diff/show/log/blame are later phases and fail the gate here).
 */
function findGitGrep(argv: string[]): GitGrepInfo | null {
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
    if (a !== 'grep') return null;
    return { dir, dirUnresolvable, start: i + 1 };
  }
  return null;
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
 * Decide which search layout a response uses from the shape of its first
 * record, consulting the command's context flags to break the recursive /
 * context ambiguity (both emit `path:line:text` match records). Fail closed:
 * an unrecognized first record means nothing in this response is trusted.
 */
function detectLayout(stdout: string, contextFlags: boolean): SearchLayout | null {
  if (stdout.includes('\0')) return 'null-separated';
  const first = completeLines(stdout).find((line) => line !== '');
  if (first === undefined) return null;
  if (/^\d+[-:]/.test(first)) return 'one-file';
  if (/^[^:]+:\d+/.test(first)) return contextFlags ? 'context' : 'recursive';
  if (/^[^-:]+-\d+-/.test(first)) return contextFlags ? 'context' : null;
  if (/^[^:]+$/.test(first)) return 'heading';
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
    case 'context':
      // Match records are `path:line:text`; context records are
      // `path-line-text` (the separator is a dash wherever a match record
      // would use a colon). Both carry the real line number; `--` group
      // separators are not records.
      for (const line of completeLines(stdout)) {
        if (line === '--') continue;
        const rec = parseRecord(line, ':') ?? parseRecord(line, '-');
        if (rec !== null) records.push(rec);
      }
      break;
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

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Derives precise per-file read ranges from a response-producing search
 * command: command gating, scope restriction against the command's declared
 * roots, search-layout decoding, coalescing, and the fail-closed
 * truncation/hostile-output rules. Returns [] for anything not
 * response-derivable or not fully observed.
 *
 * Phase 3a covers the grep/ripgrep family (`rg`, `grep`, `egrep`, `fgrep`,
 * `git grep`) only; diff-form `git diff`/`git show`/`git log` and
 * `git blame -L` commands return [] until the later decoder phases land.
 */
export function parseResponse(input: ResponseParseInput): ResolvedSpan[] {
  const { command, cwd, stdout } = input;

  // ANSI escape bytes reject the whole parse: neither rg/grep nor git emit
  // color when piped, so an ESC byte means something deliberate is going on.
  if (stdout.includes('\u001b')) return [];

  // Walk the simple commands tracking `cd`, exactly like parse-command.ts:
  // the response is attributed to the final command, which must be a gated
  // search command. A pipeline stage like `head` or `wc` resets the gate.
  let currentDir = cwd;
  let gated: { argv: string[]; start: number; dir: string | null; dirUnresolvable: boolean } | null = null;
  for (const simple of splitTopLevel(command)) {
    const argv = argvOf(simple.text);
    if (argv === null || argv.length === 0) continue;
    if (argv[0] === 'cd') {
      const target = argv[1];
      if (target !== undefined && target !== '-' && !hasShellExpansion(target)) {
        currentDir = resolvePath(currentDir, target);
      }
      continue;
    }
    gated = null;
    if (SEARCH_BINS.has(argv[0])) {
      gated = { argv, start: 1, dir: null, dirUnresolvable: false };
    } else if (argv[0] === 'git') {
      const gitGrep = findGitGrep(argv);
      if (gitGrep !== null) {
        gated = { argv, ...gitGrep };
      }
    }
  }
  if (gated === null || gated.dirUnresolvable) return [];

  // The directory search paths are relative to — the `git -C` target when
  // present, otherwise the shell cwd after any `cd`.
  const effectiveDir = gated.dir !== null ? resolvePath(currentDir, gated.dir) : currentDir;
  const info = analyzeSearchArgv(gated.argv, gated.start);

  // Permitted roots: the command's explicit search roots, or the effective
  // cwd when no path args are given (rg/grep search it by default).
  const roots = info.pathArgs.length > 0 ? info.pathArgs.map((p) => resolvePath(effectiveDir, p)) : [effectiveDir];

  const layout = detectLayout(stdout, info.contextFlags);
  const singleFileArg = info.pathArgs.length === 1 ? info.pathArgs[0] : null;

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

  const spans: ResolvedSpan[] = [];
  for (const [path, lines] of perFile) {
    const abs = resolvePath(effectiveDir, path);
    if (!insideRoot(abs, roots)) continue;
    for (const [lineStart, lineEnd] of coalesce([...lines])) {
      spans.push({ lineStart, lineEnd, absolutePath: abs });
    }
  }

  // Whole-file fallback: non-empty output with no parseable numbered record
  // and exactly one explicit file resolves to a whole-file read of it. The
  // file must be a readable file (a directory arg leaves the fallback
  // unresolved), and it must sit inside the declared roots — it is one of
  // them by construction.
  if (perFile.size === 0 && stdout !== '' && singleFileArg !== null) {
    const abs = resolvePath(effectiveDir, singleFileArg);
    const total = countFileLines(abs);
    if (total !== null && total > 0) {
      spans.push({ lineStart: 1, lineEnd: total, absolutePath: abs });
    }
  }

  return spans;
}
