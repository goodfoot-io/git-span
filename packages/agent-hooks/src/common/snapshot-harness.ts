/**
 * Harness-agnostic snapshot glue — everything between the adapters' envelope
 * narrowing and the core's capture/compare mechanism, hoisted here so the
 * Claude and Codex adapters stop duplicating it (this module imports no
 * harness SDK, so the Codex bundle stays hermetic).
 *
 * The pre side ({@link capturePreSnapshot}) resolves the repo's real git
 * paths, takes the private write-tree capture into the call's own object
 * dir/temp index (the store owns their layout), and persists the v2 record.
 * The post side ({@link snapshotBashBranch}) mirrors the pre side's capture
 * mode — tree against tree via {@link compareTrees}, or stat sweep against
 * stat sweep via {@link compareStatOnly} when the pre side degraded — then
 * runs the unchanged downstream contract: consume-first tombstoning, the
 * ambiguity table, the interleaved-edit consult, and one multi-path touch.
 *
 * Budgets resolve per call ({@link resolveSnapshotBudgets}):
 * `GIT_SPAN_SNAPSHOT_*` environment overrides, then one scoped repo-config
 * read (the `git-span.snapshot-*` and `git-span.snapshot.*` subsection key
 * forms), then the compiled defaults; a malformed value keeps the default, so
 * the config layer fails open.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queueRoot, resolveSpanRoot, sessionDir } from './agent-hooks-common.js';
import {
  type AmbiguityBaseline,
  applyAmbiguityRules,
  type CompareTreesResult,
  captureWriteTree,
  compareStatOnly,
  compareTrees,
  DEFAULT_SNAPSHOT_BUDGETS,
  type GitRunner,
  hashTreePath,
  recordHasPathCoverageGap,
  type SiblingSnapshot,
  type SnapshotBudgets,
  type SnapshotPostState,
  type SnapshotRecord,
  type StatFile,
  statOnlySweep,
  type TreePathHash
} from './snapshot-core.js';
import {
  type ActivityEntry,
  activityEntriesCovering,
  type SnapshotIndexEntry,
  type SnapshotStore,
  snapshotObjectDir,
  snapshotRecordFile,
  snapshotTempIndexFile,
  writeJsonAtomic
} from './snapshot-store.js';
import type { CoreLogger, MemoStore } from './span-surface.js';
import { type ObservedWriteScope, runTouchHook, type TouchExecutors, type TouchInput } from './touch-core.js';

/**
 * Budgets: `GIT_SPAN_SNAPSHOT_*` env overrides, else `git-span.snapshot-*` /
 * `git-span.snapshot.*` config in the repo, else the defaults — the
 * `resolveSpanRoot` precedence. The config layer is one scoped
 * `git config --get-regexp` read for the whole key family (the classifier's
 * one-subprocess idiom), so a snapshot call pays one subprocess for the
 * entire budget set; a repo-less or failed read falls through to env +
 * defaults, and values are validated exactly like the env layer, so a
 * malformed key keeps the default (fail-open, never a crash).
 */
export function resolveSnapshotBudgets(repoRoot: string | null): SnapshotBudgets {
  const budgets: SnapshotBudgets = { ...DEFAULT_SNAPSHOT_BUDGETS };
  const overrides: [keyof SnapshotBudgets, string][] = [
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
      if (Number.isFinite(value) && value >= 0) {
        budgets[key] = value;
        continue;
      }
      // A present-but-malformed env value must not shadow the config layer:
      // fall through so a valid git-span.snapshot-* key still wins over the
      // default instead of being silently dropped by the bad env value.
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
 * / `git-span.snapshot.*` key family (the dash form and the git subsection
 * form). Output lines are `key value`; a key repeated across config scopes
 * resolves to its last line, matching `git config --get`'s
 * highest-precedence value. A subsection key is normalized onto the dash
 * form's key space (`git-span.snapshot.max-touched-files` →
 * `git-span.snapshot-max-touched-files`), the key
 * {@link resolveSnapshotBudgets} looks up. Exit 1 (no matching keys) or any
 * git error yields an empty map — the config layer simply falls through to
 * defaults.
 */
function readSnapshotConfig(repoRoot: string): Map<string, string> {
  const values = new Map<string, string>();
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'config', '--get-regexp', '^git-span\\.snapshot[-.]'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    for (const line of out.split('\n')) {
      const sep = line.indexOf(' ');
      if (sep <= 0) continue;
      const key = line.slice(0, sep);
      // Only the subsection separator needs normalization — the dash form is
      // already the key space resolveSnapshotBudgets looks up.
      values.set(key.replace(/^git-span\.snapshot\./, 'git-span.snapshot-'), line.slice(sep + 1).trim());
    }
  } catch (err) {
    void err; // no matching keys (exit 1) or git error — config layer empty
  }
  return values;
}

/**
 * The default {@link GitRunner}: one `git` subprocess returning raw stdout
 * bytes (cat-file blob reads must not pass through an encoding). The caller's
 * env entries merge over the ambient environment — the capture's private
 * GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY ride on top of PATH and the rest.
 */
export const defaultGitRunner: GitRunner = (args, opts) =>
  execFileSync('git', args, {
    cwd: opts.cwd,
    env: opts.env === undefined ? process.env : { ...process.env, ...opts.env },
    // execFileSync rejects non-integer timeouts, and a fractional
    // postSideWallSeconds budget (0.5 is a valid budget value) produces
    // fractional remaining-milliseconds — ceil, never crash the capture.
    timeout: opts.timeoutMs === undefined ? undefined : Math.ceil(opts.timeoutMs),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  });

/** Injected stat over an absolute path: null when absent or unstat-able. */
export const statFile: StatFile = (absPath) => {
  try {
    const st = statSync(absPath);
    // The runtime's Stats lacks `mtimeNs`, so ns is derived from mtimeMs
    // (truncated: BigInt refuses fractional values). Stat-only comparisons
    // treat an equal (size, mtimeNs) pair as unchanged — acceptable in degrade
    // mode because the record already carries the coverage gap.
    return { size: st.size, mtimeNs: BigInt(Math.trunc(st.mtimeMs)) * 1_000_000n };
  } catch {
    return null;
  }
};

/**
 * The repo's REAL object store and index file, worktree-aware — the private
 * capture's `info/alternates` target and the temp index's warm-cache source.
 * One subprocess resolves both. Null when git cannot answer (repo gone,
 * spawn failure): the caller fails open, no capture.
 */
export function resolveGitPaths(
  repoRoot: string,
  runGit: GitRunner = defaultGitRunner
): { objectsDir: string; indexFile: string } | null {
  try {
    const out = runGit(['rev-parse', '--path-format=absolute', '--git-path', 'objects', '--git-path', 'index'], {
      cwd: repoRoot
    })
      .toString('utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (out.length < 2) return null;
    return { objectsDir: out[0]!, indexFile: out[1]! };
  } catch {
    return null;
  }
}

/** What one pre-side capture produced, for the adapters' info log. */
export interface PreSnapshotResult {
  /** False when the store refused the write (storage cap). */
  wrote: boolean;
  /** The captured tree SHA; null when the capture degraded to stat-only. */
  treeSha: string | null;
  /** The record's gap count. */
  gaps: number;
}

/**
 * The pre side of one snapshot-decided call: resolve the repo's real git
 * paths, take the private write-tree capture into the call's own object
 * dir/temp index, and persist the v2 record. Returns null on total capture
 * failure (no git paths, or both the write-tree and the stat sweep failed) —
 * the caller fails open, and any artifacts the attempt created are removed
 * immediately (no record exists, so no concurrent reader can hold them; a
 * crash between creation and cleanup is reaped by the sweep's orphan pass).
 * A storage-cap refusal cleans up the same way.
 */
export function capturePreSnapshot(opts: {
  store: SnapshotStore;
  sessionId: string;
  toolUseId: string;
  agentId?: string;
  repoRoot: string;
  budgets: SnapshotBudgets;
  logger: CoreLogger;
  runGit?: GitRunner;
  stat?: StatFile;
}): PreSnapshotResult | null {
  const runGit = opts.runGit ?? defaultGitRunner;
  const objectDir = snapshotObjectDir(opts.sessionId, opts.toolUseId);
  const indexFile = snapshotTempIndexFile(opts.sessionId, opts.toolUseId);
  const removeArtifacts = (): void => {
    rmSync(objectDir, { recursive: true, force: true });
    rmSync(indexFile, { force: true });
  };
  const gitPaths = resolveGitPaths(opts.repoRoot, runGit);
  if (gitPaths === null) return null;
  const captured = captureWriteTree({
    repoRoot: opts.repoRoot,
    objectDir,
    indexFile,
    alternates: gitPaths.objectsDir,
    realIndexFile: gitPaths.indexFile,
    spanRoot: resolveSpanRoot(opts.repoRoot),
    wallBudgetMs: opts.budgets.preSideMaxWallSeconds * 1000,
    runGit,
    stat: opts.stat ?? statFile
  });
  if (captured.treeSha === null && captured.statOnly === undefined) {
    // Total failure: no evidence of either granularity — fail open, no record.
    for (const gap of captured.gaps) opts.logger.warn(`git-span snapshot pre-capture failed open: ${gap}`);
    removeArtifacts();
    return null;
  }
  const record: SnapshotRecord = {
    version: 2,
    sessionId: opts.sessionId,
    toolUseId: opts.toolUseId,
    ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
    repoRoot: opts.repoRoot,
    createdAt: Date.now(),
    consumed: false,
    consumedAt: null,
    treeSha: captured.treeSha,
    ...(captured.statOnly !== undefined ? { statOnly: captured.statOnly } : {}),
    gaps: captured.gaps
  };
  const wrote = opts.store.write(record);
  if (!wrote) removeArtifacts();
  return { wrote, treeSha: captured.treeSha, gaps: captured.gaps.length };
}

/**
 * The decided-but-recordless fallback note, shared by the Claude and Codex
 * adapters so the wording can never drift between them. Both adapters gate
 * it on a non-empty static fallback ("the static spans below" must actually
 * follow) and on {@link shouldSurfaceRecordlessNote} (at most once per
 * session).
 */
export const SNAPSHOT_RECORDLESS_NOTE =
  "git-span: snapshot record unavailable — this command's file writes were not snapshot-attributed; the static spans below are the only attribution";

/**
 * Once-per-session gate for {@link SNAPSHOT_RECORDLESS_NOTE}. The note is a
 * standing-condition diagnostic — when records are chronically unavailable
 * (an upgrade race, a wedged store) every snapshot-decided Bash call would
 * repeat it, drowning the transcript with identical noise. The gate is a
 * disk marker under the session dir because each hook invocation is its own
 * process: an in-memory flag lives exactly one invocation and can never
 * dedupe across calls. The O_EXCL create makes the first caller win
 * atomically; EEXIST means the session has already seen the note. Any other
 * marker failure fails toward visibility — a repeated note beats a silent
 * loss.
 */
export function shouldSurfaceRecordlessNote(sessionId: string, logger: CoreLogger): boolean {
  try {
    const dir = sessionDir(sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'snapshot-recordless-note'), '', { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    logger.warn(`git-span recordless-note memo failed open: ${String(err)}`);
    return true;
  }
}

/**
 * The outcome of one snapshot-first Bash attribution: the comparison verdict
 * plus the repo-relative paths the comparison's evidence covered. `excludedPaths`
 * is the union of attributed, dropped (ambiguous / interleaved-tool / skipped)
 * and rename-source paths — the static co-parser must skip exactly those.
 */
export interface SnapshotBashOutcome {
  kind: 'no-record' | 'tombstoned' | 'done';
  /** The snapshot touch's block; meaningful only on 'done'. */
  additionalContext: string | null;
  /** Attributed ∪ dropped ∪ skipped repo-relative paths. */
  excludedPaths: Set<string>;
}

/**
 * Parse a sibling's record file directly (find returns 'tombstoned' once consumed).
 *
 * Item-6 decision — accepted, hardening claim re-scoped: this read races a
 * concurrent consume's rename-over of the same file. On virtiofs/fuse that
 * rename-over can abort the process mid-read — the documented residual abort
 * class (the store hardening closed the sweep's unmargined reads, not these).
 * A retry loop cannot survive a native abort: the process dies inside the
 * syscall, before any JS handler runs, so a retry never gets a second chance,
 * and a retry-once wrapper's 'sibling invisible' fallback is exactly what the
 * abort produces anyway (the sibling contributes no evidence either way). The
 * residual is therefore accepted and re-scoped in this comment: a sibling
 * whose record cannot be read is absent from the ambiguity check, which fails
 * toward the conservative direction only where its coverage would have
 * demanded a check.
 *
 * Plain JSON.parse, no bigint revival: the ambiguity view reads only the
 * sibling's identity, tree SHAs, and gaps — never its stat-only map, the one
 * field with serialized bigints.
 *
 * Three-way outcome: a v2 record, `'incompatible'` for a parseable record of
 * any other version, or null when the file is absent/unreadable. The
 * incompatible case matters during a rollout window — a live v1 sibling
 * mid-write is real concurrency evidence whose coverage the v2 view cannot
 * read, so the caller must fail closed on it (the sweep reaps such leftovers,
 * but a record written after this invocation's sweep is still visible here).
 */
function readSiblingRecord(
  sessionId: string,
  toolUseId: string,
  cache: Map<string, SnapshotRecord | 'incompatible' | null>
): SnapshotRecord | 'incompatible' | null {
  const key = `${sessionId}\t${toolUseId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let record: SnapshotRecord | 'incompatible' | null = null;
  try {
    const raw = JSON.parse(readFileSync(snapshotRecordFile(sessionId, toolUseId), 'utf8')) as unknown;
    if (raw !== null && typeof raw === 'object') {
      record = (raw as SnapshotRecord).version === 2 ? (raw as SnapshotRecord) : 'incompatible';
    }
  } catch {
    record = null;
  }
  cache.set(key, record);
  return record;
}

/**
 * Append diagnostics to a live record's gaps so the consume that follows
 * carries them: a consumed sibling carrying a path-coverage gap is read as
 * coverage-unknowable by later ambiguity checks (fail closed), while a
 * consumed sibling with no post tree and no coverage gap would read as
 * "consumed without changing P" — a false clean. The callers append the
 * compare-phase gaps (touched-files cap cuts, wall exhaustion, the abort
 * failure) before the consume; the consult's coverage-gap predicate is
 * kind-based, so a diagnostic-only gap (binary-scope) never opens the family.
 * The record is parsed with plain JSON.parse (the store serializes the
 * stat-only map's bigint mtimeNs as strings, so a plain round-trip preserves
 * them) and the consume's own read then revives it. One read+write serves
 * the whole batch — the touched-files cap can cut many paths. The rewrite
 * goes through the store's atomic tmp+rename writer, so a concurrent
 * sibling read can never observe a torn record. Fail open: if
 * the record cannot be re-read or rewritten, the consume below still closes
 * the window and the logger warn carries the diagnostic.
 */
function appendRecordGap(sessionId: string, toolUseId: string, gaps: string[], logger: CoreLogger): void {
  try {
    const file = snapshotRecordFile(sessionId, toolUseId);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (raw === null || typeof raw !== 'object' || (raw as SnapshotRecord).version !== 2) return;
    const rec = raw as SnapshotRecord;
    let changed = false;
    for (const gap of gaps) {
      if (rec.gaps.includes(gap)) continue;
      rec.gaps.push(gap);
      changed = true;
    }
    if (changed) writeJsonAtomic(file, rec);
  } catch (err) {
    logger.warn(`git-span record-gap append failed open: ${String(err)}`);
  }
}

/**
 * The ambiguity table's sibling set for one path: every repo record except
 * mine, read directly from disk, viewed per path exactly as the core's
 * {@link SiblingSnapshot} contract defines (pre/post null when the sibling's
 * evidence lacks the path). Per-path hashes are derived on demand from the
 * sibling's recorded tree SHAs via {@link hashTreePath} against the sibling's
 * own private object dir — records persist tree SHAs, never per-path maps —
 * and memoized per (treeSha, path) across the branch invocation. A stat-only
 * sibling has no trees to hash; its record carries the degrade's
 * path-coverage gap, so `coverageGap` makes it cover every path and the
 * table fails closed on it. The repo index is read once per
 * snapshotBashBranch and passed in — a fresh index read per changed path
 * would repeat the readdir+JSON pass for every attribution; the sibling
 * record bodies still come through the shared record cache.
 */
function siblingsForPath(
  mine: SnapshotRecord,
  index: SnapshotIndexEntry[],
  path: string,
  recordCache: Map<string, SnapshotRecord | 'incompatible' | null>,
  hashCache: Map<string, TreePathHash>,
  runGit: GitRunner,
  hashTimeoutMs: number,
  logger: CoreLogger
): SiblingSnapshot[] {
  const treeHash = (record: SnapshotRecord, treeSha: string | null): TreePathHash => {
    if (treeSha === null) return { kind: 'absent' };
    const key = `${treeSha}\t${path}`;
    const cached = hashCache.get(key);
    if (cached !== undefined) return cached;
    const result = hashTreePath({
      treeSha,
      path,
      repoRoot: record.repoRoot,
      objectDir: snapshotObjectDir(record.sessionId, record.toolUseId),
      runGit,
      timeoutMs: hashTimeoutMs
    });
    hashCache.set(key, result);
    return result;
  };
  const out: SiblingSnapshot[] = [];
  for (const entry of index) {
    if (entry.sessionId === mine.sessionId && entry.toolUseId === mine.toolUseId) continue;
    const record = readSiblingRecord(entry.sessionId, entry.toolUseId, recordCache);
    if (record === null) continue;
    if (record === 'incompatible') {
      // A foreign-version (deployed-v1) record: real concurrency evidence
      // whose coverage this view cannot read. Fail closed exactly like a
      // gapped live sibling — it covers every path and reads unconsumed, so
      // the table defers the path instead of silently attributing over a
      // sibling whose write window may still be open.
      out.push({
        sessionId: entry.sessionId,
        toolUseId: entry.toolUseId,
        createdAt: 0,
        consumed: false,
        consumedAt: null,
        coverageGap: true,
        pre: null,
        post: null
      });
      continue;
    }
    const preHash = treeHash(record, record.treeSha);
    const postHash = treeHash(record, record.post?.treeSha ?? null);
    // A failed hash read (reaped object dir, corrupt tree, timeout) is NOT
    // proof of absence: the sibling's evidence is unreadable, so its coverage
    // is unknowable for this path — the same fail-closed shape a persisted
    // path-coverage gap carries. Only a proven-absent probe may read as
    // not-covering.
    const hashError = preHash.kind === 'error' || postHash.kind === 'error';
    if (hashError) {
      const reason = preHash.kind === 'error' ? preHash.reason : postHash.kind === 'error' ? postHash.reason : '';
      logger.warn(`git-span sibling hash read failed for ${record.toolUseId} at ${path} — failing closed: ${reason}`);
    }
    out.push({
      sessionId: record.sessionId,
      toolUseId: record.toolUseId,
      createdAt: record.createdAt,
      consumed: record.consumed,
      consumedAt: record.consumedAt,
      // Kind-based, never ANY-gap: a precision-loss diagnostic (binary-scope)
      // does not make the sibling's coverage unknowable — only the
      // path-coverage family does (which includes the stat-only degrade),
      // plus the unreadable-evidence case above.
      coverageGap: recordHasPathCoverageGap(record) || hashError,
      pre: preHash.kind === 'hash' ? { hash: preHash.hash } : null,
      post: postHash.kind === 'hash' ? { hash: postHash.hash } : null
    });
  }
  return out;
}

/**
 * Direct scan of the activity log for entries still in flight (finishedAt
 * null, startedAt before `now`, file mtime in the unfinished-entry TTL window)
 * that cover the path — the consult reads only finished entries, so the
 * unfinished ones must be scanned separately: their write may land at any
 * moment, and the attribution that never fires is the attribution that never
 * lies.
 */
function unfinishedEntryCovering(repoRoot: string, path: string, now: number, budgets: SnapshotBudgets): string | null {
  const earliest = now - budgets.unfinishedEntryTtlMs;
  let dir: string;
  try {
    dir = join(queueRoot(repoRoot), 'activity-log');
  } catch {
    return null;
  }
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    // Same mtime slack as the consult: an entry finished in the same integer
    // millisecond as `now` reads 0..1 ms future — excluding it would silently
    // reopen the interleaving window.
    if (mtimeMs < earliest || mtimeMs > now + 1) continue;
    let entry: ActivityEntry;
    try {
      entry = JSON.parse(readFileSync(file, 'utf8')) as ActivityEntry;
    } catch {
      continue;
    }
    if (entry.finishedAt !== null) continue;
    if (typeof entry.startedAt !== 'number' || entry.startedAt >= now) continue;
    if (entry.paths.some((p) => p.path === path)) return entry.toolUseId;
  }
  return null;
}

/**
 * The snapshot-first Bash attribution, shared by every Post-side adapter
 * (Claude PostToolUse and PostToolUseFailure, the Codex shell branch — the
 * failure policy compares whenever a record exists; `is_interrupt` gates
 * nothing). Flow:
 *
 * 1. Find the record. A tombstone is a consumed duplicate — nothing to do. No
 *    record means the pre capture failed open — the caller falls back to the
 *    static path (with a warning on the Post side).
 * 2. Capture the post side in the SAME mode as the pre side: a pre tree gets
 *    a post write-tree into the same private object dir (unchanged blobs are
 *    already local) compared via {@link compareTrees}; a pre stat-only
 *    degrade gets a post stat sweep compared via {@link compareStatOnly} — a
 *    post tree would have nothing to compare against. A post-side degrade
 *    under a pre tree yields no attribution and a coverage gap (fail
 *    closed), never a fabricated comparison.
 * 3. Consume FIRST, before any per-path work. The tombstone is the
 *    single-winner gate: the O_EXCL means the first consumer wins and a
 *    racing duplicate no-ops — the touch runs only after a successful
 *    consume. Consuming before the attribution also bounds what a platform
 *    timeout kill can strand: the pre-consume segment (capture, compare, gap
 *    persist) is the only work that can be killed with the record still
 *    live, and the belt-and-braces catch wraps exactly that segment — an
 *    unexpected throw there still consumes the record (failure recorded as a
 *    gap, so later ambiguity reads treat it as coverage-unknowable), because
 *    an unconsumed record poisons every later attribution on the repo. Once
 *    the record is consumed, a kill loses only this call's block/touch,
 *    never the session's attribution.
 * 4. Per attributed path, in order: the ambiguity table gates first (a
 *    deterministic verdict per sibling — ambiguous paths drop whole with a
 *    warn naming the reason and the conflicting call); then the unfinished
 *    activity-entry scan (an in-flight edit may still write the path — drop
 *    with an interleaved-tool note); then the four-outcome consult:
 *    never-flag (finishedAt ≤ my record's createdAt — attribute, no note),
 *    skip (the edit's pre/post hashes equal my pre/current — it is already
 *    attributed by its own touch), bounded-double (else — attribute with an
 *    absorbed-double note).
 * 5. One multi-path touch across all attributed scopes: one heal pass on the
 *    first scope's file, one repo-wide drift, per-scope surface computation.
 *    Renames surface the OLD path (the span lives on the dead anchor); the
 *    new path is excluded from the static co-parser along with every
 *    attributed and dropped path. Deferrals, budget exhaustion, and aborts
 *    are surfaced as transcript-visible notes in the block, never
 *    logger-only.
 */
export async function snapshotBashBranch(
  store: SnapshotStore,
  sessionId: string,
  toolUseId: string,
  cwd: string,
  executors: TouchExecutors,
  memo: MemoStore,
  logger: CoreLogger,
  budgets: SnapshotBudgets,
  runGit: GitRunner = defaultGitRunner
): Promise<SnapshotBashOutcome> {
  const found = store.find(sessionId, toolUseId);
  if (found === 'tombstoned') return { kind: 'tombstoned', additionalContext: null, excludedPaths: new Set() };
  if (found === null) return { kind: 'no-record', additionalContext: null, excludedPaths: new Set() };

  const repoRoot = found.repoRoot;
  const now = Date.now();
  const excludedPaths = new Set<string>();
  const scopes: ObservedWriteScope[] = [];
  // Transcript-visible notes for the block — deferrals, budget exhaustion,
  // and aborts are all surfaced to the model loop, never logger-only.
  const notes: string[] = [];
  // Paths dropped because an interleaved edit is still in flight, aggregated
  // into ONE transcript note after the loop — a wide command can drop many
  // paths against the same unfinished entry, and a per-path note would drown
  // the block. Logger-only was the round-1 shape and violated the contract's
  // "deferrals are transcript-visible, never logger-only" promise.
  const interleavedDrops: string[] = [];
  const siblingCache = new Map<string, SnapshotRecord | 'incompatible' | null>();
  const siblingHashCache = new Map<string, TreePathHash>();
  // The repo index, read once per branch rather than once per changed path:
  // the sibling set is the same for every path, and the per-path ambiguity
  // pass must not pay a readdir+JSON index read per attribution.
  // listRepoRecords fails open (missing/unreadable index dirs yield an empty
  // list), so an index-level failure degrades to "no siblings" — the same
  // fail-open shape the per-path read had.
  const siblingIndex = store.listRepoRecords(repoRoot);

  // The post state travels into BOTH consume calls (the normal path and the
  // abort catch): whatever evidence the post capture produced must land on
  // the consumed record for later siblings, even when the compare aborted.
  let post: SnapshotPostState = { treeSha: null };
  let compared: CompareTreesResult;
  try {
    const spanRoot = resolveSpanRoot(repoRoot);
    const wallBudgetMs = budgets.postSideWallSeconds * 1000;
    if (found.treeSha === null) {
      // The pre side degraded: mirror it. A post write-tree would have no pre
      // tree to compare against, so the stat sweep is the only comparable
      // evidence — same file-granularity, whole-file scopes.
      const sweep = statOnlySweep({ repoRoot, spanRoot, timeoutMs: wallBudgetMs, runGit, stat: statFile });
      post = { treeSha: null, statOnly: sweep };
      compared = compareStatOnly(found.statOnly ?? {}, sweep);
    } else {
      const gitPaths = resolveGitPaths(repoRoot, runGit);
      if (gitPaths === null) throw new Error('git paths unresolvable at post time');
      const captured = captureWriteTree({
        repoRoot,
        objectDir: snapshotObjectDir(sessionId, toolUseId),
        indexFile: snapshotTempIndexFile(sessionId, toolUseId),
        alternates: gitPaths.objectsDir,
        realIndexFile: gitPaths.indexFile,
        spanRoot,
        wallBudgetMs,
        runGit,
        stat: statFile
      });
      if (captured.treeSha === null) {
        // Post-side degrade under a pre tree: the two sides' evidence is not
        // comparable — no attribution, and the degrade's path-coverage gap
        // (persisted below) makes later siblings fail closed on this record.
        post = { treeSha: null, ...(captured.statOnly !== undefined ? { statOnly: captured.statOnly } : {}) };
        compared = { attributions: new Map(), unchanged: new Set(), gaps: captured.gaps, contentHashes: new Map() };
      } else {
        post = { treeSha: captured.treeSha };
        compared = compareTrees({
          preTreeSha: found.treeSha,
          postTreeSha: captured.treeSha,
          repoRoot,
          objectDir: snapshotObjectDir(sessionId, toolUseId),
          spanRoot,
          budgets,
          wallStart: now,
          runGit
        });
      }
    }
    for (const gap of compared.gaps) logger.info?.(`git-span snapshot compare: ${gap}`);

    // Confirmed-unchanged paths are a definitive verdict too: the co-parser
    // must not re-touch a path the snapshot already proved identical
    // pre/post, even though it produced no attribution entry for it.
    for (const path of compared.unchanged) excludedPaths.add(path);

    // The compare-phase gaps land on the record before the consume (same funnel
    // as the abort catch): a path cut by the touched-files cap or the wall
    // budget has no derivable post evidence, and without its persisted gap a
    // later consumed-after consult would read the missing post state as
    // "consumed without changing P" — the phantom-attribution hole. The
    // persisted gap makes it coverage-unknowable instead (fail closed).
    // Diagnostic-only compare gaps (binary-scope) persist too but never match
    // the coverage-gap family the consult reads.
    if (compared.gaps.length > 0) appendRecordGap(sessionId, toolUseId, compared.gaps, logger);

    // Consume first: the tombstone is the single-winner gate. The loser of a
    // duplicate-delivery race no-ops and never runs the touch. Consuming
    // before the per-path attribution also bounds what a platform timeout kill
    // can strand: the pre-consume segment above (capture, compare, gap
    // persist) is the only work that can be killed with the record still
    // live, and the belt-and-braces catch below closes the record if it
    // throws — a kill after the consume loses only this call's block/touch,
    // never the session's attribution.
    const consumed = store.consume(sessionId, toolUseId, post);
    if (consumed === null) return { kind: 'done', additionalContext: null, excludedPaths };
  } catch (err) {
    // Belt-and-braces: an unexpected throw in the pre-consume segment
    // (capture, compare, gap persist) must still close the record window — an
    // unconsumed record poisons every later attribution on the repo. The
    // failure gap lands on the record before the consume so a later ambiguity
    // read treats this consumed sibling as coverage-unknowable (fail closed),
    // never as "consumed without changing P".
    const failureGap = `snapshot compare aborted: ${String(err)}`;
    logger.warn(`git-span ${failureGap}`);
    appendRecordGap(sessionId, toolUseId, [failureGap], logger);
    store.consume(sessionId, toolUseId, post);
    return {
      kind: 'done',
      additionalContext: `git-span: snapshot comparison aborted before attribution completed (${String(err)}); the record was consumed with a gap`,
      excludedPaths
    };
  }

  for (const [path, attribution] of compared.attributions) {
    // 1. The ambiguity table gates first — an entangled path drops whole
    // before any diff/range work. The baseline is derived from the
    // comparison's content hashes: my pre-state hash for the path (null when
    // my pre tree lacked it — a created path, or stat-only mode).
    const baseline: AmbiguityBaseline = {
      createdAt: found.createdAt,
      preHash: compared.contentHashes.get(path)?.pre ?? null
    };
    const verdict = applyAmbiguityRules(
      baseline,
      siblingsForPath(
        found,
        siblingIndex,
        path,
        siblingCache,
        siblingHashCache,
        runGit,
        budgets.postSideWallSeconds * 1000,
        logger
      ),
      path
    );
    if (verdict.ambiguous) {
      logger.warn(`git-span ambiguity: ${path} dropped (${verdict.reason})`);
      excludedPaths.add(path);
      // Transcript-visible deferral note — the model loop must see why this
      // path produced no attribution (a logger-only warn is invisible to it).
      notes.push(
        `attribution deferred: ${path} — ${verdict.reason} (session ${verdict.siblingSessionId}); not attributed`
      );
      continue;
    }

    // 2. An unfinished activity entry may still write the path — fail closed.
    const inFlight = unfinishedEntryCovering(repoRoot, path, now, budgets);
    if (inFlight !== null) {
      logger.info?.(`git-span interleaved-tool: ${path} dropped (unfinished entry ${inFlight} in flight)`);
      excludedPaths.add(path);
      interleavedDrops.push(path);
      continue;
    }

    // 3. The four-outcome consult against finished entries active in the
    // window (windowStart = now, so capture-tail entries that finished between
    // the pre capture and the compare are still evaluated). The v2 record's
    // baseline instant is the record's createdAt — the capture is one atomic
    // write-tree, so there is no per-file capture instant anymore.
    const consulted = activityEntriesCovering(repoRoot, path, now, now, budgets);
    const myPreHash = compared.contentHashes.get(path)?.pre ?? null;
    const currentHash = compared.contentHashes.get(path)?.post ?? null;
    if (consulted.some((e) => e.finishedAt !== null && e.finishedAt <= found.createdAt)) {
      // never-flag — the entry fully ended before my baseline: its change is
      // baked into my pre and can never contaminate my post-diff. Attribute
      // without a note.
    } else if (
      // Both boundary equalities must be over REAL content hashes: a
      // created/deleted path (or a stat-only degrade) has a null side, and
      // null === null is not evidence that the edit's touch covered my
      // change — it is the absence of evidence on both sides. Without the
      // non-null guard a deletion interleaved with an edit's deletion of the
      // same path skipped silently on null-postHash equality.
      myPreHash !== null &&
      currentHash !== null &&
      consulted.some((e) =>
        e.paths.some((p) => p.path === path && p.preHash === myPreHash && p.postHash === currentHash)
      )
    ) {
      // skip — the edit read my pre and its touch read my current state: its
      // change is already attributed by the edit's own touch, never silently
      // to me.
      logger.info?.(`git-span covered-by-edit: ${path} skipped (equal baselines)`);
      excludedPaths.add(path);
      continue;
    } else if (consulted.length > 0) {
      // bounded-double — the edit's segment is absorbed, my residual is
      // attributed; nothing is dropped.
      logger.info?.(`git-span absorbed-double: ${path} attributed (interleaved edit absorbed)`);
    }

    // Attribute. Renames surface the old path — the span lives on the dead
    // anchor, and the new path carries nothing.
    if (attribution.kind === 'rename') {
      scopes.push({ filePath: join(repoRoot, attribution.from), observed: { changed: [], wholeFile: true } });
      excludedPaths.add(attribution.from);
      excludedPaths.add(path);
    } else {
      const observed = attribution.kind === 'changed' ? attribution.observed : { changed: [], wholeFile: true };
      scopes.push({ filePath: join(repoRoot, path), observed });
      excludedPaths.add(path);
    }
  }

  if (interleavedDrops.length > 0) {
    notes.push(
      `attribution deferred: ${interleavedDrops.join(', ')} — an interleaved edit is still in flight; not attributed`
    );
  }

  // Wall-budget exhaustion is transcript-visible whether it struck before
  // any attribution or partway through — the user must see why attribution
  // is absent OR partial, never a silent tail of dropped paths.
  if (compared.gaps.some((g) => g.includes('post-side wall budget exhausted'))) {
    notes.push(
      scopes.length === 0
        ? 'git-span: the post-side wall budget was exhausted before any file could be attributed — no git-span block was produced'
        : `git-span: the post-side wall budget was exhausted partway — ${scopes.length} path(s) attributed, the rest dropped`
    );
  }
  // A post-side degrade under a pre tree drops ALL attribution — the same
  // transcript-visibility rule applies.
  if (compared.gaps.some((g) => g.startsWith('write-tree degraded to stat-only:'))) {
    notes.push(
      'git-span: the post-side snapshot degraded to stat-only under a pre-side tree — no comparable evidence, nothing attributed'
    );
  }

  let additionalContext: string | null = null;
  if (scopes.length > 0) {
    const baseInput: TouchInput = {
      kind: 'write',
      sessionId,
      cwd,
      filePath: scopes[0]!.filePath,
      written: ''
    };
    const output = await runTouchHook(baseInput, executors, memo, undefined, scopes);
    additionalContext = output.additionalContext;
  }
  if (notes.length > 0) {
    const noteText = notes.join('\n');
    additionalContext = additionalContext === null ? noteText : `${additionalContext}\n${noteText}`;
  }
  return { kind: 'done', additionalContext, excludedPaths };
}
