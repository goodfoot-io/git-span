/**
 * Shared walk state and low-level helpers for the shell splitter's state
 * machines ([splitTopLevel]'s dispatcher drives one step of a machine at a
 * time; each machine owns its slice of [SplitScan]).
 *
 * A machine's interface is deliberately narrow — position ([SplitScan.i]),
 * stage buffer ([SplitScan.buf]), and its own stack ([SplitScan.levels],
 * [SplitScan.caseRegion], [SplitScan.heredocs]) — so each machine is
 * testable in isolation from the dispatcher that schedules it.
 */

import type { MalformedVerdict, Operator, SimpleCommand } from './shell-split.js';

/** The construct kinds the kind-matched stack tracks (plan §3). */
export type ConstructKind = 'if' | 'loop' | 'for' | 'select' | 'brace';

/** One open construct: its kind, and whether a body word has been seen. */
export interface OpenConstruct {
  kind: ConstructKind;
  /**
   * Whether a body has started. For `if` the body starts at `then`/`else`/
   * `elif`, for loops at `do`, for brace groups at any command word — a
   * closer with no body (`if x; fi`, `{ }`) is a Bash parse error.
   */
  body: boolean;
}

/** The case region's position state (plan §3). */
export type CasePos = 'subject' | 'pattern-start' | 'pattern' | 'command';

/** An open case region: opaque content owned by the case scan. */
export interface CaseRegion {
  pos: CasePos;
  /** In a `command` position: whether the current list item is still empty (only `)`, `;`, `&`, and newlines reset it). */
  cmdEmpty: boolean;
  /** The region's own paren depth — global paren depth is frozen while the region is open (the region is not a stack; it outlives paren closes). */
  localDepth: number;
}

/** A pending heredoc whose body has not started yet (or whose body is being scanned). */
export interface PendingHeredoc {
  /** The line that closes the body: the delimiter, optionally `\t`-prefixed for `<<-`, with optional trailing whitespace. */
  close: RegExp;
}

/**
 * The mutable state threaded through every machine step: the input window
 * (`cmd`/`n`/`i`), the current stage buffer, the completed stages, the
 * list-scoped rejection bookkeeping, and one field group per machine.
 */
export interface SplitScan {
  /** The full Bash input. */
  cmd: string;
  /** `cmd.length` — cached because the machines compare against it constantly. */
  n: number;
  /** The scan cursor: the next unread character index. */
  i: number;
  /** The stage text accumulated since the last flush. */
  buf: string;
  /** Completed simple commands, in order. */
  parts: SimpleCommand[];
  /** The operator that will be recorded on the stage the next flush completes. */
  pendingOp: Operator;
  /**
   * Set when the current list is a Bash parse error; the scan stops at it
   * (plan §1, list-scope + terminal).
   */
  malformed?: MalformedVerdict;
  /** Index into `parts` where the current list began — the rejecting list's stages are dropped by rolling back to it. */
  listStart: number;

  // Quoting machine: open single/double quote spans (plan §3).
  inSquote: boolean;
  inDquote: boolean;

  // ${…} opacity: positive while inside a brace expansion (plan §1).
  braceDepth: number;

  // Nesting machine: paren depth, the kind-matched construct stacks (one per
  // paren level), and the keyword-adjacency flags (plan §3).
  depth: number;
  levels: OpenConstruct[][];
  /** Set by openers and body keywords, cleared by other words and `(` — an operator or closer directly after it is an empty-list parse error (`if true; then; fi`, `{ ; }`). */
  afterKeyword: boolean;
  /** `function` seen; the next word is the function name, and `{` right after it opens the definition body. */
  functionSeen: boolean;
  nameSeen: boolean;

  // Case machine: the open case region, if any (plan §3).
  caseRegion: CaseRegion | null;

  // Heredoc machine: pending delimiters, body mode, and the buffer flag
  // surfaced on the flushed stage (plan §3).
  heredocs: PendingHeredoc[];
  /** In the body of a pending heredoc — lines are scanned raw for the close line. */
  inBody: boolean;
  /** Whether the stage currently in the buffer feeds its stdin from a heredoc body (surfaced on the flushed SimpleCommand). */
  bufHeredoc: boolean;
}

/** Initialize the scan state for `cmd` at the very start of a top-level walk. */
export function createScan(cmd: string): SplitScan {
  return {
    cmd,
    n: cmd.length,
    i: 0,
    buf: '',
    parts: [],
    pendingOp: 'start',
    listStart: 0,
    inSquote: false,
    inDquote: false,
    braceDepth: 0,
    depth: 0,
    levels: [[]],
    afterKeyword: false,
    functionSeen: false,
    nameSeen: false,
    caseRegion: null,
    heredocs: [],
    inBody: false,
    bufHeredoc: false
  };
}

/** Word chars end at whitespace and the operator/paren/redirect metachars. */
export const WORD_END = /[\s;&|()<>]/;

/** The words that put the parser back at command start when they are the buffer's last word (plan §3). */
const COMMAND_OPENER_WORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'time', '{', '(']);

/**
 * Redirect operators that are missing their target word when they are the
 * buffer's last word (plan §1): a target must be a plain word, so every
 * non-self-complete form is a parse error. Dup forms with both fds present
 * (`2>&1`, `>&-`, `3<&0`) and fused words (`>out`, `2>err`, `<<EOF`,
 * `&>out`) are complete and never match.
 */
const DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;

/** Escape every regex metachar so a literal delimiter can match as a pattern. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The buffer's last whitespace-delimited word ('' when the buffer is empty). */
export function lastWord(buf: string): string {
  return buf.trimEnd().match(/\S+$/)?.[0] ?? '';
}

/** Whether a redirect token with no target word is the buffer's last word (plan §1). */
export function bufferEndsInDanglingRedirect(buf: string): boolean {
  return DANGLING_REDIRECT_WORD.test(lastWord(buf));
}

/** Whether the current char starts a new word in the buffer (empty buffer, or preceded by whitespace). */
export function wordStart(buf: string): boolean {
  return buf === '' || /\s$/.test(buf);
}

/**
 * Whether a new command can start here: the buffer is empty, a boundary
 * operator or `(`/`)` precedes, the buffer ends with a newline (a newline
 * inside an open construct is text but still ends the list item), or the
 * last word expects a command body (`then`, `do`, `{`, …).
 */
export function commandPosition(buf: string): boolean {
  return (
    buf.trim() === '' || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord(buf))
  );
}

/** Whether the buffer's last word is a function-name shape (`f()` / a bare `()` pair). */
export function fnNameShapeIsPending(buf: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord(buf)) || lastWord(buf) === '()';
}

/** Whether a redirect token begins at `s.i`: a `>`/`<` form, `&>`, or a digit-prefixed form like `2>`/`2>&1`. */
export function startsRedirectAt(s: SplitScan): boolean {
  const c = s.cmd[s.i];
  if (c === '>' || c === '<') return true;
  if (c === '&') return s.cmd[s.i + 1] === '>';
  if (c >= '0' && c <= '9') {
    let j = s.i;
    while (j < s.n && s.cmd[j] >= '0' && s.cmd[j] <= '9') j += 1;
    return s.cmd[j] === '>' || s.cmd[j] === '<';
  }
  return false;
}

/**
 * Whether a pipe/and/or operator is pending with a whitespace-only buffer
 * since it. A helper rather than an inline comparison: TypeScript's
 * control-flow narrowing cannot see the assignments `appendStage` makes to
 * `pendingOp` from outside, and would otherwise narrow the direct comparison
 * to the initializer `'start'`.
 */
export function unconsumedPipeOp(s: SplitScan): boolean {
  return (s.pendingOp === 'pipe' || s.pendingOp === 'and' || s.pendingOp === 'or') && s.buf.trim() === '';
}

/**
 * Complete the buffered stage under `nextOp` (dropping an empty buffer), or —
 * when the stage would be a pipe-preceded `!`, which bash rejects at parse
 * time (plan §1) — reject the list instead and leave the buffer untouched.
 */
export function appendStage(s: SplitScan, nextOp: Operator): void {
  const text = s.buf.trim();
  if (text) {
    // `!` in pipe position is a parse error (plan §1): the first word of a
    // pipe-preceded stage may not be `!` (`false | ! true`, `cat f |\n! true`).
    if (s.pendingOp === 'pipe' && (text === '!' || /^!\s/.test(text))) {
      rejectList(s, 'pipe-bang');
      return;
    }
    s.parts.push({ text, precededBy: s.pendingOp, ...(s.bufHeredoc ? { heredoc: true } : {}) });
  }
  s.buf = '';
  s.bufHeredoc = false;
  s.pendingOp = nextOp;
}

/**
 * Report a malformed list: record the verdict, drop the rejecting list's
 * stages (completed earlier lists stay), and stop the scan by exhausting the
 * cursor — bash aborts at the first parse error.
 */
export function rejectList(s: SplitScan, v: MalformedVerdict): void {
  s.malformed = v;
  s.parts.length = s.listStart;
  s.i = s.n;
}

/**
 * Quoting machine: consume the next character(s) while a quote span is open,
 * open a span at `'`/`"`, or copy a backslash escape as the verbatim pair.
 * Returns false when the character is unquoted text for the next machine —
 * single-quote content is literal until the closing `'`, double-quote
 * content honors `\"`-style escapes of `"`, `\`, `$`, and backtick, and an
 * escaped character never operates regardless of which machine follows.
 */
export function stepQuote(s: SplitScan): boolean {
  const c = s.cmd[s.i];
  if (s.inSquote) {
    s.buf += c;
    if (c === "'") s.inSquote = false;
    s.i += 1;
    return true;
  }
  if (s.inDquote) {
    s.buf += c;
    if (c === '\\' && s.i + 1 < s.n) {
      s.buf += s.cmd[s.i + 1];
      s.i += 2;
      return true;
    }
    if (c === '"') s.inDquote = false;
    s.i += 1;
    return true;
  }
  if (c === "'") {
    s.inSquote = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === '"') {
    s.inDquote = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === '\\' && s.i + 1 < s.n) {
    s.buf += c + s.cmd[s.i + 1];
    s.i += 2;
    return true;
  }
  return false;
}

/**
 * Brace-expansion opacity machine: while [SplitScan.braceDepth] is positive
 * the current character is `${…}` content — consumed opaquely, with a `}`
 * closing one nesting level. Nested expansions nest, so nothing inside counts
 * parens, splits operators, starts comments, or recognizes constructs —
 * `${x%)}`, `${x//(/}`, and `${x:-$(echo y)}` are all valid.
 */
export function stepBraceContent(s: SplitScan): boolean {
  if (s.braceDepth === 0) return false;
  const c = s.cmd[s.i];
  if (c === '}') s.braceDepth -= 1;
  s.buf += c;
  s.i += 1;
  return true;
}

/**
 * Heredoc body machine: while a heredoc body is open ([SplitScan.inBody]),
 * scan whole lines raw until the first pending heredoc's close line (a line
 * that is exactly the delimiter, optionally tab-prefixed for `<<-`, with
 * optional trailing whitespace). The body is opaque — it produces no stages —
 * and unterminated bodies end at EOF.
 */
export function stepHeredocBody(s: SplitScan): boolean {
  if (!s.inBody) return false;
  const lineEnd = s.cmd.indexOf('\n', s.i);
  const line = lineEnd === -1 ? s.cmd.slice(s.i) : s.cmd.slice(s.i, lineEnd);
  if (s.heredocs[0].close.test(line)) {
    s.heredocs.shift();
    if (s.heredocs.length === 0) s.inBody = false;
  }
  if (insideOpenRegion(s)) {
    // Inside an open construct the body line folds into the construct's
    // interior text (a newline inside an open construct is not a
    // boundary, plan §1) — the interior re-split re-scans it as body.
    s.buf += line;
    if (lineEnd !== -1) s.buf += '\n';
  }
  s.i = lineEnd === -1 ? s.n : lineEnd + 1;
  return true;
}

/**
 * The newline right after a heredoc's delimiter line ends the delimiter's
 * line — it splits normally (a completed list, but without advancing
 * [SplitScan.listStart]: a completeness violation that rejects later drops
 * the delimiter's-line stage too) — and starts the body. Inside an open
 * construct the newline is not a boundary: the delimiter's line, the body,
 * and the close line all fold into the construct's one stage, and the walk's
 * interior re-split applies the same heredoc machinery there.
 */
export function stepHeredocDelimiterNewline(s: SplitScan): boolean {
  if (s.cmd[s.i] !== '\n' || s.heredocs.length === 0) return false;
  if (insideOpenRegion(s)) {
    s.buf += '\n';
    s.inBody = true;
    s.i += 1;
    return true;
  }
  if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, 'dangling-operator');
    return true;
  }
  appendStage(s, 'newline');
  s.inBody = true;
  s.i += 1;
  return true;
}

/**
 * Here-string recognition: `<<<` (exactly three `<`s, not fd-prefixed) is a
 * two-token operator — `<<<` plus the word it feeds to stdin — NOT a heredoc.
 * The heredoc machine would otherwise fire at the SECOND `<` (its
 * `cmd[i+2] !== '<'` test passes on the following word), register that word
 * as a delimiter, and mark the whole command an unterminated heredoc — so
 * valid bash here-strings (`cat <<<hello`, `rg -n needle 1 2 <<< 'x'`) were
 * rejected and failed closed. The operator stays in the stage text (nothing
 * strips it), so the quote-aware hasUnquotedRedirect scan still applies the
 * stdin-redirect gate; consuming all three characters keeps the walk from
 * re-recognizing a heredoc at the second `<`. Longer `<` runs (`<<<<`) and
 * fd-prefixed forms (`2<<<`) are not here-strings to bash (syntax error /
 * fd-heredoc misinterpretation) and fall through to the heredoc misfire,
 * which keeps them malformed and fail-closed.
 */
export function stepHereString(s: SplitScan): boolean {
  if (s.depth !== 0) return false;
  const { i } = s;
  if (s.cmd[i] !== '<' || s.cmd[i + 1] !== '<' || s.cmd[i + 2] !== '<') return false;
  if (s.cmd[i + 3] === '<' || s.cmd[i - 1] === '<') return false;
  s.buf += '<<<';
  s.i += 3;
  return true;
}

/**
 * Heredoc recognition (plan §3): `<<`/`<<-` (not `<<<`) at depth 0 with a
 * delimiter word registers the pending close-line matcher and marks the
 * buffered stage as heredoc-fed. The operator+delimiter are stripped from
 * the stage text at top level — the stage keeps a plain argv (`cat f` stays
 * `cat f`) — but stay in the text inside an open construct, where the walk's
 * interior re-split re-recognizes the heredoc there (plan §3).
 */
export function stepHeredocOpen(s: SplitScan): boolean {
  if (s.depth !== 0) return false;
  const { i } = s;
  if (s.cmd[i] !== '<' || s.cmd[i + 1] !== '<' || s.cmd[i + 2] === '<') return false;
  const scanned = scanHeredocDelimiter(s);
  if (scanned.delim === '') return false;
  s.heredocs.push({
    close: new RegExp(`^${scanned.allowTabs ? '\t*' : ''}${escapeRegExp(scanned.delim)}[ \\t]*$`)
  });
  // The operator+delimiter leave the stage text below, so mark the stage:
  // its stdin comes from the heredoc body, and consumers that read `<` from
  // the text would otherwise never see the redirect.
  s.bufHeredoc = true;
  if (insideOpenRegion(s)) {
    // Inside an open construct the operator+delimiter stay in the stage text.
    s.buf += s.cmd.slice(i, scanned.next);
  }
  s.i = scanned.next;
  return true;
}

/** The delimiter parse of a heredoc operator at [SplitScan.i]: `-` tab flag, whitespace skip, then quoted or bare word. */
interface ScannedDelimiter {
  /** The delimiter word ('' when there is none — the operator dangles). */
  delim: string;
  /** Whether `<<-` was spelled with the dash (the close line may be tab-indented). */
  allowTabs: boolean;
  /** The index just past the consumed operator+delimiter spelling. */
  next: number;
}

/** Scan the delimiter word following `<<`/`<<-` from [SplitScan.i]. */
function scanHeredocDelimiter(s: SplitScan): ScannedDelimiter {
  let j = s.i + 2;
  let allowTabs = false;
  if (s.cmd[j] === '-') {
    allowTabs = true;
    j += 1;
  }
  while (s.cmd[j] === ' ' || s.cmd[j] === '\t') j += 1;
  if (s.cmd[j] === "'" || s.cmd[j] === '"') {
    const q = s.cmd.indexOf(s.cmd[j], j + 1);
    if (q === -1) return { delim: s.cmd.slice(j + 1), allowTabs, next: s.n };
    return { delim: s.cmd.slice(j + 1, q), allowTabs, next: q + 1 };
  }
  const delimStart = j;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  return { delim: s.cmd.slice(delimStart, j), allowTabs, next: j };
}

/** Whether the cursor sits inside an open construct frame or case region — regions where boundaries are text and content folds into one stage. */
function insideOpenRegion(s: SplitScan): boolean {
  return s.levels[s.levels.length - 1].length > 0 || s.caseRegion !== null;
}
