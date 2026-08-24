/**
 * Heuristic, dependency-free shell splitting. Not a full shell parser — good
 * enough to locate simple commands (and their argv) inside a larger
 * &&/||/;/|-joined Bash string without pulling in a real bash AST parser.
 * Validated during research against bashlex on the real transcript corpus;
 * this ports the same algorithm.
 *
 * The word-level tokenizer ([tokenize]) is quote- and redirect-aware (plan
 * §5.10): redirect operators are split as distinct tokens with attached-target
 * forms preserved (`>f`), quoted tokens are words and never operators, and
 * [argvOf] derives operands from the token stream minus redirect tokens and
 * their targets.
 */

import {
  appendStage,
  bufferEndsInDanglingRedirect,
  createScan,
  rejectEmptyConstructList,
  rejectList,
  startsRedirectAt,
  stepBraceContent,
  stepCaseRegion,
  stepConstructWord,
  stepHeredocBody,
  stepHeredocDelimiterNewline,
  stepHeredocOpen,
  stepHereString,
  stepParen,
  stepQuote,
  unconsumedPipeOp,
  wordStart
} from './shell-split-machines.js';

/**
 * The normalized boundary operators `splitTopLevel` emits — the single
 * representation both adapters consume.
 */
export type Operator = 'pipe' | 'and' | 'or' | 'semicolon' | 'newline' | 'background' | 'start';

/** One `simple command` found in a larger script, plus which operator preceded it. */
export interface SimpleCommand {
  text: string;
  /**
   * The operator immediately before this command: 'pipe' for a pipeline
   * stage, 'and' for `&&` / 'or' for `||` (the only operators that gate, plan
   * §3 step 2), 'semicolon' for `;`, 'newline' for a newline separator,
   * 'background' for `&`, or 'start' for the first command.
   */
  precededBy: Operator;
  /**
   * Whether this stage's stdin is fed by a `<<`/`<<-` heredoc body. The
   * operator+delimiter are stripped from `text` (the stage keeps a plain
   * argv), so a consumer that scans for an unquoted `<` as a stdin redirect
   * cannot see the heredoc in the text — this flag surfaces it.
   */
  heredoc?: boolean;
}

/** The verdict kinds `splitTopLevel` can return when the input is a Bash parse error (plan §1). */
export type MalformedVerdict =
  | 'unclosed-quote'
  | 'unbalanced-paren'
  | 'dangling-operator'
  | 'pipe-bang'
  | 'unterminated-heredoc'
  | 'unclosed-brace'
  | 'unclosed-case'
  | 'unclosed-construct';

/** The result of a top-level split: the stage list, plus a `malformed` verdict when the input is a Bash parse error. */
export interface SplitResult {
  stages: SimpleCommand[];
  /**
   * Set when the input is a Bash parse error — bash rejects the entire list at
   * parse time (exit 2, nothing executed), so any stage-derived touch would be
   * a phantom. The rejection is list-scoped and terminal (plan §1): the stage
   * list keeps every stage from completed earlier lists, drops the rejecting
   * list's own stages, and stops at it — every later unit is dead.
   */
  malformed?: MalformedVerdict;
}

/**
 * Split a command string into simple-command substrings at top-level &&, ||,
 * ;, |, |&, &, and newline boundaries. Quotes and $()/``/() nesting are
 * respected (not split inside); `#` comments and `${…}` brace content are
 * opaque, pipe/and/or newlines are line continuations, and Bash parse errors
 * (plan §1) come back as a `malformed` verdict with the stage list truncated
 * at the rejecting list.
 *
 * Phase 2 (plan §3) adds three machines:
 *
 * - The kind-matched construct stack: `if`/`while`/`until`/`for`/`select`/
 *   `{`/`}`/`function` open construct frames at command position, context
 *   keywords (`do`, `then`, `else`, `elif`, `in`) and closers (`fi`, `done`,
 *   `esac`, `}`) require a matching opener on top of the stack (with the
 *   right body state), and while a construct is open at depth 0 the boundary
 *   operators are text — the construct folds to one stage. Each `(` pushes a
 *   fresh stack and each `)` fires 'unclosed-construct' when its level is
 *   non-empty (fire-before-restore).
 *
 * - The case-region machine: `case` in command position opens a region closed
 *   by a matching `esac`. The region's content is opaque — pattern `)`s and
 *   `|`s are pattern syntax, not parens/pipes — with its own paren depth
 *   (the global depth freezes while open), `;;`/`;&`/`;;&` returning to
 *   pattern-start and `)`, `;`, `&`, and newlines to command start. A region
 *   open at EOF is 'unclosed-case'.
 *
 * - The heredoc machinery: `<<`/`<<-` at depth 0 with a delimiter word strips
 *   the operator+delimiter from the stage text (the stage keeps a plain argv)
 *   and scans body lines raw until the delimiter line; an unterminated
 *   heredoc is the 'unterminated-heredoc' partial — the delimiter's line (and
 *   everything before it) analyzes normally and the body produces no stages.
 *   The stripped stage carries the `heredoc` flag so consumers can see that
 *   its stdin is the body, not a pipe or a file.
 */
export function splitTopLevel(cmd: string): SplitResult {
  const s = createScan(cmd);
  const { cmd: input, n } = s;
  while (s.i < n) {
    const c = input[s.i];
    const { buf } = s;
    if (stepQuote(s)) continue;
    // `${…}` content is opaque (plan §1): nested expansions nest, and while
    // the brace depth is positive nothing inside counts parens, splits
    // operators, starts comments, or recognizes constructs — `${x%)}`,
    // `${x//(/}`, and `${x:-$(echo y)}` are all valid.
    if (stepBraceContent(s)) continue;
    if (stepHeredocBody(s)) continue;
    if (stepHeredocDelimiterNewline(s)) continue;
    // `#` begins a comment when it starts a word at depth 0 (empty buffer or
    // preceded by whitespace); comments run to the newline, keeping the buffer
    // empty for the continuation rule. Mid-word and quoted `#` are text, and
    // comments inside parens are opaque like everything else there (plan §1).
    if (c === '#' && s.depth === 0 && wordStart(buf)) {
      while (s.i < n && input[s.i] !== '\n') s.i += 1;
      continue;
    }
    if (stepCaseRegion(s)) continue;
    if (stepParen(s)) continue;
    if (stepConstructWord(s)) continue;
    if (rejectEmptyConstructList(s)) continue;
    if (s.depth === 0) {
      // A redirect token with no target word, immediately followed by another
      // redirect token mid-stage, is a parse error: `cat f > > out`,
      // `cat f > 2>&1`, `cat f > &>out`, `cat f > <<< x` (plan §1).
      if (wordStart(buf) && bufferEndsInDanglingRedirect(buf) && startsRedirectAt(s)) {
        rejectList(s, 'dangling-operator');
        break;
      }
      if (c === '$' && input[s.i + 1] === '{') {
        s.braceDepth += 1;
        s.buf += c;
        s.i += 1;
        continue;
      }
      if (stepHereString(s)) continue;
      if (stepHeredocOpen(s)) continue;
      // While a construct is open at depth 0 the boundary operators are text —
      // the construct is one stage.
      if (s.caseRegion === null && s.levels[s.levels.length - 1].length === 0) {
        if (input.slice(s.i, s.i + 2) === '&&') {
          if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'and');
          s.i += 2;
          continue;
        }
        if (input.slice(s.i, s.i + 2) === '||') {
          if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'or');
          s.i += 2;
          continue;
        }
        if (input.slice(s.i, s.i + 2) === '|&') {
          if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'pipe');
          s.i += 2;
          continue;
        }
        if (c === ';') {
          if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'semicolon');
          s.i += 1;
          continue;
        }
        if (c === '|') {
          if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'pipe');
          s.i += 1;
          continue;
        }
        if (c === '\n') {
          // A newline is a line continuation — not a statement separator — when
          // a pipe/and/or operator is pending with a whitespace-only buffer
          // since it (`cat a.txt |\nsed ...`, `false &&\nsed ...`). `cat f | head -1\ncat g`
          // is therefore two lists, and a redirect target never continues onto
          // a later line (plan §1).
          if (unconsumedPipeOp(s)) {
            s.i += 1;
            continue;
          }
          if (bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'newline');
          s.listStart = s.parts.length;
          s.i += 1;
          continue;
        }
        if (c === '&') {
          // A bare `&` is a background operator only when it is not part of a
          // redirect token: the next character is `>` (`&>`/`&>>`), or the
          // buffer's last character is `>` or `<` (`2>&1`, `>& file`, `3<&0`).
          // Splitting inside those tokens would produce junk stages. A `>`
          // counts as a dup-redirect prefix only at a token boundary (start,
          // or after whitespace/digits) — `a>b&c` still backgrounds the
          // `a>b` redirect.
          const next = input[s.i + 1];
          const last = buf[buf.length - 1];
          const trimmed = buf.trimEnd();
          let dupRedirect = false;
          if (trimmed.endsWith('>')) {
            const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : '';
            dupRedirect = trimmed.length === 1 || /\s|\d/.test(before);
          }
          if (next === '>' || dupRedirect || last === '<') {
            s.buf += c;
            s.i += 1;
            continue;
          }
          if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(buf)) {
            rejectList(s, 'dangling-operator');
            break;
          }
          appendStage(s, 'background');
          s.i += 1;
          continue;
        }
      }
    }
    s.buf += c;
    s.i += 1;
  }

  // End of input: the EOF-state verdicts — an unclosed quote, brace, case
  // region, paren level, or construct — then the unconsumed-operator checks,
  // then the unterminated-heredoc partial, then the final flush. A verdict
  // set mid-scan already dropped the rejecting list and ended the loop, so
  // `parts` is exactly the completed earlier lists here.
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
    // Unterminated heredoc — bash warns, runs the delimiter's line, and
    // treats the tail as body: the partial. The delimiter's-line stage(s)
    // analyze as-is; the body produces no stages (plan §3).
    appendStage(s, 'newline');
    s.malformed = 'unterminated-heredoc';
  } else {
    appendStage(s, 'newline');
  }
  return { stages: s.parts, malformed: s.malformed };
}

const LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

/** Strip leading FOO=bar VAR=baz env-prefix assignments from a simple command. */
export function stripLeadingAssignments(simpleCmd: string): string {
  return simpleCmd.replace(LEADING_ASSIGNMENT, '');
}

/** One quote-aware lexical token from a simple command's text (plan §5.10). */
export interface Token {
  /**
   * The token text. Word tokens have quotes stripped and escapes resolved;
   * redirect tokens keep the operator with any attached target (`>f`,
   * `>>f`), shell-lexer style.
   */
  text: string;
  /**
   * Whether the token was quoted or escaped anywhere in the source. A quoted
   * token is a word, never an operator (`echo '>'` is not a redirect).
   */
  quoted: boolean;
  /**
   * Whether the token is a redirect operator (`>`, `>>`, `1>`, `2>`, `&>`,
   * `&>>`, `>&`, `<`, `<<`, `<<-`, `<<<`), with any attached target preserved
   * in `text`.
   */
  isRedirect: boolean;
}

/**
 * Quote-aware tokenizer that splits redirect operators as distinct tokens with
 * attached-target forms preserved (plan §5.10). Word tokens carry the
 * `quoted` flag so consumers can tell a real `<<` operator from a quoted
 * `"<<"` literal. Returns null on unbalanced quotes.
 */
export function tokenize(s: string): Token[] | null {
  const tokens: Token[] = [];
  let buf = '';
  let quoted = false;
  let i = 0;
  const n = s.length;

  const flushWord = (): void => {
    if (buf.length === 0) return;
    tokens.push({ text: buf, quoted, isRedirect: false });
    buf = '';
    quoted = false;
  };

  /**
   * Append the unquoted content of the quoted section opening at `start`
   * (the quote char) to `out`, mirroring shlex's escape rules for double
   * quotes. Returns the index after the closing quote, or null when
   * unbalanced.
   */
  const appendQuotedContent = (out: string, start: number): { out: string; next: number } | null => {
    const quote = s[start];
    let j = start + 1;
    while (j < n) {
      const c = s[j];
      if (quote === "'") {
        if (c === "'") return { out, next: j + 1 };
        out += c;
        j += 1;
        continue;
      }
      if (c === '\\' && j + 1 < n && '"\\$`'.includes(s[j + 1])) {
        out += s[j + 1];
        j += 2;
        continue;
      }
      if (c === '"') return { out, next: j + 1 };
      out += c;
      j += 1;
    }
    return null;
  };

  /**
   * Append the raw attached-target text starting at `start` to `out` —
   * verbatim, quoted sections spanning spaces included — stopping at
   * whitespace or another redirect operator. Returns the next index, or null
   * on unbalanced quotes.
   */
  const appendAttachedTarget = (out: string, start: number): { out: string; next: number } | null => {
    let j = start;
    while (j < n) {
      const c = s[j];
      if (/\s/.test(c) || c === '<' || c === '>') return { out, next: j };
      if (c === "'" || c === '"') {
        const section = appendQuotedContent('', j);
        if (section === null) return null;
        out += s.slice(j, section.next);
        j = section.next;
        continue;
      }
      if (c === '\\' && j + 1 < n) {
        out += c + s[j + 1];
        j += 2;
        continue;
      }
      out += c;
      j += 1;
    }
    return { out, next: j };
  };

  /** Emit a redirect token whose text prefixes the operator with the current digit buffer (an IO_NUMBER like `2>`). */
  const emitRedirect = (operator: string, attachedStart: number): boolean => {
    const attached = appendAttachedTarget('', attachedStart);
    if (attached === null) return false;
    tokens.push({ text: buf + operator + attached.out, quoted: false, isRedirect: true });
    buf = '';
    quoted = false;
    i = attached.next;
    return true;
  };

  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      flushWord();
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      quoted = true;
      const section = appendQuotedContent(buf, i);
      if (section === null) return null;
      buf = section.out;
      i = section.next;
      continue;
    }
    if (c === '\\' && i + 1 < n) {
      quoted = true;
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '<' || c === '>') {
      // A `<`/`>` is a redirect operator at a word boundary, or after an
      // IO_NUMBER digit run (`1>`, `2>`); mid-word it ends the current word
      // first (`echo a>b` → words `echo`, `a`; redirect `>b`).
      if (buf !== '' && !/^\d+$/.test(buf)) flushWord();
      let operator: string;
      if (c === '<') {
        if (s.slice(i, i + 3) === '<<<') operator = '<<<';
        else if (s.slice(i, i + 3) === '<<-') operator = '<<-';
        else if (s.slice(i, i + 2) === '<<') operator = '<<';
        else operator = '<';
      } else {
        operator = s.slice(i, i + 2) === '>>' ? '>>' : '>';
      }
      if (!emitRedirect(operator, i + operator.length)) return null;
      continue;
    }
    if (c === '&') {
      // `&>`/`&>>` — the stdout+stderr redirect (kept together by
      // splitTopLevel). A bare `&` here is an ordinary word char (`&1` in
      // `2>&1`, which the attached-target scan above consumed anyway).
      if (s[i + 1] === '>') {
        flushWord();
        const operator = s.slice(i, i + 3) === '&>>' ? '&>>' : '&>';
        if (!emitRedirect(operator, i + operator.length)) return null;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  flushWord();
  return tokens;
}

/**
 * The attached target of a redirect token, or null when the operator is
 * standalone (`>` vs `>f`; `2>` vs `2>&1`). Splits an optional IO_NUMBER
 * digit run off the front, then the operator, leaving the target.
 */
function redirectAttachedTarget(text: string): string | null {
  const match = text.match(/^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/);
  if (match === null) return null;
  const [, , , rest] = match;
  return rest.length > 0 ? rest : null;
}

/** Best-effort argv for a simple command: leading assignments stripped, quote-aware tokens minus redirect operators and their targets. Returns null if the command doesn't tokenize cleanly (unbalanced quotes). */
export function argvOf(simpleCmd: string): string[] | null {
  const tokens = tokenize(stripLeadingAssignments(simpleCmd).trim());
  if (tokens === null) return null;
  const argv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    // A standalone redirect operator consumes the next token as its target;
    // an attached form (`>f`, `>>f`) is self-contained.
    if (redirectAttachedTarget(token.text) === null) i += 1;
  }
  return argv;
}

/** Quote-aware whitespace tokenizer, roughly matching `shlex.split(s, posix=True)`. Returns null on unbalanced quotes. */
export function splitWords(s: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  const n = s.length;

  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (has) {
        words.push(cur);
        cur = '';
        has = false;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      has = true;
      i += 1;
      const end = s.indexOf("'", i);
      if (end === -1) return null;
      cur += s.slice(i, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      has = true;
      i += 1;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n && '"\\$`'.includes(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else {
          cur += s[i];
          i += 1;
        }
      }
      if (i >= n) return null;
      i += 1;
      continue;
    }
    if (c === '\\' && i + 1 < n) {
      has = true;
      cur += s[i + 1];
      i += 2;
      continue;
    }
    has = true;
    cur += c;
    i += 1;
  }
  if (has) words.push(cur);
  return words;
}

/**
 * Whether an UNQUOTED `<` — a stdin redirect, standalone (`< file`) or glued
 * inside a token (`head -2<f`, `rg needle<f`, a consumed `-e`/`-f` value like
 * `-e needle<f`) — appears in a simple command. Bash treats `<` as a redirect
 * operator only outside quotes, so the scan is quote-aware: a literal `<` in
 * a pattern like `rg -n '<div>'` or an awk script like `'NR<=2'` must never
 * be mistaken for a redirect. Process substitution `<(…)` and here-strings
 * `<<<` also begin with an unquoted `<` — both count as redirects here (fail
 * closed; a read-touch bin never legitimately needs them).
 */
export function hasUnquotedRedirect(simpleCmd: string): boolean {
  let inSquote = false;
  let inDquote = false;
  for (let i = 0; i < simpleCmd.length; i++) {
    const c = simpleCmd[i];
    if (inSquote) {
      // No escapes inside single quotes — the next `'` always closes.
      if (c === "'") inSquote = false;
      continue;
    }
    if (inDquote) {
      // Inside double quotes a backslash only escapes `"`, `\`, `$`, and
      // backtick; everything else (including `<`) is literal.
      if (c === '\\' && i + 1 < simpleCmd.length && '"\\$`'.includes(simpleCmd[i + 1])) {
        i += 1;
      } else if (c === '"') {
        inDquote = false;
      }
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      continue;
    }
    if (c === '\\' && i + 1 < simpleCmd.length) {
      // An escaped character is literal — `\<` is not a redirect.
      i += 1;
      continue;
    }
    if (c === '<') return true;
  }
  return false;
}

/**
 * Redirect operators that drop together with their plain target word (plan §4
 * two-token shapes): `>`, `>>`, `<`, `<>`, `&>`, `&>>`, and digit-prefixed
 * forms like `2>`/`2>>`/`3<`. `>|` is deliberately absent — it fails closed.
 */
const REDIRECT_TWO_TOKEN = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))$/;

/** Dup forms that drop alone (plan §4): `2>&1`, `>&-`, `3<&0`. */
const REDIRECT_DUP = /^(?:[0-9]+)?[<>]&(?:[0-9]+|-)$/;

/** Fused operator+target words that drop whole (plan §4): `>out`, `2>err`, `&>out`. */
const REDIRECT_FUSED = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))[^<>&|]/;

/** Heredoc/here-string operators with a separate target word: `<<`, `<<-`, `<<<`. */
const HEREDOC_TWO_TOKEN = /^(?:<<-?|<<<)$/;

/** Fused heredoc words (plan §4): `<<EOF`, `<<-EOF`, `<<<x`. */
const HEREDOC_FUSED = /^(?:<<-?|<<<)[^<>&|]/;

/** Whether a word is itself a redirect token — never a valid redirect target. */
const REDIRECT_TOKEN = (w: string): boolean =>
  REDIRECT_TWO_TOKEN.test(w) ||
  REDIRECT_DUP.test(w) ||
  REDIRECT_FUSED.test(w) ||
  HEREDOC_TWO_TOKEN.test(w) ||
  HEREDOC_FUSED.test(w);

/**
 * Strip redirect tokens from a simple command's argv so the read-side
 * matchers see the words that were actually read (plan §4): two-token
 * operators (`>`, `>>`, `<`, `<>`, `&>`, `&>>`, digit-prefixed `2>`/`2>>`/
 * `3<`, ...) drop together with their plain target word, dup forms (`2>&1`,
 * `>&-`, `3<&0`) drop alone, fused forms (`>out`, `2>err`, `&>out`) drop as
 * one word, and heredoc/here-string operators drop with their target word in
 * both spellings. A two-token operator's target must be a plain file word — a
 * following redirect token (`cat f > 2>&1`) is bash's "syntax error near
 * unexpected token" and leaves the operator dangling, unmatched. Anything
 * else beginning with `>`/`<` (notably `>|`) is left alone — the caller
 * treats a residual redirect word as an unmatched stage. Applied to every
 * stage — sources, selectors, and predicates — before status evaluation and
 * matcher dispatch.
 */
export function stripRedirects(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REDIRECT_TWO_TOKEN.test(a) || HEREDOC_TWO_TOKEN.test(a)) {
      const next = argv[i + 1];
      // The operator's target must be a plain file word — a following redirect
      // token means the operator dangles and the command never runs. The
      // dangling operator itself is left in place so the caller rejects the
      // stage as unmatched.
      if (next !== undefined && !REDIRECT_TOKEN(next)) {
        i += 1;
      } else {
        out.push(a);
      }
      continue;
    }
    if (REDIRECT_DUP.test(a) || REDIRECT_FUSED.test(a) || HEREDOC_FUSED.test(a)) continue;
    out.push(a);
  }
  return out;
}

/** Shell builtins the walk recognizes a `builtin` wrapper may forward (plan §5). */
const WRAPPER_BUILTINS = new Set([
  'exit',
  'exec',
  'true',
  'false',
  ':',
  'cd',
  'set',
  'unset',
  'export',
  'readonly',
  'return',
  'break',
  'continue'
]);

/** Externals whose absolute executable paths strip to their basename (plan §5). */
const RECOGNIZED_EXTERNAL_NAMES = new Set([
  'sed',
  'head',
  'tail',
  'cat',
  'nl',
  'git',
  'true',
  'false',
  'timeout',
  'env',
  'command'
]);

/** A `timeout` duration word: `5`, `5.5s`, `1m`, `2h`, ... */
const TIMEOUT_DURATION = /^\d+(?:\.\d+)?[smhd]?$/;

/** A literal `NAME=value` env-prefix word. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;

/**
 * One strip step. Returns null when the wrapper is not clean (fail closed —
 * the caller restores the original argv, so nothing is forwarded to the
 * matchers), or the argv with one wrapper layer removed.
 */
function stripWrappersOnce(argv: string[]): string[] | null {
  let i = 0;
  while (i < argv.length && argv[i] === '!') i++;
  if (i >= argv.length) return argv.slice(i);
  const head = argv[i];
  if (head === 'command') {
    const next = argv[i + 1];
    if (next === '-v' || next === '-V') return null; // a query — runs nothing
    if (next === '-p') return argv.slice(i + 2);
    if (next !== undefined && !next.startsWith('-')) return argv.slice(i + 1);
    return null;
  }
  if (head === 'builtin') {
    const next = argv[i + 1];
    if (next !== undefined && WRAPPER_BUILTINS.has(next)) return argv.slice(i + 2);
    return null; // `builtin sed` errors — never forward a non-builtin word
  }
  if (head === 'env') {
    let j = i + 1;
    while (j < argv.length && ENV_ASSIGNMENT.test(argv[j])) j++;
    if (j === i + 1) return null; // `-i`, `-u X`, a non-assignment word — not a clean wrapper
    return argv.slice(j);
  }
  if (head === 'timeout') {
    let j = i + 1;
    while (j < argv.length && argv[j].startsWith('--')) j++;
    if (j >= argv.length || !TIMEOUT_DURATION.test(argv[j])) return null; // no duration — nothing runs
    return argv.slice(j + 1);
  }
  if (head.startsWith('/')) {
    const base = head.slice(head.lastIndexOf('/') + 1);
    if (RECOGNIZED_EXTERNAL_NAMES.has(base)) return [base, ...argv.slice(i + 1)];
    return null; // `/usr/bin/exit` and friends are not recognized externals
  }
  if (head.includes('/')) return null; // a relative colliding path is a local binary, not the coreutil
  return argv.slice(i);
}

/**
 * Strip transparent wrapper prefixes from a simple command's argv so matcher
 * dispatch sees the underlying command word (plan §5): `command` (stopping at
 * the query forms `-v`/`-V`), `builtin` restricted to the walk's recognized
 * builtins, `env NAME=value` prefixes, `timeout` plus its `--*` flags and one
 * duration, and absolute executable paths whose basename is in the recognized
 * set — iterating until fixed-point so stacked wrappers still reach the word.
 * Any unclean wrapper fails closed: the original argv is returned unchanged,
 * so the stage matches nothing.
 */
export function stripWrappers(argv: string[]): string[] {
  let current = argv;
  for (let iter = 0; iter < argv.length + 2; iter++) {
    const next = stripWrappersOnce(current);
    if (next === null) return argv;
    if (next.length === current.length && next.every((w, k) => w === current[k])) return current;
    current = next;
  }
  return argv;
}
