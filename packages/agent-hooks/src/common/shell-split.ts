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

/** One `simple command` found in a larger script, plus which operator preceded it. */
export interface SimpleCommand {
  text: string;
  /**
   * The operator immediately before this command: '|' for a pipeline stage,
   * '&&'/'||' for the conditional operators (the only ones that gate, plan
   * §3 step 2), 'other' for ';'/newline/'&', or 'start' for the first command.
   */
  precededBy: 'start' | '|' | '&&' | '||' | 'other';
}

/** Split a command string into simple-command substrings at top-level &&, ||, ;, |, |&, and newline boundaries. Quotes and $()/``/() nesting are respected (not split inside). */
export function splitTopLevel(cmd: string): SimpleCommand[] {
  const parts: SimpleCommand[] = [];
  let buf = '';
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp: SimpleCommand['precededBy'] = 'start';

  const flush = (nextOp: SimpleCommand['precededBy']) => {
    const s = buf.trim();
    if (s) parts.push({ text: s, precededBy: pendingOp });
    buf = '';
    pendingOp = nextOp;
  };

  /**
   * Whether the operator currently pending is a pipe (`|`/`|&`). A helper
   * rather than an inline comparison: TypeScript's control-flow narrowing
   * cannot see the assignments `flush` makes to `pendingOp` from inside its
   * closure, and would otherwise narrow the direct comparison to the
   * initializer `'start'`.
   */
  const isPendingPipe = (): boolean => pendingOp === '|';

  while (i < n) {
    const c = cmd[i];
    if (inSquote) {
      buf += c;
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      buf += c;
      if (c === '\\' && i + 1 < n) {
        buf += cmd[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '\\' && i + 1 < n) {
      buf += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (c === '(') {
      depth += 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      buf += c;
      i += 1;
      continue;
    }
    if (depth === 0) {
      if (cmd.slice(i, i + 2) === '&&') {
        flush('&&');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '||') {
        flush('||');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '|&') {
        flush('|');
        i += 2;
        continue;
      }
      if (c === ';') {
        flush('other');
        i += 1;
        continue;
      }
      if (c === '|') {
        flush('|');
        i += 1;
        continue;
      }
      if (c === '\n') {
        // A newline immediately after a pipe operator is a line continuation
        // (`cat a.txt |\nsed ...` keeps the pipeline), not a statement
        // separator: skipping it preserves `precededBy: '|'` for the next
        // stage instead of degrading it to 'other'.
        if (isPendingPipe()) {
          i += 1;
          continue;
        }
        flush('other');
        i += 1;
        continue;
      }
      if (c === '&') {
        // `&>`/`&>>` (stdout+stderr redirect) and `>&` (fd-dup redirect, as in
        // `2>&1`) are redirect operators, not command separators — keep them
        // in the current simple command so the tokenizer can lex them as one
        // token. A `>` counts as a dup-redirect prefix only at a token
        // boundary (start, or after whitespace/digits) — `a>b&c` still
        // backgrounds the `a>b` redirect.
        const trimmed = buf.trimEnd();
        let dupRedirect = false;
        if (trimmed.endsWith('>')) {
          const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : '';
          dupRedirect = trimmed.length === 1 || /\s|\d/.test(before);
        }
        if (cmd[i + 1] === '>' || dupRedirect) {
          buf += c;
          i += 1;
          continue;
        }
        flush('other');
        i += 1;
        continue;
      }
    }
    buf += c;
    i += 1;
  }
  flush('other');
  return parts;
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
