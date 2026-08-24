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

import type { MalformedVerdict, Operator, SimpleCommand, SplitResult } from './shell-split.js';

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

/**
 * Case-region machine: while a `case` region is open, own everything at its
 * local depth 0 — pattern-list terminators (`;;`/`;&`/`;;&`), list-item
 * separators (`;`, bare `&`, newlines), comments, and words (`esac` closing,
 * `in` ending the subject) — while pattern syntax stays out of the paren and
 * boundary machinery (the global paren depth freezes while the region is
 * open). Returns false when no region is open, the region's local depth is
 * positive (`(`/`)` fall through to the nesting machine), or the character
 * is none of the above — those reach the generic buffer through the
 * dispatcher. A newline inside a `pattern` position is a Bash parse error
 * ('unclosed-case'); a region still open at EOF is rejected by [finishScan].
 */
export function stepCaseRegion(s: SplitScan): boolean {
  const r = s.caseRegion;
  if (r?.localDepth !== 0) return false;
  if (stepCasePunct(s, r)) return true;
  return stepCaseWord(s, r);
}

/** Pattern-list terminators and item separators at local depth 0: `;;`-family back to pattern-start; `;`, bare `&`, and newlines to command start. */
function stepCasePunct(s: SplitScan, r: CaseRegion): boolean {
  const c = s.cmd[s.i];
  const termLen = caseTerminatorLength(s);
  if (termLen > 0) {
    r.pos = 'pattern-start';
    s.buf += s.cmd.slice(s.i, s.i + termLen);
    s.i += termLen;
    return true;
  }
  // `;` returns to command start (a `;;` was handled above).
  if (c === ';') {
    r.pos = 'command';
    r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  // A single `&` (not part of a redirect or `&&`) is the background
  // operator — also command start.
  if (caseBareAmpersand(s)) {
    r.pos = 'command';
    r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === '\n') {
    // A pattern cannot continue across a newline (bash errors), but a
    // newline after `in` or inside a list item is fine.
    if (r.pos === 'pattern') {
      rejectList(s, 'unclosed-case');
      return true;
    }
    if (r.pos === 'command') r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === '#' && wordStart(s.buf)) {
    // A comment inside the region runs to the newline like outside.
    while (s.i < s.n && s.cmd[s.i] !== '\n') s.i += 1;
    return true;
  }
  return false;
}

/** Length of the `;;`-family pattern-list terminator at [SplitScan.i] (`;;&` → 3, `;;`/`;&` → 2), or 0 when none matches. */
function caseTerminatorLength(s: SplitScan): number {
  const three = s.cmd.slice(s.i, s.i + 3);
  if (three === ';;&') return 3;
  const two = s.cmd.slice(s.i, s.i + 2);
  return two === ';;' || two === ';&' ? 2 : 0;
}

/** Whether the `&` at [SplitScan.i] stands alone — not part of a redirect or `&&`. */
function caseBareAmpersand(s: SplitScan): boolean {
  if (s.cmd[s.i] !== '&') return false;
  return s.cmd[s.i + 1] !== '>' && s.cmd[s.i + 1] !== '&' && !bufferEndsInRedirectChar(s.buf);
}

/**
 * Words at local depth 0: `esac` closes the region at a pattern-list start or
 * at the start of a list item (elsewhere it is an ordinary word — `echo esac`,
 * `a|esac)` — as is `case` in the subject); `in` ends the subject; any other
 * word after `in` starts a `pattern`, and any word in command position makes
 * the current list item non-empty.
 */
function stepCaseWord(s: SplitScan, r: CaseRegion): boolean {
  const c = s.cmd[s.i];
  if (!wordStart(s.buf) || WORD_END.test(c)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  const w = s.cmd.slice(s.i, j);
  if (w === 'esac' && (r.pos === 'pattern-start' || (r.pos === 'command' && r.cmdEmpty))) {
    s.caseRegion = null;
    s.afterKeyword = false;
  } else if (w === 'in' && r.pos === 'subject') {
    r.pos = 'pattern-start';
  } else if (r.pos === 'pattern-start') {
    r.pos = 'pattern';
  } else if (r.pos === 'command') {
    r.cmdEmpty = false;
  }
  s.buf += w;
  s.i = j;
  return true;
}

/** Whether the buffer's last char is a `>`/`<` redirect char (making a following `&` part of a dup token like `2>&1`). */
function bufferEndsInRedirectChar(buf: string): boolean {
  const last = buf[buf.length - 1];
  return last === '>' || last === '<';
}

/**
 * Nesting machine, parens half: `(` bumps the global depth and pushes a fresh
 * (empty) construct level — or, inside an open case region, the region's own
 * local depth instead, keeping the global depth frozen. A stray `)` at depth
 * 0 is 'unbalanced-paren'; a `)` closing a subshell whose construct stack is
 * non-empty fires 'unclosed-construct' before the pop (fire-before-restore —
 * an unclosed construct cannot outlive the subshell that closed).
 */
export function stepParen(s: SplitScan): boolean {
  const c = s.cmd[s.i];
  if (c !== '(' && c !== ')') return false;
  if (c === '(') {
    if (s.caseRegion) {
      s.caseRegion.localDepth += 1;
    } else {
      // A subshell starts a command — `if true; then ( echo hi ); fi` is
      // valid while `if true; then; fi` is not; the same subshell counts as
      // a body word for an enclosing brace group (`{ ( echo hi ); }`).
      markEnclosingBraceBody(s);
      s.depth += 1;
      s.levels.push([]);
    }
    s.afterKeyword = false;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (s.caseRegion) {
    // At local depth 0 a `)` is the pattern terminator (or the end of a
    // list item) — the region owns it and the global depth stays frozen.
    if (s.caseRegion.localDepth === 0) {
      s.caseRegion.pos = 'command';
      s.caseRegion.cmdEmpty = true;
    } else {
      s.caseRegion.localDepth -= 1;
    }
  } else {
    // A stray `)` at depth 0 (and brace depth 0, outside quotes) is a parse
    // error — `echo x) && …` (plan §1). `)` inside quotes, `${…}`, and
    // heredoc bodies never reaches this machine.
    if (s.depth === 0) {
      rejectList(s, 'unbalanced-paren');
      return true;
    }
    if (s.levels[s.levels.length - 1].length > 0) {
      rejectList(s, 'unclosed-construct');
      return true;
    }
    s.depth -= 1;
    s.levels.pop();
  }
  s.buf += c;
  s.i += 1;
  return true;
}

/**
 * Nesting machine, keywords half: recognize construct keywords and the
 * case-region opener at word starts at any paren depth (constructs track
 * through subshells), outside quotes, `${…}`, heredoc bodies, and open case
 * regions (the case machine owns those words). Word-end chars (`;`, `&`,
 * `|`, `<`, `>`) never begin a word here. The consumed word always joins the
 * stage text; what changes is the frame stacks around it.
 */
export function stepConstructWord(s: SplitScan): boolean {
  if (!startsConstructWord(s)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  const w = s.cmd.slice(s.i, j);
  const top = topFrame(s.levels);
  const atCommand = commandPosition(s.buf);
  if (forSelectSeparator(w, top)) {
    // The for/select word-list separator — recognized wherever it appears
    // while a for/select is open (`for i in a b`, `select x in a`).
  } else if (opensBraceGroup(s, w, atCommand)) {
    openBraceGroup(s);
  } else if (w === '}' && atCommand) {
    closeBraceGroup(s);
  } else if (atCommand) {
    if (!applyCommandKeyword(s, w)) ordinaryConstructWord(s);
  } else {
    // An argument-position word: nothing opens, the empty-body flag
    // clears, and the function-name handoff advances.
    ordinaryArgumentWord(s);
  }
  s.buf += w;
  s.i = j;
  return true;
}

/** Whether `in` appears while a for/select frame is open — the word-list separator, valid in any position. */
function forSelectSeparator(w: string, top: OpenConstruct | undefined): boolean {
  return w === 'in' && top !== undefined && (top.kind === 'for' || top.kind === 'select');
}

/** Whether `{` opens a brace group here: command position, right after a function name (`f() {`, `f(){`), or closing a pending `function f` handoff. `{cat` is a word. */
function opensBraceGroup(s: SplitScan, w: string, atCommand: boolean): boolean {
  return w === '{' && (atCommand || fnNameShapeIsPending(s.buf) || (s.functionSeen && s.nameSeen));
}

/** Whether a construct/case-opener word begins at [SplitScan.i]. */
function startsConstructWord(s: SplitScan): boolean {
  if (s.caseRegion) return false;
  const c = s.cmd[s.i];
  if (WORD_END.test(c)) return false;
  if (!wordStart(s.buf) && !/[()]$/.test(s.buf)) return false;
  // `${` is expansion syntax, not a construct word.
  return !(c === '$' && s.cmd[s.i + 1] === '{');
}

/** Push one construct frame, crediting any enclosing brace group's body and arming the empty-list guard. */
function pushConstruct(s: SplitScan, kind: ConstructKind): void {
  markEnclosingBraceBody(s);
  s.levels[s.levels.length - 1].push({ kind, body: false });
  s.afterKeyword = true;
}

/** Validate the top frame against `kinds` (+ optional started body), rejecting the list as 'unclosed-construct' when it does not match. */
function requireTopOf(s: SplitScan, kinds: readonly ConstructKind[], requireBody: boolean): OpenConstruct | null {
  const t = topFrame(s.levels);
  if (t === undefined || !kinds.includes(t.kind) || (requireBody && !t.body)) {
    rejectList(s, 'unclosed-construct');
    return null;
  }
  return t;
}

/** Pop a validated closer frame and disarm the empty-list guard. */
function closeConstruct(s: SplitScan, kinds: readonly ConstructKind[]): void {
  if (requireTopOf(s, kinds, true) === null) return;
  s.levels[s.levels.length - 1].pop();
  s.afterKeyword = false;
}

/** `{` opens a brace group: the function-name handoff (if pending) completes here. */
function openBraceGroup(s: SplitScan): void {
  if (s.functionSeen && s.nameSeen) {
    s.functionSeen = false;
    s.nameSeen = false;
  }
  pushConstruct(s, 'brace');
}

/** `}` closes a brace group that has a body; an opener directly before it (or no brace at all) is 'unclosed-construct'. */
function closeBraceGroup(s: SplitScan): void {
  const t = topFrame(s.levels);
  if (s.afterKeyword || t === undefined || t.kind !== 'brace' || !t.body) {
    rejectList(s, 'unclosed-construct');
    return;
  }
  s.levels[s.levels.length - 1].pop();
  s.afterKeyword = false;
}

/** else/elif require an if-frame with a body already — an empty if-list is an error; neither starts a body itself. */
function requireIfBranch(s: SplitScan): void {
  if (requireTopOf(s, ['if'], true) !== null) s.afterKeyword = true;
}

/** The command-position construct keywords, one tiny transition each. (A Map rather than a literal: bash's `then` keyword must not become a thenable.) */
const CONSTRUCT_KEYWORDS = new Map<string, (s: SplitScan) => void>([
  [
    'case',
    (s) => {
      s.caseRegion = { pos: 'subject', cmdEmpty: false, localDepth: 0 };
      s.afterKeyword = false;
    }
  ],
  [
    'function',
    (s) => {
      s.functionSeen = true;
      s.nameSeen = false;
      s.afterKeyword = false;
    }
  ],
  ['if', (s) => pushConstruct(s, 'if')],
  ['while', (s) => pushConstruct(s, 'loop')],
  ['until', (s) => pushConstruct(s, 'loop')],
  ['for', (s) => pushConstruct(s, 'for')],
  ['select', (s) => pushConstruct(s, 'select')],
  [
    'do',
    (s) => {
      const t = requireTopOf(s, ['for', 'loop', 'select'], false);
      if (t !== null) {
        t.body = true;
        s.afterKeyword = true;
      }
    }
  ],
  [
    'then',
    (s) => {
      const t = requireTopOf(s, ['if'], false);
      if (t !== null) {
        t.body = true;
        s.afterKeyword = true;
      }
    }
  ],
  ['else', (s) => requireIfBranch(s)],
  ['elif', (s) => requireIfBranch(s)],
  // `in` only validates the for/select frame — it arms nothing and starts no body.
  ['in', (s) => void requireTopOf(s, ['for', 'select'], false)],
  ['fi', (s) => closeConstruct(s, ['if'])],
  ['done', (s) => closeConstruct(s, ['for', 'loop', 'select'])],
  // No open region — a stray esac is a parse error.
  ['esac', (s) => rejectList(s, 'unclosed-construct')]
]);

/** Apply the command-position keyword `w`; false when it is an ordinary word. */
function applyCommandKeyword(s: SplitScan, w: string): boolean {
  const kw = CONSTRUCT_KEYWORDS.get(w);
  if (kw === undefined) return false;
  kw(s);
  return true;
}

/** The top construct frame on the current paren level, or undefined when the level is bare. */
function topFrame(levels: OpenConstruct[][]): OpenConstruct | undefined {
  const lv = levels[levels.length - 1];
  return lv.length > 0 ? lv[lv.length - 1] : undefined;
}

/** Credit an enclosing brace group's body — any command word (including a subshell) counts. */
function markEnclosingBraceBody(s: SplitScan): void {
  const t = topFrame(s.levels);
  if (t?.kind === 'brace') t.body = true;
}

/** An ordinary word at command position: nothing opens, the empty-body flag clears, and the function-name handoff advances. */
function ordinaryConstructWord(s: SplitScan): void {
  s.afterKeyword = false;
  markEnclosingBraceBody(s);
  advanceFunctionNameHandoff(s);
}

/** An argument-position word: identical bookkeeping to [ordinaryConstructWord] minus the brace-body mark. */
function ordinaryArgumentWord(s: SplitScan): void {
  s.afterKeyword = false;
  advanceFunctionNameHandoff(s);
}

/** `function f …`: the first following word is the name, the one after it closes the handoff. */
function advanceFunctionNameHandoff(s: SplitScan): void {
  if (!s.functionSeen) return;
  if (s.nameSeen) {
    s.functionSeen = false;
    s.nameSeen = false;
  } else {
    s.nameSeen = true;
  }
}

/**
 * A `;`/`&` directly after an opener or body keyword is an empty-list parse
 * error at any depth (`if true; then; fi`, `{ ; }`, `for i in a b; do; done`,
 * `( if true; then; fi )`). Returns whether the list was rejected.
 */
export function rejectEmptyConstructList(s: SplitScan): boolean {
  const c = s.cmd[s.i];
  if (s.caseRegion === null && s.levels[s.levels.length - 1].length > 0 && (c === ';' || c === '&') && s.afterKeyword) {
    rejectList(s, 'unclosed-construct');
    return true;
  }
  return false;
}

/**
 * `#` begins a comment when it starts a word at depth 0 (empty buffer or
 * preceded by whitespace); comments run to the newline, keeping the buffer
 * empty for the continuation rule. Mid-word and quoted `#` are text, and
 * comments inside parens are opaque like everything else there — the depth
 * guard covers them (plan §1).
 */
export function skipTopLevelComment(s: SplitScan): boolean {
  if (s.cmd[s.i] !== '#' || s.depth !== 0 || !wordStart(s.buf)) return false;
  while (s.i < s.n && s.cmd[s.i] !== '\n') s.i += 1;
  return true;
}

/**
 * Redirect-token machine at top level: reject a dangling operator followed by
 * another redirect token mid-stage, open `${…}` opacity, recognize
 * here-strings, then heredocs. Everything here is depth-gated — redirects
 * inside parens are opaque like all other syntax there.
 */
export function stepRedirectToken(s: SplitScan): boolean {
  if (s.depth !== 0) return false;
  const c = s.cmd[s.i];
  // A redirect token with no target word, immediately followed by another
  // redirect token mid-stage, is a parse error: `cat f > > out`,
  // `cat f > 2>&1`, `cat f > &>out`, `cat f > <<< x` (plan §1).
  if (wordStart(s.buf) && bufferEndsInDanglingRedirect(s.buf) && startsRedirectAt(s)) {
    rejectList(s, 'dangling-operator');
    return true;
  }
  if (c === '$' && s.cmd[s.i + 1] === '{') {
    s.braceDepth += 1;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (stepHereString(s)) return true;
  return stepHeredocOpen(s);
}

/**
 * Boundary-operator machine — the list splitter itself. At depth 0 with no
 * construct frame and no case region open, `&&`/`||`/`|&`/`;`/`|`/newline/`&`
 * flush the buffered stage under the matching operator; anywhere else they are
 * plain text for the generic buffer. A newline after an unconsumed pipe/and/or
 * is a line continuation instead of a separator, and completing a list via
 * newline advances [SplitScan.listStart].
 */
export function stepBoundaryOperator(s: SplitScan): boolean {
  if (s.depth !== 0) return false;
  if (s.caseRegion !== null) return false;
  if (s.levels[s.levels.length - 1].length > 0) return false;
  const c = s.cmd[s.i];
  // `&&`/`||`/`|&` — the two-character operators, each flushing under its
  // normalized name.
  const twoOp = TWO_CHAR_BOUNDARY_OPS.get(s.cmd.slice(s.i, s.i + 2));
  if (twoOp !== undefined) {
    flushBoundaryOrReject(s, twoOp);
    s.i += 2;
    return true;
  }
  if (c === ';') {
    flushBoundaryOrReject(s, 'semicolon');
    s.i += 1;
    return true;
  }
  if (c === '|') {
    flushBoundaryOrReject(s, 'pipe');
    s.i += 1;
    return true;
  }
  if (c === '\n') return stepNewlineBoundary(s);
  if (c === '&') {
    // A bare `&` is a background operator only when it is not part of a
    // redirect token (`&>`, `2>&1`, `>& file`) — splitting inside those
    // tokens would produce junk stages.
    if (ampersandIsRedirectText(s)) {
      s.buf += c;
      s.i += 1;
      return true;
    }
    flushBoundaryOrReject(s, 'background');
    s.i += 1;
    return true;
  }
  return false;
}

/** The two-character boundary operators and the operator names they flush under. */
const TWO_CHAR_BOUNDARY_OPS = new Map<string, Operator>([
  ['&&', 'and'],
  ['||', 'or'],
  ['|&', 'pipe']
]);

/** The newline boundary: a line continuation when a pipe/and/or operator is pending with a whitespace-only buffer since it (`cat a.txt |\nsed ...`, `false &&\nsed ...`) — `cat f | head -1\ncat g` is therefore two lists, and a redirect target never continues onto a later line (plan §1). Completing the list advances [SplitScan.listStart]. */
function stepNewlineBoundary(s: SplitScan): boolean {
  if (unconsumedPipeOp(s)) {
    s.i += 1;
    return true;
  }
  if (bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, 'dangling-operator');
    return true;
  }
  appendStage(s, 'newline');
  s.listStart = s.parts.length;
  s.i += 1;
  return true;
}

/** Flush the buffered stage under `nextOp`, unless the buffer leaves the operator unconsumed or a redirect target dangling — both Bash parse errors ('dangling-operator'). */
function flushBoundaryOrReject(s: SplitScan, nextOp: Operator): void {
  if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, 'dangling-operator');
    return;
  }
  appendStage(s, nextOp);
}

/** Whether the `&` at [SplitScan.i] is redirect text rather than the background operator. A `>` counts as a dup-redirect prefix only at a token boundary (start, or after whitespace/digits) — `a>b&c` still backgrounds the `a>b` redirect. */
function ampersandIsRedirectText(s: SplitScan): boolean {
  if (s.cmd[s.i + 1] === '>') return true; // `&>` / `&>>`
  if (s.buf[s.buf.length - 1] === '<') return true; // `3<&0`
  const trimmed = s.buf.trimEnd();
  if (!trimmed.endsWith('>')) return false;
  const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : '';
  return trimmed.length === 1 || /\s|\d/.test(before);
}

/**
 * End-of-input verdicts, in bash's own order: an unclosed quote, brace, case
 * region, paren level, or construct; then the unconsumed-operator checks;
 * then the unterminated-heredoc partial (bash warns, runs the delimiter's
 * line, and treats the tail as body — the delimiter's-line stage(s) analyze
 * as-is and the body produces no stages, plan §3); finally the closing flush.
 * A verdict set mid-scan already dropped the rejecting list and ended the
 * loop, so `parts` is exactly the completed earlier lists here.
 */
export function finishScan(s: SplitScan): SplitResult {
  if (s.malformed) return { stages: s.parts, malformed: s.malformed };
  if (s.inSquote || s.inDquote) {
    rejectList(s, 'unclosed-quote');
  } else if (s.braceDepth > 0) {
    rejectList(s, 'unclosed-brace');
  } else if (s.caseRegion !== null) {
    rejectList(s, 'unclosed-case');
  } else if (s.depth > 0) {
    rejectList(s, 'unbalanced-paren');
  } else if (s.levels[s.levels.length - 1].length > 0) {
    rejectList(s, 'unclosed-construct');
  } else if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, 'dangling-operator');
  } else if (s.inBody || s.heredocs.length > 0) {
    appendStage(s, 'newline');
    s.malformed = 'unterminated-heredoc';
  } else {
    appendStage(s, 'newline');
  }
  return { stages: s.parts, malformed: s.malformed };
}
