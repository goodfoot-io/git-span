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

import type { PorcelainRow, StalePorcelainRow } from './agent-hooks-common.js';

const NOT_IMPLEMENTED = 'Not Implemented';

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
  void command;
  throw new Error(NOT_IMPLEMENTED);
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
export function resolveChangeset(
  kind: 'commit' | 'push',
  all: boolean,
  cwd: string,
  git: GitExecutor
): Promise<string[]> {
  void kind;
  void all;
  void cwd;
  void git;
  throw new Error(NOT_IMPLEMENTED);
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
export function evaluateGate(
  paths: string[],
  cwd: string,
  executors: GateExecutors,
  memoState: GateMemoState
): Promise<GateResult> {
  void paths;
  void cwd;
  void executors;
  void memoState;
  throw new Error(NOT_IMPLEMENTED);
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
