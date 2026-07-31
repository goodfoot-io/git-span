/**
 * Harness-agnostic advisor core (Phase 3.1 — contract and stubs).
 *
 * This module declares the PreToolUse advisor that both the Claude (`Bash`) and
 * Codex (shell/exec) adapters will drive: when the agent runs `git commit` or
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
 * (`PorcelainStatus`/`PorcelainRow`/`StalePorcelainRow`), and `advisorMemoDir()`
 * (the `<git-common-dir>/git-span/advisor/` path the disk-backed
 * {@link AdvisorMemoState} will persist under) — all from agent-hooks-common.ts.
 *
 * Every function whose result depends on real logic is a `Not Implemented` stub
 * in this phase; Phase 3.2 writes skipped checks against these signatures and
 * Phase 3.3 implements them.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { isAdvisorIgnored, loadAdvisorIgnore } from './advisor-ignore.js';
import {
  advisorMemoDir,
  humanStatusLabel,
  isDebt,
  isEnvironmentalStatus,
  isInsideSpanRoot,
  type PorcelainRow,
  type PorcelainStatus,
  parsePorcelain,
  parseStalePorcelain,
  resolveRepoRoot,
  type StalePorcelainRow,
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
 * Raised by the `stale` executor when `git span stale` could not *complete* its
 * scoped scan — as opposed to completing and reporting drift. `git span stale`
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
    super(`git span stale could not complete its scan: ${detail}`);
    this.name = 'AdvisorScanError';
    this.detail = detail;
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
    if (!inv || inv.subcommand !== 'commit') continue;
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
   * configured. These are what a `git push` would publish. Also returns the
   * `base` it resolved the range against — `'@{u}'` when the upstream diff
   * succeeded, the merge-base SHA when it fell back, or `null` when neither
   * resolved (fail-open: `paths` is `[]` in that case too) — so
   * {@link resolveChangeset} can carry the exact same range into its returned
   * {@link Changeset} rather than re-deriving it and risking a different answer.
   */
  outgoingPaths(cwd: string): Promise<{ paths: string[]; base: string | null }>;
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
  pathspecPaths(paths: string[], cwd: string): Promise<string[]>;
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
  changedHunks(paths: string[], range: DiffRange, cwd: string): Promise<FileDiff[]>;
}

/**
 * Resolve the concrete list of repo-relative paths an inspected command would land,
 * so the advisor can scope its staleness/coverage check to exactly that changeset.
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
export async function resolveChangeset(
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
 * The injected execution surface advisor evaluation needs — the `fix`/`stale`/
 * `list` async functions, mirroring `touch-core.ts`'s `TouchExecutors`. Tests
 * inject fakes returning structured data; the core never spawns a subprocess
 * itself. All paths are repo-relative POSIX paths.
 */
export interface AdvisorExecutors {
  /**
   * Run a scoped `git span stale <paths> --fix` — the belt-and-braces heal that
   * runs before classification (per CARD.md), re-anchoring any positional drift
   * in the changeset that the touch hook has not already healed. Reports nothing;
   * its effect is on the working tree, and the subsequent {@link AdvisorExecutors.stale}
   * read observes the healed state.
   */
  fix(paths: string[], cwd: string): Promise<void>;
  /**
   * Run a scoped `git span stale --format porcelain <paths>` and return its
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
  stale(paths: string[], cwd: string): Promise<StalePorcelainRow[]>;
  /**
   * Run a scoped `git span list --porcelain <paths>` and return the covering
   * anchors. Used to compute *uncovered writes*: a changed path with zero
   * covering rows here (minus `.span/**`, gitignored paths, and
   * `.span/.advisorignore`-excluded paths — see {@link file://./advisor-ignore.ts})
   * is an uncovered write.
   *
   * As with {@link AdvisorExecutors.stale}, an empty result must mean the query
   * *ran and found no covering anchors*, never that it *could not run* — here
   * the stakes are inverted, since an empty covered set makes every changed
   * path look uncovered. When the query aborts before completing, the
   * implementation throws {@link AdvisorScanError} rather than returning `[]`,
   * so {@link evaluateAdvisor} warns instead of issuing a maximal, wrong hold.
   */
  list(paths: string[], cwd: string): Promise<PorcelainRow[]>;
  /**
   * Run `git span list <names...>` (human format) and return its raw stdout —
   * one `## <name>` block per span (anchor bullets + description), blocks
   * separated by `---`. The hold/advisory renderers annotate these blocks with
   * per-anchor drift labels so the surfaced message carries the full span
   * (all locations + description), not just the drifted rows. Returns `''` on
   * any failure; {@link annotateBlocks} then synthesizes minimal blocks from
   * the findings themselves so no finding is dropped.
   */
  listBlocks(names: string[], cwd: string): Promise<string>;
}

/**
 * The advisor's per-changeset memo — "have I already presented this exact debt
 * state once?" The persisted unit is a digest of the sorted staleness findings
 * plus the sorted uncovered paths (design-decisions.md #9's "hold once per
 * distinct debt-state"); the disk-backed implementation stores one marker per
 * digest under {@link advisorMemoDir} (`<git-common-dir>/git-span/advisor/`), where
 * presence means "already presented once." Injected as a store abstraction
 * (like span-surface.ts's `MemoStore`) so Phase 3.2 fakes it in memory.
 */
export interface AdvisorMemoState {
  /** Whether this exact debt-state digest has already been presented once. */
  has(digest: string): boolean;
  /**
   * Record that this debt-state digest has now been presented, returning
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
 *   was already presented once (semantic-staleness or uncovered-writes
 *   consider-once, an unchanged retry, or a state already shown in full by a
 *   prior `'report-only'` preview). The command passes.
 * - `allow` / `environmental` — the changeset's only staleness rows are
 *   terminal/environmental conditions (`CONFLICT`, `SUBMODULE`, `LFS_*`,
 *   `PROMISOR_MISSING`, `SPARSE_EXCLUDED`, `FILTER_FAILED`, `IO_ERROR`) the CLI
 *   could not resolve at all — not span drift a user can fix by editing a span.
 *   The advisor fails OPEN (allow) but carries `conditions`/`reason` so the adapter
 *   surfaces the condition instead of swallowing it. Holding here would re-hold
 *   forever on an infra failure the user cannot clear from the advisor.
 * - `allow` / `scan-failed` — `git span stale` could not *complete* its scoped
 *   scan (a {@link AdvisorScanError}, e.g. an unreadable anchor file aborting the
 *   whole query). This is distinct from both `environmental` (the scan completed
 *   and carried terminal rows) and a clean pass (the scan completed with zero
 *   rows): the scan never ran to completion, so its empty result is not evidence
 *   of "no debt." The advisor fails OPEN here too — matching `environmental` —
 *   but keeps its own `kind` and a `reason` naming the failure, so the adapter
 *   surfaces a warning that span debt was NOT verified for this changeset
 *   instead of staying silent. There is no debt-state to memoize: every
 *   evaluation of a still-failing scan warns again.
 * - `hold` / `semantic-staleness` — the changeset carries semantic staleness,
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
 * - `allow` / `semantic-staleness-report`, `allow` / `uncovered-writes-report`
 *   — the same two reports, delivered without the one-time hold. These are
 *   what `'report-only'` mode returns: identical `findings`/`uncovered`/
 *   `reason` payload, no `decision: 'hold'`, and no read or write of
 *   `memoState`. A `git status` preview is a live picture, not a debt state to
 *   hold on: it re-reports whatever debt exists on every call, exactly like
 *   `git status` itself does for the working tree.
 */
export type AdvisorResult =
  | { decision: 'allow'; kind: 'silent' }
  | { decision: 'allow'; kind: 'already-presented' }
  | { decision: 'allow'; kind: 'environmental'; conditions: StalePorcelainRow[]; reason: string }
  | { decision: 'allow'; kind: 'scan-failed'; reason: string }
  | { decision: 'allow'; kind: 'semantic-staleness-report'; findings: StalePorcelainRow[]; reason: string }
  | { decision: 'allow'; kind: 'uncovered-writes-report'; uncovered: string[]; reason: string }
  | { decision: 'hold'; kind: 'semantic-staleness'; findings: StalePorcelainRow[]; reason: string }
  | { decision: 'hold'; kind: 'uncovered-writes'; uncovered: string[]; reason: string };

/**
 * Whether {@link evaluateAdvisor} may hold the command once so its report is
 * read (`'may-hold'`, the default — used for `commit`/`push`), or must deliver
 * the report without holding at all (`'report-only'` — used for `status`).
 *
 * Neither mode enforces: `'may-hold'` is the stronger of the two only in that
 * it can interrupt once per distinct debt state, and even that interruption
 * clears on a bare retry. In `'report-only'` every branch that would otherwise
 * return `decision: 'hold'` returns its `-report` `allow` counterpart carrying
 * the identical payload, and `memoState` is never read or written — a `status`
 * preview must not spend the one-time hold that a subsequent `commit`/`push`
 * would otherwise use to get the same report read.
 */
export type AdvisorMode = 'may-hold' | 'report-only';

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
 * Runs `executors.fix` (scoped belt-and-braces `stale --fix`), then reads
 * `executors.stale` and classifies each debt row (`isDebt()`) into *semantic*
 * drift and *environmental* conditions (`isEnvironmentalStatus()`).
 *
 * Semantic drift (`CHANGED`/`DELETED`) is checked against `memoState` via its
 * own digest (`advisorStateDigest(semantic, [])`), the same distinct-debt-state
 * memo the uncovered-writes check already uses: not yet presented → record it
 * and `hold`/`semantic-staleness` (a `memoState.record` failure fails open to
 * `allow`/`silent`, since a non-persisting memo would re-hold the identical
 * retry forever); already presented → **fall through** rather than returning,
 * so a retry still surfaces environmental advisories and still runs the
 * uncovered check. Whether the semantic state was already presented is
 * tracked so that, if the evaluation then ends clean, it resolves to
 * `allow`/`already-presented` rather than a bare `allow`/`silent` — mirroring
 * the uncovered branch's own memo-hit result. A changeset carrying both
 * unpresented semantic staleness and unpresented uncovered writes therefore
 * holds twice (staleness first, uncovered on the retry) before a third
 * attempt passes — two reports, two attention-grabs, no enforcement; editing
 * one stale span while another remains stale produces a new findings set,
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
 * A {@link AdvisorScanError} from `executors.stale` or `executors.list` is the
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
 * `hold` branch fires and `memoState` is never read or written: semantic
 * staleness resolves to `allow`/`semantic-staleness-report` and uncovered
 * writes to `allow`/`uncovered-writes-report` — the same reports, the same
 * `findings`/`uncovered`/`reason` payload, simply without the one-time hold.
 * The environmental/scan-failed/silent branches are unaffected by mode — they
 * already always allow.
 *
 * @param paths The resolved changeset from {@link resolveChangeset}. Empty →
 *   `allow`/`silent`.
 * @param cwd The working directory the git command ran in.
 * @param executors The injected `fix`/`stale`/`list` surface.
 * @param memoState The per-changeset debt-state memo. Unused in `'report-only'` mode.
 * @param mode `'may-hold'` (default) may hold the command once; `'report-only'`
 *   delivers the same report and never holds. Neither enforces.
 * @param churn The optional mechanical-churn suppression surface (see
 *   {@link ChurnSuppression}), consumed by the uncovered-writes check via
 *   {@link computeUncoveredPaths}. Omitting it disables suppression
 *   entirely — the pre-change behavior, and the safe direction: "forgot to
 *   wire it" degrades to today's behavior rather than to silence.
 */
export async function evaluateAdvisor(
  paths: string[],
  cwd: string,
  executors: AdvisorExecutors,
  memoState: AdvisorMemoState,
  mode: AdvisorMode = 'may-hold',
  churn?: ChurnSuppression
): Promise<AdvisorResult> {
  if (paths.length === 0) return { decision: 'allow', kind: 'silent' };
  try {
    // Belt-and-braces heal, then classify against the healed state.
    await executors.fix(paths, cwd);
    const staleRows = await executors.stale(paths, cwd);

    // Split debt rows into semantic drift (a user can fix by editing a span)
    // and terminal/environmental conditions (the CLI could not resolve the
    // anchor at all — sparse checkout, unfetched LFS, partial-clone miss, I/O
    // error). `isDebt()` is the single source of truth for what is debt at all;
    // `isEnvironmentalStatus()` splits the fixable from the unresolvable.
    // `MOVED`/`RESOLVED_PENDING_COMMIT` are never debt and never contribute.
    const debtRows = staleRows.filter((row) => isDebt(row.status));
    const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
    const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));

    if (mode === 'report-only') {
      // A status preview never holds and never spends the `'may-hold'`
      // one-time hold credit — it reports whatever debt is live right
      // now, every time it's asked. It does, however, mark the debt state as
      // "seen" (a separate axis from the hold credit) so a `'may-hold'`
      // evaluation of the same unchanged state moments later — e.g. a `git
      // commit` right after the `git status` that just showed this — renders
      // a condensed reminder instead of repeating the identical checklist.
      if (semantic.length > 0) {
        const seen = wasAlreadySeen(memoState, advisorStateDigest(semantic, []));
        return {
          decision: 'allow',
          kind: 'semantic-staleness-report',
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), 'report-only', seen)
        };
      }
      if (environmental.length > 0) {
        return {
          decision: 'allow',
          kind: 'environmental',
          conditions: environmental,
          reason: renderEnvironmentalReason(environmental, await fetchSpanBlocks(executors, environmental, cwd))
        };
      }
      const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors, churn);
      if (uncovered.length === 0) return { decision: 'allow', kind: 'silent' };
      const seen = wasAlreadySeen(memoState, advisorStateDigest([], uncovered));
      return {
        decision: 'allow',
        kind: 'uncovered-writes-report',
        uncovered,
        reason: renderUncoveredReason(
          uncovered,
          covering,
          await fetchSpanBlocks(executors, covering, cwd),
          'report-only',
          seen
        )
      };
    }

    // Semantic staleness joins the same distinct-debt-state memo the uncovered
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
          kind: 'semantic-staleness',
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), 'may-hold')
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
        reason: renderEnvironmentalReason(environmental, await fetchSpanBlocks(executors, environmental, cwd))
      };
    }

    // Uncovered writes: changed paths with zero covering span, minus `.span/**`
    // (span repairs ride the same commit and must never self-trigger the advisor)
    // and paths the repo's user-owned `.span/.advisorignore` excludes. Gitignored
    // paths never reach here — git does not stage/publish them.
    const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors, churn);
    if (uncovered.length === 0) {
      // A retry that fell through past an already-presented semantic-staleness
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
      reason: renderUncoveredReason(uncovered, covering, await fetchSpanBlocks(executors, covering, cwd), 'may-hold')
    };
  } catch (err) {
    // A scan that could not COMPLETE is not a clean result, but it is not
    // debt either — there is nothing here for a user to resolve by editing a
    // span. Fail OPEN with a distinguishable `scan-failed` warning instead of
    // silently reading the aborted scan's empty result as clean.
    if (err instanceof AdvisorScanError) {
      return { decision: 'allow', kind: 'scan-failed', reason: renderScanFailedReason(err.detail) };
    }
    // Fail open: any other internal/CLI error resolves to allow. The advisor must
    // never brick a commit on its own failure.
    return { decision: 'allow', kind: 'silent' };
  }
}

/**
 * {@link computeUncoveredPaths}'s result: the uncovered complement the advisor
 * holds/advises on, plus the `covering` rows the same `executors.list` call
 * already resolved for the rest of the changeset, filtered down to every
 * anchor, in any span, whose path is one of the paths passed in — the CLI
 * itself returns matching spans whole, so that narrowing happens in
 * {@link computeUncoveredPaths} rather than being free. `covering` is never empty only
 * when `uncovered` is; the two partition the changeset (minus `.span/**`/
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
 * The changed paths with zero covering span — minus `.span/**` (span repairs
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
  churn?: ChurnSuppression
): Promise<ChangesetCoverage> {
  if (paths.length < 2) return { uncovered: [], covering: [] };
  // `git span list --porcelain <paths...>` matches spans by path but returns
  // each matching span *whole* — every anchor it has, including anchors in
  // files nowhere near this changeset. Narrow to the intersection here, once,
  // at the single place that has the changeset in hand: everything downstream
  // (the related-spans ranking's co-occurrence key, its proximity tie-break,
  // and the per-span bullets rendered under a header that promises "other
  // files in this change") is only meaningful over in-changeset anchors.
  const changeset = new Set(paths);
  const covering = (await executors.list(paths, cwd)).filter((row) => changeset.has(row.path));
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
  let uncovered = paths.filter(
    (path) => !covered.has(path) && !isInsideSpanRoot(path) && !isAdvisorIgnored(advisorIgnoreRules, path)
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
        for (const file of await churn.git.changedHunks(needsContent, churn.range, cwd)) byPath.set(file.path, file);
      } catch {
        readOutcome = 'failed';
      }
      const missing = needsContent.filter((path) => !byPath.has(path));
      if (missing.length > 0) {
        if (readOutcome === 'clean') readOutcome = 'per-file-fallback';
        for (const path of missing) {
          try {
            for (const file of await churn.git.changedHunks([path], churn.range, cwd)) byPath.set(file.path, file);
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
 * the fields shared by {@link StalePorcelainRow} and {@link PorcelainRow}
 * (rather than either specifically) so both the staleness/environmental
 * renderers and the uncovered-writes related-spans section ({@link
 * groupCoveringByName}) can format an anchor the same way.
 */
function anchorText(row: { path: string; start: number; end: number }): string {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}

/**
 * The distinct-debt-state digest (design-decisions.md #9): a stable hash of the
 * sorted staleness findings plus the sorted uncovered paths. Presence in the
 * memo means "this exact state was already presented once."
 */
function advisorStateDigest(findings: StalePorcelainRow[], uncovered: string[]): string {
  const findingKeys = findings.map((row) => `${row.status}\t${row.name}\t${row.path}\t${row.start}\t${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Whether this debt-state digest has already been explained to the agent in
 * full — orthogonal to (and independent of) the `'may-hold'`-only one-time
 * hold credit `evaluateAdvisor` reads/writes on the same `digest` value under its
 * own `seen-`-prefixed key. A single `git status`/`git add` preview and the
 * `git commit`/`push` that follows it moments later resolve to the same
 * digest but reach `evaluateAdvisor` through different modes (`'report-only'` never
 * touches the hold credit). A hold only ever buys one reading of the report —
 * it cannot compel a fix, and a bare retry proceeds regardless — so
 * `evaluateAdvisor` consults this "seen" axis directly
 * (via `memoState.has`/`record` on the `seen-` key, inline, not through this
 * helper) before a `'may-hold'` hold: already seen → resolve straight to
 * `allow`/`already-presented` instead of holding on a state the agent has
 * already been shown. `wasAlreadySeen` itself remains for `'report-only'` mode,
 * where a repeated preview of the same state still renders a condensed
 * reminder rather than the full checklist twice.
 */
function wasAlreadySeen(memoState: AdvisorMemoState, digest: string): boolean {
  const seenKey = `seen-${digest}`;
  const already = memoState.has(seenKey);
  memoState.record(seenKey);
  return already;
}

/**
 * Fetch the human-format `## <name>` blocks for the spans named in `rows`,
 * failing to `''` (never throwing) so a list failure can never turn a hold
 * into a silent allow via {@link evaluateAdvisor}'s outer catch —
 * {@link annotateBlocks} synthesizes minimal blocks from the rows instead, and
 * {@link renderRelatedSpansSection} simply omits a `why` sentence it can't
 * find. Typed against `{ name: string }` (rather than {@link StalePorcelainRow}
 * specifically) so both the staleness/environmental renderers and the
 * uncovered-writes related-spans section can share this one fetch.
 */
async function fetchSpanBlocks(executors: AdvisorExecutors, rows: { name: string }[], cwd: string): Promise<string> {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  if (names.length === 0) return '';
  try {
    return await executors.listBlocks(names, cwd);
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
 * `stale --format porcelain` emits one row per *drifting layer* for a single
 * anchor (e.g. both worktree and index changed) — a distinction the `src`
 * column carries but {@link parseStalePorcelain} deliberately drops — so
 * without this collapse the same anchor would otherwise render as two (or
 * more) identical bullets instead of one bullet with every status it earned.
 */
function dedupeByAnchor(rows: StalePorcelainRow[]): { addr: string; statuses: PorcelainStatus[] }[] {
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
 * `reason: renderStalenessReason(...)` *inline* inside its own `try`, and its
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
 * Lay a bare path list (no ranges at all) out as a tree — the `alreadySeen`
 * condensed retry's shape. Each path becomes a `TreeAnchor` with an **empty**
 * `ranges` array: a bare-path leaf, deliberately distinct from a `whole-file`
 * range, which would assert an anchor semantic this deduped retry list never
 * claimed.
 *
 * The catch is fail-closed for the same reason as {@link renderAnchorRun}'s —
 * see that comment; this list is rendered from inside the same `evaluateAdvisor`
 * `try` whose outer catch would otherwise turn a hold into an allow.
 */
function renderPathRun(paths: string[]): string[] {
  try {
    return renderAnchorTree(paths.map((path) => ({ path, ranges: [] })));
  } catch {
    return paths.map((path) => `- ${path}`);
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
function annotateBulletRun(bulletLines: string[], pending: StalePorcelainRow[]): { addr: string; suffix: string }[] {
  const addrs = bulletLines.map((line) => line.slice(2));
  const paths = addrs.map((addr) => addr.split('#')[0]);
  const claimed: StalePorcelainRow[][] = addrs.map(() => []);
  const used = new Set<StalePorcelainRow>();

  const claim = (index: number, matches: (row: StalePorcelainRow) => boolean): void => {
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
function annotateBlocks(blocksText: string, rows: StalePorcelainRow[]): string {
  const remaining = new Map<string, StalePorcelainRow[]>();
  for (const row of rows) {
    const group = remaining.get(row.name);
    if (group) group.push(row);
    else remaining.set(row.name, [row]);
  }

  const out: string[] = [];
  let pending: StalePorcelainRow[] = [];
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
 * The full-span checklist a semantic-staleness `hold` (or, in `'report-only'` mode,
 * a `status` advisory) renders into `reason`. The closing sentence drops "—
 * then retry" in `'report-only'` mode: a `status` check never held anything, so
 * there is nothing to retry.
 */
function renderStalenessReason(
  findings: StalePorcelainRow[],
  blocksText: string,
  mode: AdvisorMode = 'may-hold',
  alreadySeen = false
): string {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? 'an implicit dependency' : 'implicit dependencies';
  const name = names.length === 1 ? names[0] : '<name>';
  const action = `\`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} "..."\``;
  if (alreadySeen) {
    const paths = [...new Set(findings.map((row) => row.path))];
    const closing = `Already flagged above — restore agreement at the drifted locations or update the description.`;
    return [`This change still leaves ${subject} out of date:`, ...renderPathRun(paths), '', closing].join('\n');
  }
  const closing =
    mode === 'may-hold'
      ? `Bring the coupled files back into agreement (docs follow deliberately committed code), then refresh — ${action} — and retry. If the fix needs a code change or a dependency no longer holds, tell the user instead. You may retry this command directly; the hold will not fire again for the same debt state.`
      : `Bring the coupled files back into agreement (docs follow deliberately committed code), then refresh — ${action}. If the fix needs a code change or a dependency no longer holds, tell the user instead.`;
  return [
    `This change leaves ${subject} out of date:`,
    '',
    annotateBlocks(blocksText, findings),
    '',
    '---',
    '',
    closing
  ].join('\n');
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
 * The advisory surfaced when the changeset's only staleness is environmental —
 * the advisor allows but says why, so the unresolvable condition is not silently
 * swallowed.
 */
function renderEnvironmentalReason(conditions: StalePorcelainRow[], blocksText: string): string {
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
 * The advisory an `allow`/`scan-failed` result renders into `reason`: the scan
 * could not complete, so the changeset was NOT verified — but the command
 * proceeds anyway (fail-open, matching `environmental`).
 */
function renderScanFailedReason(detail: string): string {
  return [
    'The implicit-dependency check could not run, so this change was NOT verified:',
    `  ${detail}`,
    '',
    'The command proceeds anyway. Fix the scan error if verification matters for this change.'
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
 * coverage. Still tighter than the staleness/environmental blocks elsewhere
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
 * spans section (via {@link renderRelatedSpansSection}) in both the full and
 * `alreadySeen` condensed forms: it's supplementary context about the
 * changeset, not itself part of what's flagged or consider-once'd. Both forms
 * pass the same `uncovered`/`covering` pair, so both rank and cap identically
 * — a condensed retry reordering the message it condenses would be its own
 * defect.
 */
function renderUncoveredReason(
  uncovered: string[],
  covering: PorcelainRow[],
  coveringBlocksText: string,
  mode: AdvisorMode = 'may-hold',
  alreadySeen = false
): string {
  const lines = uncovered.map((path) => `- ${path}`);
  if (alreadySeen) {
    const body = ['<git-span>', ...lines, '', 'Already flagged for git-span review above.'];
    body.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
    body.push('</git-span>');
    return body.join('\n');
  }
  const body = [
    '<git-span>',
    ...lines,
    '',
    uncovered.length === 1
      ? 'Determine if this file carries implicit dependencies, then use `git span` to document them:'
      : 'Determine if these files carry implicit dependencies, then use `git span` to document them:',
    '',
    '`git span add <name> <path#Lstart-Lend> [<path#Lstart-Lend>] ...`',
    '`git span why <name> "<why>"`',
    '',
    'The "<why>" is a single present-tense sentence naming what the ranges form together, specific enough to tell whether an edit lands inside it, with no rules or reminders.'
  ];
  body.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
  if (mode === 'may-hold') {
    body.push('', 'If none exist, retry the command to proceed (one-time check).');
  }
  body.push('', 'Load the `git-span:git-span` skill for guidance.', '</git-span>');
  return body.join('\n');
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
function gitText(args: string[], cwd: string, timeoutMs: number): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      maxBuffer: MAX_STDOUT_BYTES
    });
  } catch {
    return '';
  }
}

/** Run a git command at `cwd`, returning trimmed non-empty POSIX output lines (empty on any failure). */
function gitLines(args: string[], cwd: string, timeoutMs: number): string[] {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      maxBuffer: MAX_STDOUT_BYTES
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
      timeout: timeoutMs,
      maxBuffer: MAX_STDOUT_BYTES
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
      return gitLines(['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--cached', '--name-only'], repoRoot, timeoutMs);
    },
    trackedModifiedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--name-only'], repoRoot, timeoutMs);
    },
    outgoingPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return { paths: [], base: null };
      const upstream = gitLinesOrNull(
        ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--name-only', '@{u}..HEAD'],
        repoRoot,
        timeoutMs
      );
      if (upstream !== null) return { paths: upstream, base: '@{u}' };
      // No upstream configured: fall back to the merge-base with the default
      // remote branch (`origin/HEAD`). If that too is unresolvable, fail open.
      const base = gitLines(['-C', repoRoot, 'merge-base', 'HEAD', 'origin/HEAD'], repoRoot, timeoutMs)[0];
      if (!base) return { paths: [], base: null };
      return {
        paths: gitLines(
          ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', '--name-only', `${base}..HEAD`],
          repoRoot,
          timeoutMs
        ),
        base
      };
    },
    pathspecPaths: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      // Working-tree content vs HEAD, scoped to the pathspecs — the files a
      // `git commit -- <pathspec>` would actually change (staged or not).
      return gitLines(
        ['-C', repoRoot, ...GIT_READ_OPTS, 'diff', 'HEAD', '--name-only', '--', ...paths],
        repoRoot,
        timeoutMs
      );
    },
    changedHunks: async (paths, range, cwd) => {
      if (range.kind === 'unresolvable' || paths.length === 0) return [];
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const text = gitText(buildHunkReadArgs(repoRoot, range, paths), repoRoot, timeoutMs);
      if (text.trim().length === 0) return [];
      try {
        return parseUnifiedDiff(text);
      } catch {
        return [];
      }
    }
  };
}

/** The production {@link AdvisorExecutors}: scoped `git span` fix/stale/list at the repo root. */
export function createDefaultAdvisorExecutors(timeoutMs: number = DEFAULT_TIMEOUT_MS): AdvisorExecutors {
  return {
    fix: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      try {
        execFileSync('git', ['span', 'stale', ...paths, '--fix'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          maxBuffer: MAX_STDOUT_BYTES
        });
      } catch (err) {
        // `git span stale` exits 1 on drift even after healing, and non-zero on
        // genuine failure; either way the subsequent `stale` read is the source
        // of truth, so the exit code is ignored here.
        void err;
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
          timeout: timeoutMs,
          maxBuffer: MAX_STDOUT_BYTES
        });
      } catch (err) {
        // `git span stale` exits non-zero in two very different ways, and they
        // must not be conflated:
        //  - Legitimate drift: real porcelain rows on stdout describing the
        //    drift. Parse them (this is the whole point of the read).
        //  - Hard scan failure: the scoped query aborted before completing (e.g.
        //    an unreadable anchor file), writing an error to stderr and emitting
        //    empty stdout. An empty result here is NOT "clean" — the scan never
        //    ran to completion — so signal it distinctly rather than parsing to
        //    `[]`, which would read as a clean pass and silently allow the commit.
        const stdout = (err as { stdout?: string }).stdout;
        const stderr = (err as { stderr?: string }).stderr;
        const stdoutText = typeof stdout === 'string' ? stdout : '';
        const stderrText = typeof stderr === 'string' ? stderr : '';
        if (stdoutText.trim().length === 0 && stderrText.trim().length > 0) {
          throw new AdvisorScanError(stderrText.trim());
        }
        out = stdoutText;
      }
      return parseStalePorcelain(out);
    },
    list: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      let out: string;
      try {
        out = execFileSync('git', ['span', 'list', '--porcelain', ...paths], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          maxBuffer: MAX_STDOUT_BYTES
        });
      } catch (err) {
        // The coverage read is the source of the *covered* set, so an empty
        // result reads as "nothing is covered" — the most punitive answer the
        // advisor can give. A hard query failure (an unresolvable argument, say)
        // writes an error to stderr and emits empty stdout; parsing that to
        // `[]` would turn a failed scan into a confident, maximal hold with no
        // related-spans section. Signal it distinctly instead, exactly as the
        // `stale` executor above does, and let `evaluateAdvisor` fail open with
        // the `scan-failed` warning. Any partial stdout is still parsed.
        const stdout = (err as { stdout?: string }).stdout;
        const stderr = (err as { stderr?: string }).stderr;
        const stdoutText = typeof stdout === 'string' ? stdout : '';
        const stderrText = typeof stderr === 'string' ? stderr : '';
        if (stdoutText.trim().length === 0 && stderrText.trim().length > 0) {
          throw new AdvisorScanError(stderrText.trim());
        }
        out = stdoutText;
      }
      return parsePorcelain(out);
    },
    listBlocks: async (names, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || names.length === 0) return '';
      try {
        return execFileSync('git', ['span', 'list', ...names], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          maxBuffer: MAX_STDOUT_BYTES
        });
      } catch {
        // A failed human-format read only degrades the rendered message
        // (annotateBlocks synthesizes minimal blocks); never an advisor error.
        return '';
      }
    }
  };
}

/**
 * The production disk-backed {@link AdvisorMemoState}: one marker file per debt-state
 * digest under {@link advisorMemoDir} (`<git-common-dir>/git-span/advisor/`), following
 * span-surface.ts's file-backed `MemoStore` pattern. The digest is a hex sha256,
 * a safe filename. Best-effort and non-throwing: a memo whose repo cannot be
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
