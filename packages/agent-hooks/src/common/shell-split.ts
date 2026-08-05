/**
 * Heuristic, dependency-free shell splitting. Not a full shell parser — good
 * enough to locate simple commands (and their argv) inside a larger
 * &&/||/;/|-joined Bash string without pulling in a real bash AST parser.
 * Validated during research against bashlex on the real transcript corpus;
 * this ports the same algorithm.
 */

/**
 * The normalized boundary operators `splitTopLevel` emits — the single
 * representation both adapters consume.
 */
export type Operator = 'pipe' | 'and' | 'or' | 'semicolon' | 'newline' | 'background' | 'start';

/** One `simple command` found in a larger script, plus which operator preceded it. */
export interface SimpleCommand {
  text: string;
  /** The operator immediately before this command ('pipe' for a pipeline stage, 'and' for `&&`, 'or' for `||`, 'semicolon' for `;`, 'newline' for a newline separator, 'background' for `&`, or 'start' for the first command). */
  precededBy: Operator;
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
 */
export function splitTopLevel(cmd: string): SplitResult {
  const parts: SimpleCommand[] = [];
  let buf = '';
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let braceDepth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp: Operator = 'start';
  /** Set when the current list is a Bash parse error; the scan stops at it (plan §1, list-scope + terminal). */
  let malformed: MalformedVerdict | undefined;
  /** Index into `parts` where the current list began — the rejecting list's stages are dropped by rolling back to it. */
  let listStart = 0;

  /** Report a malformed list: drop its stages (completed earlier lists stay), and stop the scan — bash aborts at the first parse error. */
  const reject = (v: MalformedVerdict) => {
    malformed = v;
    parts.length = listStart;
    i = n;
  };

  /**
   * Whether a pipe/and/or operator is pending with a whitespace-only buffer
   * since it. A helper rather than an inline comparison: TypeScript's
   * control-flow narrowing cannot see the assignments `flush` makes to
   * `pendingOp` from inside its closure, and would otherwise narrow the
   * direct comparison to the initializer `'start'`.
   */
  const isUnconsumedOperator = (): boolean =>
    (pendingOp === 'pipe' || pendingOp === 'and' || pendingOp === 'or') && buf.trim() === '';

  /** The buffer's last whitespace-delimited word ('' when the buffer is empty). */
  const lastWord = (): string => buf.trimEnd().match(/\S+$/)?.[0] ?? '';

  /**
   * Redirect operators that are missing their target word when they are the
   * buffer's last word (plan §1): a target must be a plain word, so every
   * non-self-complete form is a parse error. Dup forms with both fds present
   * (`2>&1`, `>&-`, `3<&0`) and fused words (`>out`, `2>err`, `<<EOF`,
   * `&>out`) are complete and never match.
   */
  const DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;

  const lastWordIsDanglingRedirect = (): boolean => DANGLING_REDIRECT_WORD.test(lastWord());

  /** Whether the current char starts a new word in the buffer (empty buffer, or preceded by whitespace). */
  const isWordStart = (): boolean => buf === '' || /\s$/.test(buf);

  /** Whether a redirect token begins at `i`: a `>`/`<` form, `&>`, or a digit-prefixed form like `2>`/`2>&1`. */
  const startsRedirectAt = (i: number): boolean => {
    const c = cmd[i];
    if (c === '>' || c === '<') return true;
    if (c === '&') return cmd[i + 1] === '>';
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && cmd[j] >= '0' && cmd[j] <= '9') j += 1;
      return cmd[j] === '>' || cmd[j] === '<';
    }
    return false;
  };

  const flush = (nextOp: Operator) => {
    const s = buf.trim();
    if (s) {
      // `!` in pipe position is a parse error (plan §1): the first word of a
      // pipe-preceded stage may not be `!` (`false | ! true`, `cat f |\n! true`).
      if (pendingOp === 'pipe' && (s === '!' || /^!\s/.test(s))) {
        reject('pipe-bang');
        return;
      }
      parts.push({ text: s, precededBy: pendingOp });
    }
    buf = '';
    pendingOp = nextOp;
  };

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
    // `${…}` content is opaque (plan §1): nested expansions nest, and while
    // the brace depth is positive nothing inside counts parens, splits
    // operators, starts comments, or recognizes constructs — `${x%)}`,
    // `${x//(/}`, and `${x:-$(echo y)}` are all valid.
    if (braceDepth > 0) {
      if (c === '}') braceDepth -= 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '(') {
      depth += 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ')') {
      // A stray `)` at depth 0 (and brace depth 0, outside quotes) is a parse
      // error — `echo x) && …` (plan §1). `)` inside quotes, `${…}`, and
      // heredoc bodies never reaches this branch.
      if (depth === 0) {
        reject('unbalanced-paren');
        break;
      }
      depth -= 1;
      buf += c;
      i += 1;
      continue;
    }
    if (depth === 0) {
      // A redirect token with no target word, immediately followed by another
      // redirect token mid-stage, is a parse error: `cat f > > out`,
      // `cat f > 2>&1`, `cat f > &>out`, `cat f > <<< x` (plan §1).
      if (isWordStart() && lastWordIsDanglingRedirect() && startsRedirectAt(i)) {
        reject('dangling-operator');
        break;
      }
      if (c === '$' && cmd[i + 1] === '{') {
        braceDepth += 1;
        buf += c;
        i += 1;
        continue;
      }
      // `#` begins a comment when it starts a word (empty buffer or preceded
      // by whitespace); comments run to the newline, keeping the buffer empty
      // for the continuation rule. Mid-word and quoted `#` are text (plan §1).
      if (c === '#' && isWordStart()) {
        while (i < n && cmd[i] !== '\n') i += 1;
        continue;
      }
      if (cmd.slice(i, i + 2) === '&&') {
        if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
          reject('dangling-operator');
          break;
        }
        flush('and');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '||') {
        if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
          reject('dangling-operator');
          break;
        }
        flush('or');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '|&') {
        if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
          reject('dangling-operator');
          break;
        }
        flush('pipe');
        i += 2;
        continue;
      }
      if (c === ';') {
        if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
          reject('dangling-operator');
          break;
        }
        flush('semicolon');
        i += 1;
        continue;
      }
      if (c === '|') {
        if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
          reject('dangling-operator');
          break;
        }
        flush('pipe');
        i += 1;
        continue;
      }
      if (c === '\n') {
        // A newline is a line continuation — not a statement separator — when
        // a pipe/and/or operator is pending with a whitespace-only buffer
        // since it (`cat a.txt |\nsed ...`, `false &&\nsed ...`). `cat f | head -1\ncat g`
        // is therefore two lists, and a redirect target never continues onto
        // a later line (plan §1).
        if (isUnconsumedOperator()) {
          i += 1;
          continue;
        }
        if (lastWordIsDanglingRedirect()) {
          reject('dangling-operator');
          break;
        }
        flush('newline');
        listStart = parts.length;
        i += 1;
        continue;
      }
      if (c === '&') {
        // A bare `&` is a background operator only when it is not part of a
        // redirect token: the next character is `>` (`&>`/`&>>`), or the
        // buffer's last character is `>` or `<` (`2>&1`, `>& file`, `3<&0`).
        // Splitting inside those tokens would produce junk stages.
        const next = cmd[i + 1];
        const last = buf[buf.length - 1];
        if (next !== '>' && last !== '>' && last !== '<') {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject('dangling-operator');
            break;
          }
          flush('background');
          i += 1;
          continue;
        }
      }
    }
    buf += c;
    i += 1;
  }

  // End of input: the EOF-state verdicts — an unclosed quote, brace, or paren
  // level — then the unconsumed-operator checks, then the final flush. A
  // verdict set mid-scan already dropped the rejecting list and ended the
  // loop, so `parts` is exactly the completed earlier lists here.
  if (malformed) return { stages: parts, malformed };
  if (inSquote || inDquote) {
    reject('unclosed-quote');
  } else if (braceDepth > 0) {
    reject('unclosed-brace');
  } else if (depth > 0) {
    reject('unbalanced-paren');
  } else if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
    reject('dangling-operator');
  } else {
    flush('newline');
  }
  return { stages: parts, malformed };
}

const LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

/** Strip leading FOO=bar VAR=baz env-prefix assignments from a simple command. */
export function stripLeadingAssignments(simpleCmd: string): string {
  return simpleCmd.replace(LEADING_ASSIGNMENT, '');
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

/** Best-effort argv for a simple command: leading assignments stripped, quote-aware split. Returns null if the command doesn't tokenize cleanly (unbalanced quotes). */
export function argvOf(simpleCmd: string): string[] | null {
  return splitWords(stripLeadingAssignments(simpleCmd).trim());
}

/**
 * Strip redirect tokens from a simple command's argv so the read-side
 * matchers see the words that were actually read (plan §4): two-token
 * operators (`>`, `>>`, `&>`, digit-prefixed `2>`/`3<`, ...) drop together
 * with their plain target word, dup forms (`2>&1`, `>&-`) drop alone, fused
 * forms (`>out`, `2>err`) drop as one word, and heredoc/here-string operators
 * drop with their target word. Applied to every stage — sources, selectors,
 * and predicates — before status evaluation and matcher dispatch.
 *
 * Not implemented yet — Phase 1 declares the contract surface only.
 */
export function stripRedirects(_argv: string[]): string[] {
  throw new Error('Not Implemented');
}

/**
 * Strip transparent wrapper prefixes from a simple command's argv so matcher
 * dispatch sees the underlying command word (plan §5): `command` (stopping at
 * the query forms `-v`/`-V`), `builtin` restricted to the walk's recognized
 * builtins, `env NAME=value` prefixes, `timeout` plus its flags and one
 * duration, and absolute executable paths whose basename is in the recognized
 * set — iterating until fixed-point so stacked wrappers still reach the word.
 *
 * Not implemented yet — Phase 1 declares the contract surface only.
 */
export function stripWrappers(_argv: string[]): string[] {
  throw new Error('Not Implemented');
}
