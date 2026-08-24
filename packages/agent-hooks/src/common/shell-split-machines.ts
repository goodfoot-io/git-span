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
