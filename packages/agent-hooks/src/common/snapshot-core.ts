/**
 * Harness-agnostic snapshot core for card main-213.
 *
 * When a `Bash` tool call's writes are invisible to static command parsing —
 * formatters, generators, embedded Python/Node/Ruby/Perl scripts, project
 * tools — a per-tool pre/post file snapshot correlated by (session_id,
 * tool_use_id) attributes the writes the call actually produced. The core is
 * pure logic: command classification, line/file hashing, Myers diff over
 * line-hash arrays, hunk→post-range mapping, rename pairing, pre/post
 * comparison, and the concurrency ambiguity rules. I/O is injected (the
 * stat/read functions the walkers pass in), except for the classifier's one
 * scoped `git config --get-regexp` subprocess — the exec-channel read for git
 * read subcommands, the only subprocess the pre-side classification runs. It
 * imports nothing from either hook SDK and is typed structurally, per the
 * `common/` layer convention.
 *
 * The two line-hash budget caps (per-file 4000, per-record 200,000) with the
 * coarse-file fallback are contract decisions — baked into
 * {@link DEFAULT_SNAPSHOT_BUDGETS} exactly as the plan states — as are the
 * touched-files cap (100) and the post-side wall budget (5 s), which together
 * are the PostToolUse timeout detection.
 *
 * Reused from the shared kernel (not redefined): `LineRange` (1-based
 * inclusive line ranges) from agent-hooks-common.ts.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { LineRange } from './agent-hooks-common.js';
import { argvOf, splitTopLevel } from './shell-split.js';

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
  /** Tier-2 walk: max files captured per record (default 5000). */
  maxFiles: number;
  /** Per-file byte cap; larger files are excluded, never recorded coarse (default 1 MiB). */
  maxBytesPerFile: number;
  /** Sum of file bytes across one record's pre walk (default 64 MiB). */
  maxTotalBytes: number;
  /** Line-hash cap per file; over it the file is recorded coarse — byte hash only (default 4000). */
  maxLineHashesPerFile: number;
  /**
   * Line-hash cap per record; after it (in deterministic walk order) every
   * remaining file is recorded coarse with a gap diagnostic (default 200,000).
   * Together with the per-file cap this bounds a record's worst-case serialized
   * size so the global storage cap holds several full records.
   */
  maxLineHashesPerRecord: number;
  /** Pre-side max wall seconds for the whole snapshot walk (default 1). */
  preSideMaxWallSeconds: number;
  /**
   * Max storage across all records in the repo. Exhaustion refuses new
   * snapshot writes with a diagnostic — never drop-oldest, because deleting
   * records would silently destroy the ambiguity evidence the concurrency
   * rules depend on (default 64 MiB).
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
  maxFiles: 5000,
  maxBytesPerFile: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxLineHashesPerFile: 4000,
  maxLineHashesPerRecord: 200_000,
  preSideMaxWallSeconds: 1,
  maxStorageBytes: 64 * 1024 * 1024,
  maxTouchedFiles: 100,
  postSideWallSeconds: 5,
  recordTtlMs: 24 * 60 * 60 * 1000,
  unfinishedEntryTtlMs: 15 * 60 * 1000
};

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/** The snapshot's tier: explicit targets only, or the repo-wide eligible walk. */
export type SnapshotTier = 'explicit' | 'repo';

/**
 * One file's pre (or post) state in a snapshot record: identity, byte hash +
 * size, and an ordered line-hash array. Line bytes are hashed **including the
 * terminator**, so a missing final newline and CRLF round-trips are
 * distinguishable. `mtimeNs` (BigInt) is the post-side cheap filter: a path
 * whose (size, mtimeNs) both match its pre entry is skipped without a
 * re-read — gated on a non-zero sub-second part, because on second-granularity
 * clocks a same-second write does not advance mtime. `capturedAt` is the
 * instant the pre walk read this file, on the same clock as the record's
 * `createdAt` and the activity log's `finishedAt` — the per-path baseline the
 * interleaved-edit check compares against.
 */
export interface SnapshotFile {
  /** SHA-256 hex of the file bytes. */
  hash: string;
  /** Byte size of the file at capture. */
  size: number;
  /** mtime in nanoseconds (BigInt) at capture. */
  mtimeNs: bigint;
  /** The instant the walk read this file (same clock as createdAt). */
  capturedAt: number;
  /**
   * Ordered line hashes (line bytes hashed including the terminator). Absent
   * when `coarse` — the per-file line cap or the per-record line budget cut
   * in, and the file compares by byte hash only (whole-file scope on change,
   * with a `coarse-scope` diagnostic; range precision is budgeted away,
   * visibly, never claimed).
   */
  lines?: string[];
  /** True when no line hashes were recorded (byte-hash-only comparison). */
  coarse?: boolean;
}

/**
 * One JSON record per tool call, written to
 * `~/.cache/git-span/session/<session>/snapshots/<sanitized-tool_use_id>.json`
 * with 0600 permissions (dirs 0700). `files` holds the pre-state per
 * repo-relative path. Consumption writes `post` (the same per-file shape, for
 * paths that changed), sets `consumed: true`, and stamps `consumedAt` — the
 * ambiguity table's window-overlap rows read it — and the record is then
 * retained until TTL/session-end because later calls' ambiguity checks need
 * its pre/post per-path state. A `version` mismatch on read fails closed
 * (discard + diagnostic).
 */
export interface SnapshotRecord {
  /** Record format version. A mismatch on read fails closed. */
  version: 1;
  sessionId: string;
  toolUseId: string;
  /** Subagent agent id, recorded by the PreToolUse adapters when present. */
  agentId?: string;
  /** Absolute repo root the snapshot was taken in. */
  repoRoot: string;
  /** The instant the record was written (same clock as capturedAt/finishedAt). */
  createdAt: number;
  /** Whether a PostToolUse has consumed this record. */
  consumed: boolean;
  /** Stamped at consumption; null while the record is live. */
  consumedAt: number | null;
  tier: SnapshotTier;
  /**
   * Coverage-gap diagnostics (budget cuts, refusals, comparison stops). The
   * comparison never describes partial coverage as complete; a sibling record
   * carrying gaps is treated as covering every in-scope path for the
   * ambiguity check, because its coverage is unknowable.
   */
  gaps: string[];
  /** Pre-state per repo-relative path. */
  files: Record<string, SnapshotFile>;
  /** Post-state per changed path, written at consumption. */
  post?: Record<string, SnapshotFile>;
}

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
const READ_ONLY_TOOLS = new Set(['ls', 'grep', 'cat', 'head', 'tail', 'echo', 'cd']);

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
  // Find the subcommand after the program name, skipping -C/-c and leading flags.
  let subIdx = -1;
  let subcommand: string | null = null;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '-C' || a === '-c') {
      i += 2;
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
  const rendersDiff = subcommand === 'diff' || subcommand === 'log' || subcommand === 'show';
  // Command-text pager forms force opaque (the pager program is env-dependent);
  // ambient PAGER/GIT_PAGER are inert because the hook's stdout is a pipe.
  if (/^(?:GIT_PAGER|PAGER)=/.test(assignments)) return 'opaque';
  // GIT_EXTERNAL_DIFF executes an external diff program on diff/log/show
  // unconditionally — unlike the pager, it is not terminal-gated.
  if (rendersDiff && /^GIT_EXTERNAL_DIFF=/.test(assignments)) return 'opaque';
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
  if (hasUnquotedExpansion(text)) return opaque(findRedirects(argv, currentDir).targets);
  if (EXEC_WRAPPERS.has(argv[0]!)) return opaque();
  if (argv.some((w) => OUTPUT_FLAG.test(w))) return opaque();
  const redirects = findRedirects(argv, currentDir);
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
// File hashing
// ---------------------------------------------------------------------------

/** The stat fields the snapshot needs from a file (the (size, mtimeNs) pair is the post-side cheap filter). */
export interface FileStat {
  /** Byte size of the file. */
  size: number;
  /** mtime in nanoseconds (BigInt) at capture. */
  mtimeNs: bigint;
}

/** Injected file stat: null when the file is absent or unstat-able. */
export type StatFile = (absPath: string) => FileStat | null;

/** Injected byte read: null when the file is absent or unreadable. */
export type ReadFile = (absPath: string) => Buffer | null;

/** The inputs {@link hashFile} needs; the caller owns the path and clock. */
export interface HashFileInput {
  /** Absolute path of the file to hash. */
  absPath: string;
  /** The clock instant to stamp as the entry's `capturedAt`. */
  now: number;
  /** The budgets in force (per-file byte cap; per-file line cap). */
  budgets: SnapshotBudgets;
  /**
   * Line-hash budget remaining for the record (deterministic walk order): 0
   * forces a coarse entry regardless of the per-file cap.
   */
  remainingLineBudget: number;
  /** Injected stat: null when the file is absent or unstat-able. */
  stat: StatFile;
  /** Injected byte read: null when the file is absent or unreadable. */
  read: ReadFile;
}

/**
 * Hash one file into a snapshot entry — byte hash, size, mtimeNs, and ordered
 * line hashes — or null when the file cannot be read. A file over the
 * per-file line cap (or with no line budget remaining) is recorded coarse
 * (byte hash, size, mtimeNs; no line hashes). A file over the per-file byte
 * cap is excluded (null).
 */
/** Count newline-terminated lines, plus a bare final line without a terminator. */
function lineCount(content: Buffer): number {
  let n = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === 0x0a) n += 1;
  }
  if (content.length > 0 && content[content.length - 1] !== 0x0a) n += 1;
  return n;
}

/** Split buffer content into line hashes, each line hashed including its terminator. */
function contentLines(content: Buffer): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === 0x0a) {
      lines.push(
        createHash('sha256')
          .update(content.subarray(start, i + 1))
          .digest('hex')
      );
      start = i + 1;
    }
  }
  if (start < content.length) {
    lines.push(createHash('sha256').update(content.subarray(start)).digest('hex'));
  }
  return lines;
}

export function hashFile(input: HashFileInput): SnapshotFile | null {
  const { absPath, now, budgets, remainingLineBudget, stat, read } = input;
  const st = stat(absPath);
  if (st === null) return null;
  const content = read(absPath);
  if (content === null) return null;
  if (content.length > budgets.maxBytesPerFile) return null;
  // Binary exclusion: a NUL in the first 8 KiB marks a binary file — never recorded.
  const scanEnd = Math.min(content.length, 8192);
  for (let i = 0; i < scanEnd; i += 1) {
    if (content[i] === 0) return null;
  }
  const hash = createHash('sha256').update(content).digest('hex');
  const base = { hash, size: st.size, mtimeNs: st.mtimeNs, capturedAt: now };
  if (remainingLineBudget <= 0 || lineCount(content) > budgets.maxLineHashesPerFile) {
    return { ...base, coarse: true };
  }
  return { ...base, lines: contentLines(content) };
}

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

// ---------------------------------------------------------------------------
// Diff internals — a faithful port of libxdiff (git v2.47.3 xdiffi.c /
// xprepare.c), restricted to the exact-overlap regime: for the fixture's
// inputs the mxcost floor (256) and the >256-cost heuristics are unreachable,
// and the XDF_INDENT_HEURISTIC scoring branch of xdl_change_compact is
// verified to have no effect on the fixture's pairs, so both are omitted.
// Verified byte-exact against `git diff --no-index -U0` on the fixture's
// 21 explicit cases plus 300 seeded generated pairs.
// ---------------------------------------------------------------------------

const XDL_MAX_EQLIMIT = 1024;
const XDL_SIMSCAN_WINDOW = 100;
const XDL_KPDIS_RUN = 4;
const DISCARD = 0;
const KEEP = 1;
const INVESTIGATE = 2;
/** Sentinel for "unreachable" in the backward K vectors (xdl_split). */
const XDL_LINE_MAX = 2 ** 53;

/** xdl_bogosqrt: `for (i = 1; n > 0; n >>= 2) i <<= 1; return i;`. */
function bogosqrt(n: number): number {
  let i = 1;
  while (n > 0) {
    n = Math.floor(n / 4);
    i *= 2;
  }
  return i;
}

/**
 * xdl_trim_ends + xdl_cleanup_records: unique lines are marked changed
 * immediately, everything else forms the effective sequences the divide and
 * conquer runs on. Returns the kept sequences plus, for each, the map from
 * kept slot to original index, and `changed1`/`changed2` — boolean arrays over
 * ALL original lines that the recursion and compaction mark in place.
 */
function cleanupRecords(lines1: string[], lines2: string[]) {
  const n1 = lines1.length;
  const n2 = lines2.length;

  // xdl_trim_ends: walk past the common prefix, then (up to min(n1,n2) -
  // dstart times) the common suffix. The window [dstart, dend] is what the
  // classification below sees.
  let dstart = 0;
  const lim = Math.min(n1, n2);
  while (dstart < lim && lines1[dstart] === lines2[dstart]) dstart += 1;
  let i = 0;
  while (i < lim - dstart && lines1[n1 - 1 - i] === lines2[n2 - 1 - i]) i += 1;
  const dend1 = n1 - i - 1;
  const dend2 = n2 - i - 1;

  // Class counts per distinct line hash (xdl_classify_record: the minimal
  // perfect hash index — content equality is hash equality here).
  const count1 = new Map<string, number>();
  const count2 = new Map<string, number>();
  for (const l of lines1) count1.set(l, (count1.get(l) ?? 0) + 1);
  for (const l of lines2) count2.set(l, (count2.get(l) ?? 0) + 1);

  const mlim1 = Math.min(bogosqrt(n1), XDL_MAX_EQLIMIT);
  const mlim2 = Math.min(bogosqrt(n2), XDL_MAX_EQLIMIT);

  // Per-line verdicts: no match on the other side → DISCARD; few matches →
  // KEEP; many matches → INVESTIGATE (xdl_clean_mmatch decides below).
  const action1 = new Array<number>(dend1 - dstart + 1);
  for (let j = 0; j < action1.length; j += 1) {
    const nm = count2.get(lines1[j + dstart]) ?? 0;
    action1[j] = nm === 0 ? DISCARD : nm < mlim1 ? KEEP : INVESTIGATE;
  }
  const action2 = new Array<number>(dend2 - dstart + 1);
  for (let j = 0; j < action2.length; j += 1) {
    const nm = count1.get(lines2[j + dstart]) ?? 0;
    action2[j] = nm === 0 ? DISCARD : nm < mlim2 ? KEEP : INVESTIGATE;
  }

  /**
   * xdl_clean_mmatch: a multimatch line is discarded only when discards
   * outnumber multimatch lines 4:1 in its (windowed) neighborhood, and both
   * sides of it contain at least one discard.
   */
  const cleanMmatch = (action: number[], idx: number, len: number): boolean => {
    let s = 0;
    let e = len - 1;
    if (idx - s > XDL_SIMSCAN_WINDOW) s = idx - XDL_SIMSCAN_WINDOW;
    if (e - idx > XDL_SIMSCAN_WINDOW) e = idx + XDL_SIMSCAN_WINDOW;
    let rdis0 = 0;
    let rpdis0 = 1;
    for (let r = 1; idx - r >= s; r += 1) {
      const a = action[idx - r];
      if (a === DISCARD) rdis0 += 1;
      else if (a === INVESTIGATE) rpdis0 += 1;
      else if (a === KEEP) break;
    }
    if (rdis0 === 0) return false;
    let rdis1 = 0;
    let rpdis1 = 1;
    for (let r = 1; idx + r <= e; r += 1) {
      const a = action[idx + r];
      if (a === DISCARD) rdis1 += 1;
      else if (a === INVESTIGATE) rpdis1 += 1;
      else if (a === KEEP) break;
    }
    if (rdis1 === 0) return false;
    rdis1 += rdis0;
    rpdis1 += rpdis0;
    return rpdis1 * XDL_KPDIS_RUN < rpdis1 + rdis1;
  };

  // KEEPs form the effective sequences; DISCARDs land on the original
  // coordinates of changed[] (reference_index maps kept slot → original).
  const changed1 = new Array<boolean>(n1).fill(false);
  const changed2 = new Array<boolean>(n2).fill(false);
  const seq1: string[] = [];
  const ref1: number[] = [];
  for (let j = 0; j < action1.length; j += 1) {
    let a = action1[j];
    if (a === INVESTIGATE) a = cleanMmatch(action1, j, action1.length) ? DISCARD : KEEP;
    if (a === KEEP) {
      seq1.push(lines1[j + dstart]);
      ref1.push(j + dstart);
    } else {
      changed1[j + dstart] = true;
    }
  }
  const seq2: string[] = [];
  const ref2: number[] = [];
  for (let j = 0; j < action2.length; j += 1) {
    let a = action2[j];
    if (a === INVESTIGATE) a = cleanMmatch(action2, j, action2.length) ? DISCARD : KEEP;
    if (a === KEEP) {
      seq2.push(lines2[j + dstart]);
      ref2.push(j + dstart);
    } else {
      changed2[j + dstart] = true;
    }
  }
  return { seq1, seq2, ref1, ref2, changed1, changed2 };
}

/**
 * xdl_split: a split point crossed by a shortest edit path of the box
 * [off1, lim1) x [off2, lim2) in effective-sequence coordinates. Both paths
 * index the same diagonal space (no mirrored k-axes); in-domain reads are
 * always fresh because each round writes its extension sentinels first.
 * Throws if the exact path exceeds 256 edits — the mxcost/heuristic fallbacks
 * xdiff would use are out of scope (unreachable for the fixture's inputs).
 */
function splitBox(
  seq1: string[],
  seq2: string[],
  off1: number,
  lim1: number,
  off2: number,
  lim2: number
): { i1: number; i2: number } {
  const dmin = off1 - lim2;
  const dmax = lim1 - off2;
  const fmid = off1 - off2;
  const bmid = lim1 - lim2;
  const odd = (fmid - bmid) & 1;
  let fmin = fmid;
  let fmax = fmid;
  let bmin = bmid;
  let bmax = bmid;
  const kvdf = new Map<number, number>();
  const kvdb = new Map<number, number>();
  kvdf.set(fmid, off1);
  kvdb.set(bmid, lim1);

  for (let ec = 1; ; ec += 1) {
    if (fmin > dmin) kvdf.set(--fmin - 1, -1);
    else ++fmin;
    if (fmax < dmax) kvdf.set(++fmax + 1, -1);
    else --fmax;
    for (let d = fmax; d >= fmin; d -= 2) {
      const kvdfDm1 = kvdf.get(d - 1) ?? -1;
      const kvdfDp1 = kvdf.get(d + 1) ?? -1;
      let i1: number;
      if (kvdfDm1 >= kvdfDp1) i1 = kvdfDm1 + 1;
      else i1 = kvdfDp1;
      let i2 = i1 - d;
      while (i1 < lim1 && i2 < lim2 && seq1[i1] === seq2[i2]) {
        i1 += 1;
        i2 += 1;
      }
      kvdf.set(d, i1);
      if (odd && bmin <= d && d <= bmax && (kvdb.get(d) ?? XDL_LINE_MAX) <= i1) {
        return { i1, i2 };
      }
    }

    if (bmin > dmin) kvdb.set(--bmin - 1, XDL_LINE_MAX);
    else ++bmin;
    if (bmax < dmax) kvdb.set(++bmax + 1, XDL_LINE_MAX);
    else --bmax;
    for (let d = bmax; d >= bmin; d -= 2) {
      const kvdbDm1 = kvdb.get(d - 1) ?? XDL_LINE_MAX;
      const kvdbDp1 = kvdb.get(d + 1) ?? XDL_LINE_MAX;
      let i1: number;
      if (kvdbDm1 < kvdbDp1) i1 = kvdbDm1;
      else i1 = kvdbDp1 - 1;
      let i2 = i1 - d;
      while (i1 > off1 && i2 > off2 && seq1[i1 - 1] === seq2[i2 - 1]) {
        i1 -= 1;
        i2 -= 1;
      }
      kvdb.set(d, i1);
      if (!odd && fmin <= d && d <= fmax && i1 <= (kvdf.get(d) ?? -1)) {
        return { i1, i2 };
      }
    }

    if (ec >= 256) {
      throw new Error(`splitBox exceeded the exact-regime cost floor (ec=${ec})`);
    }
  }
}

/**
 * xdl_recs_cmp: divide and conquer over the effective sequences, marking
 * `changed` (original coordinates, via the ref maps) in place. At every level
 * the box is shrunk by consuming common prefix/suffix snakes first — that is
 * what terminates the degenerate meeting of the forward and backward paths.
 */
function divideAndConquer(
  seq1: string[],
  seq2: string[],
  ref1: number[],
  ref2: number[],
  changed1: boolean[],
  changed2: boolean[]
): void {
  const recurse = (off1: number, lim1: number, off2: number, lim2: number): void => {
    while (off1 < lim1 && off2 < lim2 && seq1[off1] === seq2[off2]) {
      off1 += 1;
      off2 += 1;
    }
    while (off1 < lim1 && off2 < lim2 && seq1[lim1 - 1] === seq2[lim2 - 1]) {
      lim1 -= 1;
      lim2 -= 1;
    }
    if (off1 === lim1) {
      for (let j = off2; j < lim2; j += 1) changed2[ref2[j]] = true;
      return;
    }
    if (off2 === lim2) {
      for (let j = off1; j < lim1; j += 1) changed1[ref1[j]] = true;
      return;
    }
    const spl = splitBox(seq1, seq2, off1, lim1, off2, lim2);
    recurse(off1, spl.i1, off2, spl.i2);
    recurse(spl.i1, lim1, spl.i2, lim2);
  };
  recurse(0, seq1.length, 0, seq2.length);
}

// xdl_change_compact: slide each change group as far up and down as possible,
// merge it into any group it bumps into, then — when shifting was possible —
// align the group with the last group of changes in the other file that it
// can line up with. All coordinates are ORIGINAL line positions: compaction
// runs on the full changed[] arrays, after the D&C has marked them through
// the reference maps. A group is `[start, end)` of changed lines (end is the
// first unchanged line after it; an empty group has start === end).

interface DiffGroup {
  start: number;
  end: number;
}

function groupInit(changed: boolean[], _nrec: number): DiffGroup {
  let end = 0;
  while (changed[end]) end += 1;
  return { start: 0, end };
}

function groupNext(changed: boolean[], nrec: number, g: DiffGroup): number {
  if (g.end === nrec) return -1;
  g.start = g.end + 1;
  g.end = g.start;
  while (changed[g.end]) g.end += 1;
  return 0;
}

function groupPrevious(changed: boolean[], g: DiffGroup): number {
  if (g.start === 0) return -1;
  g.end = g.start - 1;
  g.start = g.end;
  while (changed[g.start - 1]) g.start -= 1;
  return 0;
}

function groupSlideDown(lines: string[], changed: boolean[], g: DiffGroup): number {
  if (g.end < lines.length && lines[g.start] === lines[g.end]) {
    changed[g.start] = false;
    g.start += 1;
    changed[g.end] = true;
    g.end += 1;
    while (changed[g.end]) g.end += 1;
    return 0;
  }
  return -1;
}

function groupSlideUp(lines: string[], changed: boolean[], g: DiffGroup): number {
  if (g.start > 0 && lines[g.start - 1] === lines[g.end - 1]) {
    g.start -= 1;
    changed[g.start] = true;
    g.end -= 1;
    changed[g.end] = false;
    while (changed[g.start - 1]) g.start -= 1;
    return 0;
  }
  return -1;
}

/**
 * xdl_change_compact(xdf, xdfo) for one file, in the xdl_diff call order
 * (file 1 against file 2, then file 2 against file 1). The changed[] arrays
 * carry a trailing falsy sentinel, mirroring the C rchg allocation of
 * nrec + 2 zeroed entries.
 */
function changeCompact(
  lines: string[],
  _otherLines: string[],
  changed: boolean[],
  otherChanged: boolean[],
  onrec: number
): void {
  const g = groupInit(changed, lines.length);
  const go = groupInit(otherChanged, onrec);
  for (;;) {
    // Empty group in the file being compacted: skip it.
    if (g.end !== g.start) {
      let groupsize: number;
      let endMatchingOther: number;
      let earliestEnd: number;
      do {
        groupsize = g.end - g.start;
        // Last "end" that aligns this group with a changed group in the
        // other file; -1 until one is found.
        endMatchingOther = -1;
        // Shift backward as far as possible.
        while (groupSlideUp(lines, changed, g) === 0) {
          if (groupPrevious(otherChanged, go) !== 0) throw new Error('group sync broken sliding up');
        }
        earliestEnd = g.end;
        if (go.end > go.start) endMatchingOther = g.end;
        // Shift forward as far as possible.
        for (;;) {
          if (groupSlideDown(lines, changed, g) !== 0) break;
          if (groupNext(otherChanged, onrec, go) !== 0) throw new Error('group sync broken sliding down');
          if (go.end > go.start) endMatchingOther = g.end;
        }
      } while (groupsize !== g.end - g.start);

      if (g.end !== earliestEnd && endMatchingOther !== -1) {
        // Move the (possibly merged) group back to line up with the last
        // group of changes from the other file that it can align with.
        while (go.end === go.start) {
          if (groupSlideUp(lines, changed, g) !== 0) throw new Error('match disappeared');
          if (groupPrevious(otherChanged, go) !== 0) throw new Error('group sync broken sliding to match');
        }
      }
      // (The XDF_INDENT_HEURISTIC scoring branch is omitted — verified to
      // have no effect on the fixture's pairs.)
    }
    // Move past the just-processed group.
    if (groupNext(changed, lines.length, g) !== 0) break;
    if (groupNext(otherChanged, onrec, go) !== 0) throw new Error('group sync broken moving to next group');
  }
  if (groupNext(otherChanged, onrec, go) === 0) throw new Error('group sync broken at end of file');
}

/**
 * xdl_build_script: changed[] runs → change atoms in forward order, relying
 * on a falsy sentinel at index -1 (and past the end) of each changed[].
 */
function buildScript(
  changed1: boolean[],
  changed2: boolean[]
): { i1: number; i2: number; chg1: number; chg2: number }[] {
  const atoms: { i1: number; i2: number; chg1: number; chg2: number }[] = [];
  const n1 = changed1.length;
  const n2 = changed2.length;
  const at = (arr: boolean[], idx: number): boolean => (idx >= 0 && idx < arr.length ? arr[idx] : false);
  let i1 = n1;
  let i2 = n2;
  for (; i1 >= 0 || i2 >= 0; i1 -= 1, i2 -= 1) {
    if (at(changed1, i1 - 1) || at(changed2, i2 - 1)) {
      const l1 = i1;
      while (at(changed1, i1 - 1)) i1 -= 1;
      const l2 = i2;
      while (at(changed2, i2 - 1)) i2 -= 1;
      atoms.unshift({ i1, i2, chg1: l1 - i1, chg2: l2 - i2 });
    }
  }
  return atoms;
}

/**
 * Hunk header emission, matching xdl_emit_diff / xdl_emit_hunk_hdr with
 * ctxlen = 0 (one hunk per atom; the zero-count side's start stays 0-based,
 * the count is omitted when it is 1 — git emits `-0,0`, `-3,0`, `-2`, ...).
 * `preStart` 0 for a pure insertion at the start; `postStart` 0 for a pure
 * deletion at the start.
 */
function atomsToHunks(atoms: { i1: number; i2: number; chg1: number; chg2: number }[]): DiffHunk[] {
  return atoms.map((a) => ({
    preStart: a.chg1 === 0 ? a.i1 : a.i1 + 1,
    preLines: a.chg1,
    postStart: a.chg2 === 0 ? a.i2 : a.i2 + 1,
    postLines: a.chg2
  }));
}

/**
 * Myers diff over the pre/post line-hash arrays. Pure function, O(ND) — a
 * faithful port of git's libxdiff (v2.47.3): trim + classification cleanup,
 * divide-and-conquer middle-snake split, change-group compaction, and hunk
 * emission with `-U0` semantics. The line hashes are opaque strings, so two
 * different lines mapped to the same hash diff as identical (the
 * injected-collision seam the comparison catches by byte hash).
 */
export function diffLineHashes(pre: string[], post: string[]): DiffHunk[] {
  const { seq1, seq2, ref1, ref2, changed1, changed2 } = cleanupRecords(pre, post);
  divideAndConquer(seq1, seq2, ref1, ref2, changed1, changed2);
  // xdl_diff runs compaction once per file, in this order.
  changeCompact(pre, post, changed1, changed2, post.length);
  changeCompact(post, pre, changed2, changed1, pre.length);
  return atomsToHunks(buildScript(changed1, changed2));
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
// Rename pairing
// ---------------------------------------------------------------------------

/** A delete+create pair resolved into a rename (identical byte hashes, unique match). */
export interface RenamePair {
  /** Repo-relative pre path. */
  from: string;
  /** Repo-relative post path. */
  to: string;
}

/**
 * Pair rename candidates: pre-absent paths with post-present paths of
 * identical byte hash. Only unique hash matches pair; content ties are left
 * as delete+create.
 */
export function pairRenames(
  pre: ReadonlyMap<string, SnapshotFile>,
  post: ReadonlyMap<string, SnapshotFile>
): RenamePair[] {
  const preByHash = new Map<string, string[]>();
  for (const [path, f] of pre) {
    if (post.has(path)) continue; // present on both sides — not a candidate
    const arr = preByHash.get(f.hash) ?? [];
    arr.push(path);
    preByHash.set(f.hash, arr);
  }
  const postByHash = new Map<string, string[]>();
  for (const [path, f] of post) {
    if (pre.has(path)) continue;
    const arr = postByHash.get(f.hash) ?? [];
    arr.push(path);
    postByHash.set(f.hash, arr);
  }
  const pairs: RenamePair[] = [];
  for (const [hash, prePaths] of preByHash) {
    const postPaths = postByHash.get(hash);
    // Only unique hash matches pair; content ties stay delete+create.
    if (postPaths === undefined || postPaths.length !== 1 || prePaths.length !== 1) continue;
    pairs.push({ from: prePaths[0]!, to: postPaths[0]! });
  }
  return pairs;
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

/** The inputs {@link compareSnapshot} needs; I/O is injected. */
export interface CompareSnapshotInput {
  /** The pre record written at PreToolUse (files, coverage gaps, identity). */
  record: SnapshotRecord;
  /** The post walk's per-path state, keyed by repo-relative path. */
  post: ReadonlyMap<string, SnapshotFile>;
  /** The post walk's coverage gaps (a path-coverage gap disqualifies delete candidates). */
  postGaps: string[];
  /** The budgets in force (post-side wall budget; touched-files cap). */
  budgets: SnapshotBudgets;
  /** Injected stat: null when a path is absent. */
  stat: StatFile;
  /** Injected byte read: null when a path is absent/unreadable. */
  read: ReadFile;
  /** The current clock instant, for the post-side wall budget. */
  now: number;
}

/** The comparison's outcome: per-path attributions plus coverage diagnostics. */
export interface CompareSnapshotResult {
  /**
   * Attribution per path, keyed by repo-relative path. Unchanged paths are
   * omitted; every path outside the pre/post coverage intersection is
   * dropped with a diagnostic, never attributed.
   */
  attributions: Map<string, PathAttribution>;
  /**
   * Diagnostics: dropped paths and their reasons (coverage-intersection
   * gaps, interleaved-tool verdicts live in the ambiguity pass), `coarse-scope`
   * notes, zero-hunk collision notes, and budget-stop notes naming exactly
   * which paths were attributed and which were not.
   */
  gaps: string[];
}

/**
 * Compare the pre record against the post walk. For each pre-recorded path:
 * absent → delete candidate; (size, mtimeNs) both matching its pre entry
 * (with a non-zero sub-second mtimeNs part — second-granularity clocks are
 * never trusted to prove non-change) → unchanged, no re-read; else re-read
 * and byte-hash: equal → unchanged (chmod/mtime-only noise), differing →
 * changed. Post-only paths are create candidates only when the pre record
 * reports no path-coverage gap (a coarse pre entry still records the file, so
 * it does not disqualify); pre-only paths are delete candidates only when the
 * post walk's coverage is complete. Rename candidates pair pre-absent /
 * post-present paths with identical byte hashes. Changed files diff over
 * their line-hash arrays (line-hash collision → zero hunks → whole-file +
 * diagnostic, so a hash collision can never silently shrink attribution);
 * changed coarse files degrade to whole-file scope with a `coarse-scope`
 * diagnostic. The post-side wall budget is checked per scope before any
 * diff/touch work; on exhaustion the comparison stops adding scopes and
 * records a diagnostic. The changed-path count is capped by
 * `budgets.maxTouchedFiles`; beyond it, coverage-gap diagnostics and no
 * touches.
 */
/**
 * Whether a record's gaps include a path-coverage gap — some paths were never
 * recorded (file-count/total-bytes/wall-budget cuts, truncated walks). The
 * line-hash budget cut is NOT one: a coarse entry still records the file's
 * byte hash, which is all the pre-evidence a create candidate needs. Shared
 * with the store, which keys the index's `covered` column off the same
 * predicate family.
 */
const PATH_COVERAGE_GAP = /file-count budget|total-bytes budget|wall budget|truncat/i;

export function recordHasPathCoverageGap(record: { gaps: string[] }): boolean {
  return record.gaps.some((g) => PATH_COVERAGE_GAP.test(g));
}

export function compareSnapshot(input: CompareSnapshotInput): CompareSnapshotResult {
  const { record, post, postGaps, budgets, stat, read, now } = input;
  const attributions = new Map<string, PathAttribution>();
  const gaps: string[] = [];
  const prePaths = Object.keys(record.files);
  const preMap = new Map<string, SnapshotFile>(Object.entries(record.files));
  const renamePairs = pairRenames(preMap, post);
  const renameSources = new Set(renamePairs.map((p) => p.from));
  const renameTargets = new Set(renamePairs.map((p) => p.to));
  for (const p of renamePairs) attributions.set(p.to, { kind: 'rename', from: p.from });
  const wallMs = budgets.postSideWallSeconds * 1000;
  const wallExhausted = (): boolean => now - record.createdAt > wallMs;
  let changedCount = 0;

  for (let i = 0; i < prePaths.length; i += 1) {
    const path = prePaths[i]!;
    if (renameSources.has(path)) continue; // paired away — no delete candidate
    if (wallExhausted()) {
      gaps.push(
        `post-side wall budget exhausted: attributed ${changedCount}/${prePaths.length}, unattributed ${prePaths.slice(i).join(', ')}`
      );
      break;
    }
    const preEntry = preMap.get(path)!;
    const postEntry = post.get(path) ?? null;
    let size: number | null = null;
    let mtimeNs: bigint | null = null;
    if (postEntry !== null) {
      size = postEntry.size;
      mtimeNs = postEntry.mtimeNs;
    } else {
      const st = stat(path);
      if (st === null) {
        // Absent on disk. Only a complete post walk proves deletion — under any
        // post coverage gap it may be a file the walk never reached.
        if (postGaps.length > 0) {
          gaps.push(`post-walk coverage gap: ${path} dropped — may be a budget-excluded file, no phantom delete`);
        } else {
          attributions.set(path, { kind: 'deleted' });
        }
        continue;
      }
      size = st.size;
      mtimeNs = st.mtimeNs;
    }
    if (size === preEntry.size && mtimeNs === preEntry.mtimeNs && preEntry.mtimeNs % 1_000_000_000n !== 0n) {
      continue; // (size, mtimeNs) both match with a trustworthy clock — unchanged, no re-read
    }
    const content = read(path);
    if (content === null) {
      gaps.push(`unreadable at compare: ${path} dropped without attribution`);
      continue;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    if (hash === preEntry.hash) continue; // chmod/mtime-only noise
    if (changedCount >= budgets.maxTouchedFiles) {
      gaps.push(`touched-files cap ${budgets.maxTouchedFiles} exceeded: ${path} not attributed`);
      continue;
    }
    changedCount += 1;
    if (preEntry.coarse === true) {
      // Coarse pre entry — byte-hash-only comparison, whole-file scope.
      attributions.set(path, { kind: 'changed', observed: { changed: [], wholeFile: true } });
      gaps.push(`coarse-scope: ${path} has no line hashes, whole-file scope`);
      continue;
    }
    const hunks = diffLineHashes(preEntry.lines ?? [], contentLines(content));
    if (hunks.length === 0) {
      // Byte hash changed but every line hash matched — a line-hash collision.
      // Never let it silently shrink attribution: whole-file scope + diagnostic.
      attributions.set(path, { kind: 'changed', observed: { changed: [], wholeFile: true } });
      gaps.push(`zero-hunk collision: ${path} byte hash changed but line hashes identical, whole-file scope`);
      continue;
    }
    attributions.set(path, { kind: 'changed', observed: hunksToPostRanges(hunks) });
  }

  if (!wallExhausted()) {
    const postPaths = [...post.keys()].filter((p) => !preMap.has(p) && !renameTargets.has(p));
    for (const path of postPaths) {
      if (wallExhausted()) {
        gaps.push(
          `post-side wall budget exhausted: attributed ${changedCount}/${prePaths.length + postPaths.length}, unattributed ${postPaths.join(', ')}`
        );
        break;
      }
      if (recordHasPathCoverageGap(record)) {
        gaps.push(`pre-walk coverage gap: ${path} dropped — may be a budget-excluded file, no phantom create`);
        continue;
      }
      attributions.set(path, { kind: 'created' });
    }
  }
  return { attributions, gaps };
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
  pre: SnapshotFile | null;
  /** Its post-state for the path, or null when it consumed without changing it. */
  post: SnapshotFile | null;
}

/**
 * The table's verdict for one changed path against one sibling, top-down;
 * the first matching row decides (see the plan's ambiguity table). Any
 * ambiguous sibling makes the path ambiguous — the path is dropped whole,
 * before any diff or range work.
 */
export type AmbiguityVerdict = { ambiguous: false } | { ambiguous: true; reason: string; siblingToolUseId: string };

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
 *   pre(P) → not ambiguous.
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
export function applyAmbiguityRules(mine: SnapshotRecord, siblings: SiblingSnapshot[], path: string): AmbiguityVerdict {
  const myPreHash = mine.files[path]?.hash ?? null;
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
        siblingToolUseId: sib.toolUseId
      };
    }
    const preHash = sib.pre?.hash ?? null;
    const postHash = sib.post?.hash ?? null;
    if (sib.createdAt > mine.createdAt) {
      // Consumed after mine: post(P) = pre(P) (or no post entry — consumed
      // without changing P) proves the windows are disjoint.
      if (postHash === null || postHash === preHash) continue;
      return {
        ambiguous: true,
        reason: `sibling ${sib.toolUseId} changed ${path} in a window overlapping mine`,
        siblingToolUseId: sib.toolUseId
      };
    }
    // Consumed before mine, top-down:
    if (preHash !== null && preHash === postHash) continue; // it never changed P
    if (postHash !== null && postHash === myPreHash) continue; // its write landed before my baseline
    if (sib.consumedAt !== null && sib.consumedAt <= mine.createdAt) continue; // whole window ended before my baseline
    return {
      ambiguous: true,
      reason: `sibling ${sib.toolUseId} changed ${path} in a window extending past my baseline`,
      siblingToolUseId: sib.toolUseId
    };
  }
  return { ambiguous: false };
}
