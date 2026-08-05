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

/** The construct kinds the kind-matched stack tracks (plan §3). */
type ConstructKind = 'if' | 'loop' | 'for' | 'select' | 'brace';

/** One open construct: its kind, and whether a body word has been seen. */
interface OpenConstruct {
  kind: ConstructKind;
  /**
   * Whether a body has started. For `if` the body starts at `then`/`else`/
   * `elif`, for loops at `do`, for brace groups at any command word — a
   * closer with no body (`if x; fi`, `{ }`) is a Bash parse error.
   */
  body: boolean;
}

/** The case region's position state (plan §3). */
type CasePos = 'subject' | 'pattern-start' | 'pattern' | 'command';

/** An open case region: opaque content owned by the case scan. */
interface CaseRegion {
  pos: CasePos;
  /** In a `command` position: whether the current list item is still empty (only `)`, `;`, `&`, and newlines reset it). */
  cmdEmpty: boolean;
  /** The region's own paren depth — global paren depth is frozen while the region is open (the region is not a stack; it outlives paren closes). */
  localDepth: number;
}

/** A pending heredoc whose body has not started yet (or whose body is being scanned). */
interface PendingHeredoc {
  /** The line that closes the body: the delimiter, optionally `\t`-prefixed for `<<-`, with optional trailing whitespace. */
  close: RegExp;
}

/** The words that put the parser back at command start when they are the buffer's last word (plan §3). */
const COMMAND_OPENER_WORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'time', '{', '(']);

/** Word chars end at whitespace and the operator/paren/redirect metachars. */
const WORD_END = /[\s;&|()<>]/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  /**
   * Whether a new command can start here: the buffer is empty, a boundary
   * operator or `(`/`)` precedes, the buffer ends with a newline (a newline
   * inside an open construct is text but still ends the list item), or the
   * last word expects a command body (`then`, `do`, `{`, …).
   */
  const isCommandPosition = (): boolean =>
    buf.trim() === '' || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord());

  const flush = (nextOp: Operator) => {
    const s = buf.trim();
    if (s) {
      // `!` in pipe position is a parse error (plan §1): the first word of a
      // pipe-preceded stage may not be `!` (`false | ! true`, `cat f |\n! true`).
      if (pendingOp === 'pipe' && (s === '!' || /^!\s/.test(s))) {
        reject('pipe-bang');
        return;
      }
      parts.push({ text: s, precededBy: pendingOp, ...(bufHeredoc ? { heredoc: true } : {}) });
    }
    buf = '';
    bufHeredoc = false;
    pendingOp = nextOp;
  };

  // The kind-matched construct stack, one list per paren level: `(` pushes a
  // fresh level, `)` pops it and fires when it is non-empty — an unclosed
  // construct cannot outlive the subshell that closed (plan §3).
  const levels: OpenConstruct[][] = [[]];
  const top = (): OpenConstruct | undefined => {
    const lv = levels[levels.length - 1];
    return lv.length > 0 ? lv[lv.length - 1] : undefined;
  };
  /** Set by openers and body keywords, cleared by other words and `(` — an operator or closer directly after it is an empty-list parse error (`if true; then; fi`, `{ ; }`). */
  let afterKeyword = false;
  /** `function` seen; the next word is the function name, and `{` right after it opens the definition body. */
  let functionSeen = false;
  let nameSeen = false;

  // The open case region, if any (plan §3). While open, its content is opaque
  // to every other machine: the global paren depth is frozen, the construct
  // stack is untouched, and boundary operators are text.
  let caseRegion: CaseRegion | null = null;

  // Pending heredocs (plan §3): `<<`/`<<-` at depth 0 with a delimiter word.
  const heredocs: PendingHeredoc[] = [];
  /** In the body of a pending heredoc — lines are scanned raw for the close line. */
  let inBody = false;
  /** Whether the stage currently in the buffer feeds its stdin from a heredoc body (surfaced on the flushed SimpleCommand). */
  let bufHeredoc = false;

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
    // Heredoc body mode: scan lines raw until the first pending heredoc's
    // close line (a line that is exactly the delimiter, optionally tab-
    // prefixed for `<<-`, with optional trailing whitespace). The body is
    // opaque — it produces no stages — and unterminated bodies end at EOF.
    if (inBody) {
      const lineEnd = cmd.indexOf('\n', i);
      const line = lineEnd === -1 ? cmd.slice(i) : cmd.slice(i, lineEnd);
      if (heredocs[0].close.test(line)) {
        heredocs.shift();
        if (heredocs.length === 0) inBody = false;
      }
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        // Inside an open construct the body line folds into the construct's
        // interior text (a newline inside an open construct is not a
        // boundary, plan §1) — the interior re-split re-scans it as body.
        buf += line;
        if (lineEnd !== -1) buf += '\n';
      }
      i = lineEnd === -1 ? n : lineEnd + 1;
      continue;
    }
    // The newline right after a heredoc's delimiter line ends the delimiter's
    // line — it splits normally (a completed list, but without advancing
    // `listStart`: a completeness violation that rejects later drops the
    // delimiter's-line stage too) — and starts the body. Inside an open
    // construct the newline is not a boundary: the delimiter's line, the
    // body, and the close line all fold into the construct's one stage, and
    // the walk's interior re-split applies the same heredoc machinery there.
    if (c === '\n' && heredocs.length > 0) {
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += c;
        inBody = true;
        i += 1;
        continue;
      }
      if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
        reject('dangling-operator');
        break;
      }
      flush('newline');
      inBody = true;
      i += 1;
      continue;
    }
    // `#` begins a comment when it starts a word at depth 0 (empty buffer or
    // preceded by whitespace); comments run to the newline, keeping the buffer
    // empty for the continuation rule. Mid-word and quoted `#` are text, and
    // comments inside parens are opaque like everything else there (plan §1).
    if (c === '#' && depth === 0 && isWordStart()) {
      while (i < n && cmd[i] !== '\n') i += 1;
      continue;
    }
    // The case-region scan owns everything at its local depth 0 — pattern
    // syntax, list terminators, and words — while the region is open.
    if (caseRegion) {
      const r = caseRegion;
      if (r.localDepth === 0) {
        const s2 = cmd.slice(i, i + 2);
        const s3 = cmd.slice(i, i + 3);
        // `;;`/`;&`/`;;&` end the current pattern list — back to pattern-start.
        if (s3 === ';;&' || s2 === ';;' || s2 === ';&') {
          r.pos = 'pattern-start';
          buf += s3 === ';;&' ? s3 : s2;
          i += s3 === ';;&' ? 3 : 2;
          continue;
        }
        // `;` returns to command start (a `;;` was handled above).
        if (c === ';') {
          r.pos = 'command';
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        // A single `&` (not part of a redirect or `&&`) is the background
        // operator — also command start.
        const last = buf[buf.length - 1];
        if (c === '&' && cmd[i + 1] !== '>' && cmd[i + 1] !== '&' && last !== '>' && last !== '<') {
          r.pos = 'command';
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === '\n') {
          // A pattern cannot continue across a newline (bash errors), but a
          // newline after `in` or inside a list item is fine.
          if (r.pos === 'pattern') {
            reject('unclosed-case');
            break;
          }
          if (r.pos === 'command') r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === '#' && isWordStart()) {
          // A comment inside the region runs to the newline like outside.
          while (i < n && cmd[i] !== '\n') i += 1;
          continue;
        }
        if (isWordStart() && !WORD_END.test(c)) {
          let j = i;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          const w = cmd.slice(i, j);
          // `esac` closes at a pattern-list start or at the start of a list
          // item; elsewhere it is an ordinary word (`echo esac`, `a|esac)`),
          // as is `case` in the subject (`case esac in …`).
          if (w === 'esac' && (r.pos === 'pattern-start' || (r.pos === 'command' && r.cmdEmpty))) {
            caseRegion = null;
            afterKeyword = false;
          } else if (w === 'in' && r.pos === 'subject') {
            r.pos = 'pattern-start';
          } else if (r.pos === 'pattern-start') {
            r.pos = 'pattern';
          } else if (r.pos === 'command') {
            r.cmdEmpty = false;
          }
          buf += w;
          i = j;
          continue;
        }
      }
      // Local depth > 0 or non-word chars fall through to the paren branches
      // and the generic buffer.
    }
    if (c === '(') {
      if (caseRegion) {
        caseRegion.localDepth += 1;
      } else {
        // A subshell starts a command — `if true; then ( echo hi ); fi` is
        // valid while `if true; then; fi` is not; the same subshell counts as
        // a body word for an enclosing brace group (`{ ( echo hi ); }`).
        const t = top();
        if (t?.kind === 'brace') t.body = true;
        depth += 1;
        levels.push([]);
      }
      afterKeyword = false;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ')') {
      if (caseRegion) {
        // At local depth 0 a `)` is the pattern terminator (or the end of a
        // list item) — the region owns it and the global depth stays frozen.
        if (caseRegion.localDepth === 0) {
          caseRegion.pos = 'command';
          caseRegion.cmdEmpty = true;
        } else {
          caseRegion.localDepth -= 1;
        }
      } else {
        // A stray `)` at depth 0 (and brace depth 0, outside quotes) is a parse
        // error — `echo x) && …` (plan §1). `)` inside quotes, `${…}`, and
        // heredoc bodies never reaches this branch.
        if (depth === 0) {
          reject('unbalanced-paren');
          break;
        }
        // Fire-before-restore: an unclosed construct on the closing level
        // cannot outlive the subshell (plan §3).
        if (levels[levels.length - 1].length > 0) {
          reject('unclosed-construct');
          break;
        }
        depth -= 1;
        levels.pop();
      }
      buf += c;
      i += 1;
      continue;
    }
    // Construct keywords and the case-region opener: recognized at word
    // starts at any paren depth (constructs track through subshells), outside
    // quotes, ${…}, heredoc bodies, and open case regions (the region scan
    // above owns those words). Word-end chars (`;`, `&`, `|`, `<`, `>`)
    // never begin a word here.
    if (
      !caseRegion &&
      !WORD_END.test(c) &&
      (isWordStart() || /[()]$/.test(buf)) &&
      !(c === '$' && cmd[i + 1] === '{')
    ) {
      let j = i;
      while (j < n && !WORD_END.test(cmd[j])) j += 1;
      const w = cmd.slice(i, j);
      const isFnShape = (): boolean => /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord()) || lastWord() === '()';
      if (w === 'in' && top() !== undefined && ['for', 'select'].includes(top()!.kind)) {
        // The for/select word-list separator — recognized wherever it appears
        // while a for/select is open (`for i in a b`, `select x in a`).
      } else if (w === '{' && (isCommandPosition() || isFnShape() || (functionSeen && nameSeen))) {
        // `{` opens a brace group at command position, or right after a
        // function name (`f() {`, `f(){`, `function f {`). `{cat` is a word.
        if (functionSeen && nameSeen) {
          functionSeen = false;
          nameSeen = false;
        }
        if (top()?.kind === 'brace') top()!.body = true;
        levels[levels.length - 1].push({ kind: 'brace', body: false });
        afterKeyword = true;
      } else if (w === '}' && isCommandPosition()) {
        const t = top();
        if (afterKeyword || t === undefined || t.kind !== 'brace' || !t.body) {
          reject('unclosed-construct');
          break;
        }
        levels[levels.length - 1].pop();
        afterKeyword = false;
      } else if (isCommandPosition()) {
        if (w === 'case') {
          caseRegion = { pos: 'subject', cmdEmpty: false, localDepth: 0 };
          afterKeyword = false;
        } else if (w === 'function') {
          functionSeen = true;
          nameSeen = false;
          afterKeyword = false;
        } else if (w === 'if') {
          if (top()?.kind === 'brace') top()!.body = true;
          levels[levels.length - 1].push({ kind: 'if', body: false });
          afterKeyword = true;
        } else if (w === 'while' || w === 'until') {
          if (top()?.kind === 'brace') top()!.body = true;
          levels[levels.length - 1].push({ kind: 'loop', body: false });
          afterKeyword = true;
        } else if (w === 'for') {
          if (top()?.kind === 'brace') top()!.body = true;
          levels[levels.length - 1].push({ kind: 'for', body: false });
          afterKeyword = true;
        } else if (w === 'select') {
          if (top()?.kind === 'brace') top()!.body = true;
          levels[levels.length - 1].push({ kind: 'select', body: false });
          afterKeyword = true;
        } else if (w === 'do') {
          const t = top();
          if (t === undefined || !['for', 'loop', 'select'].includes(t.kind)) {
            reject('unclosed-construct');
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === 'then') {
          const t = top();
          if (t === undefined || t.kind !== 'if') {
            reject('unclosed-construct');
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === 'else' || w === 'elif') {
          // else/elif require a body already — an empty if-list is an error.
          const t = top();
          if (t === undefined || t.kind !== 'if' || !t.body) {
            reject('unclosed-construct');
            break;
          }
          afterKeyword = true;
        } else if (w === 'in') {
          const t = top();
          if (t === undefined || !['for', 'select'].includes(t.kind)) {
            reject('unclosed-construct');
            break;
          }
        } else if (w === 'fi') {
          const t = top();
          if (t === undefined || t.kind !== 'if' || !t.body) {
            reject('unclosed-construct');
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === 'done') {
          const t = top();
          if (t === undefined || !['for', 'loop', 'select'].includes(t.kind) || !t.body) {
            reject('unclosed-construct');
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === 'esac') {
          // No open region — a stray esac is a parse error.
          reject('unclosed-construct');
          break;
        } else {
          afterKeyword = false;
          if (top()?.kind === 'brace') top()!.body = true;
          if (functionSeen) {
            if (nameSeen) {
              functionSeen = false;
              nameSeen = false;
            } else {
              nameSeen = true;
            }
          }
        }
      } else {
        // An argument-position word: nothing opens, the empty-body flag
        // clears, and the function-name handoff advances.
        afterKeyword = false;
        if (functionSeen) {
          if (nameSeen) {
            functionSeen = false;
            nameSeen = false;
          } else {
            nameSeen = true;
          }
        }
      }
      buf += w;
      i = j;
      continue;
    }
    // A `;`/`&` directly after an opener or body keyword is an empty-list
    // parse error at any depth (`if true; then; fi`, `{ ; }`,
    // `for i in a b; do; done`, `( if true; then; fi )`).
    if (caseRegion === null && levels[levels.length - 1].length > 0 && (c === ';' || c === '&') && afterKeyword) {
      reject('unclosed-construct');
      break;
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
      // Heredoc recognition (plan §3): `<<`/`<<-` (not `<<<`) at depth 0 with
      // a delimiter word. The operator+delimiter are stripped from the stage
      // text — the stage keeps a plain argv (`cat f` stays `cat f`).
      if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
        let j = i + 2;
        let allowTabs = false;
        if (cmd[j] === '-') {
          allowTabs = true;
          j += 1;
        }
        while (cmd[j] === ' ' || cmd[j] === '\t') j += 1;
        let delim = '';
        if (cmd[j] === "'" || cmd[j] === '"') {
          const q = cmd.indexOf(cmd[j], j + 1);
          if (q === -1) {
            delim = cmd.slice(j + 1);
            j = n;
          } else {
            delim = cmd.slice(j + 1, q);
            j = q + 1;
          }
        } else {
          const wordStart = j;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          delim = cmd.slice(wordStart, j);
        }
        if (delim !== '') {
          heredocs.push({
            close: new RegExp(`^${allowTabs ? '\t*' : ''}${escapeRegExp(delim)}[ \\t]*$`)
          });
          // The operator+delimiter leave the stage text below, so mark the
          // stage: its stdin comes from the heredoc body, and consumers that
          // read `<` from the text would otherwise never see the redirect.
          bufHeredoc = true;
          if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
            // Inside an open construct the operator+delimiter stay in the
            // stage text — the walk's interior re-split re-recognizes the
            // heredoc there (plan §3).
            buf += cmd.slice(i, j);
          }
          i = j;
          continue;
        }
      }
      // While a construct is open at depth 0 the boundary operators are text —
      // the construct is one stage.
      if (caseRegion === null && levels[levels.length - 1].length === 0) {
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
    }
    buf += c;
    i += 1;
  }

  // End of input: the EOF-state verdicts — an unclosed quote, brace, case
  // region, paren level, or construct — then the unconsumed-operator checks,
  // then the unterminated-heredoc partial, then the final flush. A verdict
  // set mid-scan already dropped the rejecting list and ended the loop, so
  // `parts` is exactly the completed earlier lists here.
  if (malformed) return { stages: parts, malformed };
  if (inSquote || inDquote) {
    reject('unclosed-quote');
  } else if (braceDepth > 0) {
    reject('unclosed-brace');
  } else if (caseRegion !== null) {
    reject('unclosed-case');
  } else if (depth > 0) {
    reject('unbalanced-paren');
  } else if (levels[levels.length - 1].length > 0) {
    reject('unclosed-construct');
  } else if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
    reject('dangling-operator');
  } else if (inBody || heredocs.length > 0) {
    // Unterminated heredoc — bash warns, runs the delimiter's line, and
    // treats the tail as body: the partial. The delimiter's-line stage(s)
    // analyze as-is; the body produces no stages (plan §3).
    flush('newline');
    malformed = 'unterminated-heredoc';
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

/** Best-effort argv for a simple command: leading assignments stripped, quote-aware split. Returns null if the command doesn't tokenize cleanly (unbalanced quotes). */
export function argvOf(simpleCmd: string): string[] | null {
  return splitWords(stripLeadingAssignments(simpleCmd).trim());
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
