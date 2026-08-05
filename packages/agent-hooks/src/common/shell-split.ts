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
   * a phantom. Never set yet: the malformed verdict machine is a later phase.
   */
  malformed?: MalformedVerdict;
}

/** Split a command string into simple-command substrings at top-level &&, ||, ;, |, |&, &, and newline boundaries. Quotes and $()/``/() nesting are respected (not split inside). */
export function splitTopLevel(cmd: string): SplitResult {
  const parts: SimpleCommand[] = [];
  let buf = '';
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp: Operator = 'start';

  const flush = (nextOp: Operator) => {
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
  const isPendingPipe = (): boolean => pendingOp === 'pipe';

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
        flush('and');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '||') {
        flush('or');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '|&') {
        flush('pipe');
        i += 2;
        continue;
      }
      if (c === ';') {
        flush('semicolon');
        i += 1;
        continue;
      }
      if (c === '|') {
        flush('pipe');
        i += 1;
        continue;
      }
      if (c === '\n') {
        // A newline immediately after a pipe operator is a line continuation
        // (`cat a.txt |\nsed ...` keeps the pipeline), not a statement
        // separator: skipping it preserves `precededBy: 'pipe'` for the next
        // stage instead of degrading it to 'newline'.
        if (isPendingPipe()) {
          i += 1;
          continue;
        }
        flush('newline');
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
          flush('background');
          i += 1;
          continue;
        }
      }
    }
    buf += c;
    i += 1;
  }
  flush('newline');
  return { stages: parts };
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
