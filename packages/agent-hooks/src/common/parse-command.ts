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
 * concern), plain `echo`/`printf` redirects (rare and semantically ambiguous
 * in the corpus). The write-touch families (sed -i, patch/git apply, and the
 * §5.3–§5.5 families) are separate grammars below.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, join as joinPath, resolve as resolvePath } from 'node:path';
import { countFileLines, countGitBlobLines } from './command-resolve.js';
import { type SimpleCommand, splitTopLevel, stripLeadingAssignments, type Token, tokenize } from './shell-split.js';
import { type PathStrip, parseUnifiedDiffRange } from './unified-diff.js';

/**
 * The explicit operation kind of a resolved span. The adapters translate from
 * this, never from `idiom === 'heredoc-write'`-style checks (plan §1).
 */
export type Operation =
  | 'read' // read idioms; cp/install source operands
  | 'create-overwrite' // truncating content writes: > redirects, tee, heredoc >, cp/mv dest, restore/checkout, patch add
  | 'append' // >> redirects, tee -a, heredoc >>
  | 'modify' // in-place edits with unknown content: sed -i, patch hunks, formatter write flags
  | 'rename-copy' // mv/git mv/patch-rename destination (whole-file write, same touch as create-overwrite)
  | 'truncate' // : > f, bare > f, truncate
  | 'delete'; // rm, mv/git mv source, patch delete

export interface ResolvedSpan {
  operation: Operation;
  absolutePath: string;
  /**
   * Exact range: every read; modify operations with a statically known range
   * (sed -i numeric addresses, patch hunk unions). Absent for writes →
   * whole-file scope.
   */
  lineStart?: number;
  lineEnd?: number;
  /** Statically known written content — append bodies only (heredoc/echo/printf/tee literals). */
  written?: string;
  /**
   * Ordinal of the span's simple command within the compound, in walker
   * order; groups the spans of one command for join gating (plan §3 step 2).
   */
  simpleCommandIndex: number;
  /**
   * The operator preceding the span's simple command; only `'&&'`/`'||'` gate.
   * Absent for `start`/`;`/newline/`&`/`|` boundaries.
   */
  join?: '&&' | '||';
  note?: string;
}

export type Idiom =
  | 'sed-n-range'
  | 'head-file'
  | 'tail-file'
  | 'cat-file'
  | 'nl-file'
  | 'git-show-rev-path'
  | 'git-log-L'
  | 'heredoc-write'
  // The write-touch families (plan §5). Idiom stays match metadata for tests
  // and unresolved reasons; adapter behavior keys on `operation`, never idiom.
  | 'redirect-write' // §5.1: echo/printf/tee content redirects
  | 'truncate-write' // §5.1: bare `> f` / `: > f` truncations
  | 'cp-write' // §5.3
  | 'install-write' // §5.3
  | 'mv-write' // §5.4: mv and git mv
  | 'rm-write' // §5.5: rm and git rm
  | 'truncate-command' // §5.5: the truncate command
  | 'sed-inplace' // §5.6: sed -i
  | 'patch-write' // §5.7: patch and git apply
  | 'formatter-write' // §5.8
  | 'git-restore-write' // §5.9: git restore pathspecs
  | 'git-checkout-write'; // §5.9: git checkout -- pathspecs

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
// Heredoc writes (plan §5.2): handled as a dedicated raw-text pass because the
// body can itself contain &&/;/|/newlines that would otherwise confuse
// splitTopLevel. The opener scanner is quote-aware and validates the closing
// delimiter; matched heredocs are masked out of the string (replaced with an
// indexed placeholder simple-command) before the rest of the pipeline runs,
// and re-associated by index during the main walk so the write is resolved
// against the correct `cd`-tracked directory.
// ---------------------------------------------------------------------------

/** The heredoc's content-carrying facts, re-associated by index during the walk. */
interface HeredocWrite {
  /** The opener line verbatim (e.g. `cat > f <<'EOF'`), re-tokenized during the walk. */
  opener: string;
  /** The heredoc body; `<<-` bodies have leading tabs stripped per line. */
  body: string;
}

interface HeredocOpener {
  /** Where the heredoc's simple command starts in the raw string. */
  cmdStart: number;
  /** The newline ending the opener line, or raw.length when it's the last line. */
  openerLineEnd: number;
  /** The closing delimiter (quotes stripped). */
  delim: string;
  /** `<<-`: strip leading tabs from the body and the closer line. */
  tabStrip: boolean;
}

const BARE_DELIM = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Find the next heredoc opener (`<<`/`<<-`) at top level, scanning from
 * `from`. Mirrors splitTopLevel's separator handling so `cmdStart` marks the
 * opener's own simple command: top-level `&&`/`||`/`;`/newline/`&` start a new
 * command (a newline after a pipe is a line continuation), `>`-redirects, dup
 * redirects (`2>&1`) and paren nesting stay inside the command, and
 * here-strings (`<<<`) are out of scope. An IO_NUMBER fd directly before the
 * operator (`2<<EOF`) redirects that fd, not stdin — not a heredoc. Returns
 * null when no opener is found.
 */
function findHeredocOpener(raw: string, from: number): HeredocOpener | null {
  const n = raw.length;
  let inSquote = false;
  let inDquote = false;
  let depth = 0;
  let cmdStart = from;
  let pendingPipe = false;
  let i = from;

  /** Read one delimiter word starting at `start` (the attached tail of `<<EOF`/`<<'EOF'`, or a standalone next word). Quotes contribute their content; a backslash escapes the next char. Returns null on an unbalanced quote (fail closed). */
  const readDelimWord = (start: number): { delim: string; sawQuote: boolean; next: number } | null => {
    let d = '';
    let sawQuote = false;
    let k = start;
    while (k < n && !/\s/.test(raw[k]) && raw[k] !== '<' && raw[k] !== '>') {
      const c = raw[k];
      if (c === "'" || c === '"') {
        const quote = c;
        let m = k + 1;
        while (m < n && raw[m] !== quote) {
          d += raw[m];
          m += 1;
        }
        if (m >= n) return null;
        sawQuote = true;
        k = m + 1;
        continue;
      }
      if (c === '\\' && k + 1 < n) {
        d += raw[k + 1];
        k += 2;
        continue;
      }
      d += c;
      k += 1;
    }
    return { delim: d, sawQuote, next: k };
  };

  while (i < n) {
    const c = raw[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      if (c === '\\' && i + 1 < n) {
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      i += 1;
      continue;
    }
    if (c === '\\' && i + 1 < n) {
      i += 2;
      continue;
    }
    if (c === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (raw.startsWith('&&', i) || raw.startsWith('||', i)) {
      cmdStart = i + 2;
      pendingPipe = false;
      i += 2;
      continue;
    }
    if (raw.startsWith('|&', i)) {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 2;
      continue;
    }
    if (c === ';') {
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === '|') {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 1;
      continue;
    }
    if (c === '\n') {
      // A newline after a pipe is a line continuation (mirroring
      // splitTopLevel); anything else starts a new simple command.
      if (!pendingPipe) cmdStart = i + 1;
      i += 1;
      continue;
    }
    if (c === '&') {
      // `&>`/`&>>` and dup redirects (`2>&1`) are redirect operators, not
      // command separators (mirroring splitTopLevel).
      const trimmed = raw.slice(cmdStart, i).trimEnd();
      const dupRedirect =
        trimmed.endsWith('>') && (trimmed.length === 1 || /\s|\d/.test(trimmed[trimmed.length - 2] ?? ''));
      if (raw[i + 1] === '>' || dupRedirect) {
        i += 1;
        continue;
      }
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === '<' && raw[i + 1] === '<') {
      // `<<<` is a here-string (out of scope); `<<-` strips leading tabs.
      if (raw[i + 2] === '<') {
        i += 3;
        continue;
      }
      let j = i - 1;
      while (j >= from && /\d/.test(raw[j])) j -= 1;
      const ioNumber = j < i - 1 && (j < from || /\s|[;|&(]/.test(raw[j]));
      if (ioNumber) {
        i += 2;
        continue;
      }
      const tabStrip = raw[i + 2] === '-';
      const opLen = tabStrip ? 3 : 2;
      const lineEnd = raw.indexOf('\n', i);
      const openerLineEnd = lineEnd === -1 ? n : lineEnd;
      const attached = readDelimWord(i + opLen);
      let delim = attached === null ? '' : attached.delim;
      let sawQuote = attached === null ? false : attached.sawQuote;
      if (delim === '' && attached !== null) {
        // Standalone operator: the delimiter is the next word.
        let k = attached.next;
        while (k < openerLineEnd && /\s/.test(raw[k])) k += 1;
        const word = readDelimWord(k);
        if (word === null) delim = '';
        else {
          delim = word.delim;
          sawQuote = word.sawQuote;
        }
      }
      if (delim === '' || (!sawQuote && !BARE_DELIM.test(delim))) {
        // No delimiter, or a bare form outside the identifier shape — fail
        // closed and keep scanning past the operator.
        i += opLen;
        continue;
      }
      return { cmdStart, openerLineEnd, delim, tabStrip };
    }
    i += 1;
  }
  return null;
}

/**
 * The body of an opener runs from after the opener line's newline to the line
 * that is exactly the delimiter (`<<`), or its leading-tab-stripped form
 * (`<<-`), trailing whitespace allowed. Returns the closer's line bounds, or
 * null when no closer exists (fail closed).
 */
function heredocCloser(raw: string, open: HeredocOpener): { lineStart: number; lineEnd: number } | null {
  const n = raw.length;
  const bodyStart = open.openerLineEnd < n ? open.openerLineEnd + 1 : n;
  let linePos = bodyStart;
  while (linePos < n) {
    const nl = raw.indexOf('\n', linePos);
    const lineEnd = nl === -1 ? n : nl;
    const candidate = open.tabStrip ? raw.slice(linePos, lineEnd).replace(/^\t+/, '') : raw.slice(linePos, lineEnd);
    if (
      candidate === open.delim ||
      (candidate.startsWith(open.delim) && /^[ \t]*$/.test(candidate.slice(open.delim.length)))
    ) {
      return { lineStart: linePos, lineEnd };
    }
    if (nl === -1) return null;
    linePos = nl + 1;
  }
  return null;
}

/**
 * Mask every heredoc out of the raw command string, returning the bodies and
 * openers for re-association by index. The mask covers
 * `[cmdStart, closerLineEnd)` — the opener line through the closer line, the
 * closer's newline excluded — so a command joined before the opener
 * (`cmd1 && cat <<EOF`) keeps its structure, and the placeholder stands alone
 * as its own simple command. A heredoc without a closer fails closed: its
 * opener line stays unmasked and scanning resumes after it.
 */
function extractHeredocWrites(raw: string): { writes: HeredocWrite[]; masked: string } {
  const writes: HeredocWrite[] = [];
  let masked = '';
  let cursor = 0;
  for (;;) {
    const open = findHeredocOpener(raw, cursor);
    if (open === null) break;
    const close = heredocCloser(raw, open);
    if (close === null) {
      cursor = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
      continue;
    }
    const bodyStart = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
    let body = raw.slice(bodyStart, close.lineStart).replace(/\n$/, '');
    if (open.tabStrip) body = body.replace(/^\t+/gm, '');
    masked += raw.slice(cursor, open.cmdStart);
    masked += `__heredoc_${writes.length}__`;
    writes.push({ opener: raw.slice(open.cmdStart, open.openerLineEnd), body });
    cursor = close.lineEnd;
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}

// ---------------------------------------------------------------------------
// Redirect-token analysis and the write-touch grammars (plan §5.1, §5.2).
// ---------------------------------------------------------------------------

interface RedirectInfo {
  /** IO_NUMBER fd (`1>`/`2>`), or null when implicit. */
  fd: number | null;
  /** The operator. */
  op: '>' | '>>' | '&>' | '&>>' | '>&' | '<' | '<<' | '<<-' | '<<<';
  /** Attached target text, or null for a standalone operator (target = next token). */
  target: string | null;
}

const REDIRECT_TOKEN = /^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/;

function classifyRedirectToken(text: string): RedirectInfo | null {
  const m = text.match(REDIRECT_TOKEN);
  if (m === null) return null;
  const [, fdText, op, target] = m;
  return {
    fd: fdText === '' ? null : Number.parseInt(fdText, 10),
    op: op as RedirectInfo['op'],
    target: target === '' ? null : target
  };
}

/**
 * A content-producing redirect (plan §5.1): fd-1 `>`/`>>` (explicit `1>`/`1>>`
 * included) and `&>`/`&>>`. FD-numbered (`2>`), dup (`2>&1`, `>&f`),
 * `&`-leading-target dup (`>&`) and stdin (`<`) forms never produce content.
 */
function isContentRedirect(r: RedirectInfo): boolean {
  if (r.op === '>' || r.op === '>>') {
    if (r.fd !== null && r.fd !== 1) return false;
    if (r.target?.startsWith('&')) return false;
    return true;
  }
  return r.op === '&>' || r.op === '&>>';
}

/** The argv stream and redirect list of a simple command (plan §5.10): words minus redirect tokens and their targets. */
function analyzeTokens(tokens: Token[]): { argv: string[]; redirects: RedirectInfo[] } {
  const argv: string[] = [];
  const redirects: RedirectInfo[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    const info = classifyRedirectToken(token.text);
    if (info === null) {
      argv.push(token.text);
      continue;
    }
    if (info.target === null) {
      // A standalone operator consumes the next token as its target (or
      // heredoc delimiter / here-string content) — attached to the redirect
      // so the write grammars see it, and excluded from argv.
      const next = tokens[i + 1];
      if (next !== undefined && !next.isRedirect) {
        redirects.push({ ...info, target: next.text });
        i += 1;
        continue;
      }
    }
    redirects.push(info);
  }
  return { argv, redirects };
}

/**
 * Literal `echo`/`printf` content (plan §5.1) for append-body threading: no
 * flags, no shell expansion, no globs; `printf` only when the format has no
 * `%`/backslash directives (then the format itself is the literal content).
 */
function literalContent(argv: string[]): string | undefined {
  const host = argv[0];
  if (host !== 'echo' && host !== 'printf') return undefined;
  const args = argv.slice(1);
  if (args.length === 0) return undefined;
  for (const a of args) {
    if (a.startsWith('-') || hasShellExpansion(a) || /[*?]/.test(a)) return undefined;
  }
  if (host === 'printf') {
    if (args.length !== 1) return undefined;
    const fmt = args[0];
    if (fmt.includes('%') || fmt.includes('\\')) return undefined;
    return fmt;
  }
  return `${args.join(' ')}\n`;
}

/**
 * Resolve a redirect target against the current directory, emitting the
 * unresolved verdict (the read idioms' reason) when the path carries an
 * unexpanded shell variable or glob. Returns the absolute path, or null.
 */
function resolveTarget(results: SpanMatch[], idiom: Idiom, target: string, currentDir: string): string | null {
  if (looksUnresolvable(target)) {
    results.push({
      status: 'unresolved',
      idiom,
      fileArg: target,
      reason: 'path contains an unexpanded shell variable or glob'
    });
    return null;
  }
  return resolvePath(currentDir, target);
}

/** The `tee` operand grammar: append mode and operand list; unknown options return null (fail closed). */
function teeOperandParts(argv: string[]): { append: boolean; operands: string[] } | null {
  let append = false;
  let afterDashDash = false;
  const operands: string[] = [];
  for (const a of argv.slice(1)) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-a' || a === '--append') {
      append = true;
      continue;
    }
    if (a.startsWith('-')) return null;
    operands.push(a);
  }
  return { append, operands };
}

/**
 * The `tee` operand writes (plan §5.1): each operand is a whole-file
 * create-overwrite (truncating), or a whole-file append under `-a`/`--append`.
 * An append threads the one-hop literal echo/printf pipe source (`echo x |
 * tee -a f`, plan §5.2) as its written body; without a known source the
 * append carries no written content.
 */
function matchTeeOperands(
  argv: string[],
  pipeEchoContent: string | null,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const parts = teeOperandParts(argv);
  if (parts === null) return;
  for (const operand of parts.operands) {
    const absolutePath = resolveTarget(results, 'redirect-write', operand, currentDir);
    if (absolutePath === null) continue;
    results.push({
      status: 'resolved',
      idiom: 'redirect-write',
      span: !parts.append
        ? { operation: 'create-overwrite', absolutePath, simpleCommandIndex, join }
        : {
            operation: 'append',
            absolutePath,
            simpleCommandIndex,
            join,
            ...(pipeEchoContent !== null ? { written: pipeEchoContent } : {})
          }
    });
  }
}

/**
 * The redirect family grammar (plan §5.1), run for every simple command after
 * the read matchers: content-producing redirects on `echo`/`printf`/`tee`
 * write whole-file; a bare `> f` / `: > f` truncates (the main walk hands
 * argv-empty commands directly here); `>>`-only truncation forms append
 * nothing and touch nothing. Any other host with a content redirect (`ls > f`,
 * `python3 x.py > out`, `cat f > g`) gets no write touch — the redirect is
 * real, but its content is dynamic and out of scope.
 *
 * Body threading: exactly one plain `>>` (or `1>>`) content redirect on a
 * fully literal `echo`/`printf` threads the written body; `&>>`, multi-
 * redirect commands, and `tee` never thread.
 */
function matchRedirectFamily(
  argv: string[],
  redirects: RedirectInfo[],
  pipeEchoContent: string | null,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === 'tee') matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join, results);
    return;
  }
  if (host === undefined || host === ':') {
    // Bare `> f` and `: > f` truncate; `>>`/`&>>` append nothing → no touch.
    for (const r of contentRedirects) {
      if (r.op === '>>' || r.op === '&>>' || r.target === null) continue;
      const absolutePath = resolveTarget(results, 'truncate-write', r.target, currentDir);
      if (absolutePath === null) continue;
      results.push({
        status: 'resolved',
        idiom: 'truncate-write',
        span: { operation: 'truncate', absolutePath, simpleCommandIndex, join }
      });
    }
    return;
  }
  if (host !== 'echo' && host !== 'printf' && host !== 'tee') return;
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === '>>';
  const threaded = singlePlainAppend && host !== 'tee' ? literalContent(argv) : undefined;
  for (const r of contentRedirects) {
    if (r.target === null) continue;
    const absolutePath = resolveTarget(results, 'redirect-write', r.target, currentDir);
    if (absolutePath === null) continue;
    if (r.op === '>>' || r.op === '&>>') {
      results.push({
        status: 'resolved',
        idiom: 'redirect-write',
        span: {
          operation: 'append',
          absolutePath,
          simpleCommandIndex,
          join,
          ...(threaded !== undefined ? { written: threaded } : {})
        }
      });
    } else {
      results.push({
        status: 'resolved',
        idiom: 'redirect-write',
        span: { operation: 'create-overwrite', absolutePath, simpleCommandIndex, join }
      });
    }
  }
  if (host === 'tee') matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join, results);
}

// ---------------------------------------------------------------------------
// The file-mutation family grammars (plan §5.3–§5.7): cp/install/mv/git mv,
// rm/git rm/truncate, sed -i in-place edits, and patch/git apply. They share
// the §5 fail-closed rules: leading env assignments (stripped by the walk)
// and one `command`/`env` wrapper are skipped (mechanically certain); any
// other wrapper is unresolved; a leading-`-` token that is not a known option
// is treated as an option; `--` makes the rest operands; globbed or variable
// paths are unresolved; directory-shaped source operands fail closed.
// ---------------------------------------------------------------------------

/** Wrapper words that obscure the wrapped command's argv (plan §5): a family command behind one is unresolved, never guessed. */
const FOREIGN_WRAPPERS = new Set(['sudo', 'xargs', 'nohup', 'time', 'nice', 'doas']);

/** Strip at most one `command`/`env` wrapper — mechanically transparent (plan §5). */
function stripTransparentWrapper(argv: string[]): string[] {
  return argv[0] === 'command' || argv[0] === 'env' ? argv.slice(1) : argv;
}

function pushUnresolved(results: SpanMatch[], idiom: Idiom, fileArg: string, reason: string): void {
  results.push({ status: 'unresolved', idiom, fileArg, reason });
}

/** Whether the path is an existing directory (the dest-dir decision, plan §5.3/§5.4; fs stat like the read idioms' line counts). */
function isExistingDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The shared cp/install/mv operand grammar (plan §5.3/§5.4): per-family option
 * sets and touch operations behind one parser.
 */
interface CopyMoveSpec {
  idiom: 'cp-write' | 'install-write' | 'mv-write';
  /** Known no-value flags (consumed, never operands). */
  noValue: ReadonlySet<string>;
  /** Known value-taking flags (the next word is the value — `-t DIR`, or an install mode/owner/group). */
  valueTaking: ReadonlySet<string>;
  /** Flags that fail the whole command closed (`cp -b`/`--backup`, `install -d`, git mv dry-run `-n`/`--dry-run`). */
  excluded: ReadonlySet<string>;
  /** The per-source touch: cp/install read their sources; mv deletes them. */
  sourceOperation: 'read' | 'delete';
  /** The per-dest touch: cp/install overwrite; mv rename-copies. */
  destOperation: 'create-overwrite' | 'rename-copy';
}

const CP_SPEC: CopyMoveSpec = {
  idiom: 'cp-write',
  noValue: new Set(['-r', '-R', '-p', '-f', '-v', '-n', '-i', '-u', '-a', '-d', '-L', '-P']),
  valueTaking: new Set(['-t', '--target-directory']),
  excluded: new Set(['-b', '--backup']),
  sourceOperation: 'read',
  destOperation: 'create-overwrite'
};

const INSTALL_SPEC: CopyMoveSpec = {
  idiom: 'install-write',
  noValue: new Set(['-D', '-s', '-v']),
  valueTaking: new Set(['-t', '--target-directory', '-m', '-o', '-g']),
  excluded: new Set(['-d']),
  sourceOperation: 'read',
  destOperation: 'create-overwrite'
};

const MV_SPEC: CopyMoveSpec = {
  idiom: 'mv-write',
  noValue: new Set(['-f', '-i', '-n', '-v', '-u']),
  valueTaking: new Set(['-t', '--target-directory']),
  excluded: new Set(),
  sourceOperation: 'delete',
  destOperation: 'rename-copy'
};

const GIT_MV_SPEC: CopyMoveSpec = {
  idiom: 'mv-write',
  noValue: new Set(['-f', '-k', '-v']),
  valueTaking: new Set(),
  // `git mv -n`/`--dry-run` is a trial run that moves nothing (the same
  // read-only class as `patch --dry-run`, plan §5.7) — fail closed.
  excluded: new Set(['-n', '--dry-run']),
  sourceOperation: 'delete',
  destOperation: 'rename-copy'
};

interface CopyMoveParts {
  /** Operands in order (sources; in the non-`-t` form the last is the dest). */
  operands: string[];
  /** The `-t`/`--target-directory` value, or null. */
  targetDir: string | null;
}

/**
 * Parse the operands of a cp/install/mv command: known options are consumed,
 * `--` makes the rest operands, and `-t`/`--target-directory[=DIR]` is
 * value-taking — the next word is the target directory, never a source. A
 * leading-`-` token that is not a known option is treated as an option (no
 * touch). Returns null when a fail-closed option is present or a value-taking
 * flag is left valueless.
 */
function copyMoveParts(args: string[], spec: CopyMoveSpec): CopyMoveParts | null {
  const operands: string[] = [];
  let targetDir: string | null = null;
  let i = 0;
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      i += 1;
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === '-t' || a === '--target-directory') {
      const v = args[i + 1];
      if (v === undefined) return null;
      targetDir = v;
      i += 2;
      continue;
    }
    if (a.startsWith('--target-directory=')) {
      targetDir = a.slice('--target-directory='.length);
      i += 1;
      continue;
    }
    if (spec.excluded.has(a)) return null;
    if (spec.valueTaking.has(a)) {
      if (args[i + 1] === undefined) return null;
      i += 2;
      continue;
    }
    if (spec.noValue.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith('-')) {
      i += 1;
      continue;
    }
    operands.push(a);
    i += 1;
  }
  return { operands, targetDir };
}

/**
 * The per-source touch of a cp/install/mv command. cp/install sources are
 * whole-file reads resolved against fs like the read idioms — a source that
 * cannot be read at parse time is unresolved (a failed copy read nothing). The
 * mv source is a delete.
 */
function emitSourceSpan(
  results: SpanMatch[],
  spec: CopyMoveSpec,
  absolutePath: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join']
): void {
  if (spec.sourceOperation === 'delete') {
    results.push({
      status: 'resolved',
      idiom: spec.idiom,
      span: { operation: 'delete', absolutePath, simpleCommandIndex, join }
    });
    return;
  }
  const range = resolveSpec({ kind: 'toEof', start: 1 }, () => countFileLines(absolutePath));
  if (range === null) {
    pushUnresolved(
      results,
      spec.idiom,
      absolutePath,
      'could not determine end-of-file line count (file unreadable, empty, or missing)'
    );
    return;
  }
  results.push({
    status: 'resolved',
    idiom: spec.idiom,
    span: {
      operation: 'read',
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join
    }
  });
}

/**
 * The cp/install/mv family (plan §5.3/§5.4): operands resolve to source/dest
 * pairs — each source is a read (cp/install) or delete (mv), each dest a
 * create-overwrite (cp/install) or rename-copy (mv), sources before dests in
 * declaration order. A dest that ends in `/` or stats as an existing directory
 * maps to `dir/basename(source)` per source; `-t DIR`/`--target-directory=DIR`
 * maps the same way and is unresolved when its value is not directory-shaped.
 * Multi-source commands need a directory dest; a directory-shaped or
 * globbed/variable source, a globbed/variable dest, or a fail-closed option
 * (`cp -b`, `install -d`, git mv `-n`) emits no touches.
 */
function matchCopyMoveFamily(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let spec: CopyMoveSpec | null = null;
  let args: string[] = [];
  let dir = dirForResolution;
  if (command === 'cp' || command === 'install' || command === 'mv') {
    spec = command === 'cp' ? CP_SPEC : command === 'install' ? INSTALL_SPEC : MV_SPEC;
    args = rest.slice(1);
  } else if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === 'mv') {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, 'mv-write', 'mv', 'git -C target contains an unresolved shell variable');
        return;
      }
      spec = GIT_MV_SPEC;
      args = rest.slice(1).slice(sub.subIdx + 1);
      dir = sub.cDir ?? dirForResolution;
    }
  } else if (FOREIGN_WRAPPERS.has(command)) {
    // A wrapper obscures the wrapped argv — fail closed rather than mis-parse.
    const wrapped = rest[1];
    const wrappedSpec =
      wrapped === 'cp' ? CP_SPEC : wrapped === 'install' ? INSTALL_SPEC : wrapped === 'mv' ? MV_SPEC : null;
    if (wrappedSpec !== null) {
      pushUnresolved(results, wrappedSpec.idiom, wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  if (spec === null) return;

  const parts = copyMoveParts(args, spec);
  if (parts === null || parts.operands.length === 0) return;

  // Resolve every source before emitting anything: a directory-shaped,
  // globbed, or variable source fails the whole command closed (the dest
  // mapping is per-source, so an unknowable source makes the dests unknowable).
  const sourcePaths: string[] = [];
  for (const source of parts.operands.slice(0, parts.targetDir === null ? -1 : undefined)) {
    if (source.endsWith('/')) return;
    const absolutePath = resolveTarget(results, spec.idiom, source, dir);
    if (absolutePath === null) return;
    if (isExistingDirectory(absolutePath)) return;
    sourcePaths.push(absolutePath);
  }
  if (sourcePaths.length === 0) return;

  let destPaths: string[];
  if (parts.targetDir !== null) {
    if (looksUnresolvable(parts.targetDir)) {
      pushUnresolved(results, spec.idiom, parts.targetDir, 'path contains an unexpanded shell variable or glob');
      return;
    }
    if (!parts.targetDir.endsWith('/') && !isExistingDirectory(resolvePath(dir, parts.targetDir))) {
      pushUnresolved(results, spec.idiom, parts.targetDir, 'the -t target is not an existing directory');
      return;
    }
    const targetAbs = resolvePath(dir, parts.targetDir);
    destPaths = sourcePaths.map((p) => joinPath(targetAbs, basename(p)));
  } else {
    const dest = parts.operands[parts.operands.length - 1];
    if (looksUnresolvable(dest)) {
      pushUnresolved(results, spec.idiom, dest, 'path contains an unexpanded shell variable or glob');
      return;
    }
    const destAbs = resolvePath(dir, dest);
    const destIsDir = dest.endsWith('/') || isExistingDirectory(destAbs);
    if (sourcePaths.length > 1 && !destIsDir) {
      pushUnresolved(results, spec.idiom, dest, 'a multi-source copy/move needs a directory destination');
      return;
    }
    destPaths = destIsDir ? sourcePaths.map((p) => joinPath(destAbs, basename(p))) : [destAbs];
  }

  for (let k = 0; k < sourcePaths.length; k++) {
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: 'resolved',
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join }
    });
  }
}

const RM_NO_VALUE = new Set(['-f', '-i', '-v']);
/** `rm`/`git rm` flags whose semantics are out of scope: recursive removal and rmdir. */
const RM_EXCLUDED = new Set(['-r', '-R', '--recursive', '-d']);
/** `git rm` adds the dry-run form to the exclusions. */
const GIT_RM_EXCLUDED = new Set(['-r', '-R', '--recursive', '-d', '-n', '--dry-run']);

/**
 * The shared rm/git rm operand grammar (plan §5.5): a recursive/rmdir flag (or
 * `--cached` for git rm — the worktree file survives) excludes the whole
 * command; each remaining file-shaped operand is a delete, and a
 * directory-shaped operand fails closed.
 */
function matchRmOperands(
  args: string[],
  excluded: ReadonlySet<string>,
  excludeCached: boolean,
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let afterDashDash = false;
  const operands: string[] = [];
  for (const a of args) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (excluded.has(a) || (excludeCached && a === '--cached')) return;
    if (RM_NO_VALUE.has(a)) continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option
    operands.push(a);
  }
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, 'rm-write', operand, 'path contains an unexpanded shell variable or glob');
      continue;
    }
    if (operand.endsWith('/') || isExistingDirectory(resolvePath(dir, operand))) continue;
    results.push({
      status: 'resolved',
      idiom: 'rm-write',
      span: { operation: 'delete', absolutePath: resolvePath(dir, operand), simpleCommandIndex, join }
    });
  }
}

/**
 * The truncate grammar (plan §5.5): `-s SIZE`/`-r ref` are value-taking — the
 * size value may itself lead with `-` (`truncate -s -10 f`) — and `-c` is
 * compatible. Without `-s`/`-r` the command changes nothing → no touch. Each
 * file-shaped operand is a truncate.
 */
function matchTruncateOperands(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let sawSizeFlag = false;
  let afterDashDash = false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-s' || a === '-r') {
      sawSizeFlag = true;
      i += 1; // consume the size/ref value, even when it leads with `-`
      continue;
    }
    if (a === '-c') continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option
    operands.push(a);
  }
  if (!sawSizeFlag) return;
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, 'truncate-command', operand, 'path contains an unexpanded shell variable or glob');
      continue;
    }
    if (operand.endsWith('/') || isExistingDirectory(resolvePath(dir, operand))) continue;
    results.push({
      status: 'resolved',
      idiom: 'truncate-command',
      span: { operation: 'truncate', absolutePath: resolvePath(dir, operand), simpleCommandIndex, join }
    });
  }
}

/**
 * The rm/git rm/truncate family (plan §5.5): `rm`/`git rm` operands are
 * deletes, `truncate` operands are truncations (only when `-s`/`-r` is
 * present). `git rm --cached` touches nothing.
 */
function matchRmTruncate(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'rm') {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join, results);
    return;
  }
  if (command === 'truncate') {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join, results);
    return;
  }
  if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === 'rm') {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, 'rm-write', 'rm', 'git -C target contains an unresolved shell variable');
        return;
      }
      matchRmOperands(
        rest.slice(1).slice(sub.subIdx + 1),
        GIT_RM_EXCLUDED,
        true,
        sub.cDir ?? dirForResolution,
        simpleCommandIndex,
        join,
        results
      );
    }
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'rm' || wrapped === 'truncate') {
      pushUnresolved(
        results,
        wrapped === 'rm' ? 'rm-write' : 'truncate-command',
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}

/**
 * The heredoc write grammar (plan §5.2) for the host families whose bodies are
 * content: `cat` (body → the content redirects), `tee` (body → the operands),
 * and `patch`/`git apply` (body → patch text, §5.7). Any other host's heredoc
 * body is not attributable content — stdin-only and non-family commands
 * (`python3 - <<EOF > out`, `ls > out <<EOF`) get no write touch, and
 * read-family commands (`sed -n '1,2p' <<EOF`) fall through to the read
 * matchers. Empty `>>`-bodies append nothing and touch nothing; empty `>`-bodies
 * truncate (whole-file, the F2 rule).
 */
function classifyHeredocOpener(
  opener: string,
  body: string,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const tokens = tokenize(stripLeadingAssignments(opener).trim());
  if (tokens === null) return;
  const { argv, redirects } = analyzeTokens(tokens);
  const host = argv[0];
  const contentRedirects = redirects.filter(isContentRedirect);
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === '>>';

  const emitContentRedirects = (): void => {
    for (const r of contentRedirects) {
      if (r.target === null) continue;
      const absolutePath = resolveTarget(results, 'heredoc-write', r.target, currentDir);
      if (absolutePath === null) continue;
      if (r.op === '>>' || r.op === '&>>') {
        if (body.length === 0) continue;
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span: {
            operation: 'append',
            absolutePath,
            simpleCommandIndex,
            join,
            ...(singlePlainAppend && r.op === '>>' ? { written: body } : {})
          }
        });
      } else {
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span:
            body.length === 0
              ? { operation: 'truncate', absolutePath, simpleCommandIndex, join }
              : { operation: 'create-overwrite', absolutePath, simpleCommandIndex, join }
        });
      }
    }
  };

  if (host === 'cat') {
    emitContentRedirects();
    return;
  }
  if (host === 'tee') {
    const parts = teeOperandParts(argv);
    if (parts !== null) {
      for (const operand of parts.operands) {
        const absolutePath = resolveTarget(results, 'heredoc-write', operand, currentDir);
        if (absolutePath === null) continue;
        if (parts.append) {
          if (body.length === 0) continue;
          results.push({
            status: 'resolved',
            idiom: 'heredoc-write',
            span: {
              operation: 'append',
              absolutePath,
              simpleCommandIndex,
              join,
              ...(contentRedirects.length === 0 ? { written: body } : {})
            }
          });
        } else {
          results.push({
            status: 'resolved',
            idiom: 'heredoc-write',
            span:
              body.length === 0
                ? { operation: 'truncate', absolutePath, simpleCommandIndex, join }
                : { operation: 'create-overwrite', absolutePath, simpleCommandIndex, join }
          });
        }
      }
    }
    emitContentRedirects();
    return;
  }
  if (host === 'patch' || host === 'git') {
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join, results);
    return;
  }
  // Non-family host: the body is not attributable content — no write touch.
}

// ---------------------------------------------------------------------------
// The sed -i grammar (plan §5.6), the first consumer of exact ranges: a
// substitution-only script with numeric addresses modifies the addressed
// lines; anything less statically certain is a whole-file modify. The
// suffix/script disambiguation and the segment classification below are the
// whole of it — everything else follows the shared §5 fail-closed rules.
// ---------------------------------------------------------------------------

/** A numeric-addressed substitution segment (`N`, `N,M`) — the only form with an exact range. */
const NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;

/** An unaddressed substitution segment — line-count-preserving, whole file addressed. */
const UNRESTRICTED_SUBSTITUTION = /^[sy]/;

function matchSedInplace(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'sed') {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'sed') {
      pushUnresolved(results, 'sed-inplace', wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}

/**
 * The sed -i operand grammar: `-i` bare, `-iSUFFIX` attached, or a separate
 * suffix word resolved by the standard disambiguation — the word after `-i`
 * is the suffix only when it does not start with `-` and a script plus at
 * least one file operand still follow it (the BSD separate-suffix reading;
 * GNU's attached-only reading otherwise). An attached or disambiguated suffix
 * is a backup: a non-empty suffix emits an additional create-overwrite touch
 * on `<file><SUFFIX>`; an empty suffix (which the quote-aware tokenizer drops
 * entirely — `sed -i '' f` and `sed -i f` tokenize alike) creates no backup.
 *
 * The script is the script argument plus every `-e` argument, split on `;`.
 * Segments that are all numeric-addressed substitutions yield the exact range
 * [min start, min(max end, EOF)] (per file, EOF from the post-edit count);
 * segments that are all substitutions — any numeric/unaddressed mix — are
 * still line-count-preserving, so the whole file is addressed ([1, EOF]);
 * any count-changing, pattern-addressed, step, or `$`-addressed segment is a
 * whole-file modify with no range. An absent script (no script argument, no
 * `-e`) is unresolved.
 */
function matchSedInplaceArgs(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let suffix: string | null = null;
  let sawInplace = false;
  let i = 0;
  const eScripts: string[] = [];
  // The script/file split of the positionals is derived after the scan: the
  // first positional is the script argument only when no `-e` script exists —
  // with `-e` present every positional is a file (GNU sed reads the script
  // from `-e` then, not from the first positional).
  const positionals: string[] = [];
  // Files pushed outside the positional path: `sed -i f` (script absent).
  const files: string[] = [];
  let afterDashDash = false;

  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      positionals.push(a);
      i += 1;
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === '-n') {
      i += 1;
      continue;
    }
    if (a === '-e') {
      const v = args[i + 1];
      if (v === undefined) {
        pushUnresolved(results, 'sed-inplace', a, 'the -e flag is left valueless');
        return;
      }
      eScripts.push(v);
      i += 2;
      continue;
    }
    if (a === '-i') {
      sawInplace = true;
      const w = args[i + 1];
      if (w === undefined) {
        // `sed -i` with nothing after: no suffix, no script — the absent-script
        // check below resolves this unresolved.
        i += 1;
        continue;
      }
      if (w.startsWith('-')) {
        // The word after -i is an option, never a suffix.
        i += 1;
        continue;
      }
      const restAfter = args.slice(i + 2);
      if (restAfter.length >= 2) {
        // The BSD separate-suffix reading: w is the suffix, and a script plus
        // at least one file operand still follow.
        suffix = w;
        i += 2;
        continue;
      }
      if (restAfter.length === 0) {
        // `sed -i f`: w is the last token — no script can follow, so w is the
        // file operand with the script absent (GNU instead reads w as a script
        // and errors; either way the edit does not happen).
        files.push(w);
        i += 2;
        continue;
      }
      // One token after w: w is the script argument (or a file, when `-e`
      // scripts are present) and the token is a file — consume both, so
      // neither falls through to the positional path again.
      positionals.push(w, restAfter[0]);
      i += 3;
      continue;
    }
    if (a.startsWith('-i') && a.length > 2) {
      sawInplace = true;
      suffix = a.slice(2);
      i += 1;
      continue;
    }
    if (a.startsWith('-')) {
      // Unknown option — never a script or file.
      i += 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }

  if (!sawInplace) return; // not an in-place edit at all
  const scriptArg = eScripts.length === 0 ? (positionals[0] ?? null) : null;
  if (scriptArg !== null) files.push(...positionals.slice(1));
  else files.push(...positionals);
  const segments: string[] = [];
  if (scriptArg !== null) segments.push(...scriptArg.split(';'));
  for (const s of eScripts) segments.push(...s.split(';'));
  if (segments.length === 0) {
    pushUnresolved(results, 'sed-inplace', files[0] ?? 'sed', 'no script (absent or empty script argument)');
    return;
  }

  // Segment classification: exact when every segment is a numeric-addressed
  // substitution; explicit whole-file [1, EOF] when every segment is still a
  // substitution (any unaddressed/numeric mix); no range otherwise.
  let allNumeric = true;
  let allSubstitution = true;
  let minStart = Infinity;
  let maxEnd = 0;
  for (const segment of segments) {
    const m = segment.match(NUMERIC_SUBSTITUTION);
    if (m === null) {
      allNumeric = false;
      if (!UNRESTRICTED_SUBSTITUTION.test(segment)) allSubstitution = false;
      continue;
    }
    const s = Number.parseInt(m[1], 10);
    const e = m[2] === undefined ? s : Number.parseInt(m[2], 10);
    minStart = Math.min(minStart, s);
    maxEnd = Math.max(maxEnd, e);
  }

  for (const f of files) {
    if (looksUnresolvable(f)) {
      pushUnresolved(results, 'sed-inplace', f, 'path contains an unexpanded shell variable or glob');
      continue;
    }
    const absolutePath = resolvePath(dir, f);
    if (allNumeric || allSubstitution) {
      const total = countFileLines(absolutePath);
      if (total === null) {
        pushUnresolved(
          results,
          'sed-inplace',
          absolutePath,
          'could not determine end-of-file line count (file unreadable, empty, or missing)'
        );
        continue;
      }
      const start = allNumeric ? minStart : 1;
      const end = allNumeric ? Math.min(maxEnd, total) : total;
      if (start > end) continue; // the addressed range lies beyond EOF — nothing is modified
      results.push({
        status: 'resolved',
        idiom: 'sed-inplace',
        span: { operation: 'modify', lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join }
      });
    } else {
      results.push({
        status: 'resolved',
        idiom: 'sed-inplace',
        span: { operation: 'modify', absolutePath, simpleCommandIndex, join }
      });
    }
    if (suffix !== null && suffix !== '') {
      results.push({
        status: 'resolved',
        idiom: 'sed-inplace',
        span: { operation: 'create-overwrite', absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The patch / git apply grammar (plan §5.7). Patch text sources, in order of
// recognition: a literal patch-file operand (`git apply <file>` — a `patch`
// operand is a target file, not a source, and is ignored), the stdin `<`
// source (`patch -pN < file`, `git apply - < file`), or a heredoc body
// (classifyPatchHeredoc, §5.2). Read-only modes (`--check`/`--stat`/
// `--numstat`/`--summary`, `patch --dry-run`) and index-only `--cached` touch
// nothing; `--directory` fails closed (it rewrites patch paths). A command
// with no statically known source (piped or terminal stdin, a variable patch
// path) is unresolved. Targets and ranges come from the new
// range-preserving unified-diff parser (unified-diff.ts).
// ---------------------------------------------------------------------------

/** The shared `patch`/`git apply` option surface (plan §5.7): strip level, read-only and index-only modes, `--directory`, and operands. */
interface PatchApplyParts {
  strip: PathStrip;
  readOnly: boolean;
  cachedOnly: boolean;
  directory: boolean;
  operands: string[];
}

function patchApplyParts(args: string[], isGitApply: boolean): PatchApplyParts {
  let strip: PathStrip = isGitApply ? 1 : 'auto';
  let readOnly = false;
  let cachedOnly = false;
  let directory = false;
  const operands: string[] = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (isGitApply) {
      if (a === '--check' || a === '--stat' || a === '--numstat' || a === '--summary') {
        readOnly = true;
        continue;
      }
      if (a === '--cached') {
        cachedOnly = true;
        continue;
      }
      if (a === '--index' || a === '-R' || a === '--reverse' || a === '--unsafe-paths' || a === '--reject') continue;
      if (a === '--directory') {
        directory = true;
        continue;
      }
      if (a.startsWith('--directory=')) {
        directory = true;
        continue;
      }
      if (a === '-p') {
        const v = args[i + 1];
        if (v !== undefined && /^\d+$/.test(v)) {
          strip = Number.parseInt(v, 10);
          i += 1;
        }
        continue;
      }
      if (/^-p\d+$/.test(a)) {
        strip = Number.parseInt(a.slice(2), 10);
        continue;
      }
      if (a.startsWith('-')) continue;
      operands.push(a);
      continue;
    }
    // patch
    if (a === '--dry-run') {
      readOnly = true;
      continue;
    }
    if (a === '-N' || a === '--forward') continue;
    if (a === '-p') {
      const v = args[i + 1];
      if (v !== undefined && /^\d+$/.test(v)) {
        strip = Number.parseInt(v, 10);
        i += 1;
      }
      continue;
    }
    if (/^-p\d+$/.test(a)) {
      strip = Number.parseInt(a.slice(2), 10);
      continue;
    }
    if (a.startsWith('-')) continue;
    operands.push(a);
  }
  return { strip, readOnly, cachedOnly, directory, operands };
}

/** The patch text at `absolutePath`, or null when it can't be read. */
function readPatchFile(absolutePath: string): string | null {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Emit the write touches for a `patch`/`git apply` command with a statically
 * known patch-text source. `targetDir` is where the patch's target paths
 * resolve (the git `-C` directory for `git apply`, the current directory
 * otherwise); `shellDir` is where the shell's stdin `<` redirect target
 * resolves — a redirect is shell-side, so `git -C` never affects it.
 */
function emitPatchTargets(
  args: string[],
  isGitApply: boolean,
  host: string,
  targetDir: string,
  shellDir: string,
  redirects: RedirectInfo[],
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return; // read-only / index-only — no touches
  if (parts.directory) {
    pushUnresolved(results, 'patch-write', '--directory', '--directory rewrites patch paths');
    return;
  }

  let patchText: string | null = null;
  let source: string | null = null;
  // 1. A literal patch-file operand (git apply only; a patch operand is a
  //    target file, not a source — ignored).
  if (isGitApply) {
    const operand = parts.operands.find((o) => o !== '-');
    if (operand !== undefined) {
      if (looksUnresolvable(operand)) {
        pushUnresolved(results, 'patch-write', operand, 'path contains an unexpanded shell variable or glob');
        return;
      }
      source = resolvePath(targetDir, operand);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, 'patch-write', source, 'patch file unreadable or missing');
        return;
      }
    }
  }
  // 2. The stdin `<` source (patch and git apply).
  if (patchText === null) {
    const stdin = redirects.find((r) => r.op === '<');
    if (stdin !== undefined && stdin.target !== null) {
      if (looksUnresolvable(stdin.target)) {
        pushUnresolved(results, 'patch-write', stdin.target, 'path contains an unexpanded shell variable or glob');
        return;
      }
      source = resolvePath(shellDir, stdin.target);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, 'patch-write', source, 'patch text unreadable or missing');
        return;
      }
    }
  }
  // 3. No statically known source: stdin is dynamic (terminal, pipe, variable).
  if (patchText === null) {
    pushUnresolved(results, 'patch-write', host, 'no statically known patch text source (stdin is dynamic)');
    return;
  }

  const targets = parseUnifiedDiffRange(patchText, parts.strip);
  if (targets === null) {
    pushUnresolved(results, 'patch-write', source ?? host, 'malformed or empty patch text');
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, 'patch-write', t.path, targetDir);
    if (absolutePath === null) continue;
    results.push({
      status: 'resolved',
      idiom: 'patch-write',
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join,
        ...(t.lineStart !== undefined ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {})
      }
    });
  }
}

/**
 * The patch/git apply grammar in the main walk: `patch` reads patch text from
 * stdin or a `<` redirect; `git apply` additionally accepts a patch-file
 * operand and resolves targets against its `-C` directory. A wrapped
 * `patch`/`apply` is unresolved — the wrapper obscures the argv.
 */
function matchPatchApply(
  argv: string[],
  redirects: RedirectInfo[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'patch') {
    emitPatchTargets(
      rest.slice(1),
      false,
      'patch',
      dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join,
      results
    );
    return;
  }
  if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== 'apply') return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, 'patch-write', 'apply', 'git -C target contains an unresolved shell variable');
      return;
    }
    emitPatchTargets(
      rest.slice(1).slice(sub.subIdx + 1),
      true,
      'apply',
      sub.cDir ?? dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join,
      results
    );
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'patch' || wrapped === 'apply') {
      pushUnresolved(results, 'patch-write', wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}

/**
 * The heredoc patch-text grammar (plan §5.7): a `patch`/`git apply` heredoc
 * body is patch text. The opener's own options still apply — `--dry-run`/
 * `--check`/`--stat`/`--numstat`/`--summary`/`--cached` make the body
 * read-only (no touches), `--directory` fails closed, and `-pN` sets the
 * header strip level.
 */
function classifyPatchHeredoc(
  argv: string[],
  body: string,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let isGitApply = false;
  let args: string[];
  let dir = currentDir;
  if (command === 'patch') {
    args = rest.slice(1);
  } else if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== 'apply') return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, 'patch-write', 'apply', 'git -C target contains an unresolved shell variable');
      return;
    }
    isGitApply = true;
    args = rest.slice(1).slice(sub.subIdx + 1);
    dir = sub.cDir ?? currentDir;
  } else {
    return;
  }
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return;
  if (parts.directory) {
    pushUnresolved(results, 'patch-write', '--directory', '--directory rewrites patch paths');
    return;
  }
  const targets = parseUnifiedDiffRange(body, parts.strip);
  if (targets === null) {
    pushUnresolved(results, 'patch-write', 'heredoc', 'malformed or empty patch text');
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, 'patch-write', t.path, dir);
    if (absolutePath === null) continue;
    results.push({
      status: 'resolved',
      idiom: 'patch-write',
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join,
        ...(t.lineStart !== undefined ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {})
      }
    });
  }
}

// ---------------------------------------------------------------------------
// The formatter / fixer grammar (plan §5.8): a table-driven family over the
// corpus-derived 16-tool set. Flag matching is exact-token on full argv words —
// never prefix or substring — and the read-only list is consulted first, so
// `--fix-dry-run` can never collide with `--fix` and `black --check` never
// heals. Tools whose write form is a bare invocation (black, isort, rustfmt)
// carry the empty form and fire on the write form itself. Leading transparent
// package-runner wrappers (npx, yarn, pnpm exec/dlx, bunx, npm exec) strip
// under a pinned option grammar; a wrapper that could rewrite argv fails
// closed as unresolved.
// ---------------------------------------------------------------------------

/** One §5.8 table row: the tool command and its write/read-only token forms. */
export interface FormatterToolRow {
  command: string;
  /** Token sequences whose exact-token presence marks the invocation a write. */
  writeForms: string[][];
  /** Token sequences consulted first — presence suppresses the write (the read-only mode wins). */
  readOnlyForms: string[][];
}

/**
 * The §5.8 table, exported so the corpus-coverage fixture can assert two-sided
 * tool-set equality and per-tool read-only suppression (plan §5.8, Phase 3
 * step 8).
 */
export const FORMATTER_TABLE: readonly FormatterToolRow[] = [
  {
    command: 'prettier',
    writeForms: [['--write'], ['-w']],
    readOnlyForms: [['--check'], ['--list-different'], ['--debug-check']]
  },
  { command: 'eslint', writeForms: [['--fix']], readOnlyForms: [['--fix-dry-run']] },
  {
    command: 'biome',
    writeForms: [
      ['check', '--write'],
      ['check', '--fix'],
      ['format', '--write']
    ],
    readOnlyForms: []
  },
  { command: 'gofmt', writeForms: [['-w']], readOnlyForms: [['-l']] },
  { command: 'goimports', writeForms: [['-w']], readOnlyForms: [] },
  { command: 'clang-format', writeForms: [['-i']], readOnlyForms: [['--dry-run']] },
  { command: 'shfmt', writeForms: [['-w']], readOnlyForms: [['-d']] },
  { command: 'yapf', writeForms: [['-i']], readOnlyForms: [['--diff']] },
  { command: 'autopep8', writeForms: [['-i']], readOnlyForms: [['-d'], ['--diff']] },
  { command: 'black', writeForms: [[]], readOnlyForms: [['--check'], ['--diff']] },
  { command: 'isort', writeForms: [[]], readOnlyForms: [['--check-only'], ['--diff']] },
  {
    command: 'ruff',
    writeForms: [['format'], ['check', '--fix']],
    readOnlyForms: [
      ['check', '--no-fix'],
      ['format', '--check']
    ]
  },
  { command: 'deno', writeForms: [['fmt']], readOnlyForms: [['fmt', '--check']] },
  { command: 'dprint', writeForms: [['fmt']], readOnlyForms: [['check']] },
  { command: 'rustfmt', writeForms: [[]], readOnlyForms: [['--check'], ['--emit', 'stdout']] },
  {
    command: 'terraform',
    writeForms: [['fmt']],
    readOnlyForms: [
      ['fmt', '-check'],
      ['fmt', '-diff']
    ]
  }
];

/** The pinned package-runner no-arg flags (plan §5.8): flags that cannot move or rewrite argv. */
const RUNNER_NO_ARG_FLAGS = new Set(['-y', '--yes', '--no-install']);

/** The outcome of stripping one leading package-runner wrapper. */
type RunnerStrip = { kind: 'stripped'; stripped: string[] } | { kind: 'obscured' };

/**
 * Strip one leading transparent package-runner wrapper (plan §5.8): `npx`,
 * `yarn`, `pnpm exec`/`pnpm dlx`, `bunx`, and `npm exec` followed directly by
 * the wrapped command word, with only the pinned no-arg flags (`-y`/`--yes`,
 * `--no-install`) and `npm exec`'s `--` terminator between. A string-form
 * argument (`npx "prettier --write f"`), an argv-altering runner flag
 * (`--package=X` or a flag consuming the next word), or a wrapper word that is
 * itself a script (`.`-prefixed) obscures the wrapped argv — the wrapper is
 * transparent only when the pinned grammar proves it so. Returns 'not-runner'
 * when the word is not a runner at all (a different npm/pnpm subcommand, or a
 * bare runner with no command word) — the table matches it directly, which
 * fails closed for non-formatter runners.
 */
function stripPackageRunner(argv: string[]): RunnerStrip | 'not-runner' {
  const runner = argv[0];
  let rest = argv.slice(1);
  if (runner === 'npx' || runner === 'yarn' || runner === 'bunx') {
    // These runners take the command word directly.
  } else if (runner === 'pnpm') {
    if (rest[0] !== 'exec' && rest[0] !== 'dlx') return 'not-runner';
    rest = rest.slice(1);
  } else if (runner === 'npm') {
    if (rest[0] !== 'exec') return 'not-runner';
    rest = rest.slice(1);
  } else {
    return 'not-runner';
  }
  while (RUNNER_NO_ARG_FLAGS.has(rest[0])) rest = rest.slice(1);
  if (runner === 'npm' && rest[0] === '--') rest = rest.slice(1);
  if (rest.length === 0) return 'not-runner'; // a bare runner attributes nothing
  const wrapped = rest[0];
  if (wrapped.startsWith('-') || wrapped.startsWith('.') || /\s/.test(wrapped)) return { kind: 'obscured' };
  return { kind: 'stripped', stripped: rest };
}

/**
 * The formatter/fixer family (plan §5.8). The read-only forms are consulted
 * first and win over any write form; a write form with no read-only form and
 * every operand an explicit file emits a whole-file `modify` per operand;
 * directory/glob/no-operand invocations touch nothing; unknown executables
 * fail closed. A form's leading subcommand word (`check`/`format`/`fmt`) is
 * positional — it must lead the tool's args, so `deno task fmt` is a script
 * runner, not a formatter.
 */
function matchFormatter(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  let words = rest;
  const strip = stripPackageRunner(rest);
  if (strip === 'not-runner') {
    // rest[0] is not a package runner — the table matches it directly.
  } else if (strip.kind === 'obscured') {
    pushUnresolved(results, 'formatter-write', rest[0], `the ${rest[0]} wrapper obscures the wrapped argv`);
    return;
  } else {
    words = strip.stripped;
  }
  if (FOREIGN_WRAPPERS.has(words[0])) {
    const wrapped = words[1];
    if (wrapped !== undefined && FORMATTER_TABLE.some((r) => r.command === wrapped)) {
      pushUnresolved(results, 'formatter-write', wrapped, `the ${words[0]} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  const row = FORMATTER_TABLE.find((r) => r.command === words[0]);
  if (row === undefined) return; // unknown executable — fail closed, no touch
  const args = words.slice(1);
  const formPresent = (form: string[]): boolean => {
    const first = form[0];
    if (first !== undefined && !first.startsWith('-') && args[0] !== first) return false;
    return form.every((token) => args.includes(token));
  };
  // The read-only list is consulted first and wins over any write form:
  // `eslint --fix --fix-dry-run f` writes nothing, `black --check f` never heals.
  if (row.readOnlyForms.some(formPresent)) return;
  if (!row.writeForms.some(formPresent)) return; // bare invocations of flag-required tools are read-only (stdout/lint)
  // Consume the tool's subcommand word before collecting operands.
  const subcommandWords = new Set<string>();
  for (const form of row.writeForms) {
    for (const token of form) {
      if (!token.startsWith('-')) subcommandWords.add(token);
    }
  }
  const afterSubcommand = subcommandWords.has(args[0]) ? args.slice(1) : args;
  let afterDashDash = false;
  const operands: string[] = [];
  for (const a of afterSubcommand) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a.startsWith('-')) continue; // unknown option → treated as an option (shared §5)
    operands.push(a);
  }
  if (operands.length === 0) return; // no-operand invocations touch nothing
  // Every operand must be an explicit file — a glob, variable, directory, or
  // trailing-slash operand fails the whole command closed.
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, 'formatter-write', operand, 'path contains an unexpanded shell variable or glob');
      return;
    }
    if (operand.endsWith('/') || isExistingDirectory(resolvePath(dirForResolution, operand))) return;
  }
  for (const operand of operands) {
    results.push({
      status: 'resolved',
      idiom: 'formatter-write',
      span: { operation: 'modify', absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join }
    });
  }
}

// ---------------------------------------------------------------------------
// The git restore / git checkout grammar (plan §5.9), the last pure-parser
// family. Restore has no revision operand form — its positional args are
// always pathspecs; checkout skips a pre-`--` revision/ref operand and takes
// pathspecs only after `--`. Every explicit-file pathspec is a whole-file
// create-overwrite touch; a directory-shaped pathspec (`.`/`..`, trailing `/`,
// or a path that stats as a directory), `--staged`-only restore, and
// `-p`/`--patch` interactive hunk selection all fail closed.
// ---------------------------------------------------------------------------

/** git restore no-value flags (plan §5.9); `-s`/`--source`, `--staged`, `-W`/`--worktree`, `-m`/`--merge`, and `-p`/`--patch` are handled explicitly. */
const RESTORE_NO_VALUE = new Set(['-q', '-f', '-u']);

/**
 * The shared restore/checkout pathspec emission (plan §5.9): an explicit-file
 * pathspec (no globs, no `.`/`..`, no directory, no trailing `/`) is a
 * create-overwrite whole-file touch; a directory-shaped pathspec is
 * unresolved — a directory restore/checkout rewrites arbitrary files beneath
 * it and cannot be attributed to a file write.
 */
function emitRestoreCheckoutPathspec(
  results: SpanMatch[],
  idiom: 'git-restore-write' | 'git-checkout-write',
  operand: string,
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join']
): void {
  if (looksUnresolvable(operand)) {
    pushUnresolved(results, idiom, operand, 'path contains an unexpanded shell variable or glob');
    return;
  }
  const absolutePath = resolvePath(dir, operand);
  if (operand === '.' || operand === '..' || operand.endsWith('/') || isExistingDirectory(absolutePath)) {
    pushUnresolved(
      results,
      idiom,
      operand,
      'directory-shaped pathspec rewrites arbitrary files beneath it — not attributable to a file write'
    );
    return;
  }
  results.push({
    status: 'resolved',
    idiom,
    span: { operation: 'create-overwrite', absolutePath, simpleCommandIndex, join }
  });
}

/**
 * The git restore operand grammar (plan §5.9): `-s`/`--source=<tree>` is
 * value-taking — the tree operand never resolves as a pathspec; `-p`/`--patch`
 * interactive hunk selection is unresolved; `-m`/`--merge` (the merge
 * machinery, conditional on the index being unmerged) and `--staged` without
 * `--worktree` (index-only — the working file survives) touch nothing.
 */
function matchRestoreOperands(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let staged = false;
  let worktree = false;
  let afterDashDash = false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-p' || a === '--patch') {
      pushUnresolved(
        results,
        'git-restore-write',
        a,
        'interactive patch mode applies user-chosen hunks — no static span'
      );
      return;
    }
    if (a === '-s' || a === '--source') {
      i += 1; // the tree operand is never a pathspec
      continue;
    }
    if (a.startsWith('--source=')) continue;
    if (a === '-m' || a === '--merge') return;
    if (a === '--staged') {
      staged = true;
      continue;
    }
    if (a === '-W' || a === '--worktree') {
      worktree = true;
      continue;
    }
    if (RESTORE_NO_VALUE.has(a)) continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option (fail closed)
    operands.push(a);
  }
  if (staged && !worktree) return; // index-only restore does not touch the working file
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, 'git-restore-write', operand, dir, simpleCommandIndex, join);
  }
}

/**
 * The git checkout operand grammar (plan §5.9): `-b`/`-B`/`--orphan <branch>`
 * are value-taking — the branch name never resolves as a pathspec; `-p`/
 * `--patch` interactive hunk selection is unresolved; a pre-`--` positional is
 * a revision/ref operand and is skipped. Pathspecs only after `--`.
 */
function matchCheckoutOperands(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let afterDashDash = false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-p' || a === '--patch') {
      pushUnresolved(
        results,
        'git-checkout-write',
        a,
        'interactive patch mode applies user-chosen hunks — no static span'
      );
      return;
    }
    if (a === '-b' || a === '-B' || a === '--orphan') {
      i += 1; // the branch name is never a pathspec
      continue;
    }
    if (a === '-f' || a === '-q' || a === '-m' || a === '-t') continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option (fail closed)
    // A pre-`--` positional is a revision/ref operand — never a pathspec.
  }
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, 'git-checkout-write', operand, dir, simpleCommandIndex, join);
  }
}

/**
 * The git restore / git checkout family (plan §5.9): via `findGitSubcommand`
 * (handles `git -C`/`-c`), the two subcommands resolve their pathspecs to
 * whole-file create-overwrite touches; a wrapped subcommand fails closed.
 */
function matchGitRestoreCheckout(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || (sub.subcommand !== 'restore' && sub.subcommand !== 'checkout')) return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(
        results,
        sub.subcommand === 'restore' ? 'git-restore-write' : 'git-checkout-write',
        sub.subcommand,
        'git -C target contains an unresolved shell variable'
      );
      return;
    }
    const dir = sub.cDir ?? dirForResolution;
    const args = rest.slice(1).slice(sub.subIdx + 1);
    if (sub.subcommand === 'restore') matchRestoreOperands(args, dir, simpleCommandIndex, join, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'restore' || wrapped === 'checkout') {
      pushUnresolved(
        results,
        wrapped === 'restore' ? 'git-restore-write' : 'git-checkout-write',
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
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
  // The one-hop literal echo/printf pipe source (plan §5.2): set at the end of
  // each simple command, cleared at any non-pipe boundary, threaded by tee -a
  // appends in the next pipe stage (`echo x | tee -a f`).
  let pipeEchoContent: string | null = null;

  /** The `join` stamp for a simple command: only the conditional operators gate (plan §3 step 2). */
  const joinOf = (simple: SimpleCommand): ResolvedSpan['join'] =>
    simple.precededBy === '&&' || simple.precededBy === '||' ? simple.precededBy : undefined;

  const emitCandidate = (
    c: RawCandidate,
    dirForResolution: string,
    simpleCommandIndex: number,
    join: ResolvedSpan['join']
  ) => {
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
      span: {
        operation: 'read',
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        absolutePath,
        simpleCommandIndex,
        join
      }
    });
  };

  /**
   * The read idioms for one simple command (the existing corpus grammar):
   * plain `cat`/`nl` sources, the line selectors, and the git matchers, with
   * one-hop pipe-source propagation for downstream `head`/`tail`/`sed -n`.
   */
  const matchReads = (simple: SimpleCommand, argv: string[], i: number): void => {
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
          currentDir,
          i,
          joinOf(simple)
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
          emitCandidate(outcome, outcome.dirOverride ?? currentDir, i, joinOf(simple));
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
          if (outcome.kind === 'candidate') emitCandidate(outcome, currentDir, i, joinOf(simple));
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
  };

  for (let i = 0; i < simpleCommands.length; i++) {
    const simple = simpleCommands[i];

    // A pipe stage may inherit the previous stage's literal echo content; any
    // other boundary clears it.
    if (simple.precededBy !== '|') pipeEchoContent = null;

    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      const tokens = tokenize(stripLeadingAssignments(w.opener).trim());
      if (tokens === null) {
        lastPlainFileSource = null;
        continue;
      }
      const openerArgv = analyzeTokens(tokens).argv;
      matchReads(simple, openerArgv, i);
      classifyHeredocOpener(w.opener, w.body, currentDir, i, joinOf(simple), results);
      pipeEchoContent = literalContent(openerArgv) ?? null;
      continue;
    }

    const tokens = tokenize(stripLeadingAssignments(simple.text).trim());
    if (tokens === null) {
      lastPlainFileSource = null;
      continue;
    }
    const { argv, redirects } = analyzeTokens(tokens);
    if (argv.length === 0) {
      // Bare `> f` / `: > f`: no argv, but the truncation grammar still fires.
      matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
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

    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
    pipeEchoContent = literalContent(argv) ?? null;
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
