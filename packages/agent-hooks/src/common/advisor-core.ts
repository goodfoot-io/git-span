/**
 * Harness-agnostic advisor core.
 *
 * This module declares the PreToolUse advisor that both the Claude (`Bash`) and
 * Codex (shell/exec) adapters drive: when the agent runs `git commit` or
 * `git push` and the changeset it is about to land carries real span debt, the
 * command is held once with a checklist — a bare retry then proceeds, so the
 * advisor reports rather than enforces; positional drift the touch hook has been
 * healing all along is never reported at all. Like {@link file://./touch-core.ts} it imports
 * nothing from either hook SDK and is typed structurally, per the `common/`
 * layer convention: adapters translate their SDK-specific hook input into a
 * command string + cwd, inject execution/state dependencies, and translate the
 * returned {@link AdvisorResult} into their own hold/allow output builder.
 *
 * advisor-core is a sibling of touch-core, not a dependent: the two cores are
 * independent and this module imports nothing from `touch-core.ts`.
 *
 * Reused from the shared kernel (not redefined): `isDebt()` (the single
 * source of truth for the semantic-only debt invariant — `MOVED` and
 * `RESOLVED_PENDING_COMMIT` are never debt), the porcelain status vocabulary
 * (`PorcelainStatus`/`PorcelainRow`/`DriftPorcelainRow`), and `advisorMemoDir()`
 * (the `<git-common-dir>/git-span/advisor/` path the disk-backed
 * {@link AdvisorMemoState} persists under) — all from agent-hooks-common.ts.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';
import { isAdvisorIgnored, loadAdvisorIgnore } from './advisor-ignore.js';
import {
  advisorMemoDir,
  type DriftPorcelainRow,
  humanStatusLabel,
  indentBlockBody,
  isDebt,
  isEnvironmentalStatus,
  isInsideSpanRoot,
  type PorcelainRow,
  type PorcelainStatus,
  parseDriftPorcelain,
  parsePorcelain,
  resolveRepoRoot,
  resolveSpanRoot,
  SPAN_ROOT,
  toPosix
} from './agent-hooks-common.js';
import { collapseByPath, type RangeLabel, renderAnchorTree } from './anchor-tree.js';
import {
  classifyMechanical,
  type FileDiff,
  isClassifiablePath,
  isNeverSpannedPath,
  parseUnifiedDiff
} from './mechanical-change.js';
import type { CoreLogger } from './span-surface.js';

// ---------------------------------------------------------------------------
// Scan-failure signal
// ---------------------------------------------------------------------------

/**
 * Raised by the `drift` executor when `git span drift` could not *complete* its
 * scoped scan — as opposed to completing and reporting drift. `git span drift`
 * exits non-zero in two very different situations: on legitimate drift (real
 * porcelain rows on stdout) and on a hard scan failure (e.g. an unreadable
 * anchor file aborts the whole scoped query, leaving stdout empty and an error
 * on stderr). Only the second throws this, so {@link evaluateAdvisor} can tell a
 * scan that *ran clean* (empty rows) from one that *never ran* (empty rows
 * because it aborted) and refuse to read the latter as a clean pass. `detail`
 * carries the CLI's stderr for the surfaced reason.
 */
export class AdvisorScanError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`git span drift could not complete its scan: ${detail}`);
    this.name = 'AdvisorScanError';
    this.detail = detail;
  }
}

/**
 * Raised when the installed `git-span` binary does not understand the command
 * the hooks issue — the hook bundle and the binary install through independent
 * channels, so a plugin newer than the binary is a routine state, not a corner
 * case.
 *
 * This is deliberately *not* an {@link AdvisorScanError}. A scan error means the
 * scan started and aborted on something in the repository; this means the scan
 * never had a chance to start, and nothing about the repository is implicated.
 * Conflating the two hands the user the CLI's own argument-parser diagnostic —
 * which names whatever subcommand clap guessed at, a command the user never
 * ran — instead of the one fact that resolves it: upgrade the binary.
 *
 * `installedVersion` is the version the probe read back, or `null` when even
 * `git span --version` could not be run or parsed.
 */
export class AdvisorIncompatibleCliError extends Error {
  readonly detail: string;
  readonly installedVersion: string | null;
  constructor(detail: string, installedVersion: string | null) {
    super(`the installed git-span binary does not support this command: ${detail}`);
    this.name = 'AdvisorIncompatibleCliError';
    this.detail = detail;
    this.installedVersion = installedVersion;
  }
}

/**
 * Internal sentinel rejecting the raced deadline promise inside
 * {@link evaluateAdvisor} when the evaluation's overall budget expires — the
 * loser of the `Promise.race` that bounds wall time. Never escapes
 * {@link evaluateAdvisor}: the catch maps it to the fail-open
 * `allow`/`scan-failed`/`deadline-exceeded` result. Not exported on purpose —
 * it marks a scheduling fact (the budget ran out), not a repository or install
 * condition, and callers observe it through the result's `cause`, not through
 * an exception type.
 */
class AdvisorDeadlineError extends Error {
  readonly budgetMs: number;
  constructor(budgetMs: number) {
    super(`advisor evaluation exceeded its ${budgetMs} ms budget`);
    this.name = 'AdvisorDeadlineError';
    this.budgetMs = budgetMs;
  }
}

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

/**
 * The kind of git command a shell command string resolves to — the shapes the
 * advisor inspects. `'none'`
 * is the conservative fail-open answer: any shape {@link parseGitCommand} does
 * not confidently recognize as a `git commit`/`git push`/`git status` maps to
 * `'none'` and the advisor allows the command through untouched. `'status'` is
 * never held — {@link evaluateAdvisor}'s `'report-only'` mode only ever allows,
 * surfacing any span debt as advisory context.
 */
export type GitCommandKind = 'commit' | 'push' | 'status' | 'none';

/**
 * The result of parsing a shell command string for an inspected git invocation.
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
 * Word-boundary parse of a `git commit` / `git push` / `git status` invocation
 * embedded in an arbitrary shell command string.
 *
 * Must recognize the real shapes commits, pushes, and status checks arrive in:
 * chained commands (`… && git commit …`, `…; git push`, `… | …`), an explicit
 * repo via `git -C <dir> commit …`, trailing pathspecs after `--`, the
 * `-a`/`-am` "commit all tracked-modified" forms, and invocation from a cwd
 * below the repo root. Matching is on word boundaries, never substring: a path
 * or message that merely contains the text `git commit` must not trip the
 * advisor.
 *
 * Conservative by contract: this is the fail-open point at the parse layer, not
 * a place to guess. Any command whose shape is not confidently an inspected
 * `git commit`/`git push`/`git status` — an unfamiliar subcommand, an alias, an
 * obfuscated or dynamically-built invocation — returns `{ kind: 'none' }` so the
 * advisor allows it rather than holding on a shaky read. (See CARD.md "Risks and
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
    if (inv.subcommand === 'status') {
      return { kind: 'status' };
    }
    // A recognized `git` invocation that is neither commit, push, nor status
    // (e.g. `git add . && git commit …`): keep scanning later segments.
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
 *
 * Value-taking commit options (`-m`, `--message`, `-F`, `-C`, …) consume their
 * following token, so it is never scanned as a flag: a message word like
 * `-analysis` in `git commit -m "-analysis"` must not be misread as the
 * `--all`-equivalent short-flag cluster and widen the changeset.
 */
const COMMIT_VALUE_OPTIONS = new Set([
  '-m',
  '--message',
  '-F',
  '--file',
  '-C',
  '--reuse-message',
  '-c',
  '--reedit-message',
  '--author',
  '--date',
  '-t',
  '--template',
  '--fixup',
  '--squash',
  '--trailer',
  '--cleanup',
  '--gpg-sign'
]);

export function commitStagesAll(command: string): boolean {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (inv?.subcommand !== 'commit') continue;
    const dashDash = inv.args.indexOf('--');
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (let i = 0; i < flagArgs.length; i++) {
      const arg = flagArgs[i];
      if (arg === '--all') return true;
      // A value-taking option consumes its following token — skip that token so
      // a message/author/date argument is never scanned as an `-a` cluster.
      if (COMMIT_VALUE_OPTIONS.has(arg)) {
        i++;
        continue;
      }
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
 * The diff range {@link resolveChangeset} resolved a changeset's paths from —
 * threaded alongside `paths` (as {@link Changeset}) so the mechanical-churn
 * classifier ({@link file://./mechanical-change.ts}) can read hunks from the
 * *same* range that produced the path list, never a different one (a `push`
 * classified against the working tree would be wrong). `'unresolvable'` is
 * the fail-toward-reporting answer for the one case where range fidelity
 * cannot be guaranteed — an `outgoingPaths` call whose base came back
 * `null` (neither `@{u}` nor a merge-base resolved) — and it skips the
 * classifier entirely, leaving every uncovered path in that changeset
 * flagged.
 */
export type DiffRange =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'commits'; base: string }
  | { kind: 'unresolvable' };

/**
 * {@link resolveChangeset}'s result: the resolved paths plus the
 * {@link DiffRange} they were resolved from, kept together so a caller
 * threading both into the mechanical-churn classifier (via `evaluateAdvisor`'s
 * optional `churn` parameter) makes one call instead of re-deriving the
 * range separately — re-deriving `push`'s range in particular risks a
 * different answer than the one `outgoingPaths` actually used.
 */
export interface Changeset {
  paths: string[];
  range: DiffRange;
}

/**
 * The mechanical-churn suppression surface {@link evaluateAdvisor} threads into
 * its uncovered-writes check: the {@link GitExecutor} to read hunk content from,
 * the {@link DiffRange} {@link resolveChangeset} resolved the changeset from
 * (see {@link DiffRange}'s doc — reading a `push` against the working tree would
 * classify the wrong content), and an optional logger.
 *
 * `logger` is the only window onto suppression there is. Everything else the
 * feature does is *subtractive*: a suppressed file is one the agent is never
 * told about, so a correct suppression, a wrong one, and a read that failed and
 * suppressed nothing all look identical from outside. The adapters pass their
 * hook logger here; omitting it loses the breadcrumb, not the behavior.
 */
export interface ChurnSuppression {
  git: GitExecutor;
  range: DiffRange;
  logger?: CoreLogger;
}

/**
 * The injected git surface {@link resolveChangeset} needs to turn a parsed
 * command into the concrete list of paths that would land. Kept as narrow async
 * functions (rather than a raw command runner) following `touch-core.ts`'s
 * `TouchExecutors` pattern, so Phase 3.2's tests fake the repo state without a
 * real subprocess and the core never spawns one itself.
 *
 * Every method takes an optional trailing `signal`: {@link evaluateAdvisor}'s
 * overall deadline aborts it when the budget expires, and production
 * implementations kill their in-flight subprocess with it (fakes may ignore
 * it). All returned paths are repo-relative POSIX paths.
 */
export interface GitExecutor {
  /**
   * Paths staged for the next commit — `git diff --cached --name-only`. These
   * are what a plain `git commit` would land.
   */
  stagedPaths(cwd: string, signal?: AbortSignal): Promise<string[]>;
  /**
   * Tracked files with unstaged working-tree modifications —
   * `git diff --name-only`. Folded into the changeset only for `-a`/`-am`
   * forms, which stage tracked-modified files implicitly at commit time.
   */
  trackedModifiedPaths(cwd: string, signal?: AbortSignal): Promise<string[]>;
  /**
   * Paths in the outgoing push range — the files changed by `@{u}..HEAD`, with
   * a merge-base-against-the-default-remote-branch fallback when no upstream is
   * configured. These are what a `git push` would publish. Also returns the
   * `base` it resolved the range against — `'@{u}'` when the upstream diff
   * succeeded, the merge-base SHA when it fell back, or `null` when neither
   * resolved (fail-open: `paths` is `[]` in that case too) — so
   * {@link resolveChangeset} can carry the exact same range into its returned
   * {@link Changeset} rather than re-deriving it and risking a different answer.
   */
  outgoingPaths(cwd: string, signal?: AbortSignal): Promise<{ paths: string[]; base: string | null }>;
  /**
   * Paths under the given explicit pathspecs whose working-tree content differs
   * from `HEAD` — `git diff HEAD --name-only -- <pathspecs>`. This is what a
   * pathspec-scoped commit (`git commit -- <pathspec>…`) actually lands: the
   * current working-tree content at those pathspecs, regardless of what else is
   * staged. Used to scope the changeset when {@link ParsedGitCommand.paths} is
   * present, so the advisor evaluates exactly the files this commit takes — never
   * an unrelated staged file, and never missing a modified-but-unstaged file
   * named in the pathspec (which `git diff --cached` would never surface).
   */
  pathspecPaths(paths: string[], cwd: string, signal?: AbortSignal): Promise<string[]>;
  /**
   * The parsed per-file diff content for `paths` over `range` — the fifth
   * method, and the first that returns content rather than names, feeding the
   * mechanical-churn classifier in {@link file://./mechanical-change.ts}.
   * `range` must be the *same* range that produced `paths` (see
   * {@link DiffRange}'s doc) — a `push` classified against the working tree
   * would be wrong. Returns `[]` on any failure (absent binary, timeout,
   * unparseable output, `range.kind === 'unresolvable'`): `[]` means
   * "classify nothing," which means "suppress nothing," so a read failure
   * here can never make a file disappear from the uncovered-writes list.
   *
   * A `[]` (or short) answer is therefore indistinguishable from "these files
   * have no diff", which is why {@link computeUncoveredPaths} re-reads each
   * absent path individually: the failure this guards against is a *whole-batch*
   * one — an oversized diff exceeding the subprocess buffer — and a per-file
   * retry keeps that from costing every other file its classification.
   */
  changedHunks(paths: string[], range: DiffRange, cwd: string, signal?: AbortSignal): Promise<FileDiff[]>;
}

/**
 * Resolve the concrete list of repo-relative paths an inspected command would land,
 * so the advisor can scope its drift/coverage check to exactly that changeset.
 *
 * - `commit` with explicit `paths` (a `git commit -- <pathspec>…` form): only
 *   the working-tree content under those pathspecs (`pathspecPaths`), since a
 *   pathspec-scoped commit lands exactly that, regardless of the rest of the
 *   staged set. `all` is ignored — `-a` and an explicit pathspec do not combine.
 * - `commit`, no `paths`: the staged paths, plus — when `all` is true (the
 *   command was an `-a`/`-am` form) — the tracked-modified paths those forms
 *   stage implicitly.
 * - `push`: the outgoing range `@{u}..HEAD`, with a merge-base fallback when no
 *   upstream is configured. `all`/`paths` are not meaningful for a push and are
 *   ignored.
 * - `status`: the staged paths plus the tracked-modified paths, deduplicated —
 *   the same working-tree picture `git status` itself prints, previewed for
 *   span debt. `all`/`paths` are not meaningful for a status check and are
 *   ignored.
 *
 * The resolved paths are filtered against the working tree before being
 * returned: any path absent from the tree is dropped, because the scoped scan
 * queries (`git span drift <paths>`, `git span list --porcelain <paths>`) fail
 * hard on a path that no longer exists — exit 1, empty stdout, an error on
 * stderr — and the executors read that shape as an aborted scan. A deletion
 * (staged or not) is a working-tree modification, so the diff-name reads list
 * it; without this filter a routine `rm` would turn every status check into
 * the "could not run" advisory. A deleted file has no content whose implicit
 * dependencies could be documented, so it never belongs in the changeset. The
 * list is returned unchanged when no repo root can be resolved for `cwd`, or
 * when it is already empty.
 *
 * The `all` flag and `paths` are threaded in explicitly (rather than read back
 * out of the command) because the caller/adapter derives them from the parse:
 * `paths` is {@link ParsedGitCommand.paths}, and `all` (which {@link ParsedGitCommand}
 * intentionally does not carry) comes from {@link commitStagesAll}.
 *
 * The returned {@link Changeset.range} follows the kind→range mapping table
 * (design-decisions/plan): plain `commit` → `staged`; `-a`/`-am` `commit` and
 * `status` → `worktree` (`git diff HEAD` spans staged *and* unstaged); a
 * pathspec-scoped `commit` → `worktree` (`pathspecPaths` is already a `git
 * diff HEAD` read); `push` → `commits` with the base `outgoingPaths` resolved,
 * or `unresolvable` when that base came back `null`.
 *
 * @param kind Whether the changeset is a commit's staged set, a push's range, or a status preview.
 * @param all Whether the commit was an `-a`/`-am` form (ignored for `push`/`status`).
 * @param cwd The working directory the git command ran in.
 * @param git The injected git surface backing the resolution.
 * @param paths Explicit pathspecs from `git commit -- <pathspec>…`, if any.
 */
/**
 * The raw diff-read resolution behind {@link resolveChangeset}, without the
 * working-tree existence filter — kept separate so the exported wrapper can
 * drop deleted-path entries once, at the single point every changeset kind
 * passes through, rather than in each executor.
 */
async function resolveChangesetUnfiltered(
  kind: 'commit' | 'push' | 'status',
  all: boolean,
  cwd: string,
  git: GitExecutor,
  paths?: string[]
): Promise<Changeset> {
  if (kind === 'push') {
    const { paths: outgoing, base } = await git.outgoingPaths(cwd);
    return { paths: outgoing, range: base === null ? { kind: 'unresolvable' } : { kind: 'commits', base } };
  }
  if (kind === 'status') {
    const [staged, tracked] = await Promise.all([git.stagedPaths(cwd), git.trackedModifiedPaths(cwd)]);
    return { paths: mergeUniquePaths(staged, tracked), range: { kind: 'worktree' } };
  }
  // A pathspec-scoped commit lands only the working-tree content at those
  // pathspecs — scope the changeset to exactly that, never the full staged set.
  if (paths && paths.length > 0) {
    return { paths: await git.pathspecPaths(paths, cwd), range: { kind: 'worktree' } };
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return { paths: staged, range: { kind: 'staged' } };
  const tracked = await git.trackedModifiedPaths(cwd);
  return { paths: mergeUniquePaths(staged, tracked), range: { kind: 'worktree' } };
}

export async function resolveChangeset(
  kind: 'commit' | 'push' | 'status',
  all: boolean,
  cwd: string,
  git: GitExecutor,
  paths?: string[]
): Promise<Changeset> {
  const changeset = await resolveChangesetUnfiltered(kind, all, cwd, git, paths);
  // A deleted tracked path is a working-tree modification, so the diff-name
  // reads list it — but the scoped scan queries abort hard on a path the
  // working tree no longer has, and a deleted file has no content whose
  // implicit dependencies could be documented. Drop changeset paths absent
  // from the working tree, repo-relative to the resolved root; when the root
  // is unresolvable (or the list is empty), leave the list unchanged. This
  // single point fixes the `fix`/`drift`/`list` executors at once, upstream of
  // every scan query.
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot || changeset.paths.length === 0) return changeset;
  return { ...changeset, paths: changeset.paths.filter((p) => fs.existsSync(nodePath.join(repoRoot, p))) };
}

/** Concatenate path lists in order, dropping later duplicates of an earlier path. */
function mergeUniquePaths(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Advisor evaluation
// ---------------------------------------------------------------------------

/**
 * The injected execution surface advisor evaluation needs — the `fix`/`drift`/
 * `list` async functions, mirroring `touch-core.ts`'s `TouchExecutors`. Tests
 * inject fakes returning structured data; the core never spawns a subprocess
 * itself. Every method takes an optional trailing `signal`:
 * {@link evaluateAdvisor}'s overall deadline aborts it when the budget expires,
 * and production implementations kill their in-flight subprocess with it (fakes
 * may ignore it). All paths are repo-relative POSIX paths.
 */
export interface AdvisorExecutors {
  /**
   * Run a scoped `git span drift <paths> --fix` — the belt-and-braces heal that
   * runs before classification (per CARD.md), re-anchoring any positional drift
   * in the changeset that the touch hook has not already healed. Reports nothing;
   * its effect is on the working tree, and the subsequent {@link AdvisorExecutors.drift}
   * read observes the healed state.
   *
   * Invoked only in `'may-hold'` mode: a `'report-only'` preview must leave the
   * working tree byte-identical, so it classifies from the unhealed scan instead
   * (positional rows are never debt, so nothing is lost).
   */
  fix(paths: string[], cwd: string, signal?: AbortSignal): Promise<void>;
  /**
   * Run a scoped `git span drift --format porcelain <paths>` and return its
   * parsed rows — one per drifted anchor among the changeset's spans, empty when
   * clean. Debt is classified from these rows via `isDebt()`; positional
   * (`MOVED`/`RESOLVED_PENDING_COMMIT`) rows are never debt and never hold.
   *
   * An empty result must mean the scan *ran and found nothing*, never that the
   * scan *could not run*. When the scoped query aborts before completing (e.g.
   * an unreadable anchor file), the implementation throws {@link AdvisorScanError}
   * rather than returning `[]`, so {@link evaluateAdvisor} does not mistake an
   * aborted scan for a clean one and silently allow unverified debt through.
   */
  drift(paths: string[], cwd: string, signal?: AbortSignal): Promise<DriftPorcelainRow[]>;
  /**
   * Run a scoped `git span list --porcelain <paths>` and return the covering
   * anchors. Used to compute *uncovered writes*: a changed path with zero
   * covering rows here (minus `.span/**`, gitignored paths, and
   * `.span/.advisorignore`-excluded paths — see {@link file://./advisor-ignore.ts})
   * is an uncovered write.
   *
   * As with {@link AdvisorExecutors.drift}, an empty result must mean the query
   * *ran and found no covering anchors*, never that it *could not run* — here
   * the stakes are inverted, since an empty covered set makes every changed
   * path look uncovered. When the query aborts before completing, the
   * implementation throws {@link AdvisorScanError} rather than returning `[]`,
   * so {@link evaluateAdvisor} warns instead of issuing a maximal, wrong hold.
   */
  list(paths: string[], cwd: string, signal?: AbortSignal): Promise<PorcelainRow[]>;
  /**
   * Run `git span list <names...>` (human format) and return its raw stdout —
   * one `## <name>` block per span (anchor bullets + description), blocks
   * separated by `---`. The hold/advisory renderers annotate these blocks with
   * per-anchor drift labels so the surfaced message carries the full span
   * (all locations + description), not just the drifted rows. Returns `''` on
   * any failure; {@link annotateBlocks} then synthesizes minimal blocks from
   * the findings themselves so no finding is dropped.
   */
  listBlocks(names: string[], cwd: string, signal?: AbortSignal): Promise<string>;
}

/**
 * The advisor's session memo. Hold credit uses a digest of the complete debt
 * state (design-decisions.md #9's "hold once per distinct debt-state"), while
 * report-only previews use separate hashed markers for individual semantic
 * rows and uncovered paths. The disk-backed implementation stores one marker
 * file per key under {@link advisorMemoDir}
 * (`<git-common-dir>/git-span/advisor/`). Injected as a store abstraction (like
 * span-surface.ts's `MemoStore`) so tests can fake it in memory.
 */
export interface AdvisorMemoState {
  /** Whether this hold-state or report-item marker is present. */
  has(digest: string): boolean;
  /**
   * Record a hold-state or report-item marker, returning
   * whether the record actually persisted. `false` means the memo could not be
   * written (e.g. an unwritable memo directory) — the advisor treats that as a
   * fail-open signal rather than holding, because a non-persisting memo would
   * silently turn "hold once, then allow the identical retry" into "hold every
   * time" with no escape.
   */
  record(digest: string): boolean;
}

/**
 * The advisor's outcome for one command, as a discriminated union the adapter
 * translates into its harness's vocabulary — `decision: 'hold'` becomes
 * Claude's `permissionDecision: 'deny'` and Codex's block. That translation is
 * the adapter's business, not this type's: `'hold'` says what the advisor is
 * asking for (stop long enough to read the report), and the harness's `deny`
 * is merely the mechanism available for asking. Nothing here enforces
 * anything — a held command succeeds on a bare retry, because the retry finds
 * the debt state already recorded in the memo and resolves to
 * `already-presented`. `kind` records *why*, so the adapter renders the right
 * message and so tests assert the exact branch.
 *
 * - `allow` / `silent` — nothing to check (no paths) or the changeset is clean;
 *   allow with no output. Internal errors and parse failures also resolve here:
 *   the advisor fails open and must never brick a commit.
 * - `allow` / `already-presented` — debt is present, but this exact debt state
 *   was already presented once (semantic-drift or uncovered-writes
 *   consider-once, an unchanged retry, or a state already shown in full by a
 *   prior `'report-only'` preview). The command passes.
 * - `allow` / `environmental` — the changeset's only drift rows are
 *   terminal/environmental conditions (`CONFLICT`, `SUBMODULE`, `LFS_*`,
 *   `PROMISOR_MISSING`, `SPARSE_EXCLUDED`, `FILTER_FAILED`, `IO_ERROR`) the CLI
 *   could not resolve at all — not span drift a user can fix by editing a span.
 *   The advisor fails OPEN (allow) but carries `conditions`/`reason` so the adapter
 *   surfaces the condition instead of swallowing it. Holding here would re-hold
 *   forever on an infra failure the user cannot clear from the advisor.
 * - `allow` / `scan-failed` — `git span drift` could not *complete* its scoped
 *   scan (a {@link AdvisorScanError}, e.g. an unreadable anchor file aborting the
 *   whole query). This is distinct from both `environmental` (the scan completed
 *   and carried terminal rows) and a clean pass (the scan completed with zero
 *   rows): the scan never ran to completion, so its empty result is not evidence
 *   of "no debt." The advisor fails OPEN here too — matching `environmental` —
 *   but keeps its own `kind` and a `reason` naming the failure, so the adapter
 *   surfaces a warning that span debt was NOT verified for this changeset
 *   instead of staying silent. There is no debt-state to memoize: every
 *   evaluation of a still-failing scan warns again.
 * - `hold` / `semantic-drift` — the changeset carries semantic drift,
 *   and this exact findings digest has not been presented before *and* was
 *   not already shown in full by a prior `'report-only'` preview. Hold
 *   **once**, listing `findings` as a checklist in `reason`. The hold exists
 *   only to make the report land: repeating the same command, changing
 *   nothing, proceeds — the identical retry falls through to the environmental
 *   and uncovered checks and resolves to `already-presented` when otherwise
 *   clean. A *different* debt state (a new digest) earns its own one-time
 *   hold, so the agent sees each distinct problem once (per
 *   design-decisions.md #1). A state the agent has already seen via
 *   `'report-only'` resolves straight to `already-presented`: it has been read
 *   already, and holding could not have compelled anything anyway.
 * - `hold` / `uncovered-writes` — the changeset has changed files no span
 *   covers, and this state has not been presented before *and* was not
 *   already shown in full by a prior `'report-only'` preview. Hold **once**,
 *   listing `uncovered`; the retry with an unchanged state — or a state
 *   already shown via `'report-only'` — resolves to `already-presented` and
 *   passes (per design-decisions.md #3).
 * - `allow` / `semantic-drift-report`, `allow` / `uncovered-writes-report`
 *   — the same two reports, delivered without the one-time hold. These are
 *   what `'report-only'` mode returns: identical `findings`/`uncovered`/
 *   `reason` payload, no `decision: 'hold'`, and no read or write of
 *   `memoState`. A `git status` preview is a live picture, not a debt state to
 *   hold on: it re-reports whatever debt exists on every call, exactly like
 *   `git status` itself does for the working tree.
 */
/**
 * Why an `allow`/`scan-failed` result happened. All three fail open, and all
 * are surfaced the same way by the adapters (a warning carrying `reason`) —
 * the discriminant exists because the three have nothing else in common:
 *
 * - `'aborted'` — the scan ran against this repository and could not finish.
 *   The cause is in the repository, and the remedy is to fix whatever the CLI
 *   reported.
 * - `'incompatible-cli'` — the installed `git-span` binary does not understand
 *   the command the hooks issue, so no scan ran at all. The cause is version
 *   skew between the plugin bundle and the binary, and the only remedy is to
 *   upgrade the binary. Nothing about the repository is implicated.
 * - `'deadline-exceeded'` — the scan was given a fixed overall budget and lost
 *   the race against it: evaluation was abandoned mid-flight (outstanding
 *   subprocesses aborted) so the hook can answer inside its registered window.
 *   The cause is duration, not repository state or install health; nothing
 *   about the repository is implicated either.
 *
 * The kind stays `'scan-failed'` rather than splitting into a third kind so the
 * adapters keep one branch for "allowed without verifying"; the discriminant
 * lets a caller that cares tell them apart without parsing prose.
 */
export type ScanFailureCause = 'aborted' | 'incompatible-cli' | 'deadline-exceeded';

/**
 * A reason payload a renderer produced. Adapters surface `reason` through
 * their own message channel verbatim.
 */
export interface RenderedReason {
  /** The rendered report text, ready for the harness's reason channel. */
  reason: string;
}

export type AdvisorResult =
  | { decision: 'allow'; kind: 'silent' }
  | { decision: 'allow'; kind: 'already-presented' }
  | { decision: 'allow'; kind: 'environmental'; conditions: DriftPorcelainRow[]; reason: string }
  | { decision: 'allow'; kind: 'scan-failed'; cause: ScanFailureCause; reason: string }
  | {
      decision: 'allow';
      kind: 'semantic-drift-report';
      findings: DriftPorcelainRow[];
      reason: string;
    }
  | {
      decision: 'allow';
      kind: 'uncovered-writes-report';
      uncovered: string[];
      reason: string;
    }
  | {
      decision: 'hold';
      kind: 'semantic-drift';
      findings: DriftPorcelainRow[];
      reason: string;
    }
  | {
      decision: 'hold';
      kind: 'uncovered-writes';
      uncovered: string[];
      reason: string;
    };

/**
 * Whether {@link evaluateAdvisor} may hold the command once so its report is
 * read (`'may-hold'`, the default — used for `commit`/`push`), or must deliver
 * the report without holding at all (`'report-only'` — used for `status`).
 *
 * Neither mode enforces: `'may-hold'` differs from `'report-only'` in that it
 * can interrupt once per distinct debt state and runs the belt-and-braces
 * `fix` heal before classifying. In `'report-only'` every branch that would otherwise
 * return `decision: 'hold'` returns its `-report` `allow` counterpart for only
 * the rows or paths not already reported this session. Report-only reads and
 * writes item markers, but never spends the one-time hold that a subsequent
 * `commit`/`push` would otherwise use to get the same report read.
 */
export type AdvisorMode = 'may-hold' | 'report-only';

/**
 * Which harness's agent the closing instruction is written for. The action-
 * oriented closings of {@link renderDriftReason} and
 * {@link renderUncoveredReason} direct the agent to do the work inline by
 * default (`'generic'`, the pre-harness prose, unchanged); `'claude'`,
 * `'codex'`, and `'opencode'` instead direct it to dispatch a forked subagent
 * — Claude's `Agent` tool with `subagent_type: "fork"`, Codex's `spawn_agent`
 * with `fork_turns: "all"`, OpenCode's Task tool (`task` with
 * `subagent_type`) — since the research/reconcile task is self-contained
 * and benefits from isolation. OpenCode additionally addresses skills by bare
 * directory name through its skill tool, where Claude/Codex use the
 * `git-span:<skill>` namespaced form. Environmental and scan-failed messages
 * do not read this value.
 */
export type AdvisorHarness = 'claude' | 'codex' | 'opencode' | 'generic';

/**
 * Evaluate the advisor for a resolved changeset: report the span debt the
 * changeset carries, and decide whether to hold the command once so that
 * report is read.
 *
 * **This function never enforces anything.** A `decision: 'hold'` asks the
 * harness to stop the command a single time; running the very same command
 * again succeeds, because the first evaluation recorded the debt state in
 * `memoState` and the second finds it already presented. Nothing returned here
 * can prevent a commit or a push. Every failure path below — an absent CLI, a
 * timeout, an aborted scan, an unwritable memo, any uncaught error — resolves
 * to `allow`. The one-time hold is an attention-grab, not a barrier, and it is
 * spent per *distinct* debt state: change the debt and the advisor asks for
 * attention once more; leave it unchanged and the advisor steps aside.
 *
 * Runs `executors.fix` (scoped belt-and-braces `drift --fix`) in `'may-hold'`
 * mode only, then reads
 * `executors.drift` and classifies each debt row (`isDebt()`) into *semantic*
 * drift and *environmental* conditions (`isEnvironmentalStatus()`).
 *
 * Semantic drift (`CHANGED`/`DELETED`) is checked against `memoState` via its
 * own digest (`advisorStateDigest(semantic, [])`), the same distinct-debt-state
 * memo the uncovered-writes check already uses: not yet presented → record it
 * and `hold`/`semantic-drift` (a `memoState.record` failure fails open to
 * `allow`/`silent`, since a non-persisting memo would re-hold the identical
 * retry forever); already presented → **fall through** rather than returning,
 * so a retry still surfaces environmental advisories and still runs the
 * uncovered check. Whether the semantic state was already presented is
 * tracked so that, if the evaluation then ends clean, it resolves to
 * `allow`/`already-presented` rather than a bare `allow`/`silent` — mirroring
 * the uncovered branch's own memo-hit result. A changeset carrying both
 * unpresented semantic drift and unpresented uncovered writes therefore
 * holds twice (drift first, uncovered on the retry) before a third
 * attempt passes — two reports, two attention-grabs, no enforcement; editing
 * one drifted span while another remains drifted produces a new findings set,
 * hence a new digest and one fresh hold. Digest collision
 * between the two categories is impossible: the payload is
 * `JSON.stringify({findings, uncovered})`, and the semantic digest populates
 * `findings` while the uncovered digest populates `uncovered`.
 *
 * Environmental conditions the CLI could not resolve at all
 * (`CONFLICT`/`SUBMODULE`/`LFS_*`/`PROMISOR_MISSING`/`SPARSE_EXCLUDED`/
 * `FILTER_FAILED`/`IO_ERROR`) → `allow`/`environmental`: fail OPEN, surfacing the
 * condition rather than holding on an infra failure a span edit cannot fix.
 * Uncovered writes (changed paths with zero coverage from `executors.list`,
 * minus `.span/**`, and paths matched by the repo's `.span/.advisorignore` — see
 * {@link file://./advisor-ignore.ts}, loaded directly from disk via
 * `resolveRepoRoot(cwd)`, fail-open when absent/unreadable) →
 * `hold`/`uncovered-writes` the first time that state is both unpresented and
 * unseen, then `allow`/`already-presented` on retry — or immediately, if a
 * prior `'report-only'` preview already showed this exact state in full: a
 * report already read is a report delivered, and holding could not have
 * compelled a fix in any case. `MOVED` and `RESOLVED_PENDING_COMMIT` never
 * contribute to any branch and never hold. Any internal error resolves to
 * `allow`/`silent` — the advisor fails open and never bricks a commit.
 *
 * A {@link AdvisorScanError} from `executors.drift` or `executors.list` is the
 * one case handled outside that flow: a scan that *could not complete* (e.g.
 * an unreadable anchor file aborts the scoped query, or the coverage query
 * cannot resolve an argument) yields an empty result that is NOT evidence of
 * a clean changeset — nor, for coverage, of an uncovered one. Reading that as `allow`/`silent` would
 * silently swallow the fact that verification never happened, so it resolves
 * instead to its own `allow`/`scan-failed` — fail OPEN like `environmental`
 * (the command is not held), but with a distinct `kind` and `reason` so the
 * adapter surfaces a warning that span debt was NOT verified for this
 * changeset rather than staying silent. There is no debt-state to memoize
 * here: every evaluation of a still-failing scan warns again.
 *
 * In `'report-only'` mode (`status`), the same classification runs but neither
 * `hold` branch fires — and no heal runs either: `executors.fix` is skipped so
 * a preview leaves the working tree byte-identical, classifying positionally-
 * drifted anchors from the read-only scan (those rows are never debt). Each
 * semantic row and uncovered path is memoized
 * independently: a preview reports only items this session has not named yet,
 * and resolves to `allow`/`silent` when none are new. These item markers are
 * separate from the once-per-debt-state hold credit, which status never spends.
 * The environmental/scan-failed/silent branches are unaffected by mode — they
 * already always allow.
 *
 * @param paths The resolved changeset from {@link resolveChangeset}. Empty →
 *   `allow`/`silent`.
 * @param cwd The working directory the git command ran in.
 * @param executors The injected `fix`/`drift`/`list` surface.
 * @param memoState The session memo for hold-credit state and report-only item markers.
 * @param mode `'may-hold'` (default) may hold the command once and runs the
 *   belt-and-braces heal; `'report-only'`
 *   delivers the same report, never holds, and never heals (no `fix` call —
 *   the preview leaves the working tree byte-identical). Neither enforces.
 * @param churn The optional mechanical-churn suppression surface (see
 *   {@link ChurnSuppression}), consumed by the uncovered-writes check via
 *   {@link computeUncoveredPaths}. Omitting it disables suppression
 *   entirely — the pre-change behavior, and the safe direction: "forgot to
 *   wire it" degrades to today's behavior rather than to silence.
 * @param harness The harness the closing instruction is written for (see
 *   {@link AdvisorHarness}); `'generic'` (default) produces the pre-harness
 *   prose unchanged. The Claude, Codex, and OpenCode adapters pass their own
 *   values; a third-party adapter passing nothing degrades to today's behavior.
 * @param deadlineMs The evaluation's overall wall-clock budget in ms —
 *   {@link EVALUATION_DEADLINE_MS} (8s) by default, chosen under every
 *   adapter's registered hook window (Claude/Codex register 10s).
 *   Per-spawn timeouts do not bound the pipeline they compose — evaluation is
 *   strictly sequential (fix → drift → list → listBlocks → changedHunks plus a
 *   per-file fallback), so a slow or hung child can otherwise spend minutes
 *   against a 10-second parent budget, after which the harness kills the hook
 *   and even the scan-failed advisory is lost. Evaluation therefore races this
 *   deadline: when the budget expires first, an internal {@link AbortSignal}
 *   aborts (killing outstanding subprocess work so nothing is orphaned),
 *   executors stop being invoked, and the result is fail-open
 *   `allow`/`scan-failed`/`'deadline-exceeded'` — an advisory-or-warning is
 *   always returned, never silence.
 * @param logger The optional core logger (see {@link CoreLogger}). The
 *   documented fail-open kinds (`scan-failed`, environmental, silent allows)
 *   stay quiet — the adapters surface those themselves — but a throw that is
 *   none of the mapped advisor errors is an internal defect silently
 *   disabling holds, so it is warned here when a logger is threaded.
 *   Omitting it loses the breadcrumb, not the fail-open behavior.
 */
export async function evaluateAdvisor(
  paths: string[],
  cwd: string,
  executors: AdvisorExecutors,
  memoState: AdvisorMemoState,
  mode: AdvisorMode = 'may-hold',
  churn?: ChurnSuppression,
  harness: AdvisorHarness = 'generic',
  deadlineMs: number = EVALUATION_DEADLINE_MS,
  logger?: CoreLogger
): Promise<AdvisorResult> {
  if (paths.length === 0) return { decision: 'allow', kind: 'silent' };
  // One cancellation scope per evaluation. Aborted when the deadline fires —
  // which kills any in-flight spawn through the signal threaded into every
  // executor call — and again unconditionally in the finally below, so no
  // child outlives the answer either way.
  const controller = new AbortController();
  const { signal } = controller;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const evaluation = (async (): Promise<AdvisorResult> => {
      try {
        // Belt-and-braces heal — `'may-hold'` only. A `'report-only'` preview must
        // leave the working tree byte-identical (CARD.md main-347): the heal dirties
        // `.span/**` with positional re-anchors no preview asked for. Skipping it
        // costs classification nothing — unhealed `MOVED`/`RESOLVED_PENDING_COMMIT`
        // rows read straight from the scan are never debt (`isDebt()`) and never
        // contribute to any branch.
        if (mode === 'may-hold') {
          await executors.fix(paths, cwd, signal);
        }
        const driftRows = await executors.drift(paths, cwd, signal);

        // Split debt rows into semantic drift (a user can fix by editing a span)
        // and terminal/environmental conditions (the CLI could not resolve the
        // anchor at all — sparse checkout, unfetched LFS, partial-clone miss, I/O
        // error). `isDebt()` is the single source of truth for what is debt at all;
        // `isEnvironmentalStatus()` splits the fixable from the unresolvable.
        // `MOVED`/`RESOLVED_PENDING_COMMIT` are never debt and never contribute.
        const debtRows = driftRows.filter((row) => isDebt(row.status));
        const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
        const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));

        if (mode === 'report-only') {
          // A status preview never holds and never spends the `'may-hold'`
          // one-time hold credit. Item-level markers keep successive previews from
          // repeating rows or paths already named this session. The whole-state
          // `seen-` marker remains a separate bridge to `'may-hold'`: a commit
          // immediately following a status preview still knows the exact state was
          // already explained, without report-only using whole-state equality to
          // decide what to render.
          if (semantic.length > 0) {
            memoState.record(`seen-${advisorStateDigest(semantic, [])}`);
            const newSemantic = filterNewReportItems(semantic, memoState, semanticReportIdentity);
            if (newSemantic.length === 0) return { decision: 'allow', kind: 'silent' };
            return {
              decision: 'allow',
              kind: 'semantic-drift-report',
              findings: newSemantic,
              ...renderDriftReason(
                newSemantic,
                await fetchSpanBlocks(executors, newSemantic, cwd, signal),
                'report-only',
                harness
              )
            };
          }
          if (environmental.length > 0) {
            return {
              decision: 'allow',
              kind: 'environmental',
              conditions: environmental,
              reason: renderEnvironmentalReason(
                environmental,
                await fetchSpanBlocks(executors, environmental, cwd, signal)
              )
            };
          }
          const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors, churn, signal);
          if (uncovered.length === 0) return { decision: 'allow', kind: 'silent' };
          memoState.record(`seen-${advisorStateDigest([], uncovered)}`);
          const newUncovered = filterNewReportItems(uncovered, memoState, uncoveredReportIdentity);
          if (newUncovered.length === 0) return { decision: 'allow', kind: 'silent' };
          return {
            decision: 'allow',
            kind: 'uncovered-writes-report',
            uncovered: newUncovered,
            ...renderUncoveredReason(
              newUncovered,
              covering,
              await fetchSpanBlocks(executors, covering, cwd, signal),
              'report-only',
              harness
            )
          };
        }

        // Semantic drift joins the same distinct-debt-state memo the uncovered
        // check uses: hold once per findings digest, then fall through (rather than
        // returning) on an identical retry so the rest of the evaluation still runs.
        let semanticAlreadyPresented = false;
        if (semantic.length > 0) {
          const semanticDigest = advisorStateDigest(semantic, []);
          if (memoState.has(semanticDigest)) {
            semanticAlreadyPresented = true;
          } else if (memoState.has(`seen-${semanticDigest}`)) {
            // Already explained in full by a prior `'report-only'` (status)
            // preview. The report has landed, which is all a hold can accomplish —
            // a hold never compels a fix, it only buys one reading — so holding
            // again buys nothing; record the hold credit too so this digest reads
            // as presented from here on, and let it through.
            memoState.record(semanticDigest);
            semanticAlreadyPresented = true;
          } else {
            // A non-persisting memo write would turn "hold once, then allow the
            // retry" into "hold every time" with no escape — fail open instead.
            if (!memoState.record(semanticDigest)) return { decision: 'allow', kind: 'silent' };
            memoState.record(`seen-${semanticDigest}`);
            return {
              decision: 'hold',
              kind: 'semantic-drift',
              findings: semantic,
              ...renderDriftReason(
                semantic,
                await fetchSpanBlocks(executors, semantic, cwd, signal),
                'may-hold',
                harness
              )
            };
          }
        }

        // Environmental conditions are not a span edit away from resolution: fail
        // OPEN (allow) — but carry them so the adapter surfaces the condition rather
        // than swallowing it. Holding would re-hold forever on an infra failure the
        // user cannot clear from the advisor, contradicting the fail-open contract the
        // rest of the advisor already honors for CLI-absent/timeout/parse failures.
        if (environmental.length > 0) {
          return {
            decision: 'allow',
            kind: 'environmental',
            conditions: environmental,
            reason: renderEnvironmentalReason(
              environmental,
              await fetchSpanBlocks(executors, environmental, cwd, signal)
            )
          };
        }

        // Uncovered writes: changed paths with zero covering span, minus the
        // configured span root (span repairs ride the same commit and must never
        // self-trigger the advisor) and paths the repo's user-owned `.span/.advisorignore`
        // excludes. Gitignored paths never reach here — git does not stage/publish them.
        const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors, churn, signal);
        if (uncovered.length === 0) {
          // A retry that fell through past an already-presented semantic-drift
          // digest ends clean here: surface already-presented rather than a bare
          // silent allow, mirroring the uncovered branch's own memo-hit result.
          return semanticAlreadyPresented
            ? { decision: 'allow', kind: 'already-presented' }
            : { decision: 'allow', kind: 'silent' };
        }

        // Hold once: interrupt the first time this exact debt state is seen, then
        // pass the retry with an unchanged state. (No semantic rows survive to
        // here unpresented — the semantic branch above has already returned for
        // that case — so the digest's findings component is empty and the state
        // is keyed by the uncovered set.) `covering` — which spans for the rest of
        // this changeset the message goes on to name — never feeds the digest: it
        // never changes what's reported on, only what's explained, so it can't
        // spawn a fresh hold on its own.
        const digest = advisorStateDigest([], uncovered);
        if (memoState.has(digest)) return { decision: 'allow', kind: 'already-presented' };
        if (memoState.has(`seen-${digest}`)) {
          // Already explained in full by a prior `'report-only'` (status) preview.
          // The report has landed, which is the only thing a hold ever achieves —
          // it never compels a fix — so holding again buys nothing. Record the
          // hold credit so this digest reads as presented from here on, and let
          // it through.
          memoState.record(digest);
          return { decision: 'allow', kind: 'already-presented' };
        }
        // A non-persisting memo write would turn "hold once, then allow the retry"
        // into "hold every time" with no escape — fail open rather than hold.
        if (!memoState.record(digest)) return { decision: 'allow', kind: 'silent' };
        memoState.record(`seen-${digest}`);
        return {
          decision: 'hold',
          kind: 'uncovered-writes',
          uncovered,
          ...renderUncoveredReason(
            uncovered,
            covering,
            await fetchSpanBlocks(executors, covering, cwd, signal),
            'may-hold',
            harness
          )
        };
      } catch (err) {
        // The budget expired while this body was awaiting an executor. Nothing
        // below classifies an expiry — it is not a repository condition, and
        // reading the aborted spawn's collapsed result as a clean pass (or as
        // a scan failure pointing at the repo) would both lie — so rethrow to
        // the deadline mapping at the race's catch. This is also what keeps a
        // timer that fires between two awaits from having the body carry on
        // spawning: every later executor call receives the already-aborted
        // signal.
        if (controller.signal.aborted) throw new AdvisorDeadlineError(deadlineMs);
        // A scan that could not COMPLETE is not a clean result, but it is not
        // debt either — there is nothing here for a user to resolve by editing a
        // span. Fail OPEN with a distinguishable `scan-failed` warning instead of
        // silently reading the aborted scan's empty result as clean.
        if (err instanceof AdvisorIncompatibleCliError) {
          // Version skew, not a repository problem: same fail-open decision, but a
          // reason that names the binary and the upgrade rather than pointing the
          // user at a scan error they cannot act on.
          return {
            decision: 'allow',
            kind: 'scan-failed',
            cause: 'incompatible-cli',
            reason: renderIncompatibleCliReason(err)
          };
        }
        if (err instanceof AdvisorScanError) {
          return {
            decision: 'allow',
            kind: 'scan-failed',
            cause: 'aborted',
            reason: renderScanFailedReason(err.detail)
          };
        }
        // Fail open: any other internal/CLI error resolves to allow. The advisor must
        // never brick a commit on its own failure. This branch is exactly the
        // non-advisor-error case — scan/incompatible-cli/deadline failures are
        // mapped above — so what reaches it is an internal defect silently
        // disabling holds: warn through the threaded logger so the
        // permanently-disabled hold is diagnosable rather than invisible.
        // Omitting the logger loses the breadcrumb, not the behavior.
        logger?.warn('git-span advisor evaluation failed open on an unexpected error', { err });
        return { decision: 'allow', kind: 'silent' };
      }
    })();
    // The overall deadline: evaluation races a timer, and the loser's work is
    // not left running — firing the timer aborts `controller`, which kills the
    // in-flight subprocess through the executor `signal` and makes every later
    // executor call refuse to spawn. A losing body that rejects afterwards is
    // still handled: Promise.race attached handlers to every input, so no
    // unhandled rejection can escape either direction of the settle order.
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AdvisorDeadlineError(deadlineMs));
      }, deadlineMs);
    });
    return await Promise.race([evaluation, expiry]);
  } catch (err) {
    if (err instanceof AdvisorDeadlineError) {
      // Fail OPEN under the expired budget — matching `environmental` and every
      // other scan failure — but keep the dedicated cause so the surfaced
      // warning says the changeset was NOT verified because time ran out,
      // rather than pointing at the repository or the install.
      return {
        decision: 'allow',
        kind: 'scan-failed',
        cause: 'deadline-exceeded',
        reason: renderDeadlineExceededReason(err.budgetMs)
      };
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Kill any straggler on the success path too: by construction nothing is
    // in flight once the sequential body settles, but aborting here makes that
    // invariant hold by construction rather than by audit.
    controller.abort();
  }
}

/**
 * {@link computeUncoveredPaths}'s result: the uncovered complement the advisor
 * holds/advises on, plus the `covering` rows the same `executors.list` call
 * already resolved for the rest of the changeset, filtered down to every
 * anchor, in any span, whose path is one of the paths passed in — the CLI
 * itself returns matching spans whole, so that narrowing happens in
 * {@link computeUncoveredPaths} rather than being free. `covering` is never empty only
 * when `uncovered` is; the two partition the changeset (minus configured-span-root/
 * advisor-ignored paths, which appear in neither). Kept together so a caller
 * needing both (the uncovered-writes reason, which now also names spans
 * already covering the changeset's other files — see
 * {@link renderUncoveredReason}) makes one call instead of two.
 */
interface ChangesetCoverage {
  uncovered: string[];
  covering: PorcelainRow[];
}

/**
 * The changed paths with zero covering span — minus the configured span root
 * (`GIT_SPAN_DIR` / git config `git-span.dir`, default `.span`; span repairs
 * ride the same commit and must never self-trigger the advisor) and paths the
 * repo's user-owned `.span/.advisorignore` excludes (fail-open when absent/
 * unreadable). Shared by `evaluateAdvisor`'s `'may-hold'` and `'report-only'` branches,
 * which differ only in what they do with the result (hold-once vs. an
 * always-fresh report).
 *
 * A changeset of fewer than two files can never carry an implicit *cross-file*
 * dependency — git-span records couplings between file/line ranges across
 * files — so a single-file (or empty) changeset short-circuits to no
 * uncovered paths (and no covering rows) rather than prompting for a coupling
 * that cannot exist.
 */
async function computeUncoveredPaths(
  paths: string[],
  cwd: string,
  executors: AdvisorExecutors,
  churn?: ChurnSuppression,
  signal?: AbortSignal
): Promise<ChangesetCoverage> {
  if (paths.length < 2) return { uncovered: [], covering: [] };
  // `git span list --porcelain <paths...>` matches spans by path but returns
  // each matching span *whole* — every anchor it has, including anchors in
  // files nowhere near this changeset. Narrow to the intersection here, once,
  // at the single place that has the changeset in hand: everything downstream
  // (the related-spans ranking's co-occurrence key, its proximity tie-break,
  // and the per-span anchor tree rendered under a header that promises "other
  // files in this change") is only meaningful over in-changeset anchors.
  const changeset = new Set(paths);
  const covering = (await executors.list(paths, cwd, signal)).filter((row) => changeset.has(row.path));
  // Every row dropped above has a path outside `paths`, and `covered` is only
  // ever probed with members of `paths`, so the filter cannot change which
  // paths are flagged uncovered. A span usually keeps at least one row, since
  // it is in the CLI's output only because one of `paths` matched it — but not
  // always: the resolver tests `loaded_names.contains(arg)` before the path
  // index (`cli/show.rs`), so a changed file whose path is exactly a span name
  // matches by *name* and contributes no in-changeset anchor. That span drops
  // out of the section entirely, which is correct — it covers nothing in this
  // change — and it cannot leave a bulletless header behind, because
  // `groupCoveringByName` builds its groups by iterating rows and so never
  // creates an entry for a span with none.
  const covered = new Set(covering.map((row) => row.path));
  const repoRoot = resolveRepoRoot(cwd);
  const advisorIgnoreRules = repoRoot ? loadAdvisorIgnore(repoRoot) : [];
  // Resolved exactly once per evaluation (this helper runs at most once per
  // `evaluateAdvisor` call) so the exclusion matches the root every touch-side
  // consumer uses — `GIT_SPAN_DIR` / git config `git-span.dir`, defaulting to
  // `.span`. Filtering with the bare default left span-document edits in the
  // changeset at any relocated root, and the advisor held on its own repairs.
  // No repo root → no config to consult; keep the default-root filter.
  const spanRoot = repoRoot === null ? SPAN_ROOT : resolveSpanRoot(repoRoot);
  let uncovered = paths.filter(
    (path) => !covered.has(path) && !isInsideSpanRoot(path, spanRoot) && !isAdvisorIgnored(advisorIgnoreRules, path)
  );

  // Mechanical-churn suppression: filter the already-uncovered set down to the
  // files whose diff content is genuinely semantic, scoped only to what came
  // back uncovered so a fully-covered changeset never spawns the diff
  // subprocess. Absent `churn` skips filtering entirely (today's behavior —
  // "forgot to wire it" degrades safely rather than to silence).
  if (churn && uncovered.length > 0) {
    const before = uncovered.length;

    // The category layer runs *ahead of the diff read*, not after it. A lockfile
    // is suppressed by path shape alone — that is what
    // {@link file://./mechanical-change.ts}'s header promises — and deciding it
    // after the read made the promise conditional on the read succeeding: the
    // per-file fallback below keeps an unread file flagged, so a lockfile in a
    // changeset whose diff read failed was reported anyway. Suppression must not
    // depend on an environmental accident.
    //
    // The predicate is the bare category layer, matching `classifyMechanical`'s
    // own path-only verdict exactly. It was briefly composed here as
    // `isClassifiablePath(path) && isNeverSpannedPath(path)`, mirroring an
    // ordering the classifier itself no longer uses; that conjunction refused
    // `.map` and `.min.js` as non-manifest-shaped before their suffix was ever
    // tested, so it silently dropped three of the four categories CARD.md
    // assigns to this layer. Duplicating the classifier's ordering at its call
    // site was the underlying mistake — the sequencing rationale lives in
    // {@link classifyMechanical} and only there, and this site now defers to it
    // with a single predicate that cannot drift out of agreement.
    uncovered = uncovered.filter((path) => !isNeverSpannedPath(path));
    const suppressedByPath = before - uncovered.length;

    // The content layer, over whatever the path layer left. One batched
    // `git diff -U0` covers the whole set; a file the batch did not return is
    // re-read on its own so a single oversized or unreadable file costs only
    // its own suppression rather than the whole changeset's — an over-1MiB
    // diff used to come back as `''` from `gitText` and collapse suppression
    // for every file at once. Any failure leaves the file flagged: fail toward
    // reporting, never toward suppression.
    // Scoped to the paths the content layer is *permitted* to classify. A
    // non-manifest path's verdict is `classifyMechanical`'s gate refusal, which
    // is knowable from the path string, so reading its diff buys a foregone
    // conclusion. Leaving it in the read set made the ordinary source-only
    // changeset pay the whole feature's cost to learn nothing: this card's own
    // `ded75b8d` has 7 uncovered paths, none classifiable, and was buffering
    // and parsing 1.16 MB before refusing all 7 on the gate. This is the half
    // of "decide suppression before reading the diff" that the hoist above
    // missed — path-*suppression* moved ahead of the read, gate-*refusal* did
    // not. It also bounds the fallback fanout below to the classifiable subset,
    // which is the only place that fanout can change an answer.
    const needsContent = uncovered.filter(isClassifiablePath);
    const byPath = new Map<string, FileDiff>();
    // `skipped` rather than `clean` when nothing was classifiable: "the read
    // succeeded" and "no read was attempted" are different facts, and since
    // scoping the read to classifiable paths the second is the common case on a
    // source-only changeset. A breadcrumb that reported `clean` for both would
    // make the ordinary no-op indistinguishable from a real read that found
    // nothing mechanical.
    let readOutcome: 'clean' | 'skipped' | 'per-file-fallback' | 'failed' =
      needsContent.length > 0 ? 'clean' : 'skipped';
    if (needsContent.length > 0) {
      try {
        for (const file of await churn.git.changedHunks(needsContent, churn.range, cwd, signal)) {
          byPath.set(file.path, file);
        }
      } catch {
        readOutcome = 'failed';
      }
      const missing = needsContent.filter((path) => !byPath.has(path));
      if (missing.length > 0) {
        if (readOutcome === 'clean') readOutcome = 'per-file-fallback';
        for (const path of missing) {
          try {
            for (const file of await churn.git.changedHunks([path], churn.range, cwd, signal)) {
              byPath.set(file.path, file);
            }
          } catch {
            // this one file stays flagged; the rest of the set is unaffected
            readOutcome = 'failed';
          }
        }
      }
      uncovered = uncovered.filter((path) => {
        const file = byPath.get(path);
        if (!file) return true;
        return !classifyMechanical(file).mechanical;
      });
    }

    // The only thing a user observes about suppression is an absent prompt, so
    // "suppressed correctly", "suppressed wrongly", and "gave up on a failed
    // read" are indistinguishable from outside without this line. It goes to the
    // hook logger, never to stdout: the advisor's normal path emits nothing.
    churn.logger?.info?.('git-span advisor churn suppression', {
      candidates: before,
      suppressedByPath,
      suppressedByContent: before - suppressedByPath - uncovered.length,
      reported: uncovered.length,
      read: readOutcome
    });
  }

  return { uncovered, covering };
}

// ---------------------------------------------------------------------------
// Debt-state digest and reason rendering
// ---------------------------------------------------------------------------

/**
 * `path#Lstart-Lend`, or a bare path for a whole-file anchor. Typed against
 * the fields shared by {@link DriftPorcelainRow} and {@link PorcelainRow}
 * (rather than either specifically) so both the drift/environmental
 * renderers and the uncovered-writes related-spans section ({@link
 * groupCoveringByName}) can format an anchor the same way.
 */
function anchorText(row: { path: string; start: number; end: number }): string {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}

/**
 * The distinct-debt-state digest (design-decisions.md #9): a stable hash of the
 * sorted drift findings plus the sorted uncovered paths. Presence in the
 * memo means "this exact state was already presented once."
 */
function advisorStateDigest(findings: DriftPorcelainRow[], uncovered: string[]): string {
  const findingKeys = findings.map((row) => `${row.status}\t${row.name}\t${row.path}\t${row.start}\t${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash('sha256').update(payload).digest('hex');
}

/** A stable, filename-safe marker for one item already named by report-only. */
function reportItemKey(identity: string): string {
  return `report-${createHash('sha256').update(identity).digest('hex')}`;
}

/** Semantic previews treat path + span name as the durable row identity. */
function semanticReportIdentity(row: DriftPorcelainRow): string {
  return JSON.stringify({ kind: 'semantic', path: row.path, name: row.name });
}

/** Uncovered previews memoize each path independently. */
function uncoveredReportIdentity(path: string): string {
  return JSON.stringify({ kind: 'uncovered', path });
}

/** Filter against the pre-preview memo, then persist every identity that will be shown. */
function filterNewReportItems<T>(items: T[], memoState: AdvisorMemoState, identityOf: (item: T) => string): T[] {
  const unseen = new Set<string>();
  for (const item of items) {
    const identity = identityOf(item);
    if (!memoState.has(reportItemKey(identity))) unseen.add(identity);
  }
  for (const identity of unseen) memoState.record(reportItemKey(identity));
  return items.filter((item) => unseen.has(identityOf(item)));
}

/**
 * Fetch the human-format `## <name>` blocks for the spans named in `rows`,
 * failing to `''` (never throwing) so a list failure can never turn a hold
 * into a silent allow via {@link evaluateAdvisor}'s outer catch —
 * {@link annotateBlocks} synthesizes minimal blocks from the rows instead, and
 * {@link renderRelatedSpansSection} simply omits a `why` sentence it can't
 * find. Typed against `{ name: string }` (rather than {@link DriftPorcelainRow}
 * specifically) so both the drift/environmental renderers and the
 * uncovered-writes related-spans section can share this one fetch.
 */
async function fetchSpanBlocks(
  executors: AdvisorExecutors,
  rows: { name: string }[],
  cwd: string,
  signal?: AbortSignal
): Promise<string> {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  if (names.length === 0) return '';
  try {
    return await executors.listBlocks(names, cwd, signal);
  } catch {
    return '';
  }
}

/**
 * Pull one span's `why` paragraph out of `blocksText` (the `git span list
 * <names...>` human format {@link fetchSpanBlocks} returns) — everything
 * after `name`'s anchor bullets, up to the next `---`-separated block or the
 * end of the text. Returns `''` when the block isn't found or the span
 * simply has no `why` recorded (the CLI omits it entirely rather than
 * printing an empty line — see `render_list_block` in `cli/show.rs`).
 */
function extractWhy(blocksText: string, name: string): string {
  const trimmed = blocksText.trim();
  if (trimmed.length === 0) return '';
  for (const block of trimmed.split('\n\n---\n\n')) {
    const lines = block.split('\n');
    if (lines[0] !== `## ${name}`) continue;
    let i = 1;
    while (i < lines.length && (lines[i].startsWith('- ') || lines[i] === '*Span has no anchors*')) i++;
    if (lines[i] === '') i++;
    return lines.slice(i).join('\n').trim();
  }
  return '';
}

/**
 * Collapse rows that name the same anchor address into one entry, combining
 * their distinct statuses (sorted) and preserving first-seen order. The CLI's
 * `drift --format porcelain` emits one row per *drifting layer* for a single
 * anchor (e.g. both worktree and index changed) — a distinction the `src`
 * column carries but {@link parseDriftPorcelain} deliberately drops — so
 * without this collapse the same anchor would otherwise render as two (or
 * more) identical bullets instead of one bullet with every status it earned.
 */
function dedupeByAnchor(rows: DriftPorcelainRow[]): { addr: string; statuses: PorcelainStatus[] }[] {
  const order: string[] = [];
  const byAddr = new Map<string, Set<PorcelainStatus>>();
  for (const row of rows) {
    const addr = anchorText(row);
    let statuses = byAddr.get(addr);
    if (!statuses) {
      statuses = new Set();
      byAddr.set(addr, statuses);
      order.push(addr);
    }
    statuses.add(row.status);
  }
  return order.map((addr) => ({ addr, statuses: [...(byAddr.get(addr) ?? [])].sort() }));
}

/** One anchor on its way to {@link renderAnchorTree}, with its drift suffix precomputed. */
type AnchorRow = { path: string; range: RangeLabel; suffix: string };

/** The {@link RangeLabel} for a porcelain row — `0-0` is the whole-file anchor. */
function rangeLabel(row: { start: number; end: number }): RangeLabel {
  if (row.start === 0 && row.end === 0) return { kind: 'whole-file' };
  return { kind: 'range', start: row.start, end: row.end };
}

const BULLET_RANGE = /^(.+)#L(\d+)-L(\d+)$/;

/**
 * Classify one bullet's anchor text out of the CLI's flat human format. Three
 * shapes, and the distinction between the last two is load-bearing:
 *
 * - `path#Lstart-Lend` → a line range.
 * - a bare path with **no `#L` at all** → a deliberate whole-file anchor.
 *   `render_list_block` (`cli/show.rs`) prints it exactly that way, so this
 *   renders as a plain path with zero marker, as it does today.
 * - a `#L` fragment that does *not* cleanly match `#Lstart-Lend` — cut off
 *   mid-number, non-numeric, a lone `#L` → `truncated`: source we cannot
 *   trust and will not guess at.
 *
 * `truncated` is only ever reached when a `#L` is present and unparseable.
 * Conflating it with the bare-path case would mark every legitimate
 * whole-file anchor as broken, which is the specific regression this split
 * exists to prevent. This is also the *only* place `truncated` becomes
 * reachable at all — the structured-data call sites can never produce one
 * (see the invariant recorded at {@link RangeLabel}).
 */
function parseAnchorAddr(addr: string, suffix: string): AnchorRow {
  const matched = BULLET_RANGE.exec(addr);
  if (matched) {
    return { path: matched[1], range: { kind: 'range', start: Number(matched[2]), end: Number(matched[3]) }, suffix };
  }
  const fragment = addr.indexOf('#L');
  if (fragment === -1) return { path: addr, range: { kind: 'whole-file' }, suffix };
  return { path: addr.slice(0, fragment), range: { kind: 'truncated' }, suffix };
}

/**
 * Lay one span's anchor run out as a shared-prefix tree, degrading to the
 * caller's own `flat` bullet lines if the renderer throws.
 *
 * **The catch below is the FAIL-CLOSED choice, not a `<greenfield>`-forbidden
 * fallback. Do not remove it.** {@link evaluateAdvisor} builds
 * `reason: renderDriftReason(...)` *inline* inside its own `try`, and its
 * outer catch resolves any uncaught error to `{ decision: 'allow', kind:
 * 'silent' }` so the advisor can never brick a commit on its own failure. So
 * an exception escaping a tree render here would not degrade to a flat list —
 * it would bypass the `decision: 'hold'` construction entirely and silently
 * allow a commit that should have been held. Catching locally keeps the hold
 * firing and the reason rendering, just flat: it narrows what a rendering
 * defect can cost from "a missed commit gate" to "an uglier message", and
 * never widens it. The gating decision and the presentation of that decision
 * are different things, and this catch only ever touches the latter.
 *
 * Callers each pass their own `flat` fallback rather than sharing one
 * reconstruction, so a degraded run prints exactly what that call site printed
 * before the tree — including, for {@link annotateBlocks}, the verbatim source
 * text of a bullet this module could not classify.
 */
function renderAnchorRun(rows: AnchorRow[], flat: string[]): string[] {
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    return flat;
  }
}

/**
 * Attach each finding in `pending` to one bullet of a span's complete bullet
 * run, and render the run.
 *
 * Matching runs in two passes over the *whole* run rather than bullet by
 * bullet, because a per-bullet decision cannot see the anchors that follow it.
 * Pass one claims findings whose address matches a bullet exactly. Pass two
 * applies the path-only fallback — a deliberate accommodation, since an
 * anchor's range and the range the CLI reports can legitimately disagree after
 * a heal — but only for a bullet that is the *sole* bullet on its path, where
 * the path alone identifies the anchor unambiguously. This is the same
 * `soleOnPath` guard {@link touch-core!anchorBullets} applies, and it is what
 * makes the two hooks agree: without it, the first bullet for a multi-range
 * file claims the finding and the range that genuinely drifted renders bare.
 *
 * A finding that survives both passes matches no anchor this run can name, so
 * it is appended as its own entry — collapsed via {@link dedupeByAnchor}, and
 * never dropped.
 *
 * The result is structured rather than pre-rendered so the caller can build the
 * tree and the flat fallback from one source. Recovering an address from a
 * formatted bullet would mean splitting on ` — `, which a path is free to
 * contain.
 */
function annotateBulletRun(bulletLines: string[], pending: DriftPorcelainRow[]): { addr: string; suffix: string }[] {
  const addrs = bulletLines.map((line) => line.slice(2));
  const paths = addrs.map((addr) => addr.split('#')[0]);
  const claimed: DriftPorcelainRow[][] = addrs.map(() => []);
  const used = new Set<DriftPorcelainRow>();

  const claim = (index: number, matches: (row: DriftPorcelainRow) => boolean): void => {
    for (const row of pending) {
      if (used.has(row) || !matches(row)) continue;
      claimed[index].push(row);
      used.add(row);
    }
  };

  for (const [i, addr] of addrs.entries()) {
    claim(i, (row) => anchorText(row) === addr);
  }
  for (const [i, addr] of addrs.entries()) {
    if (paths.filter((path) => path === paths[i]).length !== 1) continue;
    claim(i, (row) => addr === row.path || addr.startsWith(`${row.path}#`));
  }

  const entries = addrs.map((addr, i) => {
    const rows = claimed[i];
    if (rows.length === 0) return { addr, suffix: '' };
    const statuses = [...new Set(rows.map((row) => row.status))].sort();
    return { addr, suffix: ` — ${statuses.map(humanStatusLabel).join(', ')}` };
  });
  for (const { addr, statuses } of dedupeByAnchor(pending.filter((row) => !used.has(row)))) {
    entries.push({ addr, suffix: ` — ${statuses.map(humanStatusLabel).join(', ')}` });
  }
  return entries;
}

/**
 * Annotate `git span list` human blocks with per-anchor drift labels: each
 * bullet whose anchor matches a finding gains ` — <label>`, per the matching
 * rules in {@link annotateBulletRun}. Bullets are only the contiguous `- ` run
 * directly under a `## <name>` header, so a description line that happens to
 * start with `- ` is never annotated — and because the run is buffered whole
 * before it is annotated, a bullet's label accounts for every sibling anchor
 * in the same span.
 *
 * Findings whose anchor has no matching bullet are appended to their span's
 * bullet run; spans absent from `blocksText` entirely (or an empty/failed
 * list read) get a synthesized minimal block — no finding is ever dropped.
 * Every finding matching (or appended for) a given anchor address is
 * collapsed via {@link dedupeByAnchor} first, so a single anchor never
 * renders as more than one bullet regardless of how many drifting-layer rows
 * the CLI emitted for it.
 *
 * The collected bullet run is re-emitted as a shared-prefix tree (via
 * {@link renderAnchorRun}) instead of the flat bullets it was parsed from —
 * that is the *only* thing about this walk that changed. Its control structure
 * is deliberately intact, because both guarantees above depend on it: the
 * `if (inBullets) closeBullets()` below is what structurally confines bullets
 * to the contiguous run under a header, and every non-bullet line
 * (`*Span has no anchors*`, blank separators, `---` delimiters, the `why`
 * paragraph) still falls through to the unconditional passthrough at the end
 * of the loop.
 */
function annotateBlocks(blocksText: string, rows: DriftPorcelainRow[]): string {
  const remaining = new Map<string, DriftPorcelainRow[]>();
  for (const row of rows) {
    const group = remaining.get(row.name);
    if (group) group.push(row);
    else remaining.set(row.name, [row]);
  }

  const out: string[] = [];
  let pending: DriftPorcelainRow[] = [];
  let bullets: string[] = [];
  let inBullets = false;
  // The bullet run collected under the current header, in both forms: `runRows`
  // feeds the tree, `runFlat` is the flat rendering it degrades to.
  let runRows: AnchorRow[] = [];
  let runFlat: string[] = [];
  const collect = (addr: string, suffix: string): void => {
    runFlat.push(`- ${addr}${suffix}`);
    runRows.push(parseAnchorAddr(addr, suffix));
  };
  const closeBullets = (): void => {
    for (const { addr, suffix } of annotateBulletRun(bullets, pending)) {
      collect(addr, suffix);
    }
    if (runRows.length > 0) out.push(...renderAnchorRun(runRows, runFlat));
    bullets = [];
    pending = [];
    runRows = [];
    runFlat = [];
    inBullets = false;
  };

  const trimmed = blocksText.trim();
  if (trimmed.length > 0) {
    for (const line of trimmed.split('\n')) {
      const header = /^## (.+)$/.exec(line);
      if (header) {
        closeBullets();
        out.push(line);
        pending = remaining.get(header[1]) ?? [];
        remaining.delete(header[1]);
        inBullets = true;
        continue;
      }
      if (inBullets && line.startsWith('- ')) {
        bullets.push(line);
        continue;
      }
      if (inBullets) closeBullets();
      out.push(line);
    }
    closeBullets();
  }

  // Synthesized blocks for spans `blocksText` never mentioned. They tree too:
  // a synthesized block sitting beside a parsed one in the same message must
  // not be the odd one out in a second format.
  for (const [name, group] of remaining) {
    if (out.length > 0) out.push('', '---', '');
    out.push(`## ${name}`);
    const rows: AnchorRow[] = [];
    const flat: string[] = [];
    for (const { addr, statuses } of dedupeByAnchor(group)) {
      const suffix = ` — ${statuses.map(humanStatusLabel).join(', ')}`;
      flat.push(`- ${addr}${suffix}`);
      rows.push(parseAnchorAddr(addr, suffix));
    }
    out.push(...renderAnchorRun(rows, flat));
  }

  return out.join('\n');
}

/**
 * The full-span checklist a semantic-drift `hold` (or, in `'report-only'` mode,
 * a `status` advisory) renders into `reason`. The closing sentence drops "—
 * then retry" in `'report-only'` mode: a `status` check never held anything, so
 * there is nothing to retry. The `harness` selects who the closing directs to
 * do the work: inline (`'generic'`, unchanged), or a forked subagent
 * (`'claude'`/`'codex'`/`'opencode'`). The inline closings name no skill at all
 * — the reconcile workflow is spelled out by the action sentence.
 */
function renderDriftReason(
  findings: DriftPorcelainRow[],
  blocksText: string,
  mode: AdvisorMode = 'may-hold',
  harness: AdvisorHarness = 'generic'
): RenderedReason {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? 'an implicit dependency' : 'implicit dependencies';
  const name = names.length === 1 ? names[0] : '<name>';
  const action = `preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`; update or retire the why only if its meaning changed; require \`git span drift ${name}\` to report zero`;
  // Who the closing directs to do the work: inline by default (`'generic'`, the
  // pre-harness prose, unchanged); a forked subagent for `'claude'` (Claude's
  // `Agent` tool with `subagent_type: "fork"`), `'codex'` (`spawn_agent`
  // with `fork_turns: "all"`), and `'opencode'` (the Task tool with
  // `subagent_type`), since the reconcile task is self-contained and
  // benefits from isolation while the parent session continues. The mode still
  // controls the retry framing: a `'report-only'` status check never held
  // anything, so there is nothing to retry.
  const inline = harness === 'generic';
  const lead = inline
    ? 'Bring the coupled files back into agreement (follow confirmed authority)'
    : harness === 'claude'
      ? 'Dispatch a forked subagent to bring the coupled files back into agreement (follow confirmed authority)'
      : harness === 'codex'
        ? 'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to bring the coupled files back into agreement (follow confirmed authority)'
        : 'Dispatch a subagent with the `task` tool to bring the coupled files back into agreement (follow confirmed authority)';
  // OpenCode addresses skills by bare directory name through its skill tool,
  // and its subagent is dispatched via the Task tool rather than forked — so
  // both the skill name and the location phrase differ from the twins. Only
  // the subagent harnesses reach this branch (inline closings name no skill).
  const skillLine =
    harness === 'opencode'
      ? 'Load the `reconcile` skill via the skill tool in the subagent.'
      : 'Load the `git-span:reconcile` skill in the fork.';
  const tail = inline
    ? mode === 'may-hold'
      ? `then reconcile: ${action}. Retry the command; the hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.`
      : `then reconcile: ${action}. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.`
    : mode === 'may-hold'
      ? `— ${action}. Then retry. ${skillLine} The hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.`
      : `— ${action}. ${skillLine} Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.`;
  const closing = `${lead}${inline ? ',' : ''} ${tail}`;
  return {
    reason: [
      `This change leaves ${subject} out of date:`,
      '',
      annotateBlocks(blocksText, findings),
      '',
      '---',
      '',
      closing
    ].join('\n')
  };
}

/**
 * Wrap `text` for delivery as a harness's `additionalContext`, so every such
 * payload this advisor emits sits inside a `<git-span>...</git-span>` block —
 * matching the touch hook's block styling — never bare prose. A no-op when
 * `text` already carries a `<git-span>` tag somewhere (e.g.
 * {@link renderUncoveredReason}'s output already wraps itself), so a caller
 * can apply this unconditionally without ever nesting one block inside
 * another.
 */
export function wrapGitSpanContext(text: string): string {
  if (text.includes('<git-span>')) return text;
  return `<git-span>\n${text}\n</git-span>`;
}

/**
 * The advisory surfaced when the changeset's only drift is environmental —
 * the advisor allows but says why, so the unresolvable condition is not silently
 * swallowed.
 */
function renderEnvironmentalReason(conditions: DriftPorcelainRow[], blocksText: string): string {
  return [
    'Could not check these implicit dependencies (unfetched LFS, sparse checkout, or similar) — not blocking:',
    '',
    annotateBlocks(blocksText, conditions),
    '',
    '---',
    '',
    'Fix the checkout/fetch issue if these dependencies need verifying.'
  ].join('\n');
}

/**
 * The advisory a `'deadline-exceeded'` scan failure renders into `reason`: the
 * evaluation raced its overall budget and lost, so verification was abandoned
 * mid-flight — not a repository condition and not an install problem, just a
 * duration fact. Same fail-open shape as {@link renderScanFailedReason}, with
 * the remedy being a manual scan rather than a fix.
 */
function renderDeadlineExceededReason(budgetMs: number): string {
  return [
    `The implicit-dependency check exceeded its ${budgetMs} ms time budget, so this change was NOT verified:`,
    '<git-span-error>',
    indentBlockBody('a git or git-span subprocess did not finish in time; the scan was abandoned mid-flight'),
    '</git-span-error>',
    '',
    'The command proceeds anyway. Run `git span drift --format porcelain` manually if verification matters for this change.'
  ].join('\n');
}

/**
 * The advisory an `allow`/`scan-failed` result renders into `reason`: the scan
 * could not complete, so the changeset was NOT verified — but the command
 * proceeds anyway (fail-open, matching `environmental`).
 */
function renderScanFailedReason(detail: string): string {
  return [
    'The implicit-dependency check could not run, so this change was NOT verified:',
    '<git-span-error>',
    indentBlockBody(detail),
    '</git-span-error>',
    '',
    'The command proceeds anyway. Fix the scan error if verification matters for this change.'
  ].join('\n');
}

/**
 * The advisory an `allow`/`scan-failed`/`incompatible-cli` result renders into
 * `reason`. Deliberately does not lead with the CLI's own stderr: that text
 * names whichever subcommand the binary's argument parser guessed at, which is
 * never the command the user ran and reliably sends readers looking for a
 * problem in their repository. Lead with the diagnosis and the remedy, and keep
 * the raw diagnostic at the bottom, in a `<git-span-error>` block, for whoever
 * is debugging the hook itself.
 */
function renderIncompatibleCliReason(err: AdvisorIncompatibleCliError): string {
  const installed = err.installedVersion;
  const lagging =
    installed !== null && !isOlderThan(installed, REQUIRED_GIT_SPAN_VERSION)
      ? // Binary is at or past what this plugin was built against, yet it
        // rejected the command — the plugin is the stale artifact.
        'the git-span plugin is older than the binary and is still issuing a retired command'
      : 'the git-span binary is older than the plugin and does not know this command yet';
  return [
    'The implicit-dependency check could not run, so this change was NOT verified.',
    '',
    `The installed git-span binary reports ${installed ?? 'no readable version'}; this plugin`,
    `expects ${REQUIRED_GIT_SPAN_VERSION} or compatible. They install through separate channels, so`,
    `they can drift apart — here, ${lagging}.`,
    '',
    'Bring them back in line, then retry:',
    '',
    '    npm install -g git-span@latest    # upgrade the binary',
    '    # and update the git-span plugin from the marketplace',
    '',
    'The command proceeds anyway. Nothing is wrong with this repository — but until',
    'the two are aligned, span drift is not being checked and spans are not being',
    'auto-reanchored on edit.',
    '',
    '<git-span-error>',
    indentBlockBody(`git-span reported: ${err.detail}`),
    '</git-span-error>'
  ].join('\n');
}

/**
 * Most spans the related-spans section lists before it truncates. Chosen from
 * the tail of this repository's measured distribution (median 2 qualifying
 * spans, p90 7, p99 15, max 41) rather than to maximize a hit rate: it engages
 * on 5% of real rendering opportunities, where a tighter cap would drop the
 * span the reader actually wanted far too often (N=5 drops it in 25% of
 * non-bulk cases, N=3 in 40%).
 */
const RELATED_SPANS_CAP = 8;

/** Directory components of a repo-relative posix path (basename dropped). */
function dirParts(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/**
 * Normalized directory proximity of two repo-relative paths, in `[0,1]`:
 * shared leading directory components over the deeper path's directory depth.
 * `1` is the same directory; `0` is nothing in common below the root.
 *
 * Two repo-root files score `0`, not `1`: their shared "directory" is the
 * whole repository, which says nothing about co-location, and treating it as a
 * perfect match lets a lockfile or root config riding along in a changeset
 * outrank a span anchored in the uncovered file's own subtree. `0` also makes
 * the rule uniform — a root-level anchor carries no proximity signal against
 * anything, root-level or nested — rather than trading one special case for
 * another.
 *
 * The card's prototype ranker used the opposite convention, so the published
 * measurement could not speak to this case. Re-running that harness with `0`
 * is never worse across top-1/top-3/MRR, which rules out a regression; the
 * margin itself is well inside bootstrap noise and is deliberately not the
 * justification here. Do not "correct" this back to `1` on a future harness
 * run that lands a fraction the other way.
 */
function pathProximity(a: string, b: string): number {
  const x = dirParts(a);
  const y = dirParts(b);
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  const deepest = Math.max(x.length, y.length);
  if (deepest === 0) return 0;
  return shared / deepest;
}

/**
 * Group `covering` — the rows {@link computeUncoveredPaths} already resolved
 * for the rest of the changeset — by span name, returning the rows themselves
 * so the caller can hand `path`/range structure to the tree renderer rather
 * than a pre-formatted string. Only anchors whose `path` is one of the paths
 * `executors.list` was scoped to appear here; a span's *other* anchors (in
 * files outside this changeset) never do, because {@link
 * computeUncoveredPaths} filtered them out — the CLI returns matching spans
 * whole, so without that filter the co-occurrence key below would measure span
 * *size* instead of changeset overlap. Deduped: two covered files under the same name collapse
 * to one entry each, anchors within a name staying alphabetical.
 *
 * Groups are ordered by relevance to the *uncovered* paths, best first, on
 * three keys:
 *
 * 1. **Co-occurrence, descending** — distinct changeset paths the span
 *    covers. Measured against this repository's history it is the only signal
 *    that carried a real win (28.8% vs. alphabetical's 15.0% top-1 on a
 *    leave-one-out evaluation), so the span covering the most of what just
 *    changed leads.
 * 2. **Path proximity, descending** — the closest any of the span's
 *    in-changeset anchors gets to any uncovered path, per
 *    {@link pathProximity}. A small but real contribution, and free: no data
 *    beyond `covering` and `uncovered` is consulted.
 * 3. **Span name, ascending** — the former sole ordering, kept purely as the
 *    determinism tie-break, so identical state always renders identically and
 *    a retry never reshuffles the list under the reader.
 *
 * Anchor *counts outside the changeset* — span "focus" and "concentration" —
 * were prototyped and rejected: both measurably degraded ranking, which is
 * why this needs no parse of `coveringBlocksText` and no extra subprocess.
 */
function groupCoveringByName(
  covering: PorcelainRow[],
  uncovered: string[]
): { name: string; anchors: PorcelainRow[] }[] {
  const byName = new Map<string, { anchors: Map<string, PorcelainRow>; paths: Set<string> }>();
  for (const row of covering) {
    const group = byName.get(row.name) ?? { anchors: new Map<string, PorcelainRow>(), paths: new Set<string>() };
    const addr = anchorText(row);
    // Keyed by address rather than held as a Set of formatted strings: the
    // tree renderer needs `path`/range structure, so the row travels with its
    // address instead of being flattened here. Dedupe semantics are identical.
    if (!group.anchors.has(addr)) group.anchors.set(addr, row);
    group.paths.add(row.path);
    byName.set(row.name, group);
  }
  return [...byName.entries()]
    .map(([name, group]) => {
      let proximity = 0;
      for (const path of group.paths) {
        for (const target of uncovered) proximity = Math.max(proximity, pathProximity(path, target));
      }
      return {
        name,
        // The determinism tie-break this section has always had, preserved
        // exactly: codepoint order over the anchor's `path#Lstart-Lend`
        // address, matching the plain `[...set].sort()` this replaced. The
        // tree renderer never re-sorts sibling paths, so it lays out whatever
        // order arrives here — which is why this sort must stay.
        anchors: [...group.anchors.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row),
        coOccurrence: group.paths.size,
        proximity
      };
    })
    .sort(
      (a, b) =>
        b.coOccurrence - a.coOccurrence ||
        b.proximity - a.proximity ||
        // Codepoint order, matching the plain `.sort()` this key replaced —
        // `localeCompare` would make the tie-break locale-dependent, and the
        // whole point of this key is that it is not.
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    )
    .map(({ name, anchors }) => ({ name, anchors }));
}

/**
 * The "other files in this change already belong to spans" section appended
 * to {@link renderUncoveredReason}'s output — empty (renders nothing) when
 * `covering` is empty, i.e. no other file in the changeset has any span
 * coverage. Still tighter than the drift/environmental blocks elsewhere
 * in this file — no anchors outside this changeset — but each `## <name>`
 * group's `why` sentence (via {@link extractWhy} against `coveringBlocksText`)
 * follows its anchors, same as those blocks, since that's the sentence that
 * actually tells the agent whether an uncovered file belongs here. Omitted
 * for a span that has none recorded, or when `coveringBlocksText` couldn't be
 * fetched.
 *
 * Ordered by {@link groupCoveringByName} — most of the changeset covered
 * first, not alphabetically — and capped at {@link RELATED_SPANS_CAP} spans,
 * with the overflow disclosed by name-count and the command that shows the
 * rest. The cap is not there to shorten a typical two-entry list; it is there
 * to stop the tail (this repository's history reaches 41 qualifying spans in
 * one changeset), where the section stops being an answer and becomes a wall
 * of text. A truncated list must never read as complete, hence the closing
 * disclosure line rather than a silent slice.
 */
function renderRelatedSpansSection(
  covering: PorcelainRow[],
  uncovered: string[],
  coveringBlocksText: string
): string[] {
  if (covering.length === 0) return [];
  const lines = [
    '',
    '---',
    '',
    'Other files in this change already belong to spans — an uncovered file above might belong with one of these instead of a new one:'
  ];
  const groups = groupCoveringByName(covering, uncovered);
  for (const { name, anchors } of groups.slice(0, RELATED_SPANS_CAP)) {
    // Related-spans anchors never carry drift status — this section lists span
    // *coverage*, not debt — so every suffix here is `''`, and stays that way.
    const rows = anchors.map((anchor) => ({ path: anchor.path, range: rangeLabel(anchor), suffix: '' }));
    lines.push(
      '',
      `## ${name}`,
      ...renderAnchorRun(
        rows,
        anchors.map((anchor) => `- ${anchorText(anchor)}`)
      )
    );
    const why = extractWhy(coveringBlocksText, name);
    if (why.length > 0) lines.push('', why);
  }
  const hidden = groups.length - RELATED_SPANS_CAP;
  if (hidden > 0) {
    lines.push(
      '',
      hidden === 1
        ? // The hidden spans cover *covered* paths, which this message never
          // names — so a `<path>` placeholder would leave the reader with
          // nothing to substitute. Bare `git span list` needs no argument and
          // is guaranteed to include them.
          '1 more span covers files in this change and is not shown — `git span list` lists every span in the repository.'
        : `${hidden} more spans cover files in this change and are not shown — \`git span list\` lists every span in the repository.`
    );
  }
  return lines;
}

/**
 * The list an uncovered-writes `hold` (or, in `'report-only'` mode, a `status`
 * advisory) renders into `reason`, wrapped in a `<git-span>` block matching the
 * touch hook's block styling. The "retry the command to proceed (one-time
 * check)" sentence drops entirely in `'report-only'` mode: a `status` check never
 * held anything, so there is nothing to retry and no consider-once state to
 * clear. `covering` — the rest of the changeset's existing span coverage,
 * from the same {@link computeUncoveredPaths} call — renders as a related-
 * spans section (via {@link renderRelatedSpansSection}): it's supplementary
 * context about the changeset, not itself part of what's flagged or
 * consider-once'd. The `harness` selects who the action line directs to do the
 * work: inline (`'generic'`, unchanged), or a forked subagent
 * (`'claude'`/`'codex'`/`'opencode'`).
 */
function renderUncoveredReason(
  uncovered: string[],
  covering: PorcelainRow[],
  coveringBlocksText: string,
  mode: AdvisorMode = 'may-hold',
  harness: AdvisorHarness = 'generic'
): RenderedReason {
  const lines = uncovered.map((path) => `- ${path}`);
  const subject = uncovered.length === 1 ? 'this file carries' : 'these files carry';
  const inline = harness === 'generic';
  const actionLine = inline
    ? `Determine if ${subject} implicit dependencies, then use \`git span\` to document them:`
    : harness === 'claude'
      ? `Dispatch a forked subagent to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:`
      : harness === 'codex'
        ? `Spawn a forked subagent with \`spawn_agent\`, setting \`fork_turns: "all"\`, to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:`
        : `Dispatch a subagent with the \`task\` tool to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:`;
  const body = [
    '<git-span>',
    ...lines,
    '',
    actionLine,
    '',
    '`git span add <name> <anchor> [<anchor>] ...`  — an anchor is a path or a `path#Lstart-Lend` range',
    '`git span why <name> "<why>"`',
    '',
    'The "<why>" is one or two complete present-tense clauses stating the relationship and any decisive nonlocal authority, invariant, permitted difference, lifecycle state, evidence gate, or focused conditional verification. Labels are optional but must introduce complete clauses. Omit generic work orders and CLI procedure.'
  ];
  body.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
  if (mode === 'may-hold') {
    body.push('', 'If none exist, retry the command to proceed (one-time check).');
  }
  body.push(
    '',
    harness === 'generic'
      ? 'Load the `git-span:git-span` skill for guidance.'
      : harness === 'opencode'
        ? 'Load the `git-span` skill via the skill tool in the subagent.'
        : 'Load the `git-span:git-span` skill in the fork.',
    '</git-span>'
  );
  return { reason: body.join('\n') };
}

// ---------------------------------------------------------------------------
// Default subprocess/disk-backed dependencies
// ---------------------------------------------------------------------------
//
// The production surfaces both adapters inject by default, following
// touch-core.ts's `createDefaultTouchExecutors` style: each captures stdout even
// on a non-zero exit where the CLI still emits useful output, and every failure
// mode (absent binary, timeout, no repo) surfaces as an empty/clean result so
// the advisor's fail-open contract holds without the adapter adding its own.

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The overall wall-clock budget {@link evaluateAdvisor}'s evaluation races,
 * in ms.
 *
 * Per-spawn timeouts do not bound the pipeline they compose: evaluation is
 * strictly sequential (fix → drift → list → listBlocks → changedHunks plus the
 * per-file fallback), so N slow children cost N × {@link DEFAULT_TIMEOUT_MS}
 * against a parent hook window of 10s (the Claude/Codex adapters'
 * registered `timeout: 10_000`), after which the harness kills the hook —
 * commits stall the full window and even the scan-failed advisory is lost.
 * 8s keeps the answer inside that window with headroom for process boot,
 * changeset resolution, and output serialization; on expiry evaluation fails
 * OPEN with a `'deadline-exceeded'` warning (an advisory-or-warning is always
 * returned) after aborting its outstanding subprocesses. OpenCode registers no
 * hook timeout at all and already budgets its spawns tighter (5s); the race
 * only ever shortens what it would otherwise wait out.
 */
export const EVALUATION_DEADLINE_MS = 8_000;

/** Promisified {@link execFile}: the async spawn every default executor reads through. */
const execFileAsync = promisify(execFile);

/**
 * The stdout ceiling every `execFileSync` read below runs under, replacing
 * Node's 1 MiB default.
 *
 * 1 MiB is not a hypothetical limit for these reads: four of the last three
 * hundred commits in this repository produce a `git diff -U0` larger than that,
 * and this card's own `ded75b8d` is 1.16 MB. Past the ceiling `execFileSync`
 * throws `ENOBUFS`, {@link gitText} converts the throw to `''`, and the caller
 * reads an empty diff as "nothing to classify" — silently switching churn
 * suppression off for the entire changeset rather than for the one file that
 * overflowed. The same collapse applies to the coverage reads, where an empty
 * result reads as "nothing is covered" and yields a maximal, wrong hold.
 *
 * 64 MiB is deliberately far above any plausible real diff: the point is that a
 * read either succeeds or fails for a reason worth surfacing, never because of
 * an arbitrary buffer size. It is a ceiling, not an allocation — Node grows the
 * buffer as output arrives.
 */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/**
 * Git global options prefixed to every read: `core.quotepath=false` keeps
 * non-ASCII paths verbatim instead of C-quoted (`"pkg/caf\303\251.ts"`).
 * Quoted paths mis-parse against `parseUnifiedDiff`'s
 * `^diff --git a/(.+) b/(.+)$` and never match a path from the name-only reads,
 * so the whole pipeline has to speak one path vocabulary. Under the old
 * post-read category layer a mangled path was merely fail-safe — it missed the
 * lookup and stayed flagged — but the category layer now decides *before* the
 * read, from the name alone, so a mangled name is a name the classifier reads
 * wrongly rather than one it fails to find.
 */
const GIT_READ_OPTS = ['-c', 'core.quotepath=false'];

/**
 * Flags that pin the *content* read's output shape against the invoking user's
 * own diff configuration. `parseUnifiedDiff` anchors on
 * `^diff --git a/(.+) b/(.+)$`, and four ordinary personal settings rewrite that
 * line or the body wholesale:
 *
 * | setting | header becomes |
 * | --- | --- |
 * | `diff.noprefix=true` | `diff --git f.txt f.txt` |
 * | `diff.mnemonicPrefix=true` | `diff --git c/f.txt i/f.txt` |
 * | `color.ui=always` | the header wrapped in SGR escapes |
 * | `diff.external` | the entire body replaced by another tool's format |
 *
 * When the anchor misses, every hunk lands outside a recognized file and the
 * parse yields no `FileDiff` for any path — which is indistinguishable from "the
 * batch returned nothing", so it routes into the per-file fallback and each
 * retry parses to nothing too. The direction is fail-toward-reporting, so no
 * coupling is lost; the cost is that churn suppression silently does not exist
 * for that user, with the breadcrumb honestly recording `suppressedByContent: 0`.
 * Total feature loss with no symptom is worse than an outage that announces
 * itself.
 *
 * These are diff-only flags and belong on this invocation rather than in
 * {@link GIT_READ_OPTS}, which the `--name-only` reads also use. Those reads are
 * already safe: `color.ui` does not colorize `--name-only` output, and
 * `diff.relative` is neutral because every read passes `-C repoRoot`. Flags also
 * close `diff.external` and `diff.mnemonicPrefix`, which a `-c` override list
 * would have to enumerate one setting at a time.
 */
const GIT_DIFF_SHAPE_OPTS = ['--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/'];

/**
 * Build the argv for the content read that feeds {@link parseUnifiedDiff}.
 *
 * This exists as a separate exported function purely so a check can assert the
 * argv, because the failure it guards against has no symptom: drop the
 * {@link GIT_DIFF_SHAPE_OPTS} spread, or add a second diff-parsing read that
 * forgets it, and churn suppression stops existing for any user carrying one of
 * the settings tabulated above while every check still passes. The read itself
 * closes over `execFileSync`, so an argv assertion is not reachable through
 * {@link createGitExecutors} — hence the seam.
 *
 * That is not a hypothetical shape of bug for this module. Its history already
 * contains one instance of two fixes cancelling each other while a doc comment
 * and a green unit check both asserted the surviving behavior, so a claim about
 * this read that only a comment enforces is precisely the thing not to leave
 * standing again.
 */
export function buildHunkReadArgs(
  repoRoot: string,
  range: Exclude<DiffRange, { kind: 'unresolvable' }>,
  paths: string[]
): string[] {
  const rangeArgs =
    range.kind === 'staged' ? ['--cached'] : range.kind === 'worktree' ? ['HEAD'] : [`${range.base}..HEAD`];
  return ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '-U0', ...GIT_DIFF_SHAPE_OPTS, ...rangeArgs, '--', ...paths];
}

/** Run a git command at `cwd`, returning its raw stdout as-is (empty string on any failure). */
async function gitText(args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? outcome.stdout : '';
}

/** Run a git command at `cwd`, returning trimmed non-empty POSIX output lines (empty on any failure). */
async function gitLines(args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? splitPosixLines(outcome.stdout) : [];
}

/**
 * Like {@link gitLines} but distinguishes a *failed* invocation (`null` — e.g.
 * `@{u}` with no upstream configured) from a *successful but empty* result
 * (`[]`), so the outgoing-range resolution knows when to try the merge-base
 * fallback rather than mistaking "no upstream" for "nothing to push".
 */
async function gitLinesOrNull(
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string[] | null> {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? splitPosixLines(outcome.stdout) : null;
}

/** Trimmed non-empty POSIX lines of a read's stdout — the shape every name-only consumer wants. */
function splitPosixLines(out: string): string[] {
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(toPosix);
}

/**
 * One spawn attempt's collapsed result. `ok: false` carries whatever stdout/
 * stderr the child managed to emit — the exact shape `execFileSync`'s throw
 * used to expose via `err.stdout`/`err.stderr`, which the drift/list/fix
 * failure classifiers read to tell a legitimate drift exit from an aborted
 * scan from version skew. An abort (deadline expiry or the final cleanup)
 * lands here like any other failure with empty pipes; reporting expiry is the
 * deadline race's job, never the executor's.
 */
type SpawnOutcome = { ok: true; stdout: string } | { ok: false; stdout: string; stderr: string };

/**
 * Spawn one `git` child asynchronously and capture its output.
 *
 * Async is load-bearing, not stylistic: the sync spawns this replaced blocked
 * the event loop for their entire duration, which made an overall evaluation
 * deadline unenforceable (a timer cannot fire while the loop is blocked) and
 * left no cancellation path once a child hung. The async child is killed via
 * `signal` when {@link evaluateAdvisor}'s budget expires, its per-invocation
 * `timeout` still bounds each individual read exactly as before.
 */
async function trySpawnGit(
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<SpawnOutcome> {
  if (signal?.aborted) return { ok: false, stdout: '', stderr: '' };
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_STDOUT_BYTES,
      timeout: timeoutMs,
      signal
    });
    return { ok: true, stdout };
  } catch (err) {
    // promisified execFile rejects with the buffered streams attached (as
    // strings under `encoding: 'utf8'`), matching execFileSync's exception
    // shape; anything else collapses to empty pipes.
    const streams = err as { stdout?: unknown; stderr?: unknown };
    return {
      ok: false,
      stdout: typeof streams.stdout === 'string' ? streams.stdout : '',
      stderr: typeof streams.stderr === 'string' ? streams.stderr : ''
    };
  }
}

/** The production {@link GitExecutor}: `git diff` reads scoped to the CWD repo. */
export function createDefaultGitExecutor(timeoutMs: number = DEFAULT_TIMEOUT_MS): GitExecutor {
  return {
    stagedPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(
        ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--cached', '--name-only'],
        repoRoot,
        timeoutMs,
        signal
      );
    },
    trackedModifiedPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--name-only'], repoRoot, timeoutMs, signal);
    },
    outgoingPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return { paths: [], base: null };
      const upstream = await gitLinesOrNull(
        ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--name-only', '@{u}..HEAD'],
        repoRoot,
        timeoutMs,
        signal
      );
      if (upstream !== null) return { paths: upstream, base: '@{u}' };
      // No upstream configured: fall back to the merge-base with the default
      // remote branch (`origin/HEAD`). If that too is unresolvable, fail open.
      const base = (
        await gitLines(['-C', repoRoot, 'merge-base', 'HEAD', 'origin/HEAD'], repoRoot, timeoutMs, signal)
      )[0];
      if (!base) return { paths: [], base: null };
      return {
        paths: await gitLines(
          ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--name-only', `${base}..HEAD`],
          repoRoot,
          timeoutMs,
          signal
        ),
        base
      };
    },
    pathspecPaths: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      // Working-tree content vs HEAD, scoped to the pathspecs — the files a
      // `git commit -- <pathspec>` would actually change (staged or not).
      return gitLines(
        ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', 'HEAD', '--name-only', '--', ...paths],
        repoRoot,
        timeoutMs,
        signal
      );
    },
    changedHunks: async (paths, range, cwd, signal) => {
      if (range.kind === 'unresolvable' || paths.length === 0) return [];
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const text = await gitText(buildHunkReadArgs(repoRoot, range, paths), repoRoot, timeoutMs, signal);
      if (text.trim().length === 0) return [];
      try {
        return parseUnifiedDiff(text);
      } catch {
        return [];
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Binary/plugin version skew
// ---------------------------------------------------------------------------

/**
 * The oldest `git-span` binary that understands every command the executors
 * below issue — currently the release that renamed the `stale` subcommand to
 * `drift`. The hook bundle and the binary install through independent channels
 * (the plugin marketplace and npm respectively), so "plugin newer than binary"
 * is an ordinary state for however long a user waits between the two upgrades,
 * not an exotic misconfiguration.
 *
 * Keep this at the version that introduced the newest command or flag the
 * executors depend on, not at the current release: raising it past what the
 * executors actually need turns a working binary into a reported failure.
 */
export const REQUIRED_GIT_SPAN_VERSION = '1.0.142';

/**
 * Whether a CLI failure is the argument parser rejecting the command outright
 * rather than the command running and failing.
 *
 * clap writes these on stderr and exits 2; the exact wording differs across
 * clap versions and across which token it choked on, so this matches the stable
 * `error: <shape>` prefixes rather than whole sentences. Requiring a `Usage:`
 * line as well keeps a repository-level error that happens to contain one of
 * these words from being read as skew — a usage block is only ever printed by
 * the parser.
 */
function isArgumentParseFailure(stderr: string): boolean {
  if (!/^\s*(usage|Usage):/m.test(stderr)) return false;
  return /error:\s+(unexpected argument|unrecognized subcommand|invalid subcommand|unknown (?:argument|subcommand)|the subcommand .* wasn't recognized|unexpected value)/i.test(
    stderr
  );
}

/** Parsed `x.y.z` triple, or `null` for anything that is not one. */
function parseSemverTriple(text: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `true` when `version` is strictly older than `floor`; `false` if either is unparseable. */
function isOlderThan(version: string, floor: string): boolean {
  const a = parseSemverTriple(version);
  const b = parseSemverTriple(floor);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * The installed binary's version, or `null` if it could not be read.
 *
 * Probed lazily — only once a command has already failed — rather than checked
 * up front on every hook invocation. A hook process is short-lived and runs on
 * every tool use, so an unconditional `git span --version` would spend a
 * subprocess on every edit to answer a question that matters only on the
 * failure path.
 */
async function probeGitSpanVersion(repoRoot: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  const outcome = await trySpawnGit(['span', '--version'], repoRoot, timeoutMs, signal);
  if (!outcome.ok) return null;
  const triple = parseSemverTriple(outcome.stdout);
  return triple ? triple.join('.') : null;
}

/**
 * Classify a non-zero `git span` exit into the error the advisor should raise.
 *
 * The signal is the shape of the failure, not the direction of the version
 * gap. Skew fires both ways and the *lagging plugin* direction is the more
 * common one in the field: the binary updates through npm's postinstall, which
 * runs whenever a project's dependencies are installed, while the plugin waits
 * on a marketplace sync. An older binary rejects a new flag with exit 2 and a
 * usage block, which the shape gate below recognizes as skew. The retirement
 * machinery this card adds emits exit 1 with prose naming the replacement
 * (`git span drift`) and no usage block, so a lagging-plugin future would
 * surface as a scan failure rather than skew — the shape gate alone does not
 * cover that case, and the version probe is the signal available there.
 * Gating on "installed is older than the floor" would classify only half of it
 * and hand the other half back to the scan-failure message that says nothing
 * useful.
 *
 * The version is probed for the message rather than for the verdict, so the
 * reader can see the gap and which side of it they are on. `null` (no binary on
 * PATH, unparseable output) still classifies as skew — the parse failure is the
 * evidence; the version is the detail.
 */
async function classifyCliFailure(
  detail: string,
  repoRoot: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Error> {
  if (!isArgumentParseFailure(detail)) return new AdvisorScanError(detail);
  return new AdvisorIncompatibleCliError(detail, await probeGitSpanVersion(repoRoot, timeoutMs, signal));
}

/** The production {@link AdvisorExecutors}: scoped `git span` fix/drift/list at the repo root. */
export function createDefaultAdvisorExecutors(timeoutMs: number = DEFAULT_TIMEOUT_MS): AdvisorExecutors {
  return {
    fix: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      const outcome = await trySpawnGit(['span', 'drift', ...paths, '--fix'], repoRoot, timeoutMs, signal);
      if (outcome.ok) return;
      // `git span drift` exits 1 on drift even after healing, and non-zero on
      // genuine failure; either way the subsequent `drift` read is the source
      // of truth, so the exit code is ignored here — with one exception.
      //
      // A binary that cannot parse the command never healed anything, and the
      // `drift` read that follows is about to fail the same way. Swallowing it
      // here means auto-reanchoring stops dead with no signal whatsoever, which
      // is precisely the state a user upgrading their plugin ahead of their
      // binary lands in. Raise it so the reason reaches them.
      const stderrText = outcome.stderr.trim();
      if (stderrText.length > 0) {
        const classified = await classifyCliFailure(stderrText, repoRoot, timeoutMs, signal);
        if (classified instanceof AdvisorIncompatibleCliError) throw classified;
      }
    },
    drift: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      const outcome = await trySpawnGit(
        ['span', 'drift', '--format', 'porcelain', ...paths],
        repoRoot,
        timeoutMs,
        signal
      );
      // `git span drift` exits non-zero in two very different ways, and they
      // must not be conflated:
      //  - Legitimate drift: real porcelain rows on stdout describing the
      //    drift. Parse them (this is the whole point of the read).
      //  - Hard scan failure: the scoped query aborted before completing (e.g.
      //    an unreadable anchor file), writing an error to stderr and emitting
      //    empty stdout. An empty result here is NOT "clean" — the scan never
      //    ran to completion — so signal it distinctly rather than parsing to
      //    `[]`, which would read as a clean pass and silently allow the commit.
      //  - Version skew: the binary's argument parser rejected the command
      //    before any scan ran. Shaped exactly like a hard scan failure on the
      //    wire, but the cause is the install, not the repository —
      //    `classifyCliFailure` separates the two.
      if (!outcome.ok && outcome.stdout.trim().length === 0 && outcome.stderr.trim().length > 0) {
        throw await classifyCliFailure(outcome.stderr.trim(), repoRoot, timeoutMs, signal);
      }
      return parseDriftPorcelain(outcome.stdout);
    },
    list: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      const outcome = await trySpawnGit(['span', 'list', '--porcelain', ...paths], repoRoot, timeoutMs, signal);
      // The coverage read is the source of the *covered* set, so an empty
      // result reads as "nothing is covered" — the most punitive answer the
      // advisor can give. A hard query failure (an unresolvable argument, say)
      // writes an error to stderr and emits empty stdout; parsing that to
      // `[]` would turn a failed scan into a confident, maximal hold with no
      // related-spans section. Signal it distinctly instead, exactly as the
      // `drift` executor above does, and let `evaluateAdvisor` fail open with
      // the `scan-failed` warning. Any partial stdout is still parsed.
      if (!outcome.ok && outcome.stdout.trim().length === 0 && outcome.stderr.trim().length > 0) {
        throw new AdvisorScanError(outcome.stderr.trim());
      }
      return parsePorcelain(outcome.stdout);
    },
    listBlocks: async (names, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || names.length === 0) return '';
      const outcome = await trySpawnGit(['span', 'list', ...names], repoRoot, timeoutMs, signal);
      // A failed human-format read only degrades the rendered message
      // (annotateBlocks synthesizes minimal blocks); never an advisor error.
      return outcome.ok ? outcome.stdout : '';
    }
  };
}

/**
 * The production disk-backed {@link AdvisorMemoState}: one marker file per
 * hashed state/item key under {@link advisorMemoDir}
 * (`<git-common-dir>/git-span/advisor/`), following span-surface.ts's
 * file-backed `MemoStore` pattern. Keys are prefixed hex sha256 values and are
 * safe filenames. Best-effort and non-throwing: a memo whose repo cannot be
 * resolved degrades to a no-op store (never persists → uncovered would re-hold,
 * but an unresolvable repo yields an empty changeset upstream anyway).
 */
export function createDiskAdvisorMemoState(cwd: string): AdvisorMemoState {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    // No resolvable repo → the memo cannot persist. Report `false` from
    // `record` so the advisor fails open rather than holding with no escape.
    return { has: () => false, record: () => false };
  }
  const dir = advisorMemoDir(repoRoot);
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
        return true;
      } catch {
        // A failed memo write must never brick the commit and must never
        // silently re-hold forever: report the failure so the advisor fails open.
        return false;
      }
    }
  };
}
