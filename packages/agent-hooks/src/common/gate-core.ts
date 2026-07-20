/**
 * Harness-agnostic gate core (Phase 3.1 — contract and stubs).
 *
 * This module declares the PreToolUse "gate" that both the Claude (`Bash`) and
 * Codex (shell/exec) adapters will drive: when the agent runs `git commit` or
 * `git push` and the changeset it is about to land carries real span debt, the
 * command is held with a checklist; positional drift the touch hook has been
 * healing all along never blocks. Like {@link file://./touch-core.ts} it imports
 * nothing from either hook SDK and is typed structurally, per the `common/`
 * layer convention: adapters translate their SDK-specific hook input into a
 * command string + cwd, inject execution/state dependencies, and translate the
 * returned {@link GateResult} into their own deny/allow output builder.
 *
 * gate-core is a sibling of touch-core, not a dependent: the two cores are
 * independent and this module imports nothing from `touch-core.ts`.
 *
 * Reused from the shared kernel (not redefined): `isDebt()` (the single
 * source of truth for the semantic-only debt invariant — `MOVED` and
 * `RESOLVED_PENDING_COMMIT` are never debt), the porcelain status vocabulary
 * (`PorcelainStatus`/`PorcelainRow`/`StalePorcelainRow`), and `gateMemoDir()`
 * (the `<git-common-dir>/git-span/gate/` path the disk-backed
 * {@link GateMemoState} will persist under) — all from agent-hooks-common.ts.
 *
 * Every function whose result depends on real logic is a `Not Implemented` stub
 * in this phase; Phase 3.2 writes skipped checks against these signatures and
 * Phase 3.3 implements them. The one exception is {@link isGateSkipped}, which
 * is pure and fully specified by CARD.md, so it is implemented here (see its
 * doc comment for the rationale).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import {
  gateMemoDir,
  isDebt,
  isInsideSpanRoot,
  type PorcelainRow,
  parsePorcelain,
  parseStalePorcelain,
  resolveRepoRoot,
  type StalePorcelainRow,
  toPosix
} from './agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

/**
 * The kind of gated git command a shell command string resolves to. `'none'`
 * is the conservative fail-open answer: any shape {@link parseGitCommand} does
 * not confidently recognize as a `git commit`/`git push` maps to `'none'` and
 * the gate allows the command through untouched.
 */
export type GitCommandKind = 'commit' | 'push' | 'none';

/**
 * The result of parsing a shell command string for a gated git invocation.
 *
 * `paths` carries only what is parseable from the command line itself — the
 * explicit pathspecs a `git commit -- <path>…` form names. It is deliberately
 * *not* the changeset: the fuller resolution (staged files, the `-a`/`-am`
 * expansion against tracked-modified files, the outgoing push range) is
 * {@link resolveChangeset}'s job, driven from the repo state, not from the
 * command text. `paths` is omitted when the command names no explicit
 * pathspec.
 */
export interface ParsedGitCommand {
  kind: GitCommandKind;
  paths?: string[];
}

/**
 * Word-boundary parse of a `git commit` / `git push` invocation embedded in an
 * arbitrary shell command string.
 *
 * Must recognize the real shapes commits and pushes arrive in: chained
 * commands (`… && git commit …`, `…; git push`, `… | …`), an explicit repo via
 * `git -C <dir> commit …`, trailing pathspecs after `--`, the `-a`/`-am`
 * "commit all tracked-modified" forms, and invocation from a cwd below the repo
 * root. Matching is on word boundaries, never substring: a path or message that
 * merely contains the text `git commit` must not trip the gate.
 *
 * Conservative by contract: this is the fail-open point at the parse layer, not
 * a place to guess. Any command whose shape is not confidently a gated
 * `git commit`/`git push` — an unfamiliar subcommand, an alias, an obfuscated
 * or dynamically-built invocation — returns `{ kind: 'none' }` so the gate
 * allows it rather than denying on a shaky read. (See CARD.md "Risks and
 * required spikes → Command parsing" and design-decisions.md #1.)
 *
 * @param command The raw shell command string from the hook's tool input.
 */
export function parseGitCommand(command: string): ParsedGitCommand {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv) continue;
    if (inv.subcommand === 'commit') {
      const dashDash = inv.args.indexOf('--');
      const paths = dashDash >= 0 ? inv.args.slice(dashDash + 1).filter((p) => p.length > 0) : [];
      return paths.length > 0 ? { kind: 'commit', paths } : { kind: 'commit' };
    }
    if (inv.subcommand === 'push') {
      return { kind: 'push' };
    }
    // A recognized `git` invocation that is neither commit nor push (e.g.
    // `git add . && git commit …`): keep scanning later segments.
  }
  return { kind: 'none' };
}

/**
 * Whether a `git commit` in the command is an `-a`/`-am`/`--all` form — the
 * "stage all tracked-modified files" variant whose changeset {@link resolveChangeset}
 * must widen beyond the already-staged set.
 *
 * The `all` signal is deliberately *not* carried on {@link ParsedGitCommand}
 * (see that type's doc): the adapter derives it here from the same command text
 * and threads it into {@link resolveChangeset} explicitly. Conservative: only a
 * short-flag group containing `a` (`-a`, `-am`, `-ma`) or an explicit `--all`,
 * scanned before any `--` pathspec separator, counts.
 */
export function commitStagesAll(command: string): boolean {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv || inv.subcommand !== 'commit') continue;
    const dashDash = inv.args.indexOf('--');
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (const arg of flagArgs) {
      if (arg === '--all') return true;
      if (!arg.startsWith('--') && /^-[A-Za-z]*a[A-Za-z]*$/.test(arg)) return true;
    }
    return false;
  }
  return false;
}

// Shell control operators that separate one simple command from the next.
// Splitting on these (outside quotes) isolates each command so a `git commit`/
// `git push` chained after `&&`/`;`/`|` is found, while text inside a quoted
// argument (`echo "git commit"`) stays within its own non-git segment.
const TWO_CHAR_OPERATORS = new Set(['&&', '||']);
const ONE_CHAR_SEPARATORS = new Set([';', '|', '\n', '&', '(', ')']);

/** Split a shell command into simple-command segments, respecting quotes. */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (TWO_CHAR_OPERATORS.has(command.slice(i, i + 2))) {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ONE_CHAR_SEPARATORS.has(ch)) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/**
 * Tokenize one segment into shell words, respecting single/double quotes and
 * stripping the quote characters. Deliberately minimal (no expansion, no
 * escape handling beyond quotes): the goal is confident recognition of a
 * `git commit`/`push` shape, not a full shell parser.
 */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (has) {
        tokens.push(current);
        current = '';
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}

/** Git global options that consume a separate following value token. */
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--exec-path',
  '--attr-source',
  '--config-env'
]);

interface GitInvocation {
  subcommand: string;
  args: string[];
}

/**
 * If a segment's tokens are a `git <subcommand> …` invocation, return the
 * subcommand and its remaining args; otherwise `null`. Leading `VAR=value`
 * environment assignments and `git` global options (including the value-taking
 * ones) are skipped so the subcommand is correctly located.
 */
function matchGitInvocation(tokens: string[]): GitInvocation | null {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || tokens[i] !== 'git') return null;
  i++;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '--') return null; // a `--` before any subcommand is not a shape we recognize
    if (!t.startsWith('-')) break;
    i += GIT_VALUE_OPTIONS.has(t) ? 2 : 1;
  }
  if (i >= tokens.length) return null;
  return { subcommand: tokens[i], args: tokens.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Changeset resolution
// ---------------------------------------------------------------------------

/**
 * The injected git surface {@link resolveChangeset} needs to turn a parsed
 * command into the concrete list of paths that would land. Kept as narrow async
 * functions (rather than a raw command runner) following `touch-core.ts`'s
 * `TouchExecutors` pattern, so Phase 3.2's tests fake the repo state without a
 * real subprocess and the core never spawns one itself.
 *
 * All returned paths are repo-relative POSIX paths.
 */
export interface GitExecutor {
  /**
   * Paths staged for the next commit — `git diff --cached --name-only`. These
   * are what a plain `git commit` would land.
   */
  stagedPaths(cwd: string): Promise<string[]>;
  /**
   * Tracked files with unstaged working-tree modifications —
   * `git diff --name-only`. Folded into the changeset only for `-a`/`-am`
   * forms, which stage tracked-modified files implicitly at commit time.
   */
  trackedModifiedPaths(cwd: string): Promise<string[]>;
  /**
   * Paths in the outgoing push range — the files changed by `@{u}..HEAD`, with
   * a merge-base-against-the-default-remote-branch fallback when no upstream is
   * configured. These are what a `git push` would publish.
   */
  outgoingPaths(cwd: string): Promise<string[]>;
}

/**
 * Resolve the concrete list of repo-relative paths a gated command would land,
 * so the gate can scope its staleness/coverage check to exactly that changeset.
 *
 * - `commit`: the staged paths, plus — when `all` is true (the command was an
 *   `-a`/`-am` form) — the tracked-modified paths those forms stage implicitly.
 * - `push`: the outgoing range `@{u}..HEAD`, with a merge-base fallback when no
 *   upstream is configured. `all` is not meaningful for a push and is ignored.
 *
 * The `all` flag is threaded in explicitly (rather than read back out of the
 * command) because {@link ParsedGitCommand} intentionally does not carry it —
 * the caller/adapter derives it from the parse and passes it here.
 *
 * @param kind Whether the changeset is a commit's staged set or a push's range.
 * @param all Whether the commit was an `-a`/`-am` form (ignored for `push`).
 * @param cwd The working directory the git command ran in.
 * @param git The injected git surface backing the resolution.
 */
export async function resolveChangeset(
  kind: 'commit' | 'push',
  all: boolean,
  cwd: string,
  git: GitExecutor
): Promise<string[]> {
  if (kind === 'push') {
    return git.outgoingPaths(cwd);
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return staged;
  const tracked = await git.trackedModifiedPaths(cwd);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const path of [...staged, ...tracked]) {
    if (seen.has(path)) continue;
    seen.add(path);
    merged.push(path);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

/**
 * The injected execution surface gate evaluation needs — the `fix`/`stale`/
 * `list` async functions, mirroring `touch-core.ts`'s `TouchExecutors`. Tests
 * inject fakes returning structured data; the core never spawns a subprocess
 * itself. All paths are repo-relative POSIX paths.
 */
export interface GateExecutors {
  /**
   * Run a scoped `git span stale <paths> --fix` — the belt-and-braces heal that
   * runs before classification (per CARD.md), re-anchoring any positional drift
   * in the changeset that the touch hook has not already healed. Reports nothing;
   * its effect is on the working tree, and the subsequent {@link GateExecutors.stale}
   * read observes the healed state.
   */
  fix(paths: string[], cwd: string): Promise<void>;
  /**
   * Run a scoped `git span stale --format porcelain <paths>` and return its
   * parsed rows — one per drifted anchor among the changeset's spans, empty when
   * clean. Debt is classified from these rows via `isDebt()`; positional
   * (`MOVED`/`RESOLVED_PENDING_COMMIT`) rows are never debt and never deny.
   */
  stale(paths: string[], cwd: string): Promise<StalePorcelainRow[]>;
  /**
   * Run a scoped `git span list --porcelain <paths>` and return the covering
   * anchors. Used to compute *uncovered writes*: a changed path with zero
   * covering rows here (minus `.span/**`, gitignored paths, and
   * `.span/.gateignore`-excluded paths) is an uncovered write.
   */
  list(paths: string[], cwd: string): Promise<PorcelainRow[]>;
}

/**
 * The gate's per-changeset memo — "have I already presented this exact debt
 * state once?" The persisted unit is a digest of the sorted staleness findings
 * plus the sorted uncovered paths (design-decisions.md #9's "gate once per
 * distinct debt-state"); the disk-backed implementation stores one marker per
 * digest under {@link gateMemoDir} (`<git-common-dir>/git-span/gate/`), where
 * presence means "already presented once." Injected as a store abstraction
 * (like span-surface.ts's `MemoStore`) so Phase 3.2 fakes it in memory.
 */
export interface GateMemoState {
  /** Whether this exact debt-state digest has already been presented once. */
  has(digest: string): boolean;
  /** Record that this debt-state digest has now been presented. */
  record(digest: string): void;
}

/**
 * The gate's decision for one command, as a discriminated union the adapter
 * translates into `permissionDecision: 'deny'`/allow (Claude) or a block/allow
 * (Codex). `decision` is the coarse allow/deny the harness acts on; `kind`
 * records *why*, so the adapter renders the right message and so tests assert
 * the exact branch.
 *
 * - `allow` / `silent` — nothing to check (no paths) or the changeset is clean;
 *   allow with no output. Internal errors and parse failures also resolve here:
 *   the gate fails open and must never brick a commit.
 * - `allow` / `already-presented` — debt is present, but this exact debt state
 *   was already presented once (uncovered-writes consider-once, or an unchanged
 *   state). The command passes.
 * - `deny` / `semantic-staleness` — the changeset carries semantic staleness.
 *   Deny with `findings` rendered as a checklist in `reason`; re-denies on every
 *   retry until the findings change (staleness is hard-until-resolved).
 * - `deny` / `uncovered-writes` — the changeset has changed files no span
 *   covers, and this state has not been presented before. Deny **once**, listing
 *   `uncovered`; the retry with an unchanged state resolves to `already-presented`
 *   and passes (consider-once, per design-decisions.md #3).
 */
export type GateResult =
  | { decision: 'allow'; kind: 'silent' }
  | { decision: 'allow'; kind: 'already-presented' }
  | { decision: 'deny'; kind: 'semantic-staleness'; findings: StalePorcelainRow[]; reason: string }
  | { decision: 'deny'; kind: 'uncovered-writes'; uncovered: string[]; reason: string };

/**
 * Evaluate the gate for a resolved changeset and decide whether to hold the
 * command.
 *
 * The eventual implementation: run `executors.fix` (scoped belt-and-braces
 * `stale --fix`), then read `executors.stale` and classify each row via
 * `isDebt()`. Semantic staleness → `deny`/`semantic-staleness`, re-blocking
 * until the findings digest changes. Uncovered writes (changed paths with zero
 * coverage from `executors.list`, minus `.span/**`, gitignored, and
 * `.gateignore`-excluded paths) → `deny`/`uncovered-writes` the first time that
 * state is seen, then `allow`/`already-presented` on retry. `MOVED` and
 * `RESOLVED_PENDING_COMMIT` never contribute to either and never deny. The
 * distinct-debt-state digest (sorted findings + sorted uncovered paths) is
 * checked and recorded through `memoState`. Any internal error resolves to
 * `allow`/`silent` — the gate fails open and never bricks a commit.
 *
 * The `GIT_SPAN_GATE=skip` escape hatch is *not* checked here — it is a
 * pre-check the adapter runs via {@link isGateSkipped} before calling
 * evaluateGate, so a bypass is logged as an explicit exception at the adapter
 * boundary rather than folded into the decision here.
 *
 * @param paths The resolved changeset from {@link resolveChangeset}. Empty →
 *   `allow`/`silent`.
 * @param cwd The working directory the git command ran in.
 * @param executors The injected `fix`/`stale`/`list` surface.
 * @param memoState The per-changeset debt-state memo.
 */
export async function evaluateGate(
  paths: string[],
  cwd: string,
  executors: GateExecutors,
  memoState: GateMemoState
): Promise<GateResult> {
  if (paths.length === 0) return { decision: 'allow', kind: 'silent' };
  try {
    // Belt-and-braces heal, then classify against the healed state.
    await executors.fix(paths, cwd);
    const staleRows = await executors.stale(paths, cwd);

    // Semantic staleness is hard-until-resolved: deny every time until the
    // findings themselves change. `isDebt()` is the single source of truth —
    // `MOVED`/`RESOLVED_PENDING_COMMIT` are never debt and never contribute.
    const findings = staleRows.filter((row) => isDebt(row.status));
    if (findings.length > 0) {
      return { decision: 'deny', kind: 'semantic-staleness', findings, reason: renderStalenessReason(findings) };
    }

    // Uncovered writes: changed paths with zero covering span, minus `.span/**`
    // (span repairs ride the same commit and must never self-trigger the gate).
    // Gitignored paths never reach here — git does not stage/publish them.
    const covering = await executors.list(paths, cwd);
    const covered = new Set(covering.map((row) => row.path));
    const uncovered = paths.filter((path) => !covered.has(path) && !isInsideSpanRoot(path));
    if (uncovered.length === 0) return { decision: 'allow', kind: 'silent' };

    // Consider-once: deny the first time this exact debt state is seen, then
    // pass the retry with an unchanged state.
    const digest = gateStateDigest(findings, uncovered);
    if (memoState.has(digest)) return { decision: 'allow', kind: 'already-presented' };
    memoState.record(digest);
    return { decision: 'deny', kind: 'uncovered-writes', uncovered, reason: renderUncoveredReason(uncovered) };
  } catch {
    // Fail open: any internal/CLI error resolves to allow. The gate must never
    // brick a commit on its own failure.
    return { decision: 'allow', kind: 'silent' };
  }
}

// ---------------------------------------------------------------------------
// Debt-state digest and reason rendering
// ---------------------------------------------------------------------------

/** `path#Lstart-Lend`, or a bare path for a whole-file anchor. */
function anchorText(row: StalePorcelainRow): string {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}

/**
 * The distinct-debt-state digest (design-decisions.md #9): a stable hash of the
 * sorted staleness findings plus the sorted uncovered paths. Presence in the
 * memo means "this exact state was already presented once."
 */
function gateStateDigest(findings: StalePorcelainRow[], uncovered: string[]): string {
  const findingKeys = findings.map((row) => `${row.status}\t${row.name}\t${row.path}\t${row.start}\t${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash('sha256').update(payload).digest('hex');
}

/** The `GIT_SPAN_GATE=skip` escape-hatch line appended to every deny reason. */
const ESCAPE_HATCH_LINE =
  'To proceed anyway (requires explicit user approval): prefix the command with `GIT_SPAN_GATE=skip`.';

/** The checklist a semantic-staleness deny renders into `reason`. */
function renderStalenessReason(findings: StalePorcelainRow[]): string {
  const lines = findings.map((row) => `  - ${row.name} (${row.status}): ${anchorText(row)}`);
  return [
    'This changeset carries span debt — resolve it before this lands:',
    ...lines,
    '',
    "Update each span's anchors/why in this same change, or tell the user why the described coupling no longer holds, then retry.",
    ESCAPE_HATCH_LINE
  ].join('\n');
}

/** The one-time list an uncovered-writes deny renders into `reason`. */
function renderUncoveredReason(uncovered: string[]): string {
  const lines = uncovered.map((path) => `  - ${path}`);
  return [
    'These changed files are covered by no span — consider whether they need one:',
    ...lines,
    '',
    'Declare a coupling with `git span add` if one genuinely exists, or just retry the command to proceed (this is a one-time check).',
    ESCAPE_HATCH_LINE
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Escape hatch
// ---------------------------------------------------------------------------

/**
 * Whether the transcript-visible escape hatch `GIT_SPAN_GATE=skip` is set,
 * bypassing the gate for a user-approved exception (CARD.md acceptance
 * criterion 5; the skill documents that setting it requires explicit user
 * approval).
 *
 * Implemented (not stubbed) in this phase: it is a single, pure env-var read
 * that CARD.md fully specifies, so the stub-then-implement ceremony would add
 * nothing — there is no logic to get wrong beyond the exact-string match, and a
 * trivial implementation is more honest than a stub that throws. Kept pure over
 * `process.env` (env injected as a parameter) so Phase 3.2 can exercise both
 * branches without mutating global state.
 *
 * @param env The environment to read, e.g. `process.env`.
 */
export function isGateSkipped(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env['GIT_SPAN_GATE'] === 'skip';
}

// ---------------------------------------------------------------------------
// Default subprocess/disk-backed dependencies
// ---------------------------------------------------------------------------
//
// The production surfaces both adapters inject by default, following
// touch-core.ts's `createDefaultTouchExecutors` style: each captures stdout even
// on a non-zero exit where the CLI still emits useful output, and every failure
// mode (absent binary, timeout, no repo) surfaces as an empty/clean result so
// the gate's fail-open contract holds without the adapter adding its own.

const DEFAULT_TIMEOUT_MS = 10_000;

/** Run a git command at `cwd`, returning trimmed non-empty POSIX output lines (empty on any failure). */
function gitLines(args: string[], cwd: string, timeoutMs: number): string[] {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(toPosix);
  } catch {
    return [];
  }
}

/**
 * Like {@link gitLines} but distinguishes a *failed* invocation (`null` — e.g.
 * `@{u}` with no upstream configured) from a *successful but empty* result
 * (`[]`), so the outgoing-range resolution knows when to try the merge-base
 * fallback rather than mistaking "no upstream" for "nothing to push".
 */
function gitLinesOrNull(args: string[], cwd: string, timeoutMs: number): string[] | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(toPosix);
  } catch {
    return null;
  }
}

/** The production {@link GitExecutor}: `git diff` reads scoped to the CWD repo. */
export function createDefaultGitExecutor(timeoutMs: number = DEFAULT_TIMEOUT_MS): GitExecutor {
  return {
    stagedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(['-C', repoRoot, 'diff', '--cached', '--name-only'], repoRoot, timeoutMs);
    },
    trackedModifiedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(['-C', repoRoot, 'diff', '--name-only'], repoRoot, timeoutMs);
    },
    outgoingPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const upstream = gitLinesOrNull(['-C', repoRoot, 'diff', '--name-only', '@{u}..HEAD'], repoRoot, timeoutMs);
      if (upstream !== null) return upstream;
      // No upstream configured: fall back to the merge-base with the default
      // remote branch (`origin/HEAD`). If that too is unresolvable, fail open.
      const base = gitLines(['-C', repoRoot, 'merge-base', 'HEAD', 'origin/HEAD'], repoRoot, timeoutMs)[0];
      if (!base) return [];
      return gitLines(['-C', repoRoot, 'diff', '--name-only', `${base}..HEAD`], repoRoot, timeoutMs);
    }
  };
}

/** The production {@link GateExecutors}: scoped `git span` fix/stale/list at the repo root. */
export function createDefaultGateExecutors(timeoutMs: number = DEFAULT_TIMEOUT_MS): GateExecutors {
  return {
    fix: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      try {
        execFileSync('git', ['span', 'stale', ...paths, '--fix'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
      } catch {
        // `git span stale` exits 1 on drift even after healing, and non-zero on
        // genuine failure; either way the subsequent `stale` read is the source
        // of truth, so the exit code is ignored here.
      }
    },
    stale: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      let out: string;
      try {
        out = execFileSync('git', ['span', 'stale', '--format', 'porcelain', ...paths], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
      } catch (err) {
        const captured = (err as { stdout?: string }).stdout;
        if (typeof captured === 'string') out = captured;
        else return [];
      }
      return parseStalePorcelain(out);
    },
    list: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      try {
        const out = execFileSync('git', ['span', 'list', '--porcelain', ...paths], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    }
  };
}

/**
 * The production disk-backed {@link GateMemoState}: one marker file per debt-state
 * digest under {@link gateMemoDir} (`<git-common-dir>/git-span/gate/`), following
 * span-surface.ts's file-backed `MemoStore` pattern. The digest is a hex sha256,
 * a safe filename. Best-effort and non-throwing: a memo whose repo cannot be
 * resolved degrades to a no-op store (never persists → uncovered would re-deny,
 * but an unresolvable repo yields an empty changeset upstream anyway).
 */
export function createDiskGateMemoState(cwd: string): GateMemoState {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    return { has: () => false, record: () => {} };
  }
  const dir = gateMemoDir(repoRoot);
  return {
    has: (digest) => {
      try {
        return fs.existsSync(nodePath.join(dir, digest));
      } catch {
        return false;
      }
    },
    record: (digest) => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(nodePath.join(dir, digest), '');
      } catch {
        // Best-effort: a failed memo write must never brick the commit.
      }
    }
  };
}
