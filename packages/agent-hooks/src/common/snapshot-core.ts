/**
 * Harness-agnostic snapshot core for card main-213.
 *
 * When a `Bash` tool call's writes are invisible to static command parsing —
 * formatters, generators, embedded Python/Node/Ruby/Perl scripts, project
 * tools — a per-tool pre/post file snapshot correlated by (session_id,
 * tool_use_id) attributes the writes the call actually produced. The core is
 * pure logic plus injected subprocess I/O: command classification, the
 * private write-tree capture, tree-to-tree comparison (git-diff hunks mapped
 * to post ranges), the text/binary classifier, and the concurrency ambiguity
 * rules. Git runs through the injected {@link GitRunner} seam and file stats
 * through {@link StatFile}, except for the classifier's one scoped
 * `git config --get-regexp` subprocess — the exec-channel read for git read
 * subcommands, the only subprocess the pre-side classification runs. It
 * imports nothing from either hook SDK and is typed structurally, per the
 * `common/` layer convention.
 *
 * The touched-files cap (100) and the post-side wall budget (5 s) are
 * contract decisions — baked into {@link DEFAULT_SNAPSHOT_BUDGETS} exactly as
 * the plan states — and together they are the PostToolUse timeout detection.
 *
 * Reused from the shared kernel (not redefined): `LineRange` (1-based
 * inclusive line ranges) from agent-hooks-common.ts.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isInsideSpanRoot, type LineRange } from './agent-hooks-common.js';
import { argvOf, splitTopLevel, tokenize } from './shell-split.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * The snapshot budgets in force for one tool call's pre walk, the post
 * comparison, and the store. Env-var / git-config precedence (mirroring
 * resolveSpanRoot) is resolved before the core sees a budgets value; these
 * are the shipped defaults, per the plan.
 */
export interface SnapshotBudgets {
  /**
   * Pre-side max wall seconds for the `git add -A` + `write-tree` pair
   * (default 1); exhaustion degrades the capture to a stat-only sweep.
   */
  preSideMaxWallSeconds: number;
  /**
   * Max storage across all of the repo's live calls — the per-call private
   * object dirs plus the record files. Exhaustion refuses new snapshot
   * writes with a diagnostic — never drop-oldest, because deleting records
   * would silently destroy the ambiguity evidence the concurrency rules
   * depend on (default 64 MiB).
   */
  maxStorageBytes: number;
  /**
   * Touched-files cap per tool call: changed-path count is capped by it;
   * beyond it, coverage-gap diagnostics and no touches (default 100). This cap
   * IS the PostToolUse timeout detection.
   */
  maxTouchedFiles: number;
  /**
   * Post-side wall budget in seconds, checked per scope before any diff/touch
   * work: on exhaustion the comparison stops adding scopes and records a
   * diagnostic naming exactly which paths were attributed and which were not
   * (default 5). This budget IS the PostToolUse timeout detection.
   */
  postSideWallSeconds: number;
  /** Snapshot-record TTL, the crash-recovery backstop (default 24 h). */
  recordTtlMs: number;
  /** Unfinished activity-entry TTL, pruned by the sweep (default 15 min). */
  unfinishedEntryTtlMs: number;
}

/** The shipped budget defaults, exactly as the plan states them. */
export const DEFAULT_SNAPSHOT_BUDGETS: SnapshotBudgets = {
  preSideMaxWallSeconds: 1,
  maxStorageBytes: 64 * 1024 * 1024,
  maxTouchedFiles: 100,
  postSideWallSeconds: 5,
  recordTtlMs: 24 * 60 * 60 * 1000,
  unfinishedEntryTtlMs: 15 * 60 * 1000
};

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

/** The classifier's per-simple-command verdict — the plan's three buckets. */
export type CommandWriteClass = 'read-only' | 'covered-write' | 'opaque';

/**
 * The classifier's decision for the whole command: whether a snapshot record
 * must exist for the Post side to compare against, and why.
 *
 * - `no-snapshot` / `read-only`: no write-capable command — nothing can write.
 * - `no-snapshot` / `statically-covered`: every write is statically covered
 *   and provably expansion-free — exact ranges are already available and
 *   nothing can be missed (the fast-path exception).
 * - `snapshot`: at least one opaque command, alone or mixed with covered
 *   writes — the pre walk must capture the state the Post side compares.
 */
export type SnapshotDecision =
  | { kind: 'no-snapshot'; reason: 'read-only' }
  | { kind: 'no-snapshot'; reason: 'statically-covered' }
  | { kind: 'snapshot'; reason: 'opaque' }
  | { kind: 'snapshot'; reason: 'mixed' };

/**
 * The classifier's plan for a command: the decision plus the tier-1 targets —
 * the parser's resolved paths plus literal redirect targets, the paths the
 * pre walk must capture within budget before any repo-wide tier-2 walk.
 * Empty when the decision is `no-snapshot`.
 */
export interface SnapshotPlan {
  decision: SnapshotDecision;
  /** Absolute tier-1 target paths (parser-resolved + literal redirect targets). */
  tier1Targets: string[];
}

/**
 * Classify a Bash command into a {@link SnapshotPlan}. The SAME classifier
 * runs in both the Pre and Post hooks, so both sides always agree on whether
 * a snapshot should exist; the Post side warns when it concludes a snapshot
 * should have existed but the record is absent.
 *
 * Classification rules (per the plan): tilde, background (`&`), and
 * parser-unresolved globbed/variable targets are opaque; the read-only set is
 * flag- and wrapper-aware (output-targeting flags like `sort -o` disqualify,
 * argument-executing wrappers like `env`/`xargs` are opaque, git write
 * subcommands are never read-only, and git read subcommands are read-only
 * only while no exec channel — GIT_EXTERNAL_DIFF / GIT_PAGER / diff.external /
 * diff.<driver>.textconv|command in env, config, or command text — is open,
 * with `--no-ext-diff`/`--no-textconv` disarming); a covered write is gated
 * on the command being provably expansion-free (single-quoted heredoc
 * delimiters only; `>`/`>>` to a literal path with no unquoted
 * `$`/backtick/command substitution); anything else is opaque.
 */
/** Tools provably incapable of writing (no redirect, no expansion, no flags). */
const READ_ONLY_TOOLS = new Set(['ls', 'grep', 'rg', 'cat', 'head', 'tail', 'echo', 'cd']);

/** Git subcommands with write forms — never read-only. */
const GIT_WRITE_SUBCOMMANDS = new Set([
  'config',
  'branch',
  'tag',
  'remote',
  'stash',
  'checkout',
  'switch',
  'reset',
  'restore',
  'clean',
  'rebase',
  'merge',
  'pull',
  'commit',
  'add'
]);

/** Git read subcommands whose read-only label gates on the exec channels. */
const GIT_READ_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'help']);

/** Argument-executing wrappers: the wrapped subcommand can write. */
const EXEC_WRAPPERS = new Set(['env', 'time', 'xargs', 'sudo', 'nohup', 'nice', 'command', 'exec']);

/** Output-targeting flags: arguments can write without a shell redirect. */
const OUTPUT_FLAG = /^(?:-o|--output|--output-file)(?:=|$)/;

/** The git exec-channel config keys, in `-c KEY=val` command text. */
const EXEC_CONFIG_KEY = /^diff\.(?:external|.*\.(?:textconv|command))$/;
/**
 * Command-text env assignments that repoint git's repo/index/object/config
 * sources. Any member makes the config the diff-exec keys come from unknowable
 * to the hook's cwd-scoped read. The scan covers every leading assignment
 * (each `KEY=val` token is whitespace-delimited); `GIT_CONFIG_COUNT` alone is
 * inert, but the KEY/VALUE pair forms are what inject config entries, so the
 * family matches each member and the fixtures pin the pair form.
 */
const GIT_REDIRECT_ASSIGNMENT =
  /(?:^|\s)(?:GIT_DIR|GIT_WORK_TREE|GIT_OBJECT_DIRECTORY|GIT_INDEX_FILE|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_[0-9]+|GIT_CONFIG_VALUE_[0-9]+|XDG_CONFIG_HOME|HOME)=/;

/** One `git config --get-regexp` scoped to exactly the exec keys (the classifier's only subprocess). */
const EXEC_CONFIG_PATTERN = '^(diff\\.external|diff\\..*\\.(textconv|command))$';

/** One heredoc write found in the command, with its delimiter quote style. */
interface SnapshotHeredoc {
  redirect: '>' | '>>';
  target: string;
  /** True only for `<<'EOF'` — the one form whose body is inert data. */
  inert: boolean;
}

const HEREDOC_OPEN =
  /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))[ \t]*\r?\n/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mask every heredoc write the way parse-command's extractHeredocWrites does —
 * open line, body, and closing line become one `__heredoc_N__` token — but keep
 * the delimiter quote style, which classification needs (a single-quoted
 * delimiter is the only form whose body is inert data).
 */
function extractHeredocs(raw: string): { writes: SnapshotHeredoc[]; masked: string } {
  const writes: SnapshotHeredoc[] = [];
  let masked = '';
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch: RegExpExecArray | null = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const bodyStart = openMatch.index + openMatch[0].length;
    if (delim === undefined || bodyStart < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const closeRe = new RegExp(`^${dash === undefined ? '' : '\\t*'}${escapeRegExp(delim)}[ \\t]*$`, 'm');
    const closeMatch = closeRe.exec(raw.slice(bodyStart));
    if (closeMatch === null) {
      HEREDOC_OPEN.lastIndex = bodyStart;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect: redirect as '>' | '>>', target, inert: dq1 !== undefined });
    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}

/** Quote-aware scan for unquoted `$`/backtick (double quotes expand; single quotes and escapes do not). */
function hasUnquotedExpansion(text: string): boolean {
  let inSquote = false;
  let inDquote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (inDquote) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === '"') {
        inDquote = false;
        continue;
      }
      if (c === '$' || c === '`') return true;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      continue;
    }
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '$' || c === '`') return true;
  }
  return false;
}

/**
 * A top-level `&` that is not `&&`, `|&`, `>&`, `<&`, `&>`, or `&>>` backgrounds
 * a job — the write can land after the hook returns, so the whole command is
 * opaque. splitTopLevel consumes `&` as a separator, so this scans the raw text.
 */
function hasBackground(raw: string): boolean {
  let inSquote = false;
  let inDquote = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (inDquote) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === '"') inDquote = false;
      continue;
    }
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '(') {
      depth += 1;
      continue;
    }
    if (c === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && c === '&') {
      const prev = i > 0 ? raw[i - 1]! : '';
      const next = i + 1 < raw.length ? raw[i + 1]! : '';
      if (prev === '&' || prev === '|' || prev === '>' || prev === '<') continue;
      if (next === '&' || next === '>') continue;
      return true;
    }
  }
  return false;
}

/**
 * Output-redirect words (`>`, `>>`, `1>`, `2>`, `&>`, …) and their targets.
 * `2>&1`-style fd duplication is not a file write. A literal target (no tilde,
 * no expansion, no glob) resolves against `currentDir` into a tier-1 target.
 */
function findRedirects(argv: string[], currentDir: string): { present: boolean; targets: string[] } {
  const targets: string[] = [];
  let present = false;
  for (let i = 0; i < argv.length; i += 1) {
    const w = argv[i]!;
    const m = /^(?:[12]?>>?|&>>?)(.*)$/.exec(w);
    if (m === null) continue;
    let target = m[1]!;
    if (target.startsWith('&')) continue; // `2>&1` duplicates a descriptor — no file write
    present = true;
    if (target === '') target = argv[i + 1] ?? '';
    if (target !== '' && !target.startsWith('~') && !/[$`*?]/.test(target)) {
      targets.push(resolve(currentDir, target));
    }
  }
  return { present, targets };
}

/**
 * The exec-channel verdict for a git command, or null when the command is not
 * git. The structural no-exec-channel invariant: env (ambient and command
 * text), effective config (one scoped `git config --get-regexp` read), and
 * command text (`-c KEY=val`) each open a channel; `--no-ext-diff` /
 * `--no-textconv` close theirs, but only in the subcommand's argument
 * position — the pre-subcommand form is a usage error git rejects (exit 129),
 * it does not disarm.
 */
function classifyGitExec(argv: string[], assignments: string, cwd: string): 'read-only' | 'opaque' | null {
  if (argv[0] !== 'git') return null;
  // Find the subcommand after the program name, skipping -C/-c, --git-dir /
  // --work-tree, and leading flags. The -C targets are resolved in order (git
  // applies each -C relative to the previous one) so the command's working
  // directory is known; a --git-dir/--work-tree redirect makes the repo's
  // config source unknowable to this hook's cwd-scoped read — fail closed.
  let subIdx = -1;
  let subcommand: string | null = null;
  let cTarget: string | null = null;
  let repoRedirected = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '-C') {
      cTarget = resolve(cTarget ?? cwd, argv[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (a === '-c') {
      i += 2;
      continue;
    }
    if (a === '--git-dir' || a === '--work-tree') {
      repoRedirected = true;
      i += 2;
      continue;
    }
    if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) {
      repoRedirected = true;
      i += 1;
      continue;
    }
    if (a.startsWith('-')) {
      i += 1;
      continue;
    }
    subIdx = i;
    subcommand = a;
    break;
  }
  if (subcommand === null) return 'opaque'; // `git` alone or flags only — not provably read-only
  if (GIT_WRITE_SUBCOMMANDS.has(subcommand)) return 'opaque';
  if (subcommand === 'help') {
    return argv.some((a) => a === '-w' || a === '--web') ? 'opaque' : 'read-only';
  }
  if (!GIT_READ_SUBCOMMANDS.has(subcommand)) return 'opaque';
  // The command may run in a different repo than the hook cwd: with `-C` the
  // diff-exec keys come from the TARGET repo's config, which the cwd-scoped
  // read below cannot see; with `--git-dir`/`--work-tree` the repo itself is
  // redirected. Only a `-C` target proven to resolve to the same top-level as
  // the cwd keeps the read-only path with the cwd config read.
  if (repoRedirected) return 'opaque';
  if (cTarget !== null) {
    const cwdRoot = repoTopLevel(cwd);
    const targetRoot = repoTopLevel(cTarget);
    if (cwdRoot === null || targetRoot === null || cwdRoot !== targetRoot) return 'opaque';
  }
  const rendersDiff = subcommand === 'diff' || subcommand === 'log' || subcommand === 'show';
  // Command-text pager forms force opaque (the pager program is env-dependent);
  // ambient PAGER/GIT_PAGER are inert because the hook's stdout is a pipe. The
  // scan covers every leading assignment, not just the first.
  if (/(?:^|\s)(?:GIT_PAGER|PAGER)=/.test(assignments)) return 'opaque';
  // GIT_EXTERNAL_DIFF executes an external diff program on diff/log/show
  // unconditionally — unlike the pager, it is not terminal-gated.
  if (rendersDiff && /(?:^|\s)GIT_EXTERNAL_DIFF=/.test(assignments)) return 'opaque';
  // The command-assignment redirect family: any member repoints the repo, the
  // index, the object store, or the effective config, so the cwd-scoped read
  // below sees the wrong config source — fail closed on the diff-rendering
  // subcommands, the only ones with an exec channel. (The ambient forms are
  // self-correcting for the config read because the classifier's subprocesses
  // inherit the hook env; GIT_DIR additionally hijacks the -C top-level check,
  // which is exactly why the assignment forms must fail closed instead.)
  if (rendersDiff && GIT_REDIRECT_ASSIGNMENT.test(assignments)) return 'opaque';
  // `git -c diff.external=…` — the config channel in command text, visible without a read.
  if (rendersDiff) {
    for (let j = 0; j < argv.length; j += 1) {
      const a = argv[j]!;
      const key = a === '-c' ? (argv[j + 1] ?? '') : a.startsWith('-c') && a.length > 2 ? a.slice(2) : null;
      if (key !== null && EXEC_CONFIG_KEY.test(key.split('=')[0] ?? '')) return 'opaque';
    }
  }
  if (subcommand === 'status') return 'read-only'; // status never renders diffs — no config gate
  const postSubArgs = argv.slice(subIdx + 1);
  const noExtDiff = postSubArgs.includes('--no-ext-diff');
  const noTextconv = postSubArgs.includes('--no-textconv');
  if (!noExtDiff && process.env.GIT_EXTERNAL_DIFF !== undefined) return 'opaque';
  if (!noExtDiff || !noTextconv) {
    const { external, driver } = readExecConfig(cwd);
    if (external && !noExtDiff) return 'opaque';
    if (driver && !noTextconv) return 'opaque';
  }
  return 'read-only';
}

/**
 * The repo top-level a directory resolves to (git's canonicalized answer), or
 * null when the directory is not inside a repo or git cannot answer — the
 * fail-closed side of the `-C` target check: an unresolvable target can never
 * be proven to be the hook cwd's repo.
 */
function repoTopLevel(dir: string): string | null {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** The one scoped config read: any exec key in the effective config opens a channel. */
function readExecConfig(cwd: string): { external: boolean; driver: boolean } {
  try {
    const out = execFileSync('git', ['config', '--get-regexp', EXEC_CONFIG_PATTERN], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let external = false;
    let driver = false;
    for (const line of out.split('\n')) {
      const key = line.split(/\s/)[0] ?? '';
      if (key === 'diff.external') external = true;
      else if (/^diff\..*\.(textconv|command)$/.test(key)) driver = true;
    }
    return { external, driver };
  } catch {
    // No matches, or git unavailable — no exec channel.
    return { external: false, driver: false };
  }
}

/** Fail the fast path when a path is a symlink or its lstat is unknowable (ENOENT is fine — new files). */
function isSymlinkOrUnknowable(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/** The covered target itself and every ancestor between cwd and target must be a non-symlink. */
function fastPathTargetsOk(absTarget: string, cwd: string): boolean {
  if (isSymlinkOrUnknowable(absTarget)) return false;
  const rel = relative(cwd, absTarget);
  if (rel === '' || isAbsolute(rel) || rel.startsWith('..')) return true; // outside cwd — only the target is checkable
  const parts = rel.split('/');
  let cur = cwd;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    if (part === '' || part === '.') continue;
    cur = join(cur, part);
    if (isSymlinkOrUnknowable(cur)) return false;
  }
  return true;
}

interface SimpleClass {
  writeCapable: boolean;
  opaque: boolean;
  covered: boolean;
  coveredTargets: string[];
  tier1: string[];
}

/** Classify one simple command into the plan's three buckets. */
function classifySimple(text: string, argv: string[], currentDir: string, background: boolean): SimpleClass {
  const opaque = (tier1: string[] = []): SimpleClass => ({
    writeCapable: true,
    opaque: true,
    covered: false,
    coveredTargets: [],
    tier1
  });
  const readOnly: SimpleClass = {
    writeCapable: false,
    opaque: false,
    covered: false,
    coveredTargets: [],
    tier1: []
  };
  if (background) return opaque();
  if (argv.some((w) => w.startsWith('~') || /[*?]/.test(w))) return opaque();
  // `argvOf` strips redirect operators and their targets from argv (per its
  // own contract); redirect detection needs the raw token stream instead, so
  // a literal redirect target is still visible here.
  const rawTokens = (tokenize(text) ?? []).map((t) => t.text);
  if (hasUnquotedExpansion(text)) return opaque(findRedirects(rawTokens, currentDir).targets);
  if (EXEC_WRAPPERS.has(argv[0]!)) return opaque();
  if (argv.some((w) => OUTPUT_FLAG.test(w))) return opaque();
  const redirects = findRedirects(rawTokens, currentDir);
  if (redirects.present) return opaque(redirects.targets);
  if (argv[0] === 'git') {
    const assignments = (text.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/) ?? [''])[0] ?? '';
    const verdict = classifyGitExec(argv, assignments, currentDir);
    return verdict === 'read-only' ? readOnly : opaque();
  }
  if (READ_ONLY_TOOLS.has(argv[0]!)) return readOnly;
  return opaque();
}

export function classifyCommandForSnapshot(command: string, cwd: string): SnapshotPlan {
  const background = hasBackground(command);
  const { writes, masked } = extractHeredocs(command);
  // The split reports completed lists plus a `malformed` verdict for a list
  // bash rejects at parse time — nothing in a rejecting list (or after it)
  // ever executes, so the surviving stages are exactly the writes that can
  // happen.
  const simpleCommands = splitTopLevel(masked).stages;
  let currentDir = cwd;
  let hasOpaque = false;
  let hasCovered = false;
  let anyWrite = false;
  const tier1: string[] = [];
  const coveredTargets: string[] = [];
  const pushTier1 = (t: string): void => {
    if (!tier1.includes(t)) tier1.push(t);
  };
  for (const simple of simpleCommands) {
    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef !== null) {
      const h = writes[Number.parseInt(heredocRef[1]!, 10)]!;
      const absTarget = resolve(currentDir, h.target);
      const literal = !h.target.startsWith('~') && !/[$`*?]/.test(h.target);
      if (literal) pushTier1(absTarget);
      anyWrite = true;
      if (background || !h.inert || !literal) hasOpaque = true;
      else {
        hasCovered = true;
        coveredTargets.push(absTarget);
      }
      continue;
    }
    const argv = argvOf(simple.text);
    if (argv === null) {
      // Unbalanced quotes — not provably anything.
      hasOpaque = true;
      anyWrite = true;
      continue;
    }
    if (argv[0] === 'cd' && argv.length >= 2 && argv[1] !== '-' && !/[$`]/.test(argv[1]!)) {
      currentDir = resolve(currentDir, argv[1]!);
    }
    const cls = classifySimple(simple.text, argv, currentDir, background);
    if (cls.writeCapable) anyWrite = true;
    if (cls.opaque) hasOpaque = true;
    if (cls.covered) {
      hasCovered = true;
      coveredTargets.push(...cls.coveredTargets);
    }
    for (const t of cls.tier1) pushTier1(t);
  }
  if (background) return { decision: { kind: 'snapshot', reason: 'opaque' }, tier1Targets: tier1 };
  if (!anyWrite) return { decision: { kind: 'no-snapshot', reason: 'read-only' }, tier1Targets: [] };
  if (hasOpaque) {
    return {
      decision: { kind: 'snapshot', reason: hasCovered ? 'mixed' : 'opaque' },
      tier1Targets: tier1
    };
  }
  // All write-capable commands are covered writes — the fast path attaches only
  // when every covered target is provably a plain path (no symlink detours).
  if (coveredTargets.every((t) => fastPathTargetsOk(t, cwd))) {
    return { decision: { kind: 'no-snapshot', reason: 'statically-covered' }, tier1Targets: [] };
  }
  return { decision: { kind: 'snapshot', reason: 'opaque' }, tier1Targets: tier1 };
}

// ---------------------------------------------------------------------------
// File stat
// ---------------------------------------------------------------------------

/** The stat fields the stat-only degrade sweep records per path. */
export interface FileStat {
  /** Byte size of the file. */
  size: number;
  /** mtime in nanoseconds (BigInt) at capture. */
  mtimeNs: bigint;
}

/** Injected file stat: null when the file is absent or unstat-able. */
export type StatFile = (absPath: string) => FileStat | null;

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * One change region between the pre and post line-hash sequences (the Myers
 * diff's output, O(ND) over the hash arrays). Coordinates are 1-based and
 * inclusive; a hunk with `preLines === 0` is a pure insertion, one with
 * `postLines === 0` is a pure deletion.
 */
export interface DiffHunk {
  /** 1-based first line in the pre sequence; 0 for a pure insertion. */
  preStart: number;
  /** Number of pre lines the hunk covers; 0 for a pure insertion. */
  preLines: number;
  /** 1-based first line in the post sequence; 0 for a pure deletion. */
  postStart: number;
  /** Number of post lines the hunk produces; 0 for a pure deletion. */
  postLines: number;
}

/** The post-state ranges a snapshot comparison observes for one path. */
export interface ObservedWriteRanges {
  /** Post-state 1-based inclusive ranges of inserted/modified lines. */
  changed: LineRange[];
  /** Create / delete / rename / truncation / delete-only hunks — whole-file scope. */
  wholeFile: boolean;
}

/**
 * Map diff hunks to post-state ranges: inserted/modified lines become exact
 * post-state ranges; any delete-only hunk (no reliable post-state coordinate
 * for deleted lines) forces whole-file scope.
 */
export function hunksToPostRanges(hunks: DiffHunk[]): ObservedWriteRanges {
  // A delete-only hunk has no reliable post-state coordinate — the deletion may
  // have shifted everything below it, so the whole file is in scope.
  if (hunks.some((h) => h.postLines === 0)) return { changed: [], wholeFile: true };
  const changed: LineRange[] = hunks.map((h) => ({
    start: h.postStart,
    end: h.postStart + h.postLines - 1
  }));
  return { changed, wholeFile: false };
}

// ---------------------------------------------------------------------------
// Pre/post comparison
// ---------------------------------------------------------------------------

/**
 * What the comparison concluded about one path. `changed` carries the exact
 * post-state ranges; `created`/`deleted`/`rename` are whole-file by nature.
 */
export type PathAttribution =
  | { kind: 'unchanged' }
  | { kind: 'changed'; observed: ObservedWriteRanges }
  | { kind: 'created' }
  | { kind: 'deleted' }
  | { kind: 'rename'; from: string };

/**
 * Whether a record's gaps include a path-coverage gap — the capture degraded
 * to stat-only (content coverage unknowable) or the comparison stopped before
 * recording a path's post state (touched-files cap, post-side wall
 * exhaustion, unreadable-at-compare, an aborted comparison). The
 * precision-loss diagnostics (`binary-scope`) are NOT in the family — those
 * paths ARE attributed and their post state is recorded, so a missing post
 * entry still means "unchanged". Every match is anchored to the emitter's
 * fixed prefix: gap strings interpolate user file names (cap-cut paths,
 * unreadable drops), so an unanchored scan would let a file named like a gap
 * phrase open the family.
 */
const PATH_COVERAGE_GAP =
  /^(?:post-side wall budget exhausted:|touched-files cap \d+ exceeded:|unreadable at compare:|snapshot compare aborted:|write-tree degraded to stat-only:)/;

export function recordHasPathCoverageGap(record: { gaps: string[] }): boolean {
  return record.gaps.some((g) => PATH_COVERAGE_GAP.test(g));
}

// ---------------------------------------------------------------------------
// Concurrency ambiguity rules
// ---------------------------------------------------------------------------

/**
 * A sibling record's per-path state for the ambiguity check — the minimal
 * view the table reads: record identity, consumption, and its pre/post state
 * for the path in question.
 */
export interface SiblingSnapshot {
  sessionId: string;
  toolUseId: string;
  /** The instant its pre walk wrote the record. */
  createdAt: number;
  consumed: boolean;
  /** Its consumption instant; null while live. */
  consumedAt: number | null;
  /**
   * True when the sibling record carries a path-coverage gap: its coverage is
   * unknowable, so overlap must be assumed — a gapped unconsumed sibling
   * makes every changed path ambiguous.
   */
  coverageGap: boolean;
  /** Its pre-state for the path, or null when its coverage excluded the path. */
  pre: SiblingPathState | null;
  /** Its post-state for the path, or null when it consumed without changing it. */
  post: SiblingPathState | null;
}

/**
 * One side's per-path state as the table reads it: the Node SHA-256 hex of
 * the path's bytes in that side's tree — derived on demand via
 * {@link hashTreePath} from the sibling's recorded tree SHAs, never persisted
 * per path.
 */
export interface SiblingPathState {
  /** SHA-256 hex of the path's bytes on that side. */
  hash: string;
}

/**
 * My own record's view for the ambiguity check: the instant my pre capture
 * wrote the record, and my pre-state hash for the path in question (null when
 * my pre tree lacked the path — a created path, or a stat-only degrade).
 * Derived by the harness from the comparison's content hashes; the table's
 * row logic is unchanged from the per-path-map era — only where its inputs
 * come from changed.
 */
export interface AmbiguityBaseline {
  /** The instant my pre capture wrote the record. */
  createdAt: number;
  /** My pre-state hash for the path; null when my pre side lacked it. */
  preHash: string | null;
}

/**
 * The table's verdict for one changed path against one sibling, top-down;
 * the first matching row decides (see the plan's ambiguity table). Any
 * ambiguous sibling makes the path ambiguous — the path is dropped whole,
 * before any diff or range work. An ambiguous verdict names the deciding
 * sibling (toolUseId + sessionId) so the harness can surface a
 * transcript-visible deferral note the model loop can act on.
 */
export type AmbiguityVerdict =
  | { ambiguous: false }
  | { ambiguous: true; reason: string; siblingToolUseId: string; siblingSessionId: string };

/**
 * The concurrency ambiguity check for one changed path P (my pre ≠ now):
 * inspect the siblings covering P, ordered by createdAt (ties broken by
 * toolUseId — fully deterministic, so every consumer of an entangled path
 * evaluates the same sibling set in the same order and reaches the same
 * verdict), and read the table top-down per sibling:
 *
 * - unconsumed (before or after mine) → ambiguous — its write window has not
 *   provably ended, regardless of pre order or pre equality.
 * - consumed, created after mine: post(P) ≠ pre(P) → ambiguous; post(P) =
 *   pre(P) → not ambiguous. A missing post entry (post(P) = null) reads as
 *   "consumed without changing P" ONLY when the sibling carries no coverage
 *   gap — under a gap its post walk may have dropped P (the post-walk
 *   coverage-gap guard), so post:null means unknowable, not clean.
 * - consumed, created before mine: pre(P) = post(P) → not ambiguous (it never
 *   changed P); post(P) = my pre(P) → not ambiguous (its write provably
 *   landed before my baseline); pre(P) ≠ post(P) and consumedAt ≤ my
 *   createdAt → not ambiguous (its whole window ended before my baseline);
 *   pre(P) ≠ post(P) and consumedAt > my createdAt → ambiguous (it changed P
 *   in a window that extends past my baseline).
 *
 * A gapped unconsumed sibling covers every path (coverageGap), closing the
 * "truncated sibling becomes invisible" hole.
 */
export function applyAmbiguityRules(
  mine: AmbiguityBaseline,
  siblings: SiblingSnapshot[],
  path: string
): AmbiguityVerdict {
  const myPreHash = mine.preHash;
  // Fully deterministic order: every consumer of an entangled path evaluates
  // the same sibling set in the same order and reaches the same verdict.
  const ordered = [...siblings].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.toolUseId < b.toolUseId ? -1 : a.toolUseId > b.toolUseId ? 1 : 0;
  });
  for (const sib of ordered) {
    // A sibling not covering the path (pre and post both null, no coverage gap)
    // is invisible here — its window provably never touched it.
    const covers = sib.coverageGap || sib.pre !== null || sib.post !== null;
    if (!covers) continue;
    if (!sib.consumed) {
      // Its write window has not provably ended, regardless of pre order or
      // pre equality — it may still write the path.
      return {
        ambiguous: true,
        reason: `unconsumed sibling ${sib.toolUseId} may still write ${path}`,
        siblingToolUseId: sib.toolUseId,
        siblingSessionId: sib.sessionId
      };
    }
    const preHash = sib.pre?.hash ?? null;
    const postHash = sib.post?.hash ?? null;
    if (sib.createdAt > mine.createdAt) {
      // Consumed after mine: post(P) = pre(P) proves the windows are
      // disjoint. A missing post entry proves "consumed without changing P"
      // only without a coverage gap — under a gap the sibling's post walk may
      // have dropped P (the post-walk coverage-gap guard), so post:null means
      // its end state is unknowable, never clean.
      if (postHash === null) {
        if (sib.coverageGap) {
          return {
            ambiguous: true,
            reason: `sibling ${sib.toolUseId} consumed with a coverage gap and no post state for ${path} — its end state is unknowable`,
            siblingToolUseId: sib.toolUseId,
            siblingSessionId: sib.sessionId
          };
        }
        continue;
      }
      if (postHash === preHash) continue;
      return {
        ambiguous: true,
        reason: `sibling ${sib.toolUseId} changed ${path} in a window overlapping mine`,
        siblingToolUseId: sib.toolUseId,
        siblingSessionId: sib.sessionId
      };
    }
    // Consumed before mine, top-down:
    if (preHash !== null && preHash === postHash) continue; // it never changed P
    if (postHash !== null && postHash === myPreHash) continue; // its write landed before my baseline
    if (sib.consumedAt !== null && sib.consumedAt <= mine.createdAt) continue; // whole window ended before my baseline
    return {
      ambiguous: true,
      reason: `sibling ${sib.toolUseId} changed ${path} in a window extending past my baseline`,
      siblingToolUseId: sib.toolUseId,
      siblingSessionId: sib.sessionId
    };
  }
  return { ambiguous: false };
}

// ---------------------------------------------------------------------------
// Tree-SHA snapshot mechanism (card main-228) — v2 contract
//
// Replaces the per-line-hash record above: each side of a snapshot-decided
// call takes a private `git write-tree` snapshot (temp index primed from the
// real index, private GIT_OBJECT_DIRECTORY whose info/alternates points at
// the real object store — the alternates are load-bearing: without them
// `git add -A` re-copies every blob into the private dir) and persists only
// the tree SHA plus correlation/gap metadata. The post side compares two
// 40-char strings first; only on mismatch does it pay for
// `git diff --name-status -M100% --text` (tree-to-tree) and, per changed
// path, `git diff --unified=0 --text` — producing the same
// ObservedWriteRanges/PathAttribution shapes so nothing downstream of the
// touch core changes. Per-path hashes stay Node SHA-256 over blob bytes (the
// activity log's ActivityPathStamp hash space), NEVER git SHA-1 OIDs.
// ---------------------------------------------------------------------------

/**
 * One path's stat-only state — the degrade capture when the wall budget
 * cuts the `git add -A` + `write-tree` pair short (or git is unavailable):
 * file-granularity create/delete/modify evidence, whole-file scope only.
 */
export interface StatOnlyEntry {
  /** Byte size of the file at capture. */
  size: number;
  /** mtime in nanoseconds (BigInt) at capture. */
  mtimeNs: bigint;
}

/**
 * The post side's persisted state on a v2 record, written at consumption:
 * its own tree SHA (or its own stat-only degrade). Later siblings' ambiguity
 * checks derive per-path pre/post hashes from the two tree SHAs on demand
 * ({@link hashTreePath}) instead of reading persisted per-path maps.
 */
export interface SnapshotPostState {
  /** The post-side write-tree SHA; null only on stat-only degrade. */
  treeSha: string | null;
  /** Present only on stat-only degrade (post-side wall budget cut). */
  statOnly?: Record<string, StatOnlyEntry>;
}

/**
 * The v2 snapshot record: a tree SHA and correlation/gap metadata — a few
 * hundred bytes, never megabytes. The store's version-mismatch read fails
 * closed, so v1 records on disk are discarded on read and reaped by TTL; no
 * migration.
 */
export interface SnapshotRecord {
  /** Record format version. A mismatch on read fails closed. */
  version: 2;
  sessionId: string;
  toolUseId: string;
  /** Subagent agent id, recorded by the PreToolUse adapters when present. */
  agentId?: string;
  /** Absolute repo root the snapshot was taken in. */
  repoRoot: string;
  /** The instant the record was written (same clock as the activity log's finishedAt). */
  createdAt: number;
  /** Whether a PostToolUse has consumed this record. */
  consumed: boolean;
  /** Stamped at consumption; null while the record is live. */
  consumedAt: number | null;
  /** The pre-side write-tree SHA; null only on stat-only degrade. */
  treeSha: string | null;
  /** Present only on stat-only degrade (pre-side wall budget cut). */
  statOnly?: Record<string, StatOnlyEntry>;
  /**
   * Coverage-gap diagnostics — the same diagnostic-string contract as v1
   * with a smaller vocabulary: the stat-only degrade emits a
   * `write-tree degraded to stat-only:` gap (path-coverage family — content
   * coverage is unknowable, so siblings fail closed), and the comparison
   * emits the same `touched-files cap`/`post-side wall budget exhausted`/
   * `binary-scope` family it does today.
   */
  gaps: string[];
  /** Post-side state, written at consumption. */
  post?: SnapshotPostState;
}

/**
 * Injected git subprocess runner — the tree mechanism's one I/O seam,
 * mirroring hashFile's injected stat/read convention. Returns stdout bytes
 * (cat-file reads need raw bytes); throws on a non-zero exit or timeout.
 * The caller owns cwd and the private GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY
 * environment; the runner merges `env` over the ambient environment.
 */
export type GitRunner = (
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number }
) => Buffer;

/**
 * Classify one changed file's full content as text (true) or binary (false).
 *
 * Git's own binary heuristic (any NUL in the first ~8000 bytes) false-
 * positives on real sources with NUL bytes in literals
 * (packages/discover/src/paths.ts and siblings), and `git diff --numstat`
 * reports the same unoverridable binary marker for both those files and
 * genuine binaries — so the mechanism needs its own proportional check:
 * the fraction of non-text bytes across the WHOLE content, not NUL presence
 * in a prefix. Text verdicts accept `git diff --text`'s exact hunks; binary
 * verdicts degrade that path to whole-file scope with a `binary-scope` gap —
 * attributed either way, never silently excluded.
 */
export function classifyTextOrBinary(content: Buffer): boolean {
  if (content.length === 0) return true;
  let suspect = 0;
  let i = 0;
  while (i < content.length) {
    const b = content[i]!;
    if (b < 0x80) {
      // ASCII: everything printable plus the common text controls (BS, TAB,
      // LF, VT, FF, CR, ESC) is fine; other controls, NUL, and DEL are suspect.
      if ((b < 0x20 && (b < 0x08 || b > 0x0d) && b !== 0x1b) || b === 0x7f) suspect += 1;
      i += 1;
      continue;
    }
    // Multibyte: a well-formed UTF-8 sequence is text; malformed lead or
    // continuation bytes are suspect one byte at a time (resynchronizing).
    const len = b >= 0xf0 && b <= 0xf4 ? 4 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xc2 && b <= 0xdf ? 2 : 0;
    if (len === 0) {
      suspect += 1;
      i += 1;
      continue;
    }
    let wellFormed = i + len <= content.length;
    for (let j = 1; wellFormed && j < len; j += 1) {
      const c = content[i + j]!;
      if (c < 0x80 || c > 0xbf) wellFormed = false;
    }
    if (wellFormed) {
      i += len;
    } else {
      suspect += 1;
      i += 1;
    }
  }
  return suspect / content.length <= BINARY_SUSPECT_RATIO;
}

/**
 * The classifier's threshold: content whose suspect-byte fraction exceeds
 * this reads binary. Real sources with NUL-bearing literals sit orders of
 * magnitude below it (a handful of bytes over kilobytes of code); compressed
 * or full-range binary content sits far above (a third or more of its bytes
 * are non-text under the UTF-8 walk).
 */
const BINARY_SUSPECT_RATIO = 0.1;

/** The inputs {@link captureWriteTree} needs; subprocess I/O is injected. */
export interface CaptureWriteTreeInput {
  /** Absolute repo root (the runner's cwd). */
  repoRoot: string;
  /** Private GIT_OBJECT_DIRECTORY for this call; created if absent. */
  objectDir: string;
  /** Private temp index file path for this call (keyed by tool_use_id). */
  indexFile: string;
  /** Absolute path of the REAL object store the private dir's info/alternates points at. */
  alternates: string;
  /**
   * Absolute path of the repo's real index file (worktree-aware — the caller
   * resolves `git rev-parse --git-path index`), copied into `indexFile` so
   * git's stat cache stays warm and unchanged files are never read. Null
   * (index missing/unresolvable) starts the temp index empty — correct but
   * cold: every file is re-hashed once.
   */
  realIndexFile: string | null;
  /** The repo's span root; stat-only degrade filters span documents like the diff filter does. */
  spanRoot: string;
  /** Wall budget for the add+write-tree pair; exhaustion degrades to stat-only. */
  wallBudgetMs: number;
  /** Injected git runner. */
  runGit: GitRunner;
  /** Injected stat for the stat-only degrade walk: null when absent/unstat-able. */
  stat: StatFile;
}

/** The outcome of one write-tree capture (either side of a call). */
export interface CaptureWriteTreeResult {
  /** The write-tree SHA; null when the capture degraded (or failed outright). */
  treeSha: string | null;
  /** The stat-only degrade capture; present only when treeSha is null and the stat walk succeeded. */
  statOnly?: Record<string, StatOnlyEntry>;
  /** Degrade/failure diagnostics (`write-tree degraded to stat-only:` is path-coverage family). */
  gaps: string[];
}

/**
 * Take one private write-tree snapshot: ensure the private object dir exists
 * with `info/alternates` pointing at the real object store (load-bearing —
 * without it every blob is re-copied), prime the temp index by copying the
 * real index (warm stat cache: unchanged files are never read), then
 * `git add -A` + `git write-tree` under GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY.
 * On wall-budget exhaustion or git failure, degrade to a stat-only sweep
 * (path → size/mtimeNs over tracked + untracked-non-ignored files, span
 * documents filtered) with a path-coverage gap naming the degrade; when even
 * that fails, the result carries only gaps and the caller fails open.
 */
export function captureWriteTree(input: CaptureWriteTreeInput): CaptureWriteTreeResult {
  const { repoRoot, objectDir, indexFile, alternates, realIndexFile, spanRoot, wallBudgetMs, runGit, stat } = input;
  const gaps: string[] = [];
  const start = Date.now();
  const remaining = (): number => Math.max(1, wallBudgetMs - (Date.now() - start));
  try {
    mkdirSync(join(objectDir, 'info'), { recursive: true, mode: 0o700 });
    writeFileSync(join(objectDir, 'info', 'alternates'), `${alternates}\n`, { mode: 0o600 });
    if (realIndexFile !== null) copyFileSync(realIndexFile, indexFile);
    const env = { GIT_INDEX_FILE: indexFile, GIT_OBJECT_DIRECTORY: objectDir };
    runGit(['add', '-A'], { cwd: repoRoot, env, timeoutMs: remaining() });
    const out = runGit(['write-tree'], { cwd: repoRoot, env, timeoutMs: remaining() });
    const treeSha = out.toString('utf8').trim();
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(treeSha)) return { treeSha, gaps };
    gaps.push(`write-tree degraded to stat-only: unexpected write-tree output ${JSON.stringify(treeSha)}`);
  } catch (err) {
    gaps.push(`write-tree degraded to stat-only: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Degrade: enumerate tracked + untracked-non-ignored files against the REAL
  // index (no private env — the temp index may be partially written) and stat
  // each. File-granularity evidence only; the gap above is path-coverage
  // family, so siblings fail closed on this record.
  try {
    return {
      treeSha: null,
      statOnly: statOnlySweep({ repoRoot, spanRoot, timeoutMs: remaining(), runGit, stat }),
      gaps
    };
  } catch (err) {
    gaps.push(`stat-only sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    return { treeSha: null, gaps };
  }
}

/**
 * The stat-only sweep: tracked + untracked-non-ignored paths (span documents
 * filtered) each stat'ed to (size, mtimeNs). {@link captureWriteTree}'s
 * degrade path runs it after a failed write-tree, and the post side runs it
 * standalone when the PRE side degraded — a post write-tree would have no pre
 * tree to compare against, so mirroring the degrade is the only mode that
 * yields comparable evidence. Throws when the enumeration itself fails; the
 * caller owns the diagnostic.
 */
export function statOnlySweep(input: {
  repoRoot: string;
  spanRoot: string;
  timeoutMs: number;
  runGit: GitRunner;
  stat: StatFile;
}): Record<string, StatOnlyEntry> {
  const raw = input
    .runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: input.repoRoot,
      timeoutMs: input.timeoutMs
    })
    .toString('utf8');
  const spanRel = spanRootRelative(input.repoRoot, input.spanRoot);
  const statOnly: Record<string, StatOnlyEntry> = {};
  for (const rel of raw.split('\0')) {
    if (rel.length === 0 || isInsideSpanRoot(rel, spanRel)) continue;
    const st = input.stat(join(input.repoRoot, rel));
    if (st !== null) statOnly[rel] = { size: st.size, mtimeNs: st.mtimeNs };
  }
  return statOnly;
}

/**
 * The span root as a repo-relative posix path for {@link isInsideSpanRoot} —
 * capture and compare receive it absolute from the harness, while the filter
 * compares repo-relative enumeration output.
 */
function spanRootRelative(repoRoot: string, spanRoot: string): string {
  return isAbsolute(spanRoot) ? relative(repoRoot, spanRoot).split(sep).join('/') : spanRoot;
}

/** The inputs {@link compareTrees} needs; subprocess I/O is injected. */
export interface CompareTreesInput {
  /** The pre-side write-tree SHA. */
  preTreeSha: string;
  /** The post-side write-tree SHA. */
  postTreeSha: string;
  /** Absolute repo root (the runner's cwd). */
  repoRoot: string;
  /** The call's private object dir — both trees live there; diff/cat-file reads run under it. */
  objectDir: string;
  /** The repo's span root; span documents are filtered from the diff result. */
  spanRoot: string;
  /** The budgets in force (post-side wall budget; touched-files cap). */
  budgets: Pick<SnapshotBudgets, 'postSideWallSeconds' | 'maxTouchedFiles'>;
  /**
   * The instant the post-side work began. The wall budget measures elapsed
   * time since THIS instant — the comparison's own cost, never the command's
   * runtime.
   */
  wallStart: number;
  /** Injected git runner. */
  runGit: GitRunner;
  /** Injectable wall clock, defaulting to Date.now (fixtures pin the budget). */
  wallClock?: () => number;
}

/**
 * The comparison's outcome — the same attributions/unchanged/gaps contract
 * as {@link CompareSnapshotResult}, plus the per-changed-path content hashes
 * the interleaved-edit consult and the ambiguity table compare against.
 */
export interface CompareTreesResult {
  /** Attribution per repo-relative path; unchanged paths are omitted. */
  attributions: Map<string, PathAttribution>;
  /**
   * Every pre-tree path the comparison proved untouched (tree equality or
   * absent from the tree-to-tree diff) — the co-parser exclusion set, exactly
   * as v1's confirmed-unchanged walk produced. Enumerated from
   * `git ls-tree -r --name-only` (a tree walk, no content reads).
   */
  unchanged: Set<string>;
  /** Diagnostics: budget stops, `binary-scope` degrades, unreadable drops. */
  gaps: string[];
  /**
   * Node SHA-256 hex over pre/post blob bytes per CHANGED path (null side =
   * absent from that tree). This is the ActivityPathStamp hash space — the
   * consult and the ambiguity table compare these against activity-log
   * stamps, so they must never become git SHA-1 OIDs.
   */
  contentHashes: Map<string, { pre: string | null; post: string | null }>;
}

/**
 * Compare two write-trees into per-path attributions. Equal SHAs
 * short-circuit: no diff, no attributions — every tree path is unchanged.
 * Otherwise `git diff --name-status -M100% --text -z` names the changed
 * paths (the 100% floor pairs only byte-identical renames, matching
 * pairRenames' contract); per changed path the blob pair is read
 * (`git cat-file blob`), hashed (Node SHA-256), classified
 * ({@link classifyTextOrBinary}), and — when text on both sides —
 * `git diff --unified=0 --text` hunks map through {@link hunksToPostRanges}
 * to exact post ranges; a binary side degrades to whole-file scope with a
 * `binary-scope` gap. The touched-files cap and the post-side wall budget
 * stop the loop with the same diagnostic contract as compareSnapshot.
 */
export function compareTrees(input: CompareTreesInput): CompareTreesResult {
  const { preTreeSha, postTreeSha, repoRoot, objectDir, spanRoot, budgets, wallStart, runGit } = input;
  const clock = input.wallClock ?? Date.now;
  const wallMs = budgets.postSideWallSeconds * 1000;
  const wallExhausted = (): boolean => clock() - wallStart > wallMs;
  const remaining = (): number => Math.max(1, wallMs - (clock() - wallStart));
  const env = { GIT_OBJECT_DIRECTORY: objectDir };
  const spanRel = spanRootRelative(repoRoot, spanRoot);
  const attributions = new Map<string, PathAttribution>();
  const gaps: string[] = [];
  const contentHashes = new Map<string, { pre: string | null; post: string | null }>();
  const catBlob = (tree: string, path: string): Buffer =>
    runGit(['cat-file', 'blob', `${tree}:${path}`], { cwd: repoRoot, env, timeoutMs: remaining() });

  // The co-parser exclusion set starts as the whole pre tree (a tree walk, no
  // content reads); diff entries subtract their pre-side paths below.
  const preTreePaths = runGit(['ls-tree', '-r', '--name-only', '-z', preTreeSha], {
    cwd: repoRoot,
    env,
    timeoutMs: remaining()
  })
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0 && !isInsideSpanRoot(p, spanRel));
  const unchanged = new Set(preTreePaths);
  if (preTreeSha === postTreeSha) return { attributions, unchanged, gaps, contentHashes };

  const raw = runGit(['diff', '--name-status', '-M100%', '--text', '-z', preTreeSha, postTreeSha], {
    cwd: repoRoot,
    env,
    timeoutMs: remaining()
  }).toString('utf8');
  type DiffEntry = { status: 'M' | 'A' | 'D'; path: string } | { status: 'R'; from: string; to: string };
  const entries: DiffEntry[] = [];
  const tokens = raw.split('\0');
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i]!;
    if (status.length === 0) {
      i += 1;
      continue;
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = tokens[i + 1] ?? '';
      const to = tokens[i + 2] ?? '';
      i += 3;
      if (isInsideSpanRoot(from, spanRel) || isInsideSpanRoot(to, spanRel)) continue;
      unchanged.delete(from);
      entries.push({ status: 'R', from, to });
      continue;
    }
    const path = tokens[i + 1] ?? '';
    i += 2;
    if (isInsideSpanRoot(path, spanRel)) continue;
    if (status === 'M' || status === 'D') unchanged.delete(path);
    if (status === 'M' || status === 'A' || status === 'D') entries.push({ status, path });
  }

  let changedCount = 0;
  let attributed = 0;
  const pushWallGap = (fromIndex: number): void => {
    const rest = entries.slice(fromIndex).map((e) => (e.status === 'R' ? e.to : e.path));
    gaps.push(
      `post-side wall budget exhausted: attributed ${attributed}/${entries.length}, unattributed ${rest.join(', ')}`
    );
  };
  // A git call that overruns its remaining() slice throws ETIMEDOUT
  // MID-entry — that is the wall striking, not a broken path: it must close
  // the loop with the same exhaustion gap as the loop-top check, preserving
  // the attributions already made, never abort the whole compare.
  const isTimeout = (err: unknown): boolean =>
    (err !== null && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ETIMEDOUT') ||
    /ETIMEDOUT/.test(String(err));
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (wallExhausted()) {
      pushWallGap(i);
      break;
    }
    if (entry.status === 'R') {
      attributions.set(entry.to, { kind: 'rename', from: entry.from });
      attributed += 1;
      continue;
    }
    const path = entry.path;
    if (entry.status === 'A' || entry.status === 'D') {
      const tree = entry.status === 'A' ? postTreeSha : preTreeSha;
      let hash: string;
      try {
        hash = createHash('sha256').update(catBlob(tree, path)).digest('hex');
      } catch (err) {
        if (isTimeout(err)) {
          pushWallGap(i);
          break;
        }
        gaps.push(`unreadable at compare: ${path} dropped without attribution`);
        continue;
      }
      contentHashes.set(path, entry.status === 'A' ? { pre: null, post: hash } : { pre: hash, post: null });
      attributions.set(path, { kind: entry.status === 'A' ? 'created' : 'deleted' });
      attributed += 1;
      continue;
    }
    if (changedCount >= budgets.maxTouchedFiles) {
      gaps.push(`touched-files cap ${budgets.maxTouchedFiles} exceeded: ${path} not attributed`);
      continue;
    }
    changedCount += 1;
    let preBlob: Buffer;
    let postBlob: Buffer;
    try {
      preBlob = catBlob(preTreeSha, path);
      postBlob = catBlob(postTreeSha, path);
    } catch (err) {
      if (isTimeout(err)) {
        pushWallGap(i);
        break;
      }
      gaps.push(`unreadable at compare: ${path} dropped without attribution`);
      continue;
    }
    contentHashes.set(path, {
      pre: createHash('sha256').update(preBlob).digest('hex'),
      post: createHash('sha256').update(postBlob).digest('hex')
    });
    if (classifyTextOrBinary(preBlob) && classifyTextOrBinary(postBlob)) {
      let diffOut: string;
      try {
        // :(literal) pathspec magic: a raw path is a wildmatch pattern, so a
        // filename containing `*`, `?`, or `[...]` (Next.js `[slug].tsx`)
        // would also match sibling paths and merge their hunks into this
        // path's ranges — silently corrupting the attribution.
        diffOut = runGit(['diff', '--unified=0', '--text', preTreeSha, postTreeSha, '--', `:(literal)${path}`], {
          cwd: repoRoot,
          env,
          timeoutMs: remaining()
        }).toString('utf8');
      } catch (err) {
        if (isTimeout(err)) {
          pushWallGap(i);
          break;
        }
        throw err;
      }
      const hunks = parseUnifiedZeroHunks(diffOut);
      // Trees differ per name-status but the hunk parse came back empty —
      // never let that silently shrink attribution: whole-file scope.
      attributions.set(path, {
        kind: 'changed',
        observed: hunks.length > 0 ? hunksToPostRanges(hunks) : { changed: [], wholeFile: true }
      });
    } else {
      gaps.push(`binary-scope: ${path} classified binary, whole-file scope`);
      attributions.set(path, { kind: 'changed', observed: { changed: [], wholeFile: true } });
    }
    attributed += 1;
  }
  return { attributions, unchanged, gaps, contentHashes };
}

/**
 * Parse `git diff --unified=0` output into {@link DiffHunk}s from its `@@`
 * headers alone (zero context means the headers carry the exact regions; an
 * omitted count is git shorthand for 1).
 */
function parseUnifiedZeroHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const m of diffText.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({
      preStart: Number(m[1]),
      preLines: m[2] === undefined ? 1 : Number(m[2]),
      postStart: Number(m[3]),
      postLines: m[4] === undefined ? 1 : Number(m[4])
    });
  }
  return hunks;
}

/**
 * Compare two stat-only sweeps (either side degraded): file-granularity
 * create/delete/modify attributions, whole-file scope only — the visible,
 * budget-bounded fallback when the full write-tree mechanism could not
 * finish. A path present on both sides with equal (size, mtimeNs) reads
 * unchanged (degrade mode trades the v1 clock-trust re-read for cost — the
 * record already carries the path-coverage degrade gap, so siblings fail
 * closed on it regardless).
 */
export function compareStatOnly(
  pre: Record<string, StatOnlyEntry>,
  post: Record<string, StatOnlyEntry>
): CompareTreesResult {
  const attributions = new Map<string, PathAttribution>();
  const unchanged = new Set<string>();
  for (const [path, preEntry] of Object.entries(pre)) {
    const postEntry = post[path];
    if (postEntry === undefined) {
      attributions.set(path, { kind: 'deleted' });
    } else if (postEntry.size === preEntry.size && postEntry.mtimeNs === preEntry.mtimeNs) {
      unchanged.add(path);
    } else {
      attributions.set(path, { kind: 'changed', observed: { changed: [], wholeFile: true } });
    }
  }
  for (const path of Object.keys(post)) {
    if (!(path in pre)) attributions.set(path, { kind: 'created' });
  }
  return { attributions, unchanged, gaps: [], contentHashes: new Map() };
}

/** The inputs {@link hashTreePath} needs. */
export interface HashTreePathInput {
  /** The tree to read from. */
  treeSha: string;
  /** Repo-relative path within the tree. */
  path: string;
  /** Absolute repo root (the runner's cwd). */
  repoRoot: string;
  /** The record's private object dir the tree lives in. */
  objectDir: string;
  /** Injected git runner. */
  runGit: GitRunner;
  /** Per-subprocess timeout; a hang here must never stall the whole branch. */
  timeoutMs?: number;
}

/**
 * The discriminated outcome of one tree-path hash read. `absent` is proven
 * (the tree lists no entry at the path); `error` is everything else — a
 * missing/reaped object dir, a corrupt tree, a subprocess timeout. The two
 * MUST stay distinguishable: absent means "the sibling's evidence excludes
 * the path" (not covering), while error means "the sibling's evidence is
 * unreadable" — the ambiguity view has to fail closed on it, never read it
 * as not-covering.
 */
export type TreePathHash = { kind: 'hash'; hash: string } | { kind: 'absent' } | { kind: 'error'; reason: string };

/**
 * Node SHA-256 hex of `treeSha:path`'s blob bytes, as a {@link TreePathHash}
 * — the on-demand sibling-hash read the ambiguity table uses now that
 * records persist tree SHAs instead of per-path hash maps. Absence is proven
 * by an `ls-tree` probe (success with empty output — the one shape a failed
 * read can never produce) before the blob read; the probe uses `:(literal)`
 * pathspec magic so a metacharacter filename can never match a sibling
 * entry. Callers memoize per (treeSha, path) within one branch invocation.
 */
export function hashTreePath(input: HashTreePathInput): TreePathHash {
  const opts = {
    cwd: input.repoRoot,
    env: { GIT_OBJECT_DIRECTORY: input.objectDir },
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {})
  };
  try {
    const listing = input.runGit(['ls-tree', input.treeSha, '--', `:(literal)${input.path}`], opts);
    if (listing.toString('utf8').trim() === '') return { kind: 'absent' };
    const blob = input.runGit(['cat-file', 'blob', `${input.treeSha}:${input.path}`], opts);
    return { kind: 'hash', hash: createHash('sha256').update(blob).digest('hex') };
  } catch (err) {
    return { kind: 'error', reason: String(err) };
  }
}
