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
 * `git blame -L N,M file` command-text matcher. Phase 3d made `truncated`
 * the flag's strict mode (parse nothing) and extended the terminating-
 * newline rule to the whole-file fallback (a cut preview of numbered output
 * is not fully observed and must not invent a whole-file touch). The
 * acceptance checks in test/common/parse-response.test.ts were written in
 * Phase 2.
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
 * preview, or `interrupted`) is the flag's strict mode: the adapter declares
 * the response untrustworthy, so nothing in it is parsed — the strict gate
 * sits in parseResponse rather than only the terminating-newline rule
 * (which still drops partial records when the flag is absent).
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

  // The adapter-supplied truncated flag (Claude rawOutputPath set ⇒ inline
  // stdout is only a preview; interrupted) declares the response
  // untrustworthy — fail closed, parse nothing, invent no touches.
  if (input.truncated) return [];

  // ANSI escape bytes reject the whole parse: neither rg/grep nor git emit
  // color when piped, so an ESC byte means something deliberate is going on.
  if (stdout.includes('\u001b')) return [];

  // Walk the simple commands tracking `cd`, exactly like parse-command.ts:
  // the response is attributed to the final command, which must be a gated
  // search, diff, or blame command. A pipeline stage like `head` or `wc`
  // resets the gate.
  let currentDir = cwd;
  let gated: GatedCommand | null = null;
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
      gated = { kind: 'search', argv, start: 1, dir: null, dirUnresolvable: false };
    } else if (argv[0] === 'git') {
      const sub = findGitSubcommand(argv);
      if (sub !== null) {
        const base = { argv, start: sub.start, dir: sub.dir, dirUnresolvable: sub.dirUnresolvable };
        if (sub.subcommand === 'grep') gated = { kind: 'search', ...base };
        else if (sub.subcommand === 'diff' || sub.subcommand === 'show') gated = { kind: 'diff', ...base };
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
  // response's content is irrelevant to it.
  if (gated.kind === 'blame') {
    const m = matchBlameRange(gated.argv, gated.start);
    if (m === null || hasShellExpansion(m.fileArg) || /[*?]/.test(m.fileArg)) return [];
    return [{ lineStart: m.lineStart, lineEnd: m.lineEnd, absolutePath: resolvePath(effectiveDir, m.fileArg) }];
  }

  if (gated.kind === 'diff') {
    // Diff paths resolve against the effective git dir; the repo itself is
    // the permitted root — a traversal path normalizes outside it and is
    // rejected by the same containment check.
    return spansFor(decodeUnifiedDiff(stdout), effectiveDir, [effectiveDir]);
  }

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

  return spans;
}
