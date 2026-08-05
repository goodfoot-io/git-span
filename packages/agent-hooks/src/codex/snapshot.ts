/**
 * Codex PreToolUse snapshot hook — the snapshot decision + write-only pre-walk.
 *
 * Fires before `Bash`/`shell`/`exec`/`local_shell` tool calls, on the same
 * matcher as the advisor. Mirrors the Claude snapshot hook: classify the
 * command via {@link classifyCommandForSnapshot} and, on a snapshot decision,
 * walk the tier-1/tier-2 files under the budgets and persist the pre-walk
 * record for (session_id, tool_use_id) via the snapshot store. Codex adds
 * `agent_id` to the record when present, so SubagentStop can remove only the
 * subagent's records. Fail-open is load-bearing: any error yields no record
 * and never blocks the command — the Post side then falls back to today's
 * static-parse path.
 *
 * The walk and the budget resolution are mirrored here rather than imported
 * from the Claude harness: the codex bundle must stay hermetic (the Claude
 * module executes the claude-code-hooks factory at load), and the walk is
 * the same harness-agnostic scope both sides use — tier-1 targets (the
 * classifier's parser-resolved paths plus literal redirect targets) first,
 * then the tier-2 repo-wide eligible list (tracked files from
 * `git ls-files --stage`, skipping mode-160000 gitlinks, plus untracked
 * non-ignored from `git ls-files --others --exclude-standard`), both scoped
 * to the CWD repo and excluding span-root documents, gitignored files, and
 * binaries (hashFile's NUL scan). Files are recorded under the budgets
 * (per-file byte cap excludes, file-count/total-bytes/wall-budget cuts carry
 * coverage-gap diagnostics so the comparison never describes partial coverage
 * as complete, and the per-record line budget degrades later files to coarse
 * entries). The record keys `files` by repo-relative path — the same key
 * space `compareSnapshot` and the PostToolUse adapter read.
 *
 * Budgets come from the `GIT_SPAN_SNAPSHOT_*` environment variables, falling
 * back to the defaults; the git-config layer of the plan's precedence is
 * deferred to the config pass.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/codex-hooks';
import {
  isGitIgnored,
  isInsideSpanRoot,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot
} from '../common/agent-hooks-common.js';
import {
  classifyCommandForSnapshot,
  DEFAULT_SNAPSHOT_BUDGETS,
  hashFile,
  type ReadFile,
  type SnapshotBudgets,
  type SnapshotFile,
  type SnapshotRecord,
  type StatFile
} from '../common/snapshot-core.js';
import { createSnapshotStore } from '../common/snapshot-store.js';
import type { CoreLogger } from '../common/span-surface.js';
import { extractShellCommand } from './advisor.js';
import { narrowCodeModeExec, narrowExecCommand } from './post-tool-use.js';

/** Injected stat over an absolute path: null when absent or unstat-able. */
const statFile: StatFile = (absPath) => {
  try {
    const st = statSync(absPath);
    // The runtime's Stats lacks `mtimeNs`, so ns is derived from mtimeMs
    // (truncated: BigInt refuses fractional values). The zero sub-ms part
    // reads as a second-granularity clock to the core, which never trusts such
    // a pair to prove non-change — it re-reads and hashes.
    return { size: st.size, mtimeNs: BigInt(Math.trunc(st.mtimeMs)) * 1_000_000n };
  } catch {
    return null;
  }
};

/** Injected byte read over an absolute path: null when absent or unreadable. */
const readFile: ReadFile = (absPath) => {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
};

/** The repo-wide tier-2 eligible list: tracked (minus gitlinks) + untracked non-ignored. */
function listRepoFiles(repoRoot: string, spanRoot: string): { paths: string[]; truncated: boolean } {
  const paths = new Set<string>();
  let truncated = false;
  const add = (raw: string): void => {
    for (const rel of raw.split('\0')) {
      if (rel.length === 0 || isInsideSpanRoot(rel, spanRoot)) continue;
      paths.add(rel);
    }
  };
  try {
    // `--stage` prints "<mode> <sha> <stage>\t<path>" per tracked file; the
    // mode-160000 gitlink entries (submodules) resolve outside the repo and
    // must never be walked.
    const tracked = execFileSync('git', ['ls-files', '-z', '--stage'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    for (const entry of tracked.split('\0')) {
      if (entry.length === 0) continue;
      const tab = entry.indexOf('\t');
      const meta = tab >= 0 ? entry.slice(0, tab) : entry;
      const path = tab >= 0 ? entry.slice(tab + 1) : entry;
      if (meta.startsWith('160000 ') || isInsideSpanRoot(path, spanRoot)) continue;
      paths.add(path);
    }
  } catch {
    // The repo was just resolved by git, so this is nearly unreachable; a
    // missing tracked list would otherwise make every later create look like
    // a fresh file — fail closed with a truncation gap.
    truncated = true;
  }
  try {
    add(
      execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
    );
  } catch {
    truncated = true;
  }
  return { paths: [...paths].sort(), truncated };
}

/** The outcome of one budgeted walk: per-path entries plus coverage diagnostics. */
export interface WalkResult {
  files: Record<string, SnapshotFile>;
  gaps: string[];
}

/**
 * The pre/post shared walk: tier-1 targets first (classifier order), then the
 * tier-2 eligible list (lexicographic), each hashed under the budgets. The
 * walk's gap texts are the path-coverage family the comparison reads
 * (`file-count budget` / `total-bytes budget` / `wall budget` / `truncat`) —
 * those cut coverage and disqualify delete/create candidates; the line-hash
 * gap is range-precision loss only and never matches that family.
 */
export function walkSnapshotFiles(
  repoRoot: string,
  tier1Targets: string[],
  budgets: SnapshotBudgets,
  now: number,
  _logger: CoreLogger
): WalkResult {
  const files: Record<string, SnapshotFile> = {};
  const gaps: string[] = [];
  const spanRoot = resolveSpanRoot(repoRoot);

  // Deterministic order: tier-1 targets first (deduped, scoped to this repo),
  // then the tier-2 list. The order decides which files the line-hash budget
  // degrades and which the file-count cap cuts.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const absTarget of tier1Targets) {
    const rel = relativeToRepo(repoRoot, absTarget);
    if (rel === null || rel.startsWith('..')) continue; // outside the repo
    if (isGitIgnored(repoRoot, rel) || isInsideSpanRoot(rel, spanRoot)) continue;
    if (!seen.has(rel)) {
      seen.add(rel);
      order.push(rel);
    }
  }
  const tier2 = listRepoFiles(repoRoot, spanRoot);
  if (tier2.truncated) {
    gaps.push('repo walk truncated: git ls-files failed; coverage is incomplete');
  }
  for (const rel of tier2.paths) {
    if (!seen.has(rel)) {
      seen.add(rel);
      order.push(rel);
    }
  }

  const start = Date.now();
  let totalBytes = 0;
  let lineBudget = budgets.maxLineHashesPerRecord;
  let budgetCoarse = 0;
  for (const rel of order) {
    if (Object.keys(files).length >= budgets.maxFiles) {
      gaps.push(`file-count budget exceeded: ${Object.keys(files).length}/${budgets.maxFiles}`);
      break;
    }
    if (Date.now() - start > budgets.preSideMaxWallSeconds * 1000) {
      gaps.push(`pre-side wall budget exceeded: captured ${Object.keys(files).length} files, stopped`);
      break;
    }
    const absPath = join(repoRoot, rel);
    const st = statFile(absPath);
    if (st === null) continue; // absent or unreadable — silent, per the plan
    if (totalBytes + st.size > budgets.maxTotalBytes) {
      gaps.push(`total-bytes budget exceeded: ${totalBytes + st.size}/${budgets.maxTotalBytes}`);
      break;
    }
    if (lineBudget <= 0) budgetCoarse += 1;
    const entry = hashFile({ absPath, now, budgets, remainingLineBudget: lineBudget, stat: statFile, read: readFile });
    if (entry === null) continue; // binary / over the per-file byte cap — silent exclusions
    totalBytes += st.size;
    files[rel] = entry;
    if (entry.coarse !== true) lineBudget -= entry.lines?.length ?? 0;
  }
  if (budgetCoarse > 0) {
    gaps.push(`line-hash budget exceeded: ${budgetCoarse} files recorded coarse`);
  }
  return { files, gaps };
}

/**
 * Budgets: `GIT_SPAN_SNAPSHOT_*` env overrides, else `git-span.snapshot-*`
 * config in the repo, else the defaults — the `resolveSpanRoot` precedence.
 * The config layer is one scoped `git config --get-regexp` read for the whole
 * key family (the classifier's one-subprocess idiom), so a snapshot call pays
 * one subprocess for the entire budget set; a repo-less or failed read falls
 * through to env + defaults, and values are validated exactly like the env
 * layer, so a malformed key keeps the default (fail-open, never a crash).
 */
export function resolveSnapshotBudgets(repoRoot: string | null): SnapshotBudgets {
  const budgets: SnapshotBudgets = { ...DEFAULT_SNAPSHOT_BUDGETS };
  const overrides: [keyof SnapshotBudgets, string][] = [
    ['maxFiles', 'GIT_SPAN_SNAPSHOT_MAX_FILES'],
    ['maxBytesPerFile', 'GIT_SPAN_SNAPSHOT_MAX_BYTES_PER_FILE'],
    ['maxTotalBytes', 'GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES'],
    ['maxLineHashesPerFile', 'GIT_SPAN_SNAPSHOT_MAX_LINE_HASHES_PER_FILE'],
    ['maxLineHashesPerRecord', 'GIT_SPAN_SNAPSHOT_MAX_LINE_HASHES_PER_RECORD'],
    ['preSideMaxWallSeconds', 'GIT_SPAN_SNAPSHOT_PRE_SIDE_MAX_WALL_SECONDS'],
    ['maxStorageBytes', 'GIT_SPAN_SNAPSHOT_MAX_STORAGE_BYTES'],
    ['maxTouchedFiles', 'GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES'],
    ['postSideWallSeconds', 'GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS'],
    ['recordTtlMs', 'GIT_SPAN_SNAPSHOT_RECORD_TTL_MS'],
    ['unfinishedEntryTtlMs', 'GIT_SPAN_SNAPSHOT_UNFINISHED_ENTRY_TTL_MS']
  ];
  const config = repoRoot === null ? null : readSnapshotConfig(repoRoot);
  for (const [key, envName] of overrides) {
    // Env wins, then repo config, then the default — mirroring resolveSpanRoot.
    const raw = process.env[envName];
    if (raw !== undefined && raw.trim() !== '') {
      const value = Number(raw.trim());
      if (Number.isFinite(value) && value >= 0) budgets[key] = value;
      continue;
    }
    const configKey = `git-span.${envName.slice('GIT_SPAN_'.length).toLowerCase().replaceAll('_', '-')}`;
    const configValue = config?.get(configKey);
    if (configValue !== undefined && configValue !== '') {
      const value = Number(configValue);
      if (Number.isFinite(value) && value >= 0) budgets[key] = value;
    }
  }
  return budgets;
}

/**
 * One scoped `git config --get-regexp` read for the whole `git-span.snapshot-*`
 * key family. Output lines are `key value`; a key repeated across config
 * scopes resolves to its last line, matching `git config --get`'s
 * highest-precedence value. Exit 1 (no matching keys) or any git error
 * yields an empty map — the config layer simply falls through to defaults.
 */
function readSnapshotConfig(repoRoot: string): Map<string, string> {
  const values = new Map<string, string>();
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'config', '--get-regexp', '^git-span\\.snapshot-'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    for (const line of out.split('\n')) {
      const sep = line.indexOf(' ');
      if (sep <= 0) continue;
      values.set(line.slice(0, sep), line.slice(sep + 1).trim());
    }
  } catch (err) {
    void err; // no matching keys (exit 1) or git error — config layer empty
  }
  return values;
}

export function createHandler() {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      // A PreToolUse event without session_id or tool_use_id can never be
      // correlated — fail open, no record (per the plan).
      if (!input.session_id || !input.tool_use_id) return undefined;
      // The command rides in any of the shell envelopes: the harness-unwrapped
      // `command` (string or argv — extractShellCommand), the classic
      // exec_command JSON `arguments`, or the code-mode exec JS `input`.
      let command: string | null = extractShellCommand(input.tool_input);
      if (command === null) command = narrowExecCommand(input.tool_input)?.cmd ?? null;
      if (command === null) command = narrowCodeModeExec(input.tool_input).cmd;
      if (command === null) return undefined;
      const plan = classifyCommandForSnapshot(command, input.cwd ?? '');
      if (plan.decision.kind !== 'snapshot') {
        // No snapshot: the command has no write-capable command, or every
        // write is statically covered and provably expansion-free — the Post
        // side's static-parse path stays authoritative.
        return undefined;
      }
      const repoRoot = resolveRepoRoot(input.cwd ?? '');
      if (repoRoot === null) return undefined; // no repo, no record — fail open
      const budgets = resolveSnapshotBudgets(repoRoot);
      const store = createSnapshotStore(ctx.logger, budgets);
      const now = Date.now();
      const { files, gaps } = walkSnapshotFiles(repoRoot, plan.tier1Targets, budgets, now, ctx.logger);
      const record: SnapshotRecord = {
        version: 1,
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
        repoRoot,
        createdAt: now,
        consumed: false,
        consumedAt: null,
        tier: 'repo',
        gaps,
        files
      };
      const wrote = store.write(record);
      ctx.logger.info('git-span snapshot pre-walk', {
        toolUseId: input.tool_use_id,
        decision: plan.decision.reason,
        tier: 'repo',
        files: Object.keys(files).length,
        gaps: gaps.length,
        refused: !wrote
      });
      return undefined;
    } catch (err) {
      // Fail open: never let the snapshot pre-hook block the command. A
      // missing record degrades that call to the static path — visible only
      // via the Post classifier's missing-record warning (Phase 3).
      ctx.logger.warn('git-span snapshot pre-hook failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

export default preToolUseHook({ matcher: 'Bash|shell|exec|local_shell', timeout: 10_000 }, createHandler());
