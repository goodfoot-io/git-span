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
import { argvOf, type Operator, type SimpleCommand, splitTopLevel, splitWords } from './shell-split.js';

export interface ResolvedSpan {
  lineStart: number;
  lineEnd: number;
  absolutePath: string;
  /**
   * The exact body of a `heredoc-write` span — the content the heredoc writes.
   * Absent (undefined) for read idioms.
   */
  body?: string;
  /**
   * The heredoc redirect operator. `>` means the file was overwritten
   * (whole-file scope — any span beyond the new EOF was deleted and must
   * surface); `>>` means the body was appended (narrow to the append range).
   * Absent (undefined) for read idioms.
   */
  redirect?: '>' | '>>';
}

export type Idiom =
  | 'sed-n-range'
  | 'head-file'
  | 'tail-file'
  | 'cat-file'
  | 'nl-file'
  | 'git-show-rev-path'
  | 'git-log-L'
  | 'heredoc-write';

export type SpanMatch =
  | { status: 'resolved'; idiom: Idiom; span: ResolvedSpan; note?: string }
  | { status: 'unresolved'; idiom: Idiom; fileArg: string; reason: string };

/** Options for the Bash command parser (plan §8). */
export interface ParseOptions {
  /** The working directory to resolve relative paths against; defaults to `process.cwd()`. */
  cwd?: string;
  /** The hook process env, for allowlisted path-variable resolution; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Variable names allowed to resolve from `env`; defaults to `DEFAULT_PATH_ALLOWLIST`. */
  allowlist?: readonly string[];
}

/** Whether a simple command is known to have executed, provably not, or undeterminable (plan §2). */
export type ExecStatus = 'yes' | 'no' | 'unknown';

/** The execution-aware walk's verdict for one simple command (plan §2). */
export interface StageExec {
  /** `'yes'` — provably executed; `'no'` — provably not; `'unknown'` — undeterminable (fail closed). */
  exec: ExecStatus;
}

/**
 * Compute, per simple command, whether it executed (plan §2): pipeline
 * grouping, `&&`/`||` chain gating against known statuses, `!` group-level
 * negation, in-string errexit/pipefail liveness, terminator and never-return
 * fires, and the decidable-control construct classes. IO-free and exported so
 * the xtrace oracle can compare executed sets against real bash.
 */
export function analyzeExecution(simpleCommands: SimpleCommand[], _opts: ParseOptions = {}): StageExec[] {
  const walker = new ExecutionWalker();
  walker.walkInput(simpleCommands);
  return walker.verdicts.map((exec) => ({ exec }));
}

// ---------------------------------------------------------------------------
// Execution walk (plan §2): per-simple-command ExecStatus, driven by pipeline
// grouping, &&/|| chain status, in-string errexit/pipefail liveness, and the
// decidable-control construct classes. The walk also expands decidable
// construct interiors into the stage stream the emission replay consumes.
// ---------------------------------------------------------------------------

type ChainStatus = 'success' | 'failure' | 'unknown';

type DeadKind = 'exit' | 'never-return' | 'errexit' | 'malformed';

/** One stage the walk contributes to the emission replay. */
interface ExpandedStage {
  text: string;
  precededBy: Operator;
  exec: ExecStatus;
  /** A member of a multi-member pipeline: side effects and `exit`/`exec` terminators are suppressed. */
  inPipeline: boolean;
  /** The emission's `cd` frame: +1 inside a subshell interior, discarded at the close. */
  dirFrame: number;
}

interface LoopFrame {
  outcome: 'none' | 'break' | 'continue' | 'ambiguous' | 'return';
  /** A decisive own-depth break/continue fired: the rest of the body list is dead. */
  bodyTerminated: boolean;
  /** A hidden break/continue made the guard onward untouchable. */
  ambiguousStop: boolean;
}

interface WalkOptions {
  /** Errexit liveness is suspended inside if/while/until conditions (bash exempts them). */
  liveness: boolean;
  /** The expanded stage stream is discarded (conditions, scans, def-body probes). */
  discard: boolean;
  /** Side effects (assignments, set toggles, def registration) are applied. */
  sideEffects: boolean;
  /** This list is the top-level input: record the per-input verdicts. */
  inputFacing: boolean;
}

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The `-o`/`+o` option names of `set` that bash documents (plan §2, known statuses). */
const SET_OPTION_NAMES = new Set([
  'allexport',
  'braceexpand',
  'emacs',
  'errexit',
  'errtrace',
  'functrace',
  'hashall',
  'histexpand',
  'history',
  'ignoreeof',
  'interactive-comments',
  'keyword',
  'lexical-word-processing',
  'monitor',
  'noclobber',
  'noexec',
  'noglob',
  'nolog',
  'notify',
  'nounset',
  'onecmd',
  'physical',
  'pipefail',
  'posix',
  'privileged',
  'verbose',
  'vi',
  'xtrace'
]);

/** bash's documented single-letter `set` flags (plan §2, known statuses). */
const SET_FLAG_LETTERS = 'aBbCeEfhHikmnopPtTuvx';

/** Builtins the walk's restricted `builtin` wrapper strip forwards (plan §2, wrapper discipline). */
const RECOGNIZED_BUILTINS = new Set([
  'true',
  ':',
  'false',
  'set',
  'exit',
  'exec',
  'return',
  'break',
  'continue',
  'cd',
  'export',
  'command',
  'builtin'
]);

/** Walk-side wrapper strip: `!`, `command`, and `builtin` (restricted to the recognized builtins). */
function walkStrip(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length && argv[i] === '!') i++;
  while (i < argv.length && argv[i] === 'command') i++;
  while (i < argv.length && argv[i] === 'builtin' && argv[i + 1] !== undefined && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}

/** Emission-side strip: leading `!`, `command`, and `exec` before matcher dispatch. */
function stripForEmission(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length && argv[i] === '!') i++;
  while (i < argv.length && (argv[i] === 'command' || argv[i] === 'exec')) i++;
  return argv.slice(i);
}

/** Every arg a recognized `set` flag group (`-o` consumes its name), `--`, or a positional word. */
function setFlagsKnown(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;
    if (a.startsWith('-') || a.startsWith('+')) {
      const chars = a.slice(1);
      if (chars.length === 0) return false;
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === 'o') {
          const name = args[i + 1];
          if (name === undefined || !SET_OPTION_NAMES.has(name)) return false;
          i++;
        } else if (!SET_FLAG_LETTERS.includes(c)) {
          return false;
        }
      }
    }
    // A positional parameter word — `set foo` exits 0.
  }
  return true;
}

/**
 * A quote-aware scan of a construct's text that yields its words (quote
 * content stripped) with the paren/brace/construct depths at each word, so
 * `then`/`do`/`done`/`fi`/`esac`/`in` keywords are recognized only at the
 * level that owns them.
 */
interface WordTok {
  word: string;
  start: number;
  end: number;
  depth: number;
  braceDepth: number;
  constructDepth: number;
  quoted: boolean;
}

const CONSTRUCT_OPENERS = new Set(['if', 'while', 'until', 'for', 'case', 'select']);
const CONSTRUCT_CLOSERS = new Set(['fi', 'done', 'esac']);

function scanTokens(text: string): WordTok[] {
  const toks: WordTok[] = [];
  let i = 0;
  const n = text.length;
  let parenDepth = 0;
  let braceDepth = 0;
  let constructDepth = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === '{') {
      if (c === '(') parenDepth++;
      else braceDepth++;
      i++;
      continue;
    }
    if (c === ')' || c === '}') {
      if (c === ')') parenDepth = Math.max(0, parenDepth - 1);
      else braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (';&|<>'.includes(c)) {
      i++;
      continue;
    }
    const start = i;
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    toks.push({ word: w.word, start, end: w.end, depth: parenDepth, braceDepth, constructDepth, quoted: w.quoted });
    if (parenDepth === 0 && braceDepth === 0 && !w.quoted) {
      if (CONSTRUCT_OPENERS.has(w.word)) constructDepth++;
      else if (CONSTRUCT_CLOSERS.has(w.word)) constructDepth = Math.max(0, constructDepth - 1);
    }
  }
  return toks;
}

/** Read one word at `i` (quote-aware, separator-terminated); returns its content and span. */
function readWordAt(text: string, i: number): { word: string; end: number; quoted: boolean } | null {
  if (i >= text.length) return null;
  let word = '';
  let quoted = false;
  const n = text.length;
  while (i < n && !/\s/.test(text[i]) && !'(){};&|<>'.includes(text[i])) {
    const ch = text[i];
    if (ch === "'") {
      quoted = true;
      i++;
      while (i < n && text[i] !== "'") {
        word += text[i];
        i++;
      }
      if (i < n) i++;
    } else if (ch === '"') {
      quoted = true;
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
          word += text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i++;
        }
      }
      if (i < n) i++;
    } else if (ch === '\\' && i + 1 < n) {
      word += text[i + 1];
      i += 2;
    } else {
      word += ch;
      i++;
    }
  }
  return { word, end: i, quoted };
}

/** The interior between the first `open` char and its matching `close`, quotes aware. */
function extractGroupBody(text: string, open: '{' | '(', close: '}' | ')'): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inQuote: string | null = null;
  for (let p = start; p < text.length; p++) {
    const ch = text[p];
    if (inQuote !== null) {
      if (ch === '\\' && inQuote === '"' && p + 1 < text.length && '"\\$`'.includes(text[p + 1])) p++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === '\\') {
      p++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, p);
    }
  }
  return null;
}

type ConstructKind = 'if' | 'while' | 'until' | 'for' | 'case' | 'select' | 'brace' | 'subshell' | 'def' | 'plain';

function classifyStage(text: string): ConstructKind {
  const t = text.trimStart();
  if (t.startsWith('{')) return 'brace';
  if (t.startsWith('(')) return 'subshell';
  const kw = t.match(/^(if|while|until|for|case|select)\b/);
  if (kw !== null) return kw[1] as ConstructKind;
  if (/^(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{/.test(t)) return 'def';
  return 'plain';
}

/** A function definition's name and body text (brace-group interior). */
function parseDef(text: string): { name: string; body: string } | null {
  const m = text.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
  if (m === null) return null;
  const body = extractGroupBody(text, '{', '}');
  if (body === null) return null;
  return { name: m[1], body };
}

interface ParsedIf {
  condition: string;
  thenBody: string;
  elifs: { condition: string; body: string }[];
  elseBody: string | null;
}

function parseIf(text: string): ParsedIf | null {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== 'if') return null;
  const thenIdx = toks.findIndex((t) => t.word === 'then' && t.constructDepth === 1);
  if (thenIdx === -1) return null;
  const thenTok = toks[thenIdx];
  const condition = text.slice(toks[0].end, thenTok.start);

  const boundaries: { word: string; tok: WordTok }[] = [];
  for (let idx = thenIdx + 1; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.constructDepth !== 1 || (t.word !== 'elif' && t.word !== 'else' && t.word !== 'fi')) continue;
    if (t.word === 'elif') {
      const eThenIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === 'then' && tt.constructDepth === 1);
      if (eThenIdx === -1) return null;
      boundaries.push({ word: 'elif', tok: t }, { word: 'then', tok: toks[eThenIdx] });
      idx = eThenIdx;
      continue;
    }
    boundaries.push({ word: t.word, tok: t });
    if (t.word === 'else') {
      const fiIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === 'fi' && tt.constructDepth === 1);
      if (fiIdx === -1) return null;
      boundaries.push({ word: 'fi', tok: toks[fiIdx] });
      break;
    }
    break;
  }
  if (boundaries.length === 0) return null;

  const thenBody = text.slice(thenTok.end, boundaries[0].tok.start);
  const elifs: { condition: string; body: string }[] = [];
  let elseBody: string | null = null;
  for (let b = 0; b < boundaries.length; b++) {
    const { word, tok } = boundaries[b];
    if (word === 'elif') {
      const eThen = boundaries[b + 1];
      if (eThen === undefined || eThen.word !== 'then') return null;
      const nextStart = boundaries[b + 2]?.tok.start ?? text.length;
      elifs.push({ condition: text.slice(tok.end, eThen.tok.start), body: text.slice(eThen.tok.end, nextStart) });
      b++;
    } else if (word === 'else') {
      const fi = boundaries[b + 1];
      if (fi === undefined || fi.word !== 'fi') return null;
      elseBody = text.slice(tok.end, fi.tok.start);
      break;
    }
  }
  return { condition, thenBody, elifs, elseBody };
}

function parseLoop(text: string, keyword: 'while' | 'until'): { condition: string; body: string } | null {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== keyword) return null;
  const doTok = toks.find((t) => t.word === 'do' && t.constructDepth === 1);
  if (doTok === undefined) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === 'done' && t.constructDepth === 1);
  if (doneTok === undefined) return null;
  return { condition: text.slice(toks[0].end, doTok.start), body: text.slice(doTok.end, doneTok.start) };
}

interface ParsedFor {
  list: string[] | null;
  body: string;
  wholeInterior: string;
}

function parseFor(text: string): ParsedFor | null {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== 'for') return null;
  const nameTok = toks[1];
  if (nameTok === undefined) return null;
  const doTok = toks.find((t) => t.word === 'do' && t.constructDepth === 1 && t.start > nameTok.end);
  if (doTok === undefined) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === 'done' && t.constructDepth === 1);
  if (doneTok === undefined) return null;
  const inTok = toks.find(
    (t) => t.start > nameTok.end && t.start < doTok.start && t.word === 'in' && t.constructDepth === 1
  );
  let list: string[] | null = null;
  if (inTok !== undefined) {
    list = toks.filter((t) => t.start > inTok.end && t.start < doTok.start).map((t) => t.word);
  }
  return { list, body: text.slice(doTok.end, doneTok.start), wholeInterior: text.slice(nameTok.end, doneTok.start) };
}

interface ParsedCase {
  subject: string;
  branches: { pattern: string; body: string }[];
  fallthrough: boolean;
}

function parseCase(text: string): ParsedCase | null {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  skipWs();
  const lead = readWordAt(text, i);
  if (lead === null || lead.word !== 'case') return null;
  i = lead.end;

  // The subject words up to the `in` at paren depth 0 (quote content only).
  let parenDepth = 0;
  const subjectWords: string[] = [];
  while (i < n) {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (c === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      i++;
      continue;
    }
    if (';&|<>'.includes(c)) {
      i++;
      continue;
    }
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    if (parenDepth === 0 && !w.quoted && w.word === 'in') break;
    subjectWords.push(w.word);
  }
  if (i >= n) return null;

  const branches: { pattern: string; body: string }[] = [];
  let fallthrough = false;
  while (true) {
    skipWs();
    if (i >= n) return null;
    const w = readWordAt(text, i);
    if (w !== null && !w.quoted && w.word === 'esac') {
      return { subject: subjectWords.join(' '), branches, fallthrough };
    }
    // The pattern: everything up to the `)` at paren depth 0.
    let patEnd = -1;
    {
      let p = i;
      let depth = 0;
      let inQuote: string | null = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === '\\' && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === '\\') {
          p += 2;
          continue;
        }
        if (ch === '(') {
          depth++;
          p++;
          continue;
        }
        if (ch === ')') {
          if (depth === 0) {
            patEnd = p;
            break;
          }
          depth--;
          p++;
          continue;
        }
        p++;
      }
    }
    if (patEnd === -1) return null;
    const pattern = text.slice(i, patEnd).trim();
    i = patEnd + 1;

    // The body: everything up to the `;;`/`;&`/`;;&` at paren/brace depth 0.
    let bodyEnd = -1;
    let term = '';
    {
      let p = i;
      let depth = 0;
      let bdepth = 0;
      let inQuote: string | null = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === '\\' && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === '\\') {
          p += 2;
          continue;
        }
        if (ch === '(') {
          depth++;
          p++;
          continue;
        }
        if (ch === ')') {
          depth = Math.max(0, depth - 1);
          p++;
          continue;
        }
        if (ch === '{') {
          bdepth++;
          p++;
          continue;
        }
        if (ch === '}') {
          bdepth = Math.max(0, bdepth - 1);
          p++;
          continue;
        }
        if (depth === 0 && bdepth === 0 && ch === ';') {
          const next = text[p + 1];
          if (next === ';' || next === '&') {
            term = next === ';' ? (text[p + 2] === '&' ? ';;&' : ';;') : ';&';
            bodyEnd = p;
            break;
          }
        }
        p++;
      }
    }
    if (term === '') return null;
    branches.push({ pattern, body: text.slice(i, bodyEnd).trim() });
    i = bodyEnd + term.length;
    if (term === ';&' || term === ';;&') fallthrough = true;
  }
}

/** Resolve a `case` subject against the recorded assignments (plan §1, decidable case). */
function resolveSubject(subject: string, assignments: Map<string, string>): string | null {
  const m = subject.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/) ?? subject.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (m !== null) {
    const v = assignments.get(m[1]);
    return v !== undefined ? v : null;
  }
  if (/[$`]/.test(subject)) return null;
  return subject;
}

/**
 * Alternative split of a `case` pattern on unquoted `|`. The alternatives are
 * returned verbatim — quotes and backslash escapes preserved — so
 * `analyzePattern`'s quote handling is the single interpreter: stripping them
 * here would turn `'a*'` into an unquoted glob and `\|` into a split point.
 */
function splitPatternAlternatives(pattern: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote: string | null = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === '\\' && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        cur += ch;
        cur += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < pattern.length) {
      cur += ch;
      cur += pattern[i + 1];
      i++;
      continue;
    }
    if (ch === '|') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/**
 * Quote-aware pattern analysis: the literal value (quotes stripped, backslash
 * escapes resolved) and whether any unquoted glob char appears.
 */
function analyzePattern(pattern: string): { literal: string; glob: boolean } {
  let literal = '';
  let glob = false;
  let inQuote: string | null = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === '\\' && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        literal += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        continue;
      }
      literal += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === '\\' && i + 1 < pattern.length) {
      literal += pattern[i + 1];
      i++;
      continue;
    }
    if ('*?['.includes(ch)) {
      glob = true;
      literal += ch;
      continue;
    }
    literal += ch;
  }
  return { literal, glob };
}

type PatternResult = 'match' | 'no-match' | 'glob' | 'undecidable';

/**
 * Fixture-pinned `case` pattern evaluation (plan §1, decidable case): a `|`
 * pattern is decidable iff its first alternative is a literal match and every
 * alternative after the first is a glob (dead); a glob before any literal
 * match is undecidable, and a later literal non-match after a literal match
 * is undecidable (the all-literal `a|b` fail-closed divergence — bash runs
 * the branch).
 */
function evalPattern(pattern: string, subject: string): PatternResult {
  const alts = splitPatternAlternatives(pattern);
  let matched = false;
  for (const alt of alts) {
    const { literal, glob } = analyzePattern(alt);
    if (glob) {
      if (!matched) return 'glob';
    } else if (literal === subject) {
      matched = true;
    } else if (matched) {
      return 'undecidable';
    }
  }
  return matched ? 'match' : 'no-match';
}

/** The execution walk's shared state, one instance per `parseCommandDetailed` call. */
class ExecutionWalker {
  chain: ChainStatus = 'success';
  errexit = false;
  pipefail = false;
  assignments = new Map<string, string>();
  defs = new Map<string, string>();
  dead: DeadKind | null = null;
  returned = false;
  fnDepth = 0;
  loopStack: LoopFrame[] = [];
  readonly expanded: ExpandedStage[] = [];
  readonly verdicts: ExecStatus[] = [];
  dirFrame = 0;
  readonly defProbeStack = new Set<string>();

  walkInput(stages: SimpleCommand[]): ExpandedStage[] {
    this.walkList(stages, { liveness: true, discard: false, sideEffects: true, inputFacing: true });
    return this.expanded;
  }

  private stopped(): boolean {
    if (this.dead !== null || this.returned) return true;
    const top = this.loopStack[this.loopStack.length - 1];
    return top !== undefined && (top.bodyTerminated || top.ambiguousStop);
  }

  /** Walk one list (a fresh `&&`/`||` chain); returns the list's final chain status. */
  private walkList(stages: SimpleCommand[], opts: WalkOptions): ChainStatus {
    const savedChain = this.chain;
    this.chain = 'success';
    let i = 0;
    while (i < stages.length && !this.stopped()) {
      const end = this.groupEnd(stages, i);
      const next = end < stages.length ? stages[end] : null;
      this.processGroup(stages.slice(i, end), next, opts);
      i = end;
    }
    const result = this.chain;
    while (i < stages.length) {
      if (opts.inputFacing) this.verdicts.push('no');
      i++;
    }
    this.chain = savedChain;
    return result;
  }

  private groupEnd(stages: SimpleCommand[], start: number): number {
    let end = start;
    while (end + 1 < stages.length && stages[end + 1].precededBy === 'pipe') end++;
    return end + 1;
  }

  private processGroup(group: SimpleCommand[], next: SimpleCommand | null, opts: WalkOptions): void {
    const first = group[0];
    let executes: boolean | 'unknown';
    switch (first.precededBy) {
      case 'and':
        executes = this.chain === 'success' ? true : this.chain === 'failure' ? false : 'unknown';
        break;
      case 'or':
        executes = this.chain === 'failure' ? true : this.chain === 'success' ? false : 'unknown';
        break;
      default:
        executes = true;
    }
    const exec: ExecStatus = executes === true ? 'yes' : executes === false ? 'no' : 'unknown';
    const backgrounded = first.precededBy === 'background' || (next !== null && next.precededBy === 'background');
    if (opts.inputFacing) {
      for (let i = 0; i < group.length; i++) this.verdicts.push(exec);
    }

    // `!` is a group-level modifier: the count of leading `!` words on the
    // first member's argv negates the group's final status (odd negates).
    const firstArgv = argvOf(first.text);
    let bangCount = 0;
    let memberArgv: string[] | null = firstArgv;
    if (firstArgv !== null) {
      while (memberArgv![bangCount] === '!') bangCount++;
      memberArgv = memberArgv!.slice(bangCount);
    }
    const inverted = bangCount % 2 === 1;

    if (exec === 'no') return;

    const statuses: ChainStatus[] = [];
    const inPipeline = group.length > 1;
    for (let m = 0; m < group.length; m++) {
      statuses.push(
        this.processMember(group[m], {
          exec,
          inPipeline,
          backgrounded,
          memberArgv: m === 0 ? memberArgv : null,
          opts
        })
      );
    }

    // The group status: the last member's, unless pipefail makes it the worst member.
    let groupStatus: ChainStatus;
    if (this.pipefail && group.length > 1) {
      if (statuses.every((s) => s === 'success')) groupStatus = 'success';
      else if (statuses.some((s) => s === 'failure')) groupStatus = 'failure';
      else groupStatus = 'unknown';
    } else {
      groupStatus = statuses[statuses.length - 1];
    }
    if (inverted) {
      groupStatus = groupStatus === 'success' ? 'failure' : groupStatus === 'failure' ? 'success' : 'unknown';
    }

    // Errexit liveness: an executing group whose non-exempt members did not
    // all succeed kills the shell; every later stage is 'no'.
    if (opts.liveness && this.errexit && groupStatus !== 'success') {
      const chainFinal = next === null || (next.precededBy !== 'and' && next.precededBy !== 'or');
      if (chainFinal && !inverted && !backgrounded) this.dead = 'errexit';
    }

    if (exec === 'yes') this.chain = groupStatus;
    else this.chain = 'unknown';
  }

  private processMember(
    member: SimpleCommand,
    ctx: {
      exec: ExecStatus;
      inPipeline: boolean;
      backgrounded: boolean;
      memberArgv: string[] | null;
      opts: WalkOptions;
    }
  ): ChainStatus {
    const kind = classifyStage(member.text);
    if (kind === 'plain') return this.processPlainMember(member, ctx);
    return this.processConstruct(member, kind, ctx);
  }

  private processPlainMember(
    member: SimpleCommand,
    ctx: {
      exec: ExecStatus;
      inPipeline: boolean;
      backgrounded: boolean;
      memberArgv: string[] | null;
      opts: WalkOptions;
    }
  ): ChainStatus {
    const { exec, inPipeline, backgrounded, memberArgv, opts } = ctx;
    const argv = memberArgv ?? argvOf(member.text);
    const stripped = argv === null ? null : walkStrip(argv);

    // Side effects only from executed, non-pipe stages.
    if (exec === 'yes' && !inPipeline && opts.sideEffects) {
      this.applySideEffects(member, argv, stripped);
    }

    // The known status.
    const status = this.knownStatus(argv);

    // The terminator: an executed or unknown-execution non-pipe stage whose
    // terminator word (bare, or behind `command`/`builtin`) is `exit`/`exec`.
    if (!inPipeline && exec !== 'no' && stripped !== null && (stripped[0] === 'exit' || stripped[0] === 'exec')) {
      this.dead = 'exit';
    }

    // Return-stopping: a provably-firing command-position `return` at
    // function-body depth exits the function — everything after never runs.
    if (!inPipeline && exec === 'yes' && this.fnDepth > 0 && stripped !== null && stripped[0] === 'return') {
      this.returned = true;
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== undefined) top.outcome = 'return';
    }

    // Break/continue events (a hidden `'unknown'`-exec one makes the guard
    // untouchable — ambiguous — per the loop-scan discipline).
    if (!inPipeline && exec !== 'no' && stripped !== null && (stripped[0] === 'break' || stripped[0] === 'continue')) {
      this.applyBreakContinue(stripped, exec);
    }

    // A call to a registered definition.
    if (exec !== 'no' && stripped !== null && stripped.length > 0) {
      this.applyCall(stripped[0], inPipeline, backgrounded);
    }

    if (!opts.discard) {
      this.expanded.push({
        text: member.text,
        precededBy: member.precededBy,
        exec,
        inPipeline,
        dirFrame: this.dirFrame
      });
    }
    return status;
  }

  private applyBreakContinue(stripped: string[], exec: ExecStatus): void {
    const depth = Number.parseInt(stripped[1] ?? '1', 10);
    if (Number.isNaN(depth) || depth < 1) return;
    if (this.loopStack.length === 0 || depth > this.loopStack.length) return;
    if (exec === 'unknown') {
      for (let d = 0; d < depth; d++) {
        const frame = this.loopStack[this.loopStack.length - 1 - d];
        if (frame.outcome === 'none') {
          frame.outcome = 'ambiguous';
          frame.ambiguousStop = true;
        }
      }
      return;
    }
    const isContinue = stripped[0] === 'continue';
    for (let d = 0; d < depth; d++) {
      const frame = this.loopStack[this.loopStack.length - 1 - d];
      frame.outcome = isContinue ? 'continue' : 'break';
      frame.bodyTerminated = true;
    }
  }

  /** A may-run call to a registered definition fires per its body's dead kind. */
  private applyCall(name: string, inPipeline: boolean, backgrounded: boolean): void {
    if (!this.defs.has(name) || backgrounded) return;
    if (this.defProbeStack.has(name)) return; // recursion: the inner call returns normally
    const body = this.defs.get(name)!;
    this.defProbeStack.add(name);
    const kind = this.defBodyFireKind(body);
    this.defProbeStack.delete(name);
    if (kind === null) return;
    if (kind === 'never-return') {
      this.dead = 'never-return';
    } else if (!inPipeline) {
      this.dead = kind;
    }
  }

  /** Whether a definition body, walked as its own function, ends dead. */
  private defBodyFireKind(body: string): DeadKind | null {
    const res = splitTopLevel(body);
    if (res.malformed !== undefined) return 'malformed';
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    this.dead = null;
    this.returned = false;
    this.fnDepth = this.fnDepth + 1;
    this.loopStack = [];
    this.walkList(res.stages, { liveness: true, discard: true, sideEffects: true, inputFacing: false });
    const kind = this.dead;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    return kind;
  }

  private knownStatus(argv: string[] | null): ChainStatus {
    if (argv === null || argv.length === 0) return 'success';
    const a = walkStrip(argv);
    if (a.length === 0) return 'success';
    if (a[0] === 'true' || a[0] === ':') return 'success';
    if (a[0] === 'false') return 'failure';
    if (a.every((w) => ASSIGNMENT_RE.test(w))) return 'success';
    if (a[0] === 'export' && a.length > 1 && a.slice(1).every((w) => ASSIGNMENT_RE.test(w))) return 'success';
    if (a[0] === 'set') return setFlagsKnown(a.slice(1)) ? 'success' : 'unknown';
    return 'unknown';
  }

  private applySideEffects(member: SimpleCommand, argv: string[] | null, stripped: string[] | null): void {
    if (argv === null || argv.length === 0) return;
    // Assignment recording (last definition wins, feeding case subjects).
    const words = splitWords(member.text);
    if (words !== null && words.length > 0) {
      let k = 0;
      while (k < words.length && ASSIGNMENT_RE.test(words[k])) k++;
      if (k === words.length) {
        for (const w of words) {
          const eq = w.indexOf('=');
          this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
        }
      } else if (words[0] === 'export') {
        for (const w of words.slice(1)) {
          if (ASSIGNMENT_RE.test(w)) {
            const eq = w.indexOf('=');
            this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
          }
        }
      }
    }
    if (stripped !== null && stripped[0] === 'set') this.applySetFlags(stripped.slice(1));
  }

  private applySetFlags(args: string[]): void {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--') continue;
      if (!(a.startsWith('-') || a.startsWith('+'))) continue;
      const on = a.startsWith('-');
      const chars = a.slice(1);
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === 'o') {
          const name = args[i + 1];
          if (name === undefined) return;
          if (name === 'errexit') this.errexit = on;
          else if (name === 'noerrexit') this.errexit = !on;
          else if (name === 'pipefail') this.pipefail = on;
          else if (name === 'nopipefail') this.pipefail = !on;
          i++;
          break;
        }
        if (c === 'e') this.errexit = on;
        // Every other recognized letter is a no-op for the walk.
      }
    }
  }

  private processConstruct(
    member: SimpleCommand,
    kind: ConstructKind,
    ctx: {
      exec: ExecStatus;
      inPipeline: boolean;
      backgrounded: boolean;
      memberArgv: string[] | null;
      opts: WalkOptions;
    }
  ): ChainStatus {
    const { exec, backgrounded, opts } = ctx;
    const discard = opts.discard || exec !== 'yes';
    const sideEffects = opts.sideEffects && exec === 'yes';

    switch (kind) {
      case 'if': {
        const parsed = parseIf(member.text);
        if (parsed === null) return 'unknown';
        const regions = [
          parsed.condition,
          parsed.thenBody,
          ...parsed.elifs.flatMap((e) => [e.condition, e.body]),
          ...(parsed.elseBody !== null ? [parsed.elseBody] : [])
        ];
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === 'unknown') return this.opaquePath(regions, ctx);
        if (condStatus === 'success') {
          return this.walkBranch(parsed.thenBody, discard, sideEffects);
        }
        for (const elif of parsed.elifs) {
          const eStatus = this.walkList(splitTopLevel(elif.condition).stages, {
            liveness: false,
            discard: true,
            sideEffects: true,
            inputFacing: false
          });
          if (eStatus === 'unknown') return this.opaquePath(regions, ctx);
          if (eStatus === 'success') return this.walkBranch(elif.body, discard, sideEffects);
        }
        if (parsed.elseBody !== null) return this.walkBranch(parsed.elseBody, discard, sideEffects);
        return 'success';
      }
      case 'while':
      case 'until': {
        const parsed = parseLoop(member.text, kind);
        if (parsed === null) return 'unknown';
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === 'unknown') return this.opaquePath([parsed.condition, parsed.body], ctx);
        const bodyRuns = kind === 'while' ? condStatus === 'success' : condStatus === 'failure';
        if (!bodyRuns) return 'success';
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== undefined) {
          this.dead = 'malformed';
          return 'unknown';
        }
        const frame: LoopFrame = { outcome: 'none', bodyTerminated: false, ambiguousStop: false };
        this.loopStack.push(frame);
        this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        this.loopStack.pop();
        switch (frame.outcome) {
          case 'break':
            return 'success';
          case 'continue':
          case 'none':
            if (this.dead === null && !backgrounded) this.dead = 'never-return';
            return 'unknown';
          case 'ambiguous':
          case 'return':
            return 'unknown';
        }
        return 'unknown';
      }
      case 'for': {
        const parsed = parseFor(member.text);
        if (parsed === null) return 'unknown';
        if (parsed.list === null || parsed.list.some((w) => /[$`]/.test(w))) {
          return this.opaquePath([parsed.wholeInterior], ctx);
        }
        if (parsed.list.length === 0) return 'success';
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== undefined) {
          this.dead = 'malformed';
          return 'unknown';
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case 'case': {
        const parsed = parseCase(member.text);
        if (parsed === null) return 'unknown';
        const regions = parsed.branches.map((b) => b.body);
        if (parsed.fallthrough || resolveSubject(parsed.subject, this.assignments) === null) {
          return this.opaquePath(regions, ctx);
        }
        const subject = resolveSubject(parsed.subject, this.assignments)!;
        let matchedBranch = -1;
        let undecidable = false;
        for (let b = 0; b < parsed.branches.length; b++) {
          const r = evalPattern(parsed.branches[b].pattern, subject);
          if (r === 'match') {
            matchedBranch = b;
            break;
          }
          if (r === 'glob' || r === 'undecidable') {
            undecidable = true;
            break;
          }
        }
        if (undecidable) return this.opaquePath(regions, ctx);
        if (matchedBranch !== -1) {
          return this.walkBranch(parsed.branches[matchedBranch].body, discard, sideEffects);
        }
        return 'success';
      }
      case 'select': {
        const parsed = parseLoop(member.text, 'while');
        return this.opaquePath(parsed !== null ? [parsed.body] : [], ctx);
      }
      case 'brace': {
        const interior = extractGroupBody(member.text, '{', '}');
        if (interior === null) return 'unknown';
        const res = splitTopLevel(interior);
        if (res.malformed !== undefined) {
          this.dead = 'malformed';
          return 'unknown';
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case 'subshell': {
        const interior = extractGroupBody(member.text, '(', ')');
        if (interior === null) return 'unknown';
        const res = splitTopLevel(interior);
        if (res.malformed !== undefined) {
          this.dead = 'malformed';
          return 'unknown';
        }
        const savedErrexit = this.errexit;
        const savedPipefail = this.pipefail;
        const savedAssignments = this.assignments;
        const savedDefs = this.defs;
        const savedReturned = this.returned;
        const savedFnDepth = this.fnDepth;
        const savedLoopStack = this.loopStack;
        const savedDirFrame = this.dirFrame;
        const savedDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = new Map(savedAssignments);
        this.defs = new Map(savedDefs);
        this.returned = false;
        this.fnDepth = 0;
        this.loopStack = [];
        this.dirFrame = savedDirFrame + 1;
        this.dead = null;
        const status = this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        const innerDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = savedAssignments;
        this.defs = savedDefs;
        this.returned = savedReturned;
        this.fnDepth = savedFnDepth;
        this.loopStack = savedLoopStack;
        this.dirFrame = savedDirFrame;
        this.dead = savedDead;
        // A subshell is a process boundary for the exit fire but not for the
        // never-return fire: the shell synchronously waits for the subshell.
        if (innerDead === 'never-return') this.dead = 'never-return';
        return status;
      }
      case 'def': {
        // The definition registers with the walk scope when executed.
        if (sideEffects) {
          const def = parseDef(member.text);
          if (def !== null) this.defs.set(def.name, def.body);
        }
        return 'success';
      }
    }
    return 'unknown';
  }

  private walkBranch(body: string, discard: boolean, sideEffects: boolean): ChainStatus {
    const res = splitTopLevel(body);
    if (res.malformed !== undefined) {
      this.dead = 'malformed';
      return 'unknown';
    }
    return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
  }

  /**
   * The opaque-construct treatment (plan §2): re-split each region and walk it
   * with the same machinery so an `exit`/`exec` that may have run, or a
   * never-exit loop, fires fail-closed; hidden break/continue words reach the
   * scanned loop as an ambiguous termination. State is snapshot-restored.
   */
  private opaquePath(
    regions: string[],
    ctx: { exec: ExecStatus; inPipeline: boolean; backgrounded: boolean; opts: WalkOptions }
  ): ChainStatus {
    const findings = this.scanOpaque(regions);
    if (findings.fire !== null) {
      if (findings.fire === 'never-return') {
        if (!ctx.backgrounded) this.dead = 'never-return';
      } else if (!ctx.inPipeline && !ctx.backgrounded) {
        this.dead = findings.fire;
      }
    }
    if (findings.breakTarget !== 'none') {
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== undefined) {
        top.outcome = 'ambiguous';
        top.ambiguousStop = true;
      }
    }
    return 'unknown';
  }

  private scanOpaque(regions: string[]): { fire: DeadKind | null; breakTarget: 'break' | 'continue' | 'none' } {
    const report: { fire: DeadKind | null; breakTarget: 'break' | 'continue' | 'none' } = {
      fire: null,
      breakTarget: 'none'
    };
    const savedChain = this.chain;
    const savedErrexit = this.errexit;
    const savedPipefail = this.pipefail;
    const savedAssignments = this.assignments;
    const savedDefs = this.defs;
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    const savedDirFrame = this.dirFrame;
    const savedVerdicts = this.verdicts.length;
    const savedExpanded = this.expanded.length;
    const savedDefProbe = new Set(this.defProbeStack);

    for (const region of regions) {
      const res = splitTopLevel(region);
      if (res.malformed !== undefined) {
        report.fire = 'malformed';
        break;
      }
      this.dead = null;
      this.returned = false;
      // Each region walks against a fresh copy of the enclosing loop frames so
      // its hidden break/continue events are reported, never applied.
      this.loopStack = savedLoopStack.map((f) => ({ ...f }));
      this.walkList(res.stages, { liveness: true, discard: true, sideEffects: false, inputFacing: false });
      if (this.dead !== null) {
        if (report.fire === null || this.dead === 'never-return' || this.dead === 'malformed') report.fire = this.dead;
      }
      if (report.breakTarget === 'none') {
        const innermost = this.loopStack[this.loopStack.length - 1];
        if (innermost !== undefined && (innermost.outcome === 'break' || innermost.outcome === 'continue')) {
          report.breakTarget = innermost.outcome;
        }
      }
    }

    this.chain = savedChain;
    this.errexit = savedErrexit;
    this.pipefail = savedPipefail;
    this.assignments = savedAssignments;
    this.defs = savedDefs;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    this.dirFrame = savedDirFrame;
    this.verdicts.length = savedVerdicts;
    this.expanded.length = savedExpanded;
    this.defProbeStack.clear();
    for (const name of savedDefProbe) this.defProbeStack.add(name);
    return report;
  }
}

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
// Heredoc writes (`cat > file <<EOF ... EOF`): handled as a dedicated raw-text
// pass because the body can itself contain &&/;/|/newlines that would
// otherwise confuse splitTopLevel. Matched spans are masked out of the string
// (replaced with an indexed placeholder simple-command) before the rest of
// the pipeline runs, and re-associated by index during the main walk so the
// write is resolved against the correct `cd`-tracked directory.
// ---------------------------------------------------------------------------

interface HeredocWrite {
  redirect: '>' | '>>';
  target: string;
  body: string;
}

const HEREDOC_OPEN =
  /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractHeredocWrites(raw: string): { writes: HeredocWrite[]; masked: string } {
  const writes: HeredocWrite[] = [];
  let masked = '';
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch: RegExpExecArray | null = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const openEnd = openMatch.index + openMatch[0].length;
    if (!delim || openMatch.index < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    // The body region starts right after the delimiter line's newline. An
    // absent newline (input ends at the delimiter, or `&&`/`;` continues the
    // line) is a same-line unterminated heredoc with an empty body — the `>`
    // redirect still truncates the file, and the continuation stays commands.
    const nl = raw.slice(openEnd).match(/^[ \t]*\r?\n/);
    const bodyStart = nl !== null ? openEnd + nl[0].length : openEnd;
    const remainder = raw.slice(bodyStart);
    const closeRe = new RegExp(`^${dash ? '\\t*' : ''}${escapeRegExp(delim)}[ \\t]*$`, 'm');
    const closeMatch = closeRe.exec(remainder);
    let body: string;
    let matchEnd: number;
    if (closeMatch) {
      body = remainder.slice(0, closeMatch.index).replace(/\n$/, '');
      matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    } else if (nl === null) {
      body = '';
      matchEnd = openEnd;
    } else {
      // Unterminated with a body region: the data region runs to EOF.
      body = remainder.replace(/\n$/, '');
      matchEnd = raw.length;
    }

    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect: redirect as '>' | '>>', target, body });

    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const LINE_SELECTORS = [matchSed, matchHead, matchTail];

export function parseCommandDetailed(command: string, opts: ParseOptions = {}): SpanMatch[] {
  const cwd = opts.cwd ?? process.cwd();
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const { stages: simpleCommands, malformed } = splitTopLevel(masked);

  // Verdict consumption (plan §1, list-scope + terminal semantics): the
  // splitter has already dropped the rejecting list's stages and truncated at
  // the first malformed list, so `simpleCommands` is exactly the completed
  // earlier lists and walks normally below — the full-line kinds
  // ('unclosed-quote', 'unbalanced-paren', 'dangling-operator', 'pipe-bang',
  // 'unclosed-brace', 'unclosed-case', 'unclosed-construct') emit no touches
  // without further handling. 'unterminated-heredoc' (the partial, arriving
  // with the heredoc machinery in a later phase) keeps the current behavior:
  // its stage list runs through the delimiter's line and likewise analyzes
  // as-is.
  void malformed;

  // The execution walk (plan §2) decides which stages ran and expands the
  // decidable construct interiors in their place. Only `'yes'` stages emit.
  const expanded = new ExecutionWalker().walkInput(simpleCommands);

  const results: SpanMatch[] = [];
  const fsLineCache = new Map<string, number | null>();
  const gitLineCache = new Map<string, number | null>();

  const cachedFsTotalLines = (absPath: string) => () => {
    if (!fsLineCache.has(absPath)) fsLineCache.set(absPath, countFileLines(absPath));
    return fsLineCache.get(absPath) ?? null;
  };
  const cachedGitTotalLines = (gitCwd: string, rev: string, path: string) => () => {
    const key = `${gitCwd}\u0000${rev}\u0000${path}`;
    if (!gitLineCache.has(key)) gitLineCache.set(key, countGitBlobLines(gitCwd, rev, path));
    return gitLineCache.get(key) ?? null;
  };

  // `cd` frames: the walk assigns each stage the subshell frame it ran in; a
  // subshell's `cd` re-bases within its fresh frame, discarded at the close.
  const dirFrames: string[] = [cwd];
  let lastPlainFileSource: string | null = null;
  let pendingSource: { fileArg: string; dir: string; idiom: 'cat-file' | 'nl-file' } | null = null;

  const wholeFileCandidate = (s: { fileArg: string; idiom: 'cat-file' | 'nl-file' }): RawCandidate => ({
    kind: 'candidate',
    idiom: s.idiom,
    fileArg: s.fileArg,
    spec: { kind: 'toEof', start: 1 },
    resolverKind: 'fs'
  });

  const emitCandidate = (c: RawCandidate, dirForResolution: string) => {
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
      span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
    });
  };

  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i];
    while (dirFrames.length > item.dirFrame + 1) dirFrames.pop();
    while (dirFrames.length < item.dirFrame + 1) dirFrames.push(dirFrames[dirFrames.length - 1]);
    const currentDir = dirFrames[dirFrames.length - 1];

    if (item.exec !== 'yes') {
      // A dead or unknown stage never runs — no touch, no side effects.
      if (pendingSource !== null) {
        emitCandidate(wholeFileCandidate(pendingSource), pendingSource.dir);
        pendingSource = null;
      }
      continue;
    }

    const heredocRef = item.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      lastPlainFileSource = null;
      if (pendingSource !== null) {
        emitCandidate(wholeFileCandidate(pendingSource), pendingSource.dir);
        pendingSource = null;
      }
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      if (looksUnresolvable(w.target)) {
        results.push({
          status: 'unresolved',
          idiom: 'heredoc-write',
          fileArg: w.target,
          reason: 'path contains an unexpanded shell variable or glob'
        });
        continue;
      }
      const absolutePath = resolvePath(currentDir, w.target);
      const bodyLines = w.body.length === 0 ? 0 : w.body.split('\n').length;
      if (bodyLines === 0) {
        // `cat > f <<'EOF'` with an empty body truncates the file to empty — a
        // real write that must produce a touch (whole-file, via `body: ''`).
        // `>>` with an empty body appends nothing and is a genuine no-op.
        if (w.redirect !== '>') continue;
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span: { lineStart: 1, lineEnd: 1, absolutePath, body: '', redirect: w.redirect }
        });
        continue;
      }
      const spec: LineRangeSpec =
        w.redirect === '>' ? { kind: 'literal', start: 1, end: bodyLines } : { kind: 'appendLines', count: bodyLines };
      const range = resolveSpec(spec, cachedFsTotalLines(absolutePath));
      if (range === null) {
        results.push({
          status: 'unresolved',
          idiom: 'heredoc-write',
          fileArg: absolutePath,
          reason: 'append target: could not read existing file to find its current length'
        });
      } else {
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath, body: w.body, redirect: w.redirect }
        });
      }
      continue;
    }

    const argv = stripForEmission(argvOf(item.text) ?? []);
    if (argv.length === 0) {
      lastPlainFileSource = null;
      continue;
    }

    // A `cd` only re-bases when it executed and is not in pipe position.
    if (argv[0] === 'cd' && !item.inPipeline) {
      lastPlainFileSource = null;
      const target = argv[1];
      if (target !== undefined && target !== '-' && !hasShellExpansion(target)) {
        dirFrames[dirFrames.length - 1] = resolvePath(currentDir, target);
      }
      continue;
    }

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
          emitCandidate(outcome, outcome.dirOverride ?? currentDir);
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

    if (!matched && item.precededBy === 'pipe' && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          matched = true;
          if (outcome.kind === 'candidate') emitCandidate(outcome, currentDir);
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

    // The deferred whole-file read of a pipe source: a source whose next
    // expanded stage is a pipe member holds its whole-file emission until the
    // consumer runs — a narrowing consumer's range stands instead, an
    // unrecognized pipeline-final consumer gets the conservative whole-file
    // read (never nothing). A middle consumer (itself piped on) stays
    // source-only, matching the one-hop propagation rule.
    if (pendingSource !== null) {
      const pipeFinal = expanded[i + 1] === undefined || expanded[i + 1].precededBy !== 'pipe';
      if (item.precededBy === 'pipe' && !matched && pipeFinal) {
        emitCandidate(wholeFileCandidate(pendingSource), pendingSource.dir);
      }
      pendingSource = null;
    }

    // A bare `cat file`/`nl file` that is not feeding a downstream pipe stage
    // reads the whole file: emit the same whole-file span `git show rev:path`
    // produces. When a pipe follows, the downstream line-selector already
    // emits the precise range, so the source stays source-only.
    if (plainFileArg !== null) {
      const next = expanded[i + 1];
      if (next === undefined || next.precededBy !== 'pipe') {
        emitCandidate(
          wholeFileCandidate({ fileArg: plainFileArg, idiom: argv[0] === 'cat' ? 'cat-file' : 'nl-file' }),
          currentDir
        );
      } else {
        pendingSource = { fileArg: plainFileArg, dir: currentDir, idiom: argv[0] === 'cat' ? 'cat-file' : 'nl-file' };
      }
    }

    if (!isPlainSource) lastPlainFileSource = null;
  }

  if (pendingSource !== null) {
    emitCandidate(wholeFileCandidate(pendingSource), pendingSource.dir);
  }

  return results;
}

/** Parses a Bash `command` string into the file+line-range spans it statically, reliably reads or writes. Pass `opts.cwd` (defaults to `process.cwd()`) for correct resolution of relative paths and `cd`/`git -C` targets, and of `git show`/`git log -L` revisions; `opts.env`/`opts.allowlist` feed the Phase 3 allowlisted variable resolution. */
export function parseCommand(command: string, opts: ParseOptions = {}): ResolvedSpan[] {
  const detailed = parseCommandDetailed(command, opts);
  const spans: ResolvedSpan[] = [];
  for (const m of detailed) {
    if (m.status === 'resolved') spans.push(m.span);
  }
  return spans;
}
