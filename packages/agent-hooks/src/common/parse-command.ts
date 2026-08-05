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
import { type SimpleCommand, splitTopLevel, stripLeadingAssignments, type Token, tokenize } from './shell-split.js';

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

/** The `git apply` shape: whether the command is `git ... apply`, plus its `-C` directory (null when none or unresolvable — the paths then resolve against the current directory). */
function gitApplyShape(argv: string[]): { isApply: boolean; dir: string | null } {
  if (argv[0] !== 'git') return { isApply: false, dir: null };
  const sub = findGitSubcommand(argv.slice(1));
  if (sub === null || sub.subcommand !== 'apply') return { isApply: false, dir: null };
  return { isApply: true, dir: sub.cDirUnresolvable ? null : sub.cDir };
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
  const applyShape = host === 'git' ? gitApplyShape(argv) : { isApply: false, dir: null };
  if (host === 'patch' || applyShape.isApply) {
    const targets = classifyPatchText(body);
    if (targets === null) return; // malformed or empty patch text → fail closed
    for (const t of targets) {
      const absolutePath = resolveTarget(results, 'heredoc-write', t.path, applyShape.dir ?? currentDir);
      if (absolutePath === null) continue;
      results.push({
        status: 'resolved',
        idiom: 'heredoc-write',
        span: {
          operation: t.operation,
          absolutePath,
          simpleCommandIndex,
          join,
          ...(t.lineStart !== undefined ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {})
        }
      });
    }
    return;
  }
  // Non-family host: the body is not attributable content — no write touch.
}

// ---------------------------------------------------------------------------
// Patch-text classification (plan §5.7), consumed by the heredoc grammar: a
// minimal, range-preserving unified-diff parse. Hunks of a file whose pre/post
// line counts match union into an exact range; any count-changing hunk, or any
// structural uncertainty, degrades to a whole-file modify. Malformed or empty
// patch text classifies null (fail closed).
// ---------------------------------------------------------------------------

interface PatchTarget {
  path: string;
  operation: 'modify' | 'create-overwrite' | 'delete' | 'rename-copy';
  lineStart?: number;
  lineEnd?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripGitPrefix(p: string): string {
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

function classifyPatchText(patchText: string): PatchTarget[] | null {
  const results: PatchTarget[] = [];
  let sawBlock = false;
  let current: {
    path: string;
    kind: 'modify' | 'new' | 'deleted';
    hunks: Array<{ start: number; end: number }>;
    countChanging: boolean;
  } | null = null;
  let pendingKind: 'new' | 'deleted' | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let binary = false;

  const finish = (): void => {
    if (current !== null) {
      if (current.kind === 'new') results.push({ path: current.path, operation: 'create-overwrite' });
      else if (current.kind === 'deleted') results.push({ path: current.path, operation: 'delete' });
      else if (binary) results.push({ path: current.path, operation: 'modify' });
      else if (current.hunks.length === 0) {
        // A header-only block with no hunks: nothing statically known.
      } else if (current.countChanging) results.push({ path: current.path, operation: 'modify' });
      else {
        const start = Math.min(...current.hunks.map((h) => h.start));
        const end = Math.max(...current.hunks.map((h) => h.end));
        results.push({ path: current.path, operation: 'modify', lineStart: start, lineEnd: end });
      }
      current = null;
    }
    if (renameFrom !== null) results.push({ path: renameFrom, operation: 'delete' });
    if (renameTo !== null) results.push({ path: renameTo, operation: 'rename-copy' });
    renameFrom = null;
    renameTo = null;
    binary = false;
  };

  for (const line of patchText.split('\n')) {
    if (line.startsWith('--- ')) {
      sawBlock = true;
      if (current !== null) finish();
      current = {
        path: stripGitPrefix(line.slice(4)),
        kind: pendingKind ?? 'modify',
        hunks: [],
        countChanging: false
      };
      pendingKind = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      sawBlock = true;
      const path = stripGitPrefix(line.slice(4));
      if (current === null) current = { path, kind: pendingKind ?? 'modify', hunks: [], countChanging: false };
      else if (path === '/dev/null') current.kind = 'deleted';
      else current.path = path;
      pendingKind = null;
      continue;
    }
    if (line.startsWith('new file mode')) {
      pendingKind = 'new';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      pendingKind = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      sawBlock = true;
      if (current !== null) finish();
      renameFrom = stripGitPrefix(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      sawBlock = true;
      renameTo = stripGitPrefix(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      sawBlock = true;
      binary = true;
      continue;
    }
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      sawBlock = true;
      const preStart = Number.parseInt(hunk[1], 10);
      const preCount = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
      const postCount = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
      if (current === null) return null; // a hunk without a file header → malformed
      if (preCount !== postCount) current.countChanging = true;
      if (preCount > 0) current.hunks.push({ start: preStart, end: preStart + preCount - 1 });
    }
  }
  finish();
  return sawBlock ? results : null;
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
