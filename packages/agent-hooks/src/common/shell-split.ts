/**
 * Heuristic, dependency-free shell splitting. Not a full shell parser — good
 * enough to locate simple commands (and their argv) inside a larger
 * &&/||/;/|-joined Bash string without pulling in a real bash AST parser.
 * Validated during research against bashlex on the real transcript corpus;
 * this ports the same algorithm.
 */

/** One `simple command` found in a larger script, plus which operator preceded it. */
export interface SimpleCommand {
  text: string;
  /** The operator immediately before this command ('|' for a pipeline stage, otherwise '&&'/';'/'\n'/etc., or 'start' for the first command). */
  precededBy: '|' | 'other' | 'start';
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
        flush('other');
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === '||') {
        flush('other');
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
        flush('other');
        i += 1;
        continue;
      }
      if (c === '&') {
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
