/**
 * Static classification of a Bash tool `command` string into the file
 * path(s) + line range(s) it reads or writes, where that's statically
 * determinable. Built from an empirical pass over ~31k real Claude Code
 * Bash invocations (see analyze-transcripts.mts) — the idioms below are
 * exactly the ones that turned out to be common AND reliable there.
 *
 * Deliberately NOT covered (see the research report): awk NR-tricks (rare,
 * unconstrained syntax), grep -n/-A/-B/-C (the window is anchored to match
 * position, which is data-dependent, not in the command text), embedded
 * python3/node heredoc scripts (a different language's AST, not a shell
 * concern), sed -i (no line-addressed usage observed — all pattern-only
 * substitutions with no static range), plain `echo`/`printf` redirects (rare
 * and semantically ambiguous in the corpus).
 */
import { resolve as resolvePath } from 'node:path';
import { countFileLines, countGitBlobLines } from './command-resolve.js';
import { argvOf, splitTopLevel } from './shell-split.js';

export interface ResolvedSpan {
  lineStart: number;
  lineEnd: number;
  absolutePath: string;
  /**
   * The exact body of a `heredoc-write` span — the content the heredoc writes.
   * Absent (undefined) for read idioms.
   */
  body?: string;
  /**
   * The heredoc redirect operator. `>` means the file was overwritten
   * (whole-file scope — any span beyond the new EOF was deleted and must
   * surface); `>>` means the body was appended (narrow to the append range).
   * Absent (undefined) for read idioms.
   */
  redirect?: '>' | '>>';
}

export type Idiom =
  | 'sed-n-range'
  | 'head-file'
  | 'tail-file'
  | 'cat-file'
  | 'nl-file'
  | 'git-show-rev-path'
  | 'git-log-L'
  | 'heredoc-write';

export type SpanMatch =
  | { status: 'resolved'; idiom: Idiom; span: ResolvedSpan; note?: string }
  | { status: 'unresolved'; idiom: Idiom; fileArg: string; reason: string };

// ---------------------------------------------------------------------------
// Line-range specs: what a matched idiom says about the range, before we know
// whether resolving it needs to consult a real file/git blob.
// ---------------------------------------------------------------------------

type LineRangeSpec =
  | { kind: 'literal'; start: number; end: number }
  | { kind: 'upperBoundFromStart'; end: number }
  | { kind: 'toEof'; start: number }
  | { kind: 'lastNLines'; count: number }
  | { kind: 'appendLines'; count: number };

function resolveSpec(
  spec: LineRangeSpec,
  totalLines: () => number | null
): { lineStart: number; lineEnd: number } | null {
  switch (spec.kind) {
    case 'literal':
      return { lineStart: spec.start, lineEnd: spec.end };
    case 'upperBoundFromStart': {
      const total = totalLines();
      return { lineStart: 1, lineEnd: total !== null ? Math.min(spec.end, total) : spec.end };
    }
    case 'toEof': {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: spec.start, lineEnd: Math.max(spec.start, total) };
    }
    case 'lastNLines': {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: Math.max(1, total - spec.count + 1), lineEnd: total };
    }
    case 'appendLines': {
      const total = totalLines() ?? 0;
      return { lineStart: total + 1, lineEnd: total + spec.count };
    }
  }
}

function hasShellExpansion(s: string): boolean {
  return /[$`]/.test(s);
}

function looksUnresolvable(s: string): boolean {
  return hasShellExpansion(s) || /[*?]/.test(s);
}

// ---------------------------------------------------------------------------
// Idiom matchers: pure functions over one simple command's argv.
// ---------------------------------------------------------------------------

interface RawCandidate {
  kind: 'candidate';
  idiom: Idiom;
  fileArg: string;
  spec: LineRangeSpec;
  resolverKind: 'fs' | { kind: 'git'; rev: string };
  dirOverride?: string;
}
interface RawUnresolved {
  kind: 'unresolved';
  idiom: Idiom;
  fileArg: string;
  reason: string;
}
type MatchResult = RawCandidate | RawUnresolved;

const SED_RANGE = /^(\d+)(?:,(\d+|\$))?p$/;

/** Split a `sed` script argument into its `;`-separated segments. */
function sedScriptSegments(script: string): string[] {
  return script.split(';');
}

function matchSed(argv: string[]): MatchResult[] {
  if (argv[0] !== 'sed') return [];
  const rest = argv.slice(1);
  if (!rest.includes('-n')) return [];
  let scriptIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-n') continue;
    if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
      scriptIdx = i;
      break;
    }
  }
  if (scriptIdx === -1) return [];
  const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== '-n' && !a.startsWith('-'));
  if (fileCandidates.length !== 1) return [];
  const fileArg = fileCandidates[0];
  const results: MatchResult[] = [];
  for (const segment of sedScriptSegments(rest[scriptIdx])) {
    const match = segment.match(SED_RANGE);
    if (!match) continue;
    const start = Number.parseInt(match[1], 10);
    const endToken = match[2];
    const spec: LineRangeSpec =
      endToken === undefined
        ? { kind: 'literal', start, end: start }
        : endToken === '$'
          ? { kind: 'toEof', start }
          : { kind: 'literal', start, end: Number.parseInt(endToken, 10) };
    results.push({ kind: 'candidate', idiom: 'sed-n-range', fileArg, spec, resolverKind: 'fs' });
  }
  return results;
}

function parseHeadTailFlags(rest: string[]): {
  count: number | null;
  fromStart: boolean;
  disqualified: boolean;
  files: string[];
} {
  const files: string[] = [];
  let count: number | null = null;
  let fromStart = false;
  let disqualified = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-f' || a === '-F' || a === '--follow' || a.startsWith('--follow=')) {
      disqualified = true;
      continue;
    }
    if (a === '-z' || a === '--zero-terminated') {
      disqualified = true;
      continue;
    }
    if (a === '-c' || a === '--bytes') {
      disqualified = true;
      i += 1;
      continue;
    }
    if (/^(-c|--bytes=)/.test(a)) {
      disqualified = true;
      continue;
    }
    if (a === '-q' || a === '-v' || a === '--quiet' || a === '--silent' || a === '--verbose') continue;
    if (a === '-n') {
      const v = rest[i + 1];
      if (v !== undefined && /^\+?\d+$/.test(v)) {
        fromStart = v.startsWith('+');
        count = Number.parseInt(v.replace('+', ''), 10);
        i += 1;
      }
      continue;
    }
    if (a.startsWith('--lines=')) {
      const v = a.slice('--lines='.length);
      if (/^\+?\d+$/.test(v)) {
        fromStart = v.startsWith('+');
        count = Number.parseInt(v.replace('+', ''), 10);
      }
      continue;
    }
    if (/^-n\+?\d+$/.test(a)) {
      const v = a.slice(2);
      fromStart = v.startsWith('+');
      count = Number.parseInt(v.replace('+', ''), 10);
      continue;
    }
    if (/^\+\d+$/.test(a)) {
      fromStart = true;
      count = Number.parseInt(a.slice(1), 10);
      continue;
    }
    if (/^-\d+$/.test(a)) {
      count = Number.parseInt(a.slice(1), 10);
      continue;
    }
    if (a === '-') {
      files.push(a);
      continue;
    }
    if (a.startsWith('-')) continue;
    files.push(a);
  }
  return { count, fromStart, disqualified, files };
}

function matchHead(argv: string[]): MatchResult[] {
  if (argv[0] !== 'head') return [];
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1));
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== '-');
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  return realFiles.map((fileArg) => ({
    kind: 'candidate' as const,
    idiom: 'head-file' as const,
    fileArg,
    spec: { kind: 'upperBoundFromStart', end: n } as LineRangeSpec,
    resolverKind: 'fs' as const
  }));
}

function matchTail(argv: string[]): MatchResult[] {
  if (argv[0] !== 'tail') return [];
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1));
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== '-');
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  const spec: LineRangeSpec = fromStart ? { kind: 'toEof', start: n } : { kind: 'lastNLines', count: n };
  return realFiles.map((fileArg) => ({
    kind: 'candidate' as const,
    idiom: 'tail-file' as const,
    fileArg,
    spec,
    resolverKind: 'fs' as const
  }));
}

function findGitSubcommand(
  rest: string[]
): { subIdx: number; subcommand: string; cDir: string | null; cDirUnresolvable: boolean } | null {
  let cDir: string | null = null;
  let cDirUnresolvable = false;
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === '-C') {
      const v = rest[i + 1];
      if (v === undefined) return null;
      if (hasShellExpansion(v)) cDirUnresolvable = true;
      else cDir = v;
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
    return { subIdx: i, subcommand: a, cDir, cDirUnresolvable };
  }
  return null;
}

const REV_PATH = /^([^\s:]+):(.+)$/;

function matchGitShow(argv: string[]): MatchResult[] {
  if (argv[0] !== 'git') return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (!sub || sub.subcommand !== 'show') return [];
  const after = argv
    .slice(1)
    .slice(sub.subIdx + 1)
    .filter((a) => !a.startsWith('-'));
  const revPathArg = after.find((a) => REV_PATH.test(a));
  if (!revPathArg) return [];
  const m = revPathArg.match(REV_PATH);
  if (!m) return [];
  const [, rev, path] = m;
  if (sub.cDirUnresolvable || hasShellExpansion(rev)) {
    return [
      {
        kind: 'unresolved',
        idiom: 'git-show-rev-path',
        fileArg: path,
        reason: 'git -C target or revision contains an unresolved shell variable'
      }
    ];
  }
  return [
    {
      kind: 'candidate',
      idiom: 'git-show-rev-path',
      fileArg: path,
      spec: { kind: 'toEof', start: 1 },
      resolverKind: { kind: 'git', rev },
      dirOverride: sub.cDir ?? undefined
    }
  ];
}

function matchGitLogL(argv: string[]): MatchResult[] {
  if (argv[0] !== 'git') return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (!sub || sub.subcommand !== 'log') return [];
  const after = argv.slice(1).slice(sub.subIdx + 1);
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    let spec: string | null = null;
    if (a === '-L') spec = after[i + 1] ?? null;
    else if (a.startsWith('-L')) spec = a.slice(2);
    if (!spec) continue;
    const m = spec.match(/^(\d+),(\d+):(.+)$/);
    if (!m) continue;
    const [, s, e, path] = m;
    if (sub.cDirUnresolvable) {
      return [
        {
          kind: 'unresolved',
          idiom: 'git-log-L',
          fileArg: path,
          reason: 'git -C target contains an unresolved shell variable'
        }
      ];
    }
    return [
      {
        kind: 'candidate',
        idiom: 'git-log-L',
        fileArg: path,
        spec: { kind: 'literal', start: Number.parseInt(s, 10), end: Number.parseInt(e, 10) },
        resolverKind: 'fs',
        dirOverride: sub.cDir ?? undefined
      }
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Heredoc writes (`cat > file <<EOF ... EOF`): handled as a dedicated raw-text
// pass because the body can itself contain &&/;/|/newlines that would
// otherwise confuse splitTopLevel. Matched spans are masked out of the string
// (replaced with an indexed placeholder simple-command) before the rest of
// the pipeline runs, and re-associated by index during the main walk so the
// write is resolved against the correct `cd`-tracked directory.
// ---------------------------------------------------------------------------

interface HeredocWrite {
  redirect: '>' | '>>';
  target: string;
  body: string;
}

const HEREDOC_OPEN =
  /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))[ \t]*\r?\n/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractHeredocWrites(raw: string): { writes: HeredocWrite[]; masked: string } {
  const writes: HeredocWrite[] = [];
  let masked = '';
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch: RegExpExecArray | null = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const bodyStart = openMatch.index + openMatch[0].length;
    if (!delim || bodyStart < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const closeRe = new RegExp(`^${dash ? '\\t*' : ''}${escapeRegExp(delim)}[ \\t]*$`, 'm');
    const remainder = raw.slice(bodyStart);
    const closeMatch = closeRe.exec(remainder);
    if (!closeMatch) {
      HEREDOC_OPEN.lastIndex = bodyStart;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const body = remainder.slice(0, closeMatch.index).replace(/\n$/, '');
    const matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;

    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect: redirect as '>' | '>>', target, body });

    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const LINE_SELECTORS = [matchSed, matchHead, matchTail];

export function parseCommandDetailed(command: string, cwd: string = process.cwd()): SpanMatch[] {
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const simpleCommands = splitTopLevel(masked);

  const results: SpanMatch[] = [];
  const fsLineCache = new Map<string, number | null>();
  const gitLineCache = new Map<string, number | null>();

  const cachedFsTotalLines = (absPath: string) => () => {
    if (!fsLineCache.has(absPath)) fsLineCache.set(absPath, countFileLines(absPath));
    return fsLineCache.get(absPath) ?? null;
  };
  const cachedGitTotalLines = (gitCwd: string, rev: string, path: string) => () => {
    const key = `${gitCwd} ${rev} ${path}`;
    if (!gitLineCache.has(key)) gitLineCache.set(key, countGitBlobLines(gitCwd, rev, path));
    return gitLineCache.get(key) ?? null;
  };

  let currentDir = cwd;
  let lastPlainFileSource: string | null = null;

  const emitCandidate = (c: RawCandidate, dirForResolution: string) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: 'unresolved',
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: 'path contains an unexpanded shell variable or glob'
      });
      return;
    }
    const absolutePath = resolvePath(dirForResolution, c.fileArg);
    const totalLines =
      c.resolverKind === 'fs'
        ? cachedFsTotalLines(absolutePath)
        : cachedGitTotalLines(c.dirOverride ?? dirForResolution, c.resolverKind.rev, c.fileArg);
    const range = resolveSpec(c.spec, totalLines);
    if (range === null) {
      results.push({
        status: 'unresolved',
        idiom: c.idiom,
        fileArg: absolutePath,
        reason: 'could not determine end-of-file line count (file unreadable, empty, or git rev/path not found)'
      });
      return;
    }
    results.push({
      status: 'resolved',
      idiom: c.idiom,
      span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
    });
  };

  for (let i = 0; i < simpleCommands.length; i++) {
    const simple = simpleCommands[i];
    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      lastPlainFileSource = null;
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      if (looksUnresolvable(w.target)) {
        results.push({
          status: 'unresolved',
          idiom: 'heredoc-write',
          fileArg: w.target,
          reason: 'path contains an unexpanded shell variable or glob'
        });
        continue;
      }
      const absolutePath = resolvePath(currentDir, w.target);
      const bodyLines = w.body.length === 0 ? 0 : w.body.split('\n').length;
      if (bodyLines === 0) {
        // `cat > f <<'EOF'` with an empty body truncates the file to empty — a
        // real write that must produce a touch (whole-file, via `body: ''`).
        // `>>` with an empty body appends nothing and is a genuine no-op.
        if (w.redirect !== '>') continue;
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span: { lineStart: 1, lineEnd: 1, absolutePath, body: '', redirect: w.redirect }
        });
        continue;
      }
      const spec: LineRangeSpec =
        w.redirect === '>' ? { kind: 'literal', start: 1, end: bodyLines } : { kind: 'appendLines', count: bodyLines };
      const range = resolveSpec(spec, cachedFsTotalLines(absolutePath));
      if (range === null) {
        results.push({
          status: 'unresolved',
          idiom: 'heredoc-write',
          fileArg: absolutePath,
          reason: 'append target: could not read existing file to find its current length'
        });
      } else {
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath, body: w.body, redirect: w.redirect }
        });
      }
      continue;
    }

    const argv = argvOf(simple.text);
    if (!argv || argv.length === 0) {
      lastPlainFileSource = null;
      continue;
    }

    if (argv[0] === 'cd') {
      lastPlainFileSource = null;
      const target = argv[1];
      if (target !== undefined && target !== '-' && !hasShellExpansion(target)) {
        currentDir = resolvePath(currentDir, target);
      }
      continue;
    }

    let isPlainSource = false;
    let plainFileArg: string | null = null;
    if (argv[0] === 'cat' && argv.length === 2 && !argv[1].startsWith('-')) {
      isPlainSource = true;
      plainFileArg = argv[1];
      lastPlainFileSource = hasShellExpansion(argv[1]) ? null : resolvePath(currentDir, argv[1]);
    } else if (argv[0] === 'nl' && argv.length >= 2 && !argv[argv.length - 1].startsWith('-')) {
      isPlainSource = true;
      const f = argv[argv.length - 1];
      plainFileArg = f;
      lastPlainFileSource = hasShellExpansion(f) ? null : resolvePath(currentDir, f);
    }

    // A bare `cat file`/`nl file` that is not feeding a downstream pipe stage
    // reads the whole file: emit the same whole-file span `git show rev:path`
    // produces. When a pipe follows, the downstream line-selector already
    // emits the precise range, so the source stays source-only.
    if (plainFileArg !== null) {
      const next = simpleCommands[i + 1];
      if (next === undefined || next.precededBy !== '|') {
        emitCandidate(
          {
            kind: 'candidate',
            idiom: argv[0] === 'cat' ? 'cat-file' : 'nl-file',
            fileArg: plainFileArg,
            spec: { kind: 'toEof', start: 1 },
            resolverKind: 'fs'
          },
          currentDir
        );
      }
    }

    let matched = false;
    for (const matcher of [...LINE_SELECTORS, matchGitShow, matchGitLogL]) {
      for (const outcome of matcher(argv)) {
        matched = true;
        if (outcome.kind === 'unresolved') {
          results.push({
            status: 'unresolved',
            idiom: outcome.idiom,
            fileArg: outcome.fileArg,
            reason: outcome.reason
          });
        } else {
          emitCandidate(outcome, outcome.dirOverride ?? currentDir);
          // `git show rev:path` prints the blob verbatim, so (unlike `git log -L`,
          // which prints diff-formatted history) it's a valid one-hop pipe source
          // for a downstream line-selector, same as `cat`/`nl`.
          if (outcome.idiom === 'git-show-rev-path' && !looksUnresolvable(outcome.fileArg)) {
            isPlainSource = true;
            lastPlainFileSource = resolvePath(outcome.dirOverride ?? currentDir, outcome.fileArg);
          }
        }
      }
    }

    if (!matched && simple.precededBy === '|' && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          if (outcome.kind === 'candidate') emitCandidate(outcome, currentDir);
          else
            results.push({
              status: 'unresolved',
              idiom: outcome.idiom,
              fileArg: outcome.fileArg,
              reason: outcome.reason
            });
        }
      }
    }

    if (!isPlainSource) lastPlainFileSource = null;
  }

  return results;
}

/** Parses a Bash `command` string into the file+line-range spans it statically, reliably reads or writes. `cwd` defaults to `process.cwd()` — pass the hook's own `cwd` field for correct resolution of relative paths and `cd`/`git -C` targets, and of `git show`/`git log -L` revisions. */
export function parseCommand(command: string, cwd: string = process.cwd()): ResolvedSpan[] {
  const detailed = parseCommandDetailed(command, cwd);
  const spans: ResolvedSpan[] = [];
  for (const m of detailed) {
    if (m.status === 'resolved') spans.push(m.span);
  }
  return spans;
}
