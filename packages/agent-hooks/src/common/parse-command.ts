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
 * concern), and `find <dir> -name/-path ... -delete` (the deleted paths are
 * the directory's contents as the finder walks it — data-dependent, not
 * statically enumerable; the recursive-removal fail-closed rule applies).
 *
 * The card's write-touch families — redirections and heredocs (§5.1–§5.2),
 * cp and install (§5.3), mv and git mv (§5.4), rm and truncate (§5.5),
 * sed -i (§5.6), patch and git apply (§5.7), formatter write flags (§5.8),
 * and git restore/checkout pathspecs (§5.9) — are the grammars below. Each
 * family fails closed on what it cannot statically attribute:
 * shell-expanded or dynamic content, recursive removal (`rm -r`),
 * here-strings (`<<<`), directory-shaped targets, wrapper-wrapped commands
 * whose argv cannot be recovered, and unmatched pathspecs emit no span at
 * all or an explicit unresolved entry — never a guessed write.
 *
 * The grep family (grep -n/-A/-B/-C) is not classified here either: its
 * window is anchored to match position, which is data-dependent and lives in
 * the response, not the command text. Those spans are response-derived —
 * `parseResponse` in ./parse-response.js reads them out of the command's
 * `tool_response`. The `git log -L` / `git show rev:path` idioms below remain
 * command-text-derived.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join as joinPath, resolve as resolvePath } from 'node:path';
import { countFileLines, countGitBlobLines } from './command-resolve.js';
import {
  argvOf,
  type Operator,
  type SimpleCommand,
  splitTopLevel,
  splitWords,
  stripLeadingAssignments,
  stripRedirects,
  stripWrappers,
  type Token,
  tokenize
} from './shell-split.js';
import { type PathStrip, parseUnifiedDiffRange } from './unified-diff.js';

/**
 * The explicit operation kind of a resolved span. The adapters translate from
 * this, never from `idiom === 'heredoc-write'`-style checks (plan §1).
 */
export type Operation =
  | 'read' // read idioms; cp/install source operands
  | 'create-overwrite' // truncating content writes: > redirects, tee, heredoc >, cp/mv dest, restore/checkout, patch add
  | 'append' // >> redirects, tee -a, heredoc >>
  | 'modify' // in-place edits with unknown content: sed -i, patch hunks, formatter write flags
  | 'rename-copy' // mv/git mv/patch-rename destination (whole-file write, same touch as create-overwrite)
  | 'truncate' // : > f, bare > f, truncate
  | 'delete'; // rm, mv/git mv source, patch delete

export interface ResolvedSpan {
  operation: Operation;
  absolutePath: string;
  /**
   * Exact range: every read; modify operations with a statically known range
   * (sed -i numeric addresses, patch hunk unions). Absent for writes →
   * whole-file scope.
   */
  lineStart?: number;
  lineEnd?: number;
  /**
   * Statically known written content — append bodies and literal overwrite
   * bodies (heredoc/echo/printf/tee literals, plan §3 step 1b). On appends it
   * is the suffix gate's body; on `create-overwrite` it is the exact gate's
   * post-content — the touch itself stays whole-file (`written: ''`) either
   * way.
   */
  written?: string;
  /**
   * Exact expected post-command bytes for a range-scoped in-place edit.
   * Layered static recognizers populate this from ephemeral pre-state so a
   * completed substitution remains decisive even when a later command makes
   * the compound exit nonzero.
   */
  expectedContent?: string;
  /**
   * PreToolUse proved that a delete target was index-tracked before an
   * index-changing command removed it. PostToolUse carries only this boolean
   * proof; it never reconstructs eligibility from a missing post-state path.
   */
  preTrackedDelete?: true;
  /**
   * The statically evaluated absolute `truncate -s N` size (plan §5.5): the
   * §3 `size` gate's post-command byte count (`-s 0` → the empty gate).
   * Absent for relative sizes (`-s +N`/`-s -N`), `-r ref`, and every other
   * operation — those gate existence-only.
   */
  size?: number;
  /**
   * Ordinal of the span's simple command within the compound, in walker
   * order; groups the spans of one command for join gating (plan §3 step 2).
   */
  simpleCommandIndex: number;
  /**
   * The operator preceding the span's simple command; only `'&&'`/`'||'` gate.
   * Absent for `start`/`;`/newline/`&`/`|` boundaries.
   */
  join?: '&&' | '||';
  note?: string;
}

export type Idiom =
  | 'sed-n-range'
  | 'head-file'
  | 'tail-file'
  | 'cat-file'
  | 'nl-file'
  | 'git-show-rev-path'
  | 'git-log-L'
  | 'heredoc-write'
  // The write-touch families (plan §5). Idiom stays match metadata for tests
  // and unresolved reasons; adapter behavior keys on `operation`, never idiom.
  | 'redirect-write' // §5.1: echo/printf/tee content redirects
  | 'truncate-write' // §5.1: bare `> f` / `: > f` truncations
  | 'cp-write' // §5.3
  | 'install-write' // §5.3
  | 'mv-write' // §5.4: mv and git mv
  | 'rm-write' // §5.5: rm and git rm
  | 'truncate-command' // §5.5: the truncate command
  | 'sed-inplace' // §5.6: sed -i
  | 'patch-write' // §5.7: patch and git apply
  | 'formatter-write' // §5.8
  | 'git-restore-write' // §5.9: git restore pathspecs
  | 'git-checkout-write'; // §5.9: git checkout -- pathspecs

export type SpanMatch =
  | { status: 'resolved'; idiom: Idiom; span: ResolvedSpan; note?: string }
  | { status: 'unresolved'; idiom: Idiom; fileArg: string; reason: string }
  | {
      /**
       * A span-less command with a deterministic exit status — `false` (1),
       * `true` (0), `:` (0). No span and no touch, but the join driver needs
       * the verdict: `false && echo x > f` skips the echo, `true || echo x >
       * f` skips it too, and without the guard both would fire an exact-gate
       * touch for a write that never ran (plan §3 step 2's span-less-guard
       * rule). Filtered out of `parseCommand`'s span list with the
       * unresolveds.
       */
      status: 'builtin-guard';
      simpleCommandIndex: number;
      join: ResolvedSpan['join'];
      exitStatus: 0 | 1;
    };

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
  /** The script variable table as of this stage (plan §7): the executed non-pipe assignments seen so far, in order. */
  assignments: ReadonlyMap<string, string>;
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
        dirFrame: this.dirFrame,
        assignments: new Map(this.assignments)
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
    // Redirects and transparent wrappers are stripped before status evaluation
    // (plan §4/§5): `env FOO=1 true` and `timeout 5 true` are known successes,
    // `true > out` keeps its success, and a fail-closed wrapper (`env -i …`)
    // stays unknown.
    const a = walkStrip(stripWrappers(stripRedirects(argv)));
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
    // Table lifecycle (plan §7): an executed non-pipe `unset NAME` deletes the
    // entry, so `X=/a; unset X; cat $X/f` stays unresolved instead of
    // resurrecting the stale value. `export NAME` without a value is a no-op
    // for the table (bash keeps the value, just marks it exported).
    if (stripped !== null && stripped[0] === 'unset') {
      for (const w of stripped.slice(1)) {
        if (!w.startsWith('-')) this.assignments.delete(w);
      }
    }
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

/**
 * Parse `head`/`tail` flags and file args. A bare `+N` is a from-N count only
 * for `tail` (`tail +5 f` starts at line 5); GNU `head` treats bare `+N` as a
 * *file* (coreutils 9.7 — probe: `head +5 f` errors "cannot open '+5'" and
 * reads f's first 10 lines), so `barePlusIsCount` is false for head and the
 * word falls through to the file list.
 */
function parseHeadTailFlags(
  rest: string[],
  barePlusIsCount: boolean
): {
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
      if (barePlusIsCount) {
        fromStart = true;
        count = Number.parseInt(a.slice(1), 10);
      } else {
        files.push(a);
      }
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
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1), false);
  if (disqualified) return [];
  // Bare `+N` is a GNU-head file artifact, never a real read — drop it.
  const realFiles = files.filter((f) => f !== '-' && !/^\+\d+$/.test(f));
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
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), true);
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
  if (sub?.subcommand !== 'show') return [];
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
  if (sub?.subcommand !== 'log') return [];
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
// Heredoc writes (plan §5.2): handled as a dedicated raw-text pass because the
// body can itself contain &&/;/|/newlines that would otherwise confuse
// splitTopLevel. The opener scanner is quote-aware and validates the closing
// delimiter; matched heredocs are masked out of the string (replaced with an
// indexed placeholder simple-command) before the rest of the pipeline runs,
// and re-associated by index during the main walk so the write is resolved
// against the correct `cd`-tracked directory.
// ---------------------------------------------------------------------------

/** The heredoc's content-carrying facts, re-associated by index during the walk. */
interface HeredocWrite {
  /** The opener line verbatim (e.g. `cat > f <<'EOF'`), re-tokenized during the walk. */
  opener: string;
  /** The heredoc body; `<<-` bodies have leading tabs stripped per line. */
  body: string;
  /** Whether the delimiter was quoted/escaped (`<<'EOF'`, `<<"EOF"`, `<<\EOF`): the body then undergoes no shell expansion. */
  quotedDelim: boolean;
}

interface HeredocOpener {
  /** Where the heredoc's simple command starts in the raw string. */
  cmdStart: number;
  /** The newline ending the opener line, or raw.length when it's the last line. */
  openerLineEnd: number;
  /** The closing delimiter (quotes stripped). */
  delim: string;
  /** `<<-`: strip leading tabs from the body and the closer line. */
  tabStrip: boolean;
  /** Whether the delimiter was quoted/escaped — the shell skips body expansion then. */
  quotedDelim: boolean;
}

const BARE_DELIM = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Find the next heredoc opener (`<<`/`<<-`) at top level, scanning from
 * `from`. Mirrors splitTopLevel's separator handling so `cmdStart` marks the
 * opener's own simple command: top-level `&&`/`||`/`;`/newline/`&` start a new
 * command (a newline after a pipe is a line continuation), `>`-redirects, dup
 * redirects (`2>&1`) and paren nesting stay inside the command, and
 * here-strings (`<<<`) are out of scope. An IO_NUMBER fd directly before the
 * operator (`2<<EOF`) redirects that fd, not stdin — not a heredoc. Returns
 * null when no opener is found.
 */
function findHeredocOpener(raw: string, from: number): HeredocOpener | null {
  const n = raw.length;
  let inSquote = false;
  let inDquote = false;
  let depth = 0;
  let cmdStart = from;
  let pendingPipe = false;
  let i = from;

  /** Read one delimiter word starting at `start` (the attached tail of `<<EOF`/`<<'EOF'`, or a standalone next word). Quotes contribute their content; a backslash escapes the next char. Returns null on an unbalanced quote (fail closed). */
  const readDelimWord = (start: number): { delim: string; sawQuote: boolean; next: number } | null => {
    let d = '';
    let sawQuote = false;
    let k = start;
    while (k < n && !/\s/.test(raw[k]) && raw[k] !== '<' && raw[k] !== '>') {
      const c = raw[k];
      if (c === "'" || c === '"') {
        const quote = c;
        let m = k + 1;
        while (m < n && raw[m] !== quote) {
          d += raw[m];
          m += 1;
        }
        if (m >= n) return null;
        sawQuote = true;
        k = m + 1;
        continue;
      }
      if (c === '\\' && k + 1 < n) {
        // A backslash-escaped delimiter char quotes the delimiter — the body
        // is literal (`<<\EOF`), same as quotes.
        d += raw[k + 1];
        sawQuote = true;
        k += 2;
        continue;
      }
      d += c;
      k += 1;
    }
    return { delim: d, sawQuote, next: k };
  };

  while (i < n) {
    const c = raw[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      if (c === '\\' && i + 1 < n) {
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      i += 1;
      continue;
    }
    if (c === '\\' && i + 1 < n) {
      i += 2;
      continue;
    }
    if (c === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (raw.startsWith('&&', i) || raw.startsWith('||', i)) {
      cmdStart = i + 2;
      pendingPipe = false;
      i += 2;
      continue;
    }
    if (raw.startsWith('|&', i)) {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 2;
      continue;
    }
    if (c === ';') {
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === '|') {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 1;
      continue;
    }
    if (c === '\n') {
      // A newline after a pipe is a line continuation (mirroring
      // splitTopLevel); anything else starts a new simple command.
      if (!pendingPipe) cmdStart = i + 1;
      i += 1;
      continue;
    }
    if (c === '&') {
      // `&>`/`&>>` and dup redirects (`2>&1`) are redirect operators, not
      // command separators (mirroring splitTopLevel).
      const trimmed = raw.slice(cmdStart, i).trimEnd();
      const dupRedirect =
        trimmed.endsWith('>') && (trimmed.length === 1 || /\s|\d/.test(trimmed[trimmed.length - 2] ?? ''));
      if (raw[i + 1] === '>' || dupRedirect) {
        i += 1;
        continue;
      }
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === '<' && raw[i + 1] === '<') {
      // `<<<` is a here-string (out of scope); `<<-` strips leading tabs.
      if (raw[i + 2] === '<') {
        i += 3;
        continue;
      }
      let j = i - 1;
      while (j >= from && /\d/.test(raw[j])) j -= 1;
      const ioNumber = j < i - 1 && (j < from || /\s|[;|&(]/.test(raw[j]));
      if (ioNumber) {
        i += 2;
        continue;
      }
      const tabStrip = raw[i + 2] === '-';
      const opLen = tabStrip ? 3 : 2;
      const lineEnd = raw.indexOf('\n', i);
      const openerLineEnd = lineEnd === -1 ? n : lineEnd;
      const attached = readDelimWord(i + opLen);
      let delim = attached === null ? '' : attached.delim;
      let sawQuote = attached === null ? false : attached.sawQuote;
      if (delim === '' && attached !== null) {
        // Standalone operator: the delimiter is the next word.
        let k = attached.next;
        while (k < openerLineEnd && /\s/.test(raw[k])) k += 1;
        const word = readDelimWord(k);
        if (word === null) delim = '';
        else {
          delim = word.delim;
          sawQuote = word.sawQuote;
        }
      }
      if (delim === '' || (!sawQuote && !BARE_DELIM.test(delim))) {
        // No delimiter, or a bare form outside the identifier shape — fail
        // closed and keep scanning past the operator.
        i += opLen;
        continue;
      }
      return { cmdStart, openerLineEnd, delim, tabStrip, quotedDelim: sawQuote };
    }
    i += 1;
  }
  return null;
}

/**
 * The body of an opener runs from after the opener line's newline to the line
 * that is exactly the delimiter (`<<`), or its leading-tab-stripped form
 * (`<<-`), trailing whitespace allowed. Returns the closer's line bounds, or
 * null when no closer exists (fail closed).
 */
function heredocCloser(raw: string, open: HeredocOpener): { lineStart: number; lineEnd: number } | null {
  const n = raw.length;
  const bodyStart = open.openerLineEnd < n ? open.openerLineEnd + 1 : n;
  let linePos = bodyStart;
  while (linePos < n) {
    const nl = raw.indexOf('\n', linePos);
    const lineEnd = nl === -1 ? n : nl;
    const candidate = open.tabStrip ? raw.slice(linePos, lineEnd).replace(/^\t+/, '') : raw.slice(linePos, lineEnd);
    if (
      candidate === open.delim ||
      (candidate.startsWith(open.delim) && /^[ \t]*$/.test(candidate.slice(open.delim.length)))
    ) {
      return { lineStart: linePos, lineEnd };
    }
    if (nl === -1) return null;
    linePos = nl + 1;
  }
  return null;
}

/**
 * Mask every heredoc out of the raw command string, returning the bodies and
 * openers for re-association by index. The mask covers
 * `[cmdStart, closerLineEnd)` — the opener line through the closer line, the
 * closer's newline excluded — so a command joined before the opener
 * (`cmd1 && cat <<EOF`) keeps its structure, and the placeholder stands alone
 * as its own simple command. A heredoc without a closer fails closed: its
 * opener line stays unmasked and scanning resumes after it.
 */
function extractHeredocWrites(raw: string): { writes: HeredocWrite[]; masked: string } {
  const writes: HeredocWrite[] = [];
  let masked = '';
  let cursor = 0;
  for (;;) {
    const open = findHeredocOpener(raw, cursor);
    if (open === null) break;
    const close = heredocCloser(raw, open);
    if (close === null) {
      cursor = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
      continue;
    }
    const bodyStart = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
    let body = raw.slice(bodyStart, close.lineStart).replace(/\n$/, '');
    if (open.tabStrip) body = body.replace(/^\t+/gm, '');
    masked += raw.slice(cursor, open.cmdStart);
    masked += `__heredoc_${writes.length}__`;
    writes.push({ opener: raw.slice(open.cmdStart, open.openerLineEnd), body, quotedDelim: open.quotedDelim });
    cursor = close.lineEnd;
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}

// ---------------------------------------------------------------------------
// Redirect-token analysis and the write-touch grammars (plan §5.1, §5.2).
// ---------------------------------------------------------------------------

interface RedirectInfo {
  /** IO_NUMBER fd (`1>`/`2>`), or null when implicit. */
  fd: number | null;
  /** The operator. */
  op: '>' | '>>' | '&>' | '&>>' | '>&' | '<' | '<<' | '<<-' | '<<<';
  /** Attached target text, or null for a standalone operator (target = next token). */
  target: string | null;
}

const REDIRECT_TOKEN = /^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/;

function classifyRedirectToken(text: string): RedirectInfo | null {
  const m = text.match(REDIRECT_TOKEN);
  if (m === null) return null;
  const [, fdText, op, target] = m;
  return {
    fd: fdText === '' ? null : Number.parseInt(fdText, 10),
    op: op as RedirectInfo['op'],
    target: target === '' ? null : target
  };
}

/**
 * A content-producing redirect (plan §5.1): fd-1 `>`/`>>` (explicit `1>`/`1>>`
 * included) and `&>`/`&>>`. FD-numbered (`2>`), dup (`2>&1`, `>&f`),
 * `&`-leading-target dup (`>&`) and stdin (`<`) forms never produce content.
 */
function isContentRedirect(r: RedirectInfo): boolean {
  if (r.op === '>' || r.op === '>>') {
    if (r.fd !== null && r.fd !== 1) return false;
    if (r.target?.startsWith('&')) return false;
    return true;
  }
  return r.op === '&>' || r.op === '&>>';
}

/** The argv stream and redirect list of a simple command (plan §5.10): words minus redirect tokens and their targets. */
function analyzeTokens(tokens: Token[]): { argv: string[]; redirects: RedirectInfo[] } {
  const argv: string[] = [];
  const redirects: RedirectInfo[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    const info = classifyRedirectToken(token.text);
    if (info === null) {
      argv.push(token.text);
      continue;
    }
    if (info.target === null) {
      // A standalone operator consumes the next token as its target (or
      // heredoc delimiter / here-string content) — attached to the redirect
      // so the write grammars see it, and excluded from argv.
      const next = tokens[i + 1];
      if (next !== undefined && !next.isRedirect) {
        redirects.push({ ...info, target: next.text });
        i += 1;
        continue;
      }
    }
    redirects.push(info);
  }
  return { argv, redirects };
}

/**
 * Literal `echo`/`printf` content (plan §5.1) for body threading: no
 * flags, no shell expansion, no globs; `printf` only when the format has no
 * `%`/backslash directives (then the format itself is the literal content).
 * Threaded on appends as the suffix gate's body and on single plain `>`
 * overwrites (and tee operands with a one-hop literal pipe source) as the
 * exact gate's post-content.
 */
function literalContent(argv: string[]): string | undefined {
  const host = argv[0];
  if (host !== 'echo' && host !== 'printf') return undefined;
  const args = argv.slice(1);
  if (args.length === 0) return undefined;
  for (const a of args) {
    if (a.startsWith('-') || hasShellExpansion(a) || /[*?]/.test(a)) return undefined;
  }
  if (host === 'printf') {
    if (args.length !== 1) return undefined;
    const fmt = args[0];
    if (fmt.includes('%') || fmt.includes('\\')) return undefined;
    return fmt;
  }
  return `${args.join(' ')}\n`;
}

/**
 * Resolve a redirect target against the current directory, emitting the
 * unresolved verdict (the read idioms' reason) when the path carries an
 * unexpanded shell variable or glob. Returns the absolute path, or null.
 */
function resolveTarget(results: SpanMatch[], idiom: Idiom, target: string, currentDir: string): string | null {
  if (looksUnresolvable(target)) {
    results.push({
      status: 'unresolved',
      idiom,
      fileArg: target,
      reason: 'path contains an unexpanded shell variable or glob'
    });
    return null;
  }
  return resolvePath(currentDir, target);
}

/** The `tee` operand grammar: append mode and operand list; unknown options return null (fail closed). */
function teeOperandParts(argv: string[]): { append: boolean; operands: string[] } | null {
  let append = false;
  let afterDashDash = false;
  const operands: string[] = [];
  for (const a of argv.slice(1)) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-a' || a === '--append') {
      append = true;
      continue;
    }
    if (a.startsWith('-')) return null;
    operands.push(a);
  }
  return { append, operands };
}

/**
 * The `tee` operand writes (plan §5.1): each operand is a whole-file
 * create-overwrite (truncating), or a whole-file append under `-a`/`--append`.
 * A one-hop literal echo/printf pipe source (`echo x | tee f`, `printf y |
 * tee -a f`, plan §5.2) threads as the written body — the exact gate's
 * post-content on the truncating write, the suffix gate's body on the append;
 * without a known source neither op carries written content.
 */
function matchTeeOperands(
  argv: string[],
  pipeEchoContent: string | null,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const parts = teeOperandParts(argv);
  if (parts === null) return;
  for (const operand of parts.operands) {
    const absolutePath = resolveTarget(results, 'redirect-write', operand, currentDir);
    if (absolutePath === null) continue;
    results.push({
      status: 'resolved',
      idiom: 'redirect-write',
      span: !parts.append
        ? {
            operation: 'create-overwrite',
            absolutePath,
            simpleCommandIndex,
            join,
            ...(pipeEchoContent !== null ? { written: pipeEchoContent } : {})
          }
        : {
            operation: 'append',
            absolutePath,
            simpleCommandIndex,
            join,
            ...(pipeEchoContent !== null ? { written: pipeEchoContent } : {})
          }
    });
  }
}

/**
 * The redirect family grammar (plan §5.1), run for every simple command after
 * the read matchers: content-producing redirects on `echo`/`printf`/`tee`
 * write whole-file; a bare `> f` / `: > f` truncates (the main walk hands
 * argv-empty commands directly here); `>>`-only truncation forms append
 * nothing and touch nothing. Any other host with a content redirect (`ls > f`,
 * `python3 x.py > out`, `cat f > g`) gets no write touch — the redirect is
 * real, but its content is dynamic and out of scope.
 *
 * Body threading: exactly one plain `>>` (or `1>>`) content redirect on a
 * fully literal `echo`/`printf` threads the written body (the suffix gate),
 * and exactly one plain `>` (or `1>`) content redirect on the same literals
 * threads it as the exact gate's post-content (plan §3 step 1b — the
 * content layer is what suppresses `echo hi > read-only-file`, where the
 * file stays present but unchanged). `&>`/`&>>`, multi-redirect commands,
 * and `tee`'s own redirects never thread.
 */
function matchRedirectFamily(
  argv: string[],
  redirects: RedirectInfo[],
  pipeEchoContent: string | null,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === 'tee') matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join, results);
    return;
  }
  if (host === undefined || host === ':' || host === 'exec') {
    // Bare `> f`, `: > f` and `exec > f` truncate (exec applies the redirect
    // to the shell's own fd 1 immediately — the fd-1 target is static, so the
    // truncation happens even though the command never writes);
    // `>>`/`&>>` append nothing → no touch.
    for (const r of contentRedirects) {
      if (r.op === '>>' || r.op === '&>>' || r.target === null) continue;
      const absolutePath = resolveTarget(results, 'truncate-write', r.target, currentDir);
      if (absolutePath === null) continue;
      results.push({
        status: 'resolved',
        idiom: 'truncate-write',
        span: { operation: 'truncate', absolutePath, simpleCommandIndex, join }
      });
    }
    return;
  }
  if (host !== 'echo' && host !== 'printf' && host !== 'tee') return;
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === '>>';
  const singlePlainOverwrite = contentRedirects.length === 1 && contentRedirects[0].op === '>';
  const threadedAppend = singlePlainAppend && host !== 'tee' ? literalContent(argv) : undefined;
  const threadedOverwrite = singlePlainOverwrite && host !== 'tee' ? literalContent(argv) : undefined;
  for (const r of contentRedirects) {
    if (r.target === null) continue;
    const absolutePath = resolveTarget(results, 'redirect-write', r.target, currentDir);
    if (absolutePath === null) continue;
    if (r.op === '>>' || r.op === '&>>') {
      results.push({
        status: 'resolved',
        idiom: 'redirect-write',
        span: {
          operation: 'append',
          absolutePath,
          simpleCommandIndex,
          join,
          ...(threadedAppend !== undefined ? { written: threadedAppend } : {})
        }
      });
    } else {
      results.push({
        status: 'resolved',
        idiom: 'redirect-write',
        span: {
          operation: 'create-overwrite',
          absolutePath,
          simpleCommandIndex,
          join,
          ...(threadedOverwrite !== undefined ? { written: threadedOverwrite } : {})
        }
      });
    }
  }
  if (host === 'tee') matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join, results);
}

// ---------------------------------------------------------------------------
// The file-mutation family grammars (plan §5.3–§5.7): cp/install/mv/git mv,
// rm/git rm/truncate, sed -i in-place edits, and patch/git apply. They share
// the §5 fail-closed rules: leading env assignments (stripped by the walk)
// and one `command`/`env` wrapper are skipped (mechanically certain); any
// other wrapper is unresolved; a leading-`-` token that is not a known option
// is treated as an option; `--` makes the rest operands; globbed or variable
// paths are unresolved; directory-shaped source operands fail closed.
// ---------------------------------------------------------------------------

/** Wrapper words that obscure the wrapped command's argv (plan §5): a family command behind one is unresolved, never guessed. */
const FOREIGN_WRAPPERS = new Set(['sudo', 'xargs', 'nohup', 'time', 'nice', 'doas']);

/** A leading `NAME=value` assignment token (`env FOO=bar cp a b` keeps one after the wrapper word). */
const ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Strip at most one `command`/`env` wrapper — mechanically transparent (plan
 * §5) — and any leading assignments after it: `env FOO=bar cp a b` sets FOO
 * then runs cp, exactly the transparent-prefix class the walk strips before
 * tokenizing (`FOO=bar env cp a b` arrives here with the assignments already
 * gone).
 */
function stripTransparentWrapper(argv: string[]): string[] {
  const unwrapped = argv[0] === 'command' || argv[0] === 'env' ? argv.slice(1) : argv;
  let i = 0;
  while (i < unwrapped.length && ASSIGNMENT_TOKEN.test(unwrapped[i])) i += 1;
  return i > 0 ? unwrapped.slice(i) : unwrapped;
}

function pushUnresolved(results: SpanMatch[], idiom: Idiom, fileArg: string, reason: string): void {
  results.push({ status: 'unresolved', idiom, fileArg, reason });
}

/** Whether the path is an existing directory (the dest-dir decision, plan §5.3/§5.4; fs stat like the read idioms' line counts). */
function isExistingDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The shared cp/install/mv operand grammar (plan §5.3/§5.4): per-family option
 * sets and touch operations behind one parser.
 */
interface CopyMoveSpec {
  idiom: 'cp-write' | 'install-write' | 'mv-write';
  /** Known no-value flags (consumed, never operands). */
  noValue: ReadonlySet<string>;
  /**
   * No-clobber flags (`cp -n`/`--no-clobber`): consumed like no-value flags,
   * but the write still parses — the skip is invisible to the post-command
   * byte-compare gate, which cannot distinguish a real copy from a pre-existing
   * equal dest (the documented no-op residue, pinned in
   * bash-write-integration.test.ts).
   */
  noClobber: ReadonlySet<string>;
  /** Known value-taking flags (the next word is the value — `-t DIR`, or an install mode/owner/group). */
  valueTaking: ReadonlySet<string>;
  /** Flags that fail the whole command closed (`cp -b`/`--backup`, `install -d`, git mv dry-run `-n`/`--dry-run`). */
  excluded: ReadonlySet<string>;
  /** The per-source touch: cp/install read their sources; mv deletes them. */
  sourceOperation: 'read' | 'delete';
  /** The per-dest touch: cp/install overwrite; mv rename-copies. */
  destOperation: 'create-overwrite' | 'rename-copy';
}

const CP_SPEC: CopyMoveSpec = {
  idiom: 'cp-write',
  noValue: new Set(['-r', '-R', '-p', '-f', '-v', '-i', '-u', '-a', '-d', '-L', '-P']),
  noClobber: new Set(['-n', '--no-clobber']),
  valueTaking: new Set(['-t', '--target-directory']),
  excluded: new Set(['-b', '--backup']),
  sourceOperation: 'read',
  destOperation: 'create-overwrite'
};

const INSTALL_SPEC: CopyMoveSpec = {
  idiom: 'install-write',
  noValue: new Set(['-D', '-s', '-v']),
  noClobber: new Set(),
  valueTaking: new Set(['-t', '--target-directory', '-m', '-o', '-g']),
  excluded: new Set(['-d']),
  sourceOperation: 'read',
  destOperation: 'create-overwrite'
};

const MV_SPEC: CopyMoveSpec = {
  idiom: 'mv-write',
  // `mv -n` stays in noValue, not noClobber: an mv skip leaves the source in
  // place, and the delete's own absence gate then fails the touch — the
  // no-clobber blind spot is cp's byte-compare, not mv's.
  noValue: new Set(['-f', '-i', '-n', '-v', '-u']),
  noClobber: new Set(),
  valueTaking: new Set(['-t', '--target-directory']),
  excluded: new Set(),
  sourceOperation: 'delete',
  destOperation: 'rename-copy'
};

const GIT_MV_SPEC: CopyMoveSpec = {
  idiom: 'mv-write',
  noValue: new Set(['-f', '-k', '-v']),
  noClobber: new Set(),
  valueTaking: new Set(),
  // `git mv -n`/`--dry-run` is a trial run that moves nothing (the same
  // read-only class as `patch --dry-run`, plan §5.7) — fail closed.
  excluded: new Set(['-n', '--dry-run']),
  sourceOperation: 'delete',
  destOperation: 'rename-copy'
};

interface CopyMoveParts {
  /** Operands in order (sources; in the non-`-t` form the last is the dest). */
  operands: string[];
  /** The `-t`/`--target-directory` value, or null. */
  targetDir: string | null;
}

/**
 * Parse the operands of a cp/install/mv command: known options are consumed,
 * `--` makes the rest operands, and `-t`/`--target-directory[=DIR]` is
 * value-taking — the next word is the target directory, never a source. A
 * leading-`-` token that is not a known option is treated as an option (no
 * touch). Returns null when a fail-closed option is present or a value-taking
 * flag is left valueless.
 */
function copyMoveParts(args: string[], spec: CopyMoveSpec): CopyMoveParts | null {
  const operands: string[] = [];
  let targetDir: string | null = null;
  let i = 0;
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      i += 1;
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === '-t' || a === '--target-directory') {
      const v = args[i + 1];
      if (v === undefined) return null;
      targetDir = v;
      i += 2;
      continue;
    }
    if (a.startsWith('--target-directory=')) {
      targetDir = a.slice('--target-directory='.length);
      i += 1;
      continue;
    }
    if (spec.excluded.has(a)) return null;
    if (spec.valueTaking.has(a)) {
      if (args[i + 1] === undefined) return null;
      i += 2;
      continue;
    }
    if (spec.noValue.has(a) || spec.noClobber.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith('-')) {
      i += 1;
      continue;
    }
    operands.push(a);
    i += 1;
  }
  return { operands, targetDir };
}

/**
 * The per-source touch of a cp/install/mv command. cp/install sources are
 * whole-file reads resolved against fs like the read idioms; a source whose
 * line count cannot be read at parse time (missing or unreadable — the parse
 * runs post-command, so a source the compound's own earlier `rm` deleted is
 * exactly this) still resolves as a range-less whole-file read: the driver
 * pairs the destination against it, so the absent-source rule (plan §3 step
 * 1b) and the read's post-command existence gate apply — an unexplained
 * absence fails the copy decisively and a phantom source never fires the
 * dest. The mv source is a delete.
 */
function emitSourceSpan(
  results: SpanMatch[],
  spec: CopyMoveSpec,
  absolutePath: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join']
): void {
  if (spec.sourceOperation === 'delete') {
    results.push({
      status: 'resolved',
      idiom: spec.idiom,
      span: { operation: 'delete', absolutePath, simpleCommandIndex, join }
    });
    return;
  }
  const range = resolveSpec({ kind: 'toEof', start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: 'resolved',
    idiom: spec.idiom,
    span:
      range === null
        ? { operation: 'read', absolutePath, simpleCommandIndex, join }
        : {
            operation: 'read',
            lineStart: range.lineStart,
            lineEnd: range.lineEnd,
            absolutePath,
            simpleCommandIndex,
            join
          }
  });
}

/**
 * The cp/install/mv family (plan §5.3/§5.4): operands resolve to source/dest
 * pairs — each source is a read (cp/install) or delete (mv), each dest a
 * create-overwrite (cp/install) or rename-copy (mv), sources before dests in
 * declaration order. A dest that ends in `/` or stats as an existing directory
 * maps to `dir/basename(source)` per source; `-t DIR`/`--target-directory=DIR`
 * maps the same way and is unresolved when its value is not directory-shaped.
 * Multi-source commands need a directory dest; a directory-shaped or
 * globbed/variable source, a globbed/variable dest, or a fail-closed option
 * (`cp -b`, `install -d`, git mv `-n`) emits no touches.
 */
function matchCopyMoveFamily(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let spec: CopyMoveSpec | null = null;
  let args: string[] = [];
  let dir = dirForResolution;
  if (command === 'cp' || command === 'install' || command === 'mv') {
    spec = command === 'cp' ? CP_SPEC : command === 'install' ? INSTALL_SPEC : MV_SPEC;
    args = rest.slice(1);
  } else if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === 'mv') {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, 'mv-write', 'mv', 'git -C target contains an unresolved shell variable');
        return;
      }
      spec = GIT_MV_SPEC;
      args = rest.slice(1).slice(sub.subIdx + 1);
      dir = sub.cDir ?? dirForResolution;
    }
  } else if (FOREIGN_WRAPPERS.has(command)) {
    // A wrapper obscures the wrapped argv — fail closed rather than mis-parse.
    const wrapped = rest[1];
    const wrappedSpec =
      wrapped === 'cp' ? CP_SPEC : wrapped === 'install' ? INSTALL_SPEC : wrapped === 'mv' ? MV_SPEC : null;
    if (wrappedSpec !== null) {
      pushUnresolved(results, wrappedSpec.idiom, wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  if (spec === null) return;

  const parts = copyMoveParts(args, spec);
  if (parts === null || parts.operands.length === 0) return;

  // Resolve every source before emitting anything: a directory-shaped,
  // globbed, or variable source fails the whole command closed (the dest
  // mapping is per-source, so an unknowable source makes the dests unknowable).
  const sourcePaths: string[] = [];
  for (const source of parts.operands.slice(0, parts.targetDir === null ? -1 : undefined)) {
    if (source.endsWith('/')) return;
    const absolutePath = resolveTarget(results, spec.idiom, source, dir);
    if (absolutePath === null) return;
    if (isExistingDirectory(absolutePath)) return;
    sourcePaths.push(absolutePath);
  }
  if (sourcePaths.length === 0) return;

  let destPaths: string[];
  if (parts.targetDir !== null) {
    if (looksUnresolvable(parts.targetDir)) {
      pushUnresolved(results, spec.idiom, parts.targetDir, 'path contains an unexpanded shell variable or glob');
      return;
    }
    if (!parts.targetDir.endsWith('/') && !isExistingDirectory(resolvePath(dir, parts.targetDir))) {
      pushUnresolved(results, spec.idiom, parts.targetDir, 'the -t target is not an existing directory');
      return;
    }
    const targetAbs = resolvePath(dir, parts.targetDir);
    destPaths = sourcePaths.map((p) => joinPath(targetAbs, basename(p)));
  } else {
    const dest = parts.operands[parts.operands.length - 1];
    if (looksUnresolvable(dest)) {
      pushUnresolved(results, spec.idiom, dest, 'path contains an unexpanded shell variable or glob');
      return;
    }
    const destAbs = resolvePath(dir, dest);
    const destIsDir = dest.endsWith('/') || isExistingDirectory(destAbs);
    if (sourcePaths.length > 1 && !destIsDir) {
      pushUnresolved(results, spec.idiom, dest, 'a multi-source copy/move needs a directory destination');
      return;
    }
    destPaths = destIsDir ? sourcePaths.map((p) => joinPath(destAbs, basename(p))) : [destAbs];
  }

  for (let k = 0; k < sourcePaths.length; k++) {
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: 'resolved',
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join }
    });
  }
}

const RM_NO_VALUE = new Set(['-f', '-i', '-v']);
/** `rm`/`git rm` flags whose semantics are out of scope: recursive removal and rmdir. */
const RM_EXCLUDED = new Set(['-r', '-R', '--recursive', '-d']);
/** `git rm` adds the dry-run form to the exclusions. */
const GIT_RM_EXCLUDED = new Set(['-r', '-R', '--recursive', '-d', '-n', '--dry-run']);

/**
 * The shared rm/git rm operand grammar (plan §5.5): a recursive/rmdir flag (or
 * `--cached` for git rm — the worktree file survives) excludes the whole
 * command; each remaining file-shaped operand is a delete, and a
 * directory-shaped operand fails closed.
 */
function matchRmOperands(
  args: string[],
  excluded: ReadonlySet<string>,
  excludeCached: boolean,
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let afterDashDash = false;
  const operands: string[] = [];
  for (const a of args) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (excluded.has(a) || (excludeCached && a === '--cached')) return;
    if (RM_NO_VALUE.has(a)) continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option
    operands.push(a);
  }
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, 'rm-write', operand, 'path contains an unexpanded shell variable or glob');
      continue;
    }
    if (operand.endsWith('/') || isExistingDirectory(resolvePath(dir, operand))) continue;
    results.push({
      status: 'resolved',
      idiom: 'rm-write',
      span: { operation: 'delete', absolutePath: resolvePath(dir, operand), simpleCommandIndex, join }
    });
  }
}

/**
 * Statically evaluate an absolute `truncate -s` size (plan §5.5): a plain
 * integer with an optional K/M/G suffix. Relative sizes (`-s +N`/`-s -N`),
 * `-r ref` values, and shell-expanded values depend on runtime state →
 * undefined (those spans gate existence-only).
 */
function evaluateStaticSize(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = value.match(/^(\d+)([KMG])?$/);
  if (m === null) return undefined;
  const base = Number.parseInt(m[1], 10);
  const mult = m[2] === 'K' ? 1024 : m[2] === 'M' ? 1024 ** 2 : m[2] === 'G' ? 1024 ** 3 : 1;
  return base * mult;
}

/**
 * The truncate grammar (plan §5.5): `-s SIZE`/`-r ref` are value-taking — the
 * size value may itself lead with `-` (`truncate -s -10 f`) — and `-c` is
 * compatible. Without `-s`/`-r` the command changes nothing → no touch. Each
 * file-shaped operand is a truncate; an absolute `-s N` carries the statically
 * evaluated size on the span (the §3 `size` gate's post-command byte count,
 * `-s 0` → empty), relative sizes and `-r ref` stay existence-only.
 */
function matchTruncateOperands(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let sawSizeFlag = false;
  let afterDashDash = false;
  let staticSize: number | undefined;
  const operands: Array<{ path: string; size: number | undefined }> = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push({ path: a, size: staticSize });
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-s') {
      sawSizeFlag = true;
      staticSize = evaluateStaticSize(args[i + 1]);
      i += 1; // consume the size value, even when it leads with `-`
      continue;
    }
    if (a === '-r') {
      sawSizeFlag = true;
      staticSize = undefined; // the last size option wins; a ref has no static value
      i += 1;
      continue;
    }
    if (a === '-c') continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option
    operands.push({ path: a, size: staticSize });
  }
  if (!sawSizeFlag) return;
  for (const operand of operands) {
    if (looksUnresolvable(operand.path)) {
      pushUnresolved(results, 'truncate-command', operand.path, 'path contains an unexpanded shell variable or glob');
      continue;
    }
    if (operand.path.endsWith('/') || isExistingDirectory(resolvePath(dir, operand.path))) continue;
    results.push({
      status: 'resolved',
      idiom: 'truncate-command',
      span: {
        operation: 'truncate',
        absolutePath: resolvePath(dir, operand.path),
        simpleCommandIndex,
        join,
        ...(operand.size !== undefined ? { size: operand.size } : {})
      }
    });
  }
}

/**
 * The rm/git rm/truncate family (plan §5.5): `rm`/`git rm` operands are
 * deletes, `truncate` operands are truncations (only when `-s`/`-r` is
 * present). `git rm --cached` touches nothing.
 */
function matchRmTruncate(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'rm') {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join, results);
    return;
  }
  if (command === 'truncate') {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join, results);
    return;
  }
  if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === 'rm') {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, 'rm-write', 'rm', 'git -C target contains an unresolved shell variable');
        return;
      }
      matchRmOperands(
        rest.slice(1).slice(sub.subIdx + 1),
        GIT_RM_EXCLUDED,
        true,
        sub.cDir ?? dirForResolution,
        simpleCommandIndex,
        join,
        results
      );
    }
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'rm' || wrapped === 'truncate') {
      pushUnresolved(
        results,
        wrapped === 'rm' ? 'rm-write' : 'truncate-command',
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}

/**
 * Whether the body of an unquoted heredoc is shell-literal. The shell expands
 * `$` and backtick substitutions and processes backslash escapes (`\$`, `` \` ``,
 * `\\`, backslash-newline) in an unquoted body before the host reads it; a
 * bare backslash before any other char survives literally. A quoted delimiter
 * makes the body literal regardless — checked by the caller.
 */
function heredocBodyIsLiteral(body: string): boolean {
  if (body.includes('$') || body.includes('`')) return false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') continue;
    const next = body[i + 1];
    if (next === undefined || next === '$' || next === '`' || next === '\\' || next === '\n') return false;
    i += 1;
  }
  return true;
}

/**
 * The heredoc write grammar (plan §5.2) for the host families whose bodies are
 * content: `cat` (body → the content redirects), `tee` (body → the operands),
 * and `patch`/`git apply` (body → patch text, §5.7). Any other host's heredoc
 * body is not attributable content — stdin-only and non-family commands
 * (`python3 - <<EOF > out`, `ls > out <<EOF`) get no write touch, and
 * read-family commands (`sed -n '1,2p' <<EOF`) fall through to the read
 * matchers. Empty `>>`-bodies append nothing and touch nothing; empty `>`-bodies
 * truncate (whole-file, the F2 rule).
 *
 * Body threading: `>>` appends and `>` overwrites thread the body when the
 * content redirect is single and plain — the exact gate's post-content on the
 * overwrite (the trailing `\n` the extraction strips is restored, since the
 * gate compares full file bytes), the suffix gate's body on the append (plan
 * §3 step 1b lists "tee/heredoc with a literal body" in the exact class).
 * An unquoted delimiter lets the shell expand the body before the host reads
 * it, so only a literal body (no `$`, backtick, or shell-processed backslash)
 * threads — an expandable one degrades to the existence-gated advisory class
 * rather than risk a decisive-fail on content that never reached the file.
 */
function classifyHeredocOpener(
  opener: string,
  body: string,
  quotedDelim: boolean,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const bodyLiteral = quotedDelim || heredocBodyIsLiteral(body);
  const tokens = tokenize(stripLeadingAssignments(opener).trim());
  if (tokens === null) return;
  const { argv, redirects } = analyzeTokens(tokens);
  const host = argv[0];
  const contentRedirects = redirects.filter(isContentRedirect);
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === '>>';
  const singlePlainOverwrite = contentRedirects.length === 1 && contentRedirects[0].op === '>';

  const emitContentRedirects = (): void => {
    for (const r of contentRedirects) {
      if (r.target === null) continue;
      const absolutePath = resolveTarget(results, 'heredoc-write', r.target, currentDir);
      if (absolutePath === null) continue;
      if (r.op === '>>' || r.op === '&>>') {
        if (body.length === 0) continue;
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span: {
            operation: 'append',
            absolutePath,
            simpleCommandIndex,
            join,
            ...(singlePlainAppend && r.op === '>>' && bodyLiteral ? { written: body } : {})
          }
        });
      } else {
        results.push({
          status: 'resolved',
          idiom: 'heredoc-write',
          span:
            body.length === 0
              ? { operation: 'truncate', absolutePath, simpleCommandIndex, join }
              : {
                  operation: 'create-overwrite',
                  absolutePath,
                  simpleCommandIndex,
                  join,
                  // The exact gate compares full file bytes, so the trailing
                  // `\n` the extraction stripped comes back on the overwrite.
                  ...(singlePlainOverwrite && bodyLiteral ? { written: `${body}\n` } : {})
                }
        });
      }
    }
  };

  if (host === 'cat') {
    emitContentRedirects();
    return;
  }
  if (host === 'tee') {
    const parts = teeOperandParts(argv);
    if (parts !== null) {
      for (const operand of parts.operands) {
        const absolutePath = resolveTarget(results, 'heredoc-write', operand, currentDir);
        if (absolutePath === null) continue;
        if (parts.append) {
          if (body.length === 0) continue;
          results.push({
            status: 'resolved',
            idiom: 'heredoc-write',
            span: {
              operation: 'append',
              absolutePath,
              simpleCommandIndex,
              join,
              ...(contentRedirects.length === 0 && bodyLiteral ? { written: body } : {})
            }
          });
        } else {
          results.push({
            status: 'resolved',
            idiom: 'heredoc-write',
            span:
              body.length === 0
                ? { operation: 'truncate', absolutePath, simpleCommandIndex, join }
                : {
                    operation: 'create-overwrite',
                    absolutePath,
                    simpleCommandIndex,
                    join,
                    // Same restored-`\n` exact body as the redirect branch; a
                    // tee operand with a content redirect present keeps the
                    // redirect's threading only (mirror of the append branch).
                    ...(contentRedirects.length === 0 && bodyLiteral ? { written: `${body}\n` } : {})
                  }
          });
        }
      }
    }
    emitContentRedirects();
    return;
  }
  if (host === 'patch' || host === 'git') {
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join, results);
    return;
  }
  // Non-family host: the body is not attributable content — no write touch.
}

// ---------------------------------------------------------------------------
// The sed -i grammar (plan §5.6), the first consumer of exact ranges: a
// substitution-only script with numeric addresses modifies the addressed
// lines; anything less statically certain is a whole-file modify. The
// suffix/script disambiguation and the segment classification below are the
// whole of it — everything else follows the shared §5 fail-closed rules.
// ---------------------------------------------------------------------------

/** A numeric-addressed substitution segment (`N`, `N,M`) — the only form with an exact range. */
const NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;

/** An unaddressed substitution segment — line-count-preserving, whole file addressed. */
const UNRESTRICTED_SUBSTITUTION = /^[sy]/;

function matchSedInplace(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'sed') {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'sed') {
      pushUnresolved(results, 'sed-inplace', wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}

/**
 * The sed -i operand grammar: `-i` bare, `-iSUFFIX` attached, or a separate
 * suffix word resolved by the standard disambiguation — the word after `-i`
 * is the suffix only when it does not start with `-`, is not script-shaped
 * (a sed command letter or an address start — `s/a/b/`, `2d`, `/x/d`), and a
 * script plus at least one file operand still follow it (the BSD
 * separate-suffix reading; GNU's attached-only reading otherwise). A
 * script-shaped word is the script under GNU's reading: `sed -i s/a/b/ f g`
 * would otherwise steal the first file operand as a suffix and silently miss
 * its write (the multi-file-sed misparse). An attached or disambiguated
 * suffix is a backup: a non-empty suffix emits an additional create-overwrite
 * touch on `<file><SUFFIX>`; an empty suffix (which the quote-aware tokenizer
 * drops entirely — `sed -i '' f` and `sed -i f` tokenize alike) creates no
 * backup.
 *
 * The script is the script argument plus every `-e` argument, split on `;`.
 * Segments that are all numeric-addressed substitutions yield the exact range
 * [min start, min(max end, EOF)] (per file, EOF from the post-edit count);
 * segments that are all substitutions — any numeric/unaddressed mix — are
 * still line-count-preserving, so the whole file is addressed ([1, EOF]);
 * any count-changing, pattern-addressed, step, or `$`-addressed segment is a
 * whole-file modify with no range. An absent script (no script argument, no
 * `-e`) is unresolved.
 */
/**
 * A word that can only be a sed script, never a BSD separate suffix: a sed
 * command letter (`s`/`y`/`d`/…), or an address start (digit, `/`, `\`, `$`,
 * `~`). The multi-file form `sed -i s/a/b/ f g` puts the script immediately
 * after bare `-i` (GNU's reading; the BSD reading needs a separate suffix
 * word first, and a letter-leading or address-leading word is not one).
 */
const SED_SCRIPT_SHAPE = /^(?:[A-Za-z]|\d|\/|\\|\$|~)/;

function matchSedInplaceArgs(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let suffix: string | null = null;
  let sawInplace = false;
  let i = 0;
  const eScripts: string[] = [];
  // The script/file split of the positionals is derived after the scan: the
  // first positional is the script argument only when no `-e` script exists —
  // with `-e` present every positional is a file (GNU sed reads the script
  // from `-e` then, not from the first positional).
  const positionals: string[] = [];
  // Files pushed outside the positional path: `sed -i f` (script absent).
  const files: string[] = [];
  let afterDashDash = false;

  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      positionals.push(a);
      i += 1;
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === '-n') {
      i += 1;
      continue;
    }
    if (a === '-e') {
      const v = args[i + 1];
      if (v === undefined) {
        pushUnresolved(results, 'sed-inplace', a, 'the -e flag is left valueless');
        return;
      }
      eScripts.push(v);
      i += 2;
      continue;
    }
    if (a === '-i') {
      sawInplace = true;
      const w = args[i + 1];
      if (w === undefined) {
        // `sed -i` with nothing after: no suffix, no script — the absent-script
        // check below resolves this unresolved.
        i += 1;
        continue;
      }
      if (w.startsWith('-')) {
        // The word after -i is an option, never a suffix.
        i += 1;
        continue;
      }
      const restAfter = args.slice(i + 2);
      if (restAfter.length >= 2 && !SED_SCRIPT_SHAPE.test(w)) {
        // The BSD separate-suffix reading: w is the suffix, and a script plus
        // at least one file operand still follow — only for a suffix-shaped
        // word (`.bak`, `''`). A script-shaped word is the script under GNU's
        // reading, so `sed -i s/a/b/ f g` treats `s/a/b/` as the script and
        // both f and g as files.
        suffix = w;
        i += 2;
        continue;
      }
      if (restAfter.length === 0) {
        // `sed -i f`: w is the last token — no script can follow, so w is the
        // file operand with the script absent (GNU instead reads w as a script
        // and errors; either way the edit does not happen).
        files.push(w);
        i += 2;
        continue;
      }
      // One token after w: w is the script argument (or a file, when `-e`
      // scripts are present) and the token is a file — consume both, so
      // neither falls through to the positional path again.
      positionals.push(w, restAfter[0]);
      i += 3;
      continue;
    }
    if (a.startsWith('-i') && a.length > 2) {
      sawInplace = true;
      suffix = a.slice(2);
      i += 1;
      continue;
    }
    if (a.startsWith('-')) {
      // Unknown option — never a script or file.
      i += 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }

  if (!sawInplace) return; // not an in-place edit at all
  const scriptArg = eScripts.length === 0 ? (positionals[0] ?? null) : null;
  if (scriptArg !== null) files.push(...positionals.slice(1));
  else files.push(...positionals);
  const segments: string[] = [];
  if (scriptArg !== null) segments.push(...scriptArg.split(';'));
  for (const s of eScripts) segments.push(...s.split(';'));
  if (segments.length === 0) {
    pushUnresolved(results, 'sed-inplace', files[0] ?? 'sed', 'no script (absent or empty script argument)');
    return;
  }

  // Segment classification: exact when every segment is a numeric-addressed
  // substitution; explicit whole-file [1, EOF] when every segment is still a
  // substitution (any unaddressed/numeric mix); no range otherwise.
  let allNumeric = true;
  let allSubstitution = true;
  let minStart = Infinity;
  let maxEnd = 0;
  for (const segment of segments) {
    const m = segment.match(NUMERIC_SUBSTITUTION);
    if (m === null) {
      allNumeric = false;
      if (!UNRESTRICTED_SUBSTITUTION.test(segment)) allSubstitution = false;
      continue;
    }
    const s = Number.parseInt(m[1], 10);
    const e = m[2] === undefined ? s : Number.parseInt(m[2], 10);
    minStart = Math.min(minStart, s);
    maxEnd = Math.max(maxEnd, e);
  }

  for (const f of files) {
    if (looksUnresolvable(f)) {
      pushUnresolved(results, 'sed-inplace', f, 'path contains an unexpanded shell variable or glob');
      continue;
    }
    const absolutePath = resolvePath(dir, f);
    if (allNumeric || allSubstitution) {
      const total = countFileLines(absolutePath);
      if (total === null) {
        pushUnresolved(
          results,
          'sed-inplace',
          absolutePath,
          'could not determine end-of-file line count (file unreadable, empty, or missing)'
        );
        continue;
      }
      const start = allNumeric ? minStart : 1;
      const end = allNumeric ? Math.min(maxEnd, total) : total;
      if (start > end) continue; // the addressed range lies beyond EOF — nothing is modified
      results.push({
        status: 'resolved',
        idiom: 'sed-inplace',
        span: { operation: 'modify', lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join }
      });
    } else {
      results.push({
        status: 'resolved',
        idiom: 'sed-inplace',
        span: { operation: 'modify', absolutePath, simpleCommandIndex, join }
      });
    }
    if (suffix !== null && suffix !== '') {
      results.push({
        status: 'resolved',
        idiom: 'sed-inplace',
        span: { operation: 'create-overwrite', absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The patch / git apply grammar (plan §5.7). Patch text sources, in order of
// recognition: a literal patch-file operand (`git apply <file>` — a `patch`
// operand is a target file, not a source, and is ignored), the stdin `<`
// source (`patch -pN < file`, `git apply - < file`), or a heredoc body
// (classifyPatchHeredoc, §5.2). Read-only modes (`--check`/`--stat`/
// `--numstat`/`--summary`, `patch --dry-run`) and index-only `--cached` touch
// nothing; `--directory` fails closed (it rewrites patch paths). A command
// with no statically known source (piped or terminal stdin, a variable patch
// path) is unresolved. Targets and ranges come from the new
// range-preserving unified-diff parser (unified-diff.ts).
// ---------------------------------------------------------------------------

/** The shared `patch`/`git apply` option surface (plan §5.7): strip level, read-only and index-only modes, `--directory`, and operands. */
interface PatchApplyParts {
  strip: PathStrip;
  readOnly: boolean;
  cachedOnly: boolean;
  directory: boolean;
  operands: string[];
}

function patchApplyParts(args: string[], isGitApply: boolean): PatchApplyParts {
  let strip: PathStrip = isGitApply ? 1 : 'auto';
  let readOnly = false;
  let cachedOnly = false;
  let directory = false;
  const operands: string[] = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (isGitApply) {
      if (a === '--check' || a === '--stat' || a === '--numstat' || a === '--summary') {
        readOnly = true;
        continue;
      }
      if (a === '--cached') {
        cachedOnly = true;
        continue;
      }
      if (a === '--index' || a === '-R' || a === '--reverse' || a === '--unsafe-paths' || a === '--reject') continue;
      if (a === '--directory') {
        directory = true;
        continue;
      }
      if (a.startsWith('--directory=')) {
        directory = true;
        continue;
      }
      if (a === '-p') {
        const v = args[i + 1];
        if (v !== undefined && /^\d+$/.test(v)) {
          strip = Number.parseInt(v, 10);
          i += 1;
        }
        continue;
      }
      if (/^-p\d+$/.test(a)) {
        strip = Number.parseInt(a.slice(2), 10);
        continue;
      }
      if (a.startsWith('-')) continue;
      operands.push(a);
      continue;
    }
    // patch
    if (a === '--dry-run') {
      readOnly = true;
      continue;
    }
    if (a === '-N' || a === '--forward') continue;
    if (a === '-p') {
      const v = args[i + 1];
      if (v !== undefined && /^\d+$/.test(v)) {
        strip = Number.parseInt(v, 10);
        i += 1;
      }
      continue;
    }
    if (/^-p\d+$/.test(a)) {
      strip = Number.parseInt(a.slice(2), 10);
      continue;
    }
    if (a.startsWith('-')) continue;
    operands.push(a);
  }
  return { strip, readOnly, cachedOnly, directory, operands };
}

/** The patch text at `absolutePath`, or null when it can't be read. */
function readPatchFile(absolutePath: string): string | null {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Emit the write touches for a `patch`/`git apply` command with a statically
 * known patch-text source. `targetDir` is where the patch's target paths
 * resolve (the git `-C` directory for `git apply`, the current directory
 * otherwise); `shellDir` is where the shell's stdin `<` redirect target
 * resolves — a redirect is shell-side, so `git -C` never affects it.
 */
function emitPatchTargets(
  args: string[],
  isGitApply: boolean,
  host: string,
  targetDir: string,
  shellDir: string,
  redirects: RedirectInfo[],
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return; // read-only / index-only — no touches
  if (parts.directory) {
    pushUnresolved(results, 'patch-write', '--directory', '--directory rewrites patch paths');
    return;
  }

  let patchText: string | null = null;
  let source: string | null = null;
  // 1. A literal patch-file operand (git apply only; a patch operand is a
  //    target file, not a source — ignored).
  if (isGitApply) {
    const operand = parts.operands.find((o) => o !== '-');
    if (operand !== undefined) {
      if (looksUnresolvable(operand)) {
        pushUnresolved(results, 'patch-write', operand, 'path contains an unexpanded shell variable or glob');
        return;
      }
      source = resolvePath(targetDir, operand);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, 'patch-write', source, 'patch file unreadable or missing');
        return;
      }
    }
  }
  // 2. The stdin `<` source (patch and git apply).
  if (patchText === null) {
    const stdin = redirects.find((r) => r.op === '<');
    if (stdin !== undefined && stdin.target !== null) {
      if (looksUnresolvable(stdin.target)) {
        pushUnresolved(results, 'patch-write', stdin.target, 'path contains an unexpanded shell variable or glob');
        return;
      }
      source = resolvePath(shellDir, stdin.target);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, 'patch-write', source, 'patch text unreadable or missing');
        return;
      }
    }
  }
  // 3. No statically known source: stdin is dynamic (terminal, pipe, variable).
  if (patchText === null) {
    pushUnresolved(results, 'patch-write', host, 'no statically known patch text source (stdin is dynamic)');
    return;
  }

  const targets = parseUnifiedDiffRange(patchText, parts.strip);
  if (targets === null) {
    pushUnresolved(results, 'patch-write', source ?? host, 'malformed or empty patch text');
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, 'patch-write', t.path, targetDir);
    if (absolutePath === null) continue;
    results.push({
      status: 'resolved',
      idiom: 'patch-write',
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join,
        ...(t.lineStart !== undefined ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {})
      }
    });
  }
}

/**
 * The patch/git apply grammar in the main walk: `patch` reads patch text from
 * stdin or a `<` redirect; `git apply` additionally accepts a patch-file
 * operand and resolves targets against its `-C` directory. A wrapped
 * `patch`/`apply` is unresolved — the wrapper obscures the argv.
 */
function matchPatchApply(
  argv: string[],
  redirects: RedirectInfo[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'patch') {
    emitPatchTargets(
      rest.slice(1),
      false,
      'patch',
      dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join,
      results
    );
    return;
  }
  if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== 'apply') return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, 'patch-write', 'apply', 'git -C target contains an unresolved shell variable');
      return;
    }
    emitPatchTargets(
      rest.slice(1).slice(sub.subIdx + 1),
      true,
      'apply',
      sub.cDir ?? dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join,
      results
    );
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'patch' || wrapped === 'apply') {
      pushUnresolved(results, 'patch-write', wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}

/**
 * The heredoc patch-text grammar (plan §5.7): a `patch`/`git apply` heredoc
 * body is patch text. The opener's own options still apply — `--dry-run`/
 * `--check`/`--stat`/`--numstat`/`--summary`/`--cached` make the body
 * read-only (no touches), `--directory` fails closed, and `-pN` sets the
 * header strip level.
 */
function classifyPatchHeredoc(
  argv: string[],
  body: string,
  currentDir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let isGitApply = false;
  let args: string[];
  let dir = currentDir;
  if (command === 'patch') {
    args = rest.slice(1);
  } else if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== 'apply') return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, 'patch-write', 'apply', 'git -C target contains an unresolved shell variable');
      return;
    }
    isGitApply = true;
    args = rest.slice(1).slice(sub.subIdx + 1);
    dir = sub.cDir ?? currentDir;
  } else {
    return;
  }
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return;
  if (parts.directory) {
    pushUnresolved(results, 'patch-write', '--directory', '--directory rewrites patch paths');
    return;
  }
  const targets = parseUnifiedDiffRange(body, parts.strip);
  if (targets === null) {
    pushUnresolved(results, 'patch-write', 'heredoc', 'malformed or empty patch text');
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, 'patch-write', t.path, dir);
    if (absolutePath === null) continue;
    results.push({
      status: 'resolved',
      idiom: 'patch-write',
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join,
        ...(t.lineStart !== undefined ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {})
      }
    });
  }
}

// ---------------------------------------------------------------------------
// The formatter / fixer grammar (plan §5.8): a table-driven family over the
// corpus-derived 16-tool set. Flag matching is exact-token on full argv words —
// never prefix or substring — and the read-only list is consulted first, so
// `--fix-dry-run` can never collide with `--fix` and `black --check` never
// heals. Tools whose write form is a bare invocation (black, isort, rustfmt)
// carry the empty form and fire on the write form itself. Leading transparent
// package-runner wrappers (npx, yarn, pnpm exec/dlx, bunx, npm exec) strip
// under a pinned option grammar; a wrapper that could rewrite argv fails
// closed as unresolved.
// ---------------------------------------------------------------------------

/** One §5.8 table row: the tool command and its write/read-only token forms. */
export interface FormatterToolRow {
  command: string;
  /** Token sequences whose exact-token presence marks the invocation a write. */
  writeForms: string[][];
  /** Token sequences consulted first — presence suppresses the write (the read-only mode wins). */
  readOnlyForms: string[][];
}

/**
 * The §5.8 table, exported so the corpus-coverage fixture can assert two-sided
 * tool-set equality and per-tool read-only suppression (plan §5.8, Phase 3
 * step 8).
 */
export const FORMATTER_TABLE: readonly FormatterToolRow[] = [
  {
    command: 'prettier',
    writeForms: [['--write'], ['-w']],
    readOnlyForms: [['--check'], ['--list-different'], ['--debug-check']]
  },
  { command: 'eslint', writeForms: [['--fix']], readOnlyForms: [['--fix-dry-run']] },
  {
    command: 'biome',
    writeForms: [
      ['check', '--write'],
      ['check', '--fix'],
      ['format', '--write']
    ],
    readOnlyForms: []
  },
  { command: 'gofmt', writeForms: [['-w']], readOnlyForms: [['-l']] },
  { command: 'goimports', writeForms: [['-w']], readOnlyForms: [] },
  { command: 'clang-format', writeForms: [['-i']], readOnlyForms: [['--dry-run']] },
  { command: 'shfmt', writeForms: [['-w']], readOnlyForms: [['-d']] },
  { command: 'yapf', writeForms: [['-i']], readOnlyForms: [['--diff']] },
  { command: 'autopep8', writeForms: [['-i']], readOnlyForms: [['-d'], ['--diff']] },
  { command: 'black', writeForms: [[]], readOnlyForms: [['--check'], ['--diff']] },
  { command: 'isort', writeForms: [[]], readOnlyForms: [['--check-only'], ['--diff']] },
  {
    command: 'ruff',
    writeForms: [['format'], ['check', '--fix']],
    readOnlyForms: [
      ['check', '--no-fix'],
      ['format', '--check']
    ]
  },
  { command: 'deno', writeForms: [['fmt']], readOnlyForms: [['fmt', '--check']] },
  { command: 'dprint', writeForms: [['fmt']], readOnlyForms: [['check']] },
  { command: 'rustfmt', writeForms: [[]], readOnlyForms: [['--check'], ['--emit', 'stdout']] },
  {
    command: 'terraform',
    writeForms: [['fmt']],
    readOnlyForms: [
      ['fmt', '-check'],
      ['fmt', '-diff']
    ]
  }
];

/** The pinned package-runner no-arg flags (plan §5.8): flags that cannot move or rewrite argv. */
const RUNNER_NO_ARG_FLAGS = new Set(['-y', '--yes', '--no-install']);

/** The outcome of stripping one leading package-runner wrapper. */
type RunnerStrip = { kind: 'stripped'; stripped: string[] } | { kind: 'obscured' };

/**
 * Strip one leading transparent package-runner wrapper (plan §5.8): `npx`,
 * `yarn`, `pnpm exec`/`pnpm dlx`, `bunx`, and `npm exec` followed directly by
 * the wrapped command word, with only the pinned no-arg flags (`-y`/`--yes`,
 * `--no-install`) and `npm exec`'s `--` terminator between. A string-form
 * argument (`npx "prettier --write f"`), an argv-altering runner flag
 * (`--package=X` or a flag consuming the next word), or a wrapper word that is
 * itself a script (`.`-prefixed) obscures the wrapped argv — the wrapper is
 * transparent only when the pinned grammar proves it so. Returns 'not-runner'
 * when the word is not a runner at all (a different npm/pnpm subcommand, or a
 * bare runner with no command word) — the table matches it directly, which
 * fails closed for non-formatter runners.
 */
function stripPackageRunner(argv: string[]): RunnerStrip | 'not-runner' {
  const runner = argv[0];
  let rest = argv.slice(1);
  if (runner === 'npx' || runner === 'yarn' || runner === 'bunx') {
    // These runners take the command word directly.
  } else if (runner === 'pnpm') {
    if (rest[0] !== 'exec' && rest[0] !== 'dlx') return 'not-runner';
    rest = rest.slice(1);
  } else if (runner === 'npm') {
    if (rest[0] !== 'exec') return 'not-runner';
    rest = rest.slice(1);
  } else {
    return 'not-runner';
  }
  while (RUNNER_NO_ARG_FLAGS.has(rest[0])) rest = rest.slice(1);
  if (runner === 'npm' && rest[0] === '--') rest = rest.slice(1);
  if (rest.length === 0) return 'not-runner'; // a bare runner attributes nothing
  const wrapped = rest[0];
  if (wrapped.startsWith('-') || wrapped.startsWith('.') || /\s/.test(wrapped)) return { kind: 'obscured' };
  return { kind: 'stripped', stripped: rest };
}

/**
 * The formatter/fixer family (plan §5.8). The read-only forms are consulted
 * first and win over any write form; a write form with no read-only form and
 * every operand an explicit file emits a whole-file `modify` per operand;
 * directory/glob/no-operand invocations touch nothing; unknown executables
 * fail closed. A form's leading subcommand word (`check`/`format`/`fmt`) is
 * positional — it must lead the tool's args, so `deno task fmt` is a script
 * runner, not a formatter.
 */
function matchFormatter(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  let words = rest;
  const strip = stripPackageRunner(rest);
  if (strip === 'not-runner') {
    // rest[0] is not a package runner — the table matches it directly.
  } else if (strip.kind === 'obscured') {
    pushUnresolved(results, 'formatter-write', rest[0], `the ${rest[0]} wrapper obscures the wrapped argv`);
    return;
  } else {
    words = strip.stripped;
  }
  if (FOREIGN_WRAPPERS.has(words[0])) {
    const wrapped = words[1];
    if (wrapped !== undefined && FORMATTER_TABLE.some((r) => r.command === wrapped)) {
      pushUnresolved(results, 'formatter-write', wrapped, `the ${words[0]} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  const row = FORMATTER_TABLE.find((r) => r.command === words[0]);
  if (row === undefined) return; // unknown executable — fail closed, no touch
  const args = words.slice(1);
  const formPresent = (form: string[]): boolean => {
    const first = form[0];
    if (first !== undefined && !first.startsWith('-') && args[0] !== first) return false;
    return form.every((token) => args.includes(token));
  };
  // The read-only list is consulted first and wins over any write form:
  // `eslint --fix --fix-dry-run f` writes nothing, `black --check f` never heals.
  if (row.readOnlyForms.some(formPresent)) return;
  if (!row.writeForms.some(formPresent)) return; // bare invocations of flag-required tools are read-only (stdout/lint)
  // Consume the tool's subcommand word before collecting operands.
  const subcommandWords = new Set<string>();
  for (const form of row.writeForms) {
    for (const token of form) {
      if (!token.startsWith('-')) subcommandWords.add(token);
    }
  }
  const afterSubcommand = subcommandWords.has(args[0]) ? args.slice(1) : args;
  let afterDashDash = false;
  const operands: string[] = [];
  for (const a of afterSubcommand) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a.startsWith('-')) continue; // unknown option → treated as an option (shared §5)
    operands.push(a);
  }
  if (operands.length === 0) return; // no-operand invocations touch nothing
  // Every operand must be an explicit file — a glob, variable, directory, or
  // trailing-slash operand fails the whole command closed.
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, 'formatter-write', operand, 'path contains an unexpanded shell variable or glob');
      return;
    }
    if (operand.endsWith('/') || isExistingDirectory(resolvePath(dirForResolution, operand))) return;
  }
  for (const operand of operands) {
    results.push({
      status: 'resolved',
      idiom: 'formatter-write',
      span: { operation: 'modify', absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join }
    });
  }
}

// ---------------------------------------------------------------------------
// The git restore / git checkout grammar (plan §5.9), the last pure-parser
// family. Restore has no revision operand form — its positional args are
// always pathspecs; checkout skips a pre-`--` revision/ref operand and takes
// pathspecs only after `--`. Every explicit-file pathspec is a whole-file
// create-overwrite touch; a directory-shaped pathspec (`.`/`..`, trailing `/`,
// or a path that stats as a directory), `--staged`-only restore, and
// `-p`/`--patch` interactive hunk selection all fail closed.
// ---------------------------------------------------------------------------

/** git restore no-value flags (plan §5.9); `-s`/`--source`, `--staged`, `-W`/`--worktree`, `-m`/`--merge`, and `-p`/`--patch` are handled explicitly. */
const RESTORE_NO_VALUE = new Set(['-q', '-f', '-u']);

/**
 * The shared restore/checkout pathspec emission (plan §5.9): an explicit-file
 * pathspec (no globs, no `.`/`..`, no directory, no trailing `/`) is a
 * create-overwrite whole-file touch; a directory-shaped pathspec is
 * unresolved — a directory restore/checkout rewrites arbitrary files beneath
 * it and cannot be attributed to a file write.
 */
function emitRestoreCheckoutPathspec(
  results: SpanMatch[],
  idiom: 'git-restore-write' | 'git-checkout-write',
  operand: string,
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join']
): void {
  if (looksUnresolvable(operand)) {
    pushUnresolved(results, idiom, operand, 'path contains an unexpanded shell variable or glob');
    return;
  }
  const absolutePath = resolvePath(dir, operand);
  if (operand === '.' || operand === '..' || operand.endsWith('/') || isExistingDirectory(absolutePath)) {
    pushUnresolved(
      results,
      idiom,
      operand,
      'directory-shaped pathspec rewrites arbitrary files beneath it — not attributable to a file write'
    );
    return;
  }
  results.push({
    status: 'resolved',
    idiom,
    span: { operation: 'create-overwrite', absolutePath, simpleCommandIndex, join }
  });
}

/**
 * The git restore operand grammar (plan §5.9): `-s`/`--source=<tree>` is
 * value-taking — the tree operand never resolves as a pathspec; `-p`/`--patch`
 * interactive hunk selection is unresolved; `-m`/`--merge` (the merge
 * machinery, conditional on the index being unmerged) and `--staged` without
 * `--worktree` (index-only — the working file survives) touch nothing.
 */
function matchRestoreOperands(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let staged = false;
  let worktree = false;
  let afterDashDash = false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-p' || a === '--patch') {
      pushUnresolved(
        results,
        'git-restore-write',
        a,
        'interactive patch mode applies user-chosen hunks — no static span'
      );
      return;
    }
    if (a === '-s' || a === '--source') {
      i += 1; // the tree operand is never a pathspec
      continue;
    }
    if (a.startsWith('--source=')) continue;
    if (a === '-m' || a === '--merge') return;
    if (a === '--staged') {
      staged = true;
      continue;
    }
    if (a === '-W' || a === '--worktree') {
      worktree = true;
      continue;
    }
    if (RESTORE_NO_VALUE.has(a)) continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option (fail closed)
    operands.push(a);
  }
  if (staged && !worktree) return; // index-only restore does not touch the working file
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, 'git-restore-write', operand, dir, simpleCommandIndex, join);
  }
}

/**
 * The git checkout operand grammar (plan §5.9): `-b`/`-B`/`--orphan <branch>`
 * are value-taking — the branch name never resolves as a pathspec; `-p`/
 * `--patch` interactive hunk selection is unresolved; a pre-`--` positional is
 * a revision/ref operand and is skipped. Pathspecs only after `--`.
 */
function matchCheckoutOperands(
  args: string[],
  dir: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  let afterDashDash = false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      afterDashDash = true;
      continue;
    }
    if (a === '-p' || a === '--patch') {
      pushUnresolved(
        results,
        'git-checkout-write',
        a,
        'interactive patch mode applies user-chosen hunks — no static span'
      );
      return;
    }
    if (a === '-b' || a === '-B' || a === '--orphan') {
      i += 1; // the branch name is never a pathspec
      continue;
    }
    if (a === '-f' || a === '-q' || a === '-m' || a === '-t') continue;
    if (a.startsWith('-')) continue; // unknown option → treated as an option (fail closed)
    // A pre-`--` positional is a revision/ref operand — never a pathspec.
  }
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, 'git-checkout-write', operand, dir, simpleCommandIndex, join);
  }
}

/**
 * The git restore / git checkout family (plan §5.9): via `findGitSubcommand`
 * (handles `git -C`/`-c`), the two subcommands resolve their pathspecs to
 * whole-file create-overwrite touches; a wrapped subcommand fails closed.
 */
function matchGitRestoreCheckout(
  argv: string[],
  dirForResolution: string,
  simpleCommandIndex: number,
  join: ResolvedSpan['join'],
  results: SpanMatch[]
): void {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === 'git') {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || (sub.subcommand !== 'restore' && sub.subcommand !== 'checkout')) return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(
        results,
        sub.subcommand === 'restore' ? 'git-restore-write' : 'git-checkout-write',
        sub.subcommand,
        'git -C target contains an unresolved shell variable'
      );
      return;
    }
    const dir = sub.cDir ?? dirForResolution;
    const args = rest.slice(1).slice(sub.subIdx + 1);
    if (sub.subcommand === 'restore') matchRestoreOperands(args, dir, simpleCommandIndex, join, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === 'restore' || wrapped === 'checkout') {
      pushUnresolved(
        results,
        wrapped === 'restore' ? 'git-restore-write' : 'git-checkout-write',
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const LINE_SELECTORS = [matchSed, matchHead, matchTail];

/**
 * Span-less commands whose exit status is deterministic — usable as guards in
 * `&&`/`||` joins (plan §3 step 2's span-less-guard rule): `false` always
 * exits 1, `true` and `:` always 0, so a following joined command's skip is
 * knowable even though neither produces a span.
 */
const BUILTIN_GUARD_STATUS = new Map<string, 0 | 1>([
  ['false', 1],
  ['true', 0],
  [':', 0]
]);

export function parseCommandDetailed(command: string, opts: string | ParseOptions = {}): SpanMatch[] {
  const cwd = typeof opts === 'string' ? opts : (opts.cwd ?? process.cwd());

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

  let currentDir = cwd;
  let lastPlainFileSource: string | null = null;
  // The one-hop literal echo/printf pipe source (plan §5.2): set at the end of
  // each simple command, cleared at any non-pipe boundary, threaded by tee -a
  // appends in the next pipe stage (`echo x | tee -a f`).
  let pipeEchoContent: string | null = null;

  /** The `join` stamp for a simple command: only the conditional operators gate (plan §3 step 2). */
  const joinOf = (simple: SimpleCommand): ResolvedSpan['join'] => {
    if (simple.precededBy === 'and') return '&&';
    if (simple.precededBy === 'or') return '||';
    return undefined;
  };

  /** The parts of a frame the resolution paths need (no OLDPWD). */
  interface Frame {
    dir: string;
    certain: boolean;
  }

  /**
   * The effective git repo dir for a candidate (plan §6): an absolute `-C`
   * target is self-contained; a relative one composes with the tracked
   * directory; no `-C` uses the tracked directory itself. Undefined when the
   * frame is uncertain — the repo location is unknown, fail closed.
   */
  const gitDirOf = (c: { dirOverride?: string }, frame: Frame): string | undefined => {
    if (c.dirOverride === undefined) return frame.certain ? frame.dir : undefined;
    if (isAbsolute(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : undefined;
  };

  const emitCandidate = (c: RawCandidate, frame: Frame, simpleCommandIndex: number, join: ResolvedSpan['join']) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: 'unresolved',
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: 'path contains an unexpanded shell variable or glob'
      });
      return;
    }
    // Plan §6 certainty: a relative path against an uncertain directory, or a
    // git candidate whose repo frame cannot be composed, is unresolvable —
    // never a guessed touch. Absolute paths are unaffected.
    if (c.resolverKind === 'fs') {
      if (!frame.certain && !isAbsolute(c.fileArg)) {
        results.push({
          status: 'unresolved',
          idiom: c.idiom,
          fileArg: c.fileArg,
          reason: 'the working directory is uncertain — the relative path cannot be resolved'
        });
        return;
      }
    } else if (gitDirOf(c, frame) === undefined) {
      results.push({
        status: 'unresolved',
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: 'the git -C target cannot be resolved against the tracked directory'
      });
      return;
    }
    // A git candidate's path resolves inside its repo dir (`-C` target or the
    // tracked directory), not the process dir — plan §6.
    const resolutionDir =
      c.resolverKind === 'fs'
        ? c.dirOverride === undefined
          ? frame.dir
          : isAbsolute(c.dirOverride)
            ? c.dirOverride
            : resolvePath(frame.dir, c.dirOverride)
        : gitDirOf(c, frame)!;
    const absolutePath = resolvePath(resolutionDir, c.fileArg);
    const totalLines =
      c.resolverKind === 'fs'
        ? cachedFsTotalLines(absolutePath)
        : cachedGitTotalLines(resolutionDir, c.resolverKind.rev, c.fileArg);
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
      span: {
        operation: 'read',
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        absolutePath,
        simpleCommandIndex,
        join
      }
    });
  };

  /**
   * The read idioms for one simple command (the existing corpus grammar):
   * plain `cat`/`nl` sources, the line selectors, and the git matchers, with
   * one-hop pipe-source propagation for downstream `head`/`tail`/`sed -n`.
   */
  const matchReads = (simple: SimpleCommand, argv: string[], i: number): void => {
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

    // A bare `cat file`/`nl file` that is not feeding a downstream pipe stage
    // reads the whole file: emit the same whole-file span `git show rev:path`
    // produces. When a pipe follows, the downstream line-selector already
    // emits the precise range, so the source stays source-only.
    if (plainFileArg !== null) {
      const next = simpleCommands[i + 1];
      if (next === undefined || next.precededBy !== 'pipe') {
        emitCandidate(
          {
            kind: 'candidate',
            idiom: argv[0] === 'cat' ? 'cat-file' : 'nl-file',
            fileArg: plainFileArg,
            spec: { kind: 'toEof', start: 1 },
            resolverKind: 'fs'
          },
          { dir: currentDir, certain: true },
          i,
          joinOf(simple)
        );
      }
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
          emitCandidate(outcome, { dir: currentDir, certain: true }, i, joinOf(simple));
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

    if (!matched && simple.precededBy === 'pipe' && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          if (outcome.kind === 'candidate')
            emitCandidate(outcome, { dir: currentDir, certain: true }, i, joinOf(simple));
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

    if (!isPlainSource) lastPlainFileSource = null;
  };

  for (let i = 0; i < simpleCommands.length; i++) {
    const simple = simpleCommands[i];

    // A pipe stage may inherit the previous stage's literal echo content; any
    // other boundary clears it.
    if (simple.precededBy !== 'pipe') pipeEchoContent = null;

    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      const tokens = tokenize(stripLeadingAssignments(w.opener).trim());
      if (tokens === null) {
        lastPlainFileSource = null;
        continue;
      }
      const openerArgv = analyzeTokens(tokens).argv;
      matchReads(simple, openerArgv, i);
      classifyHeredocOpener(w.opener, w.body, w.quotedDelim, currentDir, i, joinOf(simple), results);
      pipeEchoContent = literalContent(openerArgv) ?? null;
      continue;
    }

    const tokens = tokenize(stripLeadingAssignments(simple.text).trim());
    if (tokens === null) {
      lastPlainFileSource = null;
      continue;
    }
    const { argv, redirects } = analyzeTokens(tokens);
    if (argv.length === 0) {
      // Bare `> f` / `: > f`: no argv, but the truncation grammar still fires.
      matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
      lastPlainFileSource = null;
      continue;
    }

    if (argv[0] === 'cd') {
      lastPlainFileSource = null;
      const target = argv[1];
      if (target !== undefined && target !== '-' && !hasShellExpansion(target)) {
        currentDir = resolvePath(currentDir, target);
      }
      continue;
    }

    const before = results.length;
    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
    if (results.length === before) {
      // No span for this command: a deterministic builtin is still a usable
      // join guard (`false && echo x > f` must skip the echo). Any other
      // command stays span-less and unknowable — the driver fails open.
      const status = BUILTIN_GUARD_STATUS.get(argv[0]);
      if (status !== undefined) {
        results.push({
          status: 'builtin-guard',
          simpleCommandIndex: i,
          join: joinOf(simple),
          exitStatus: status
        });
      }
    }
    pipeEchoContent = literalContent(argv) ?? null;
  }

  return results;
}

/** Parses a Bash `command` string into the file+line-range spans it statically, reliably reads or writes. `cwd` defaults to `process.cwd()` — pass the hook's own `cwd` field (the string shorthand, or `opts.cwd`) for correct resolution of relative paths and `cd`/`git -C` targets, and of `git show`/`git log -L` revisions. */
export function parseCommand(command: string, opts: string | ParseOptions = {}): ResolvedSpan[] {
  const detailed = parseCommandDetailed(command, opts);
  const spans: ResolvedSpan[] = [];
  for (const m of detailed) {
    if (m.status === 'resolved') spans.push(m.span);
  }
  return spans;
}
