/**
 * Claude PostToolUse touch hook — heal + surface after a successful
 * `Read`/`Edit`/`Write`, or a `Bash` call.
 *
 * Fires after a successful `Read`/`Edit`/`Write`, or a `Bash` call. The
 * Claude-specific job is translating the structured `tool_input`
 * (`file_path`, `new_string`/`content`, `offset`/`limit`) and `tool_name` into
 * a harness-agnostic {@link TouchInput}, then handing off to the shared
 * {@link runTouchHook} core: on a write it heals
 * positional span drift in the working tree (`git span drift <file> --fix`) and
 * folds any semantic residue into one `<git-span>` block; on a read it surfaces
 * spans overlapping the read's `offset`/`limit` window (whole-file when neither
 * is given) with positional statuses filtered out, and never mutates the tree.
 *
 * A `Bash` call is snapshot-first: when the snapshot classifier decides a
 * pre-walk record should exist for the command, the record's pre/post
 * comparison is authoritative — exact post-state ranges for changed files,
 * whole-file scopes for creates/deletes/renames, interleaved-edit resolution
 * against the activity log, and the concurrency ambiguity table — and the
 * static-parse path runs only as a co-parser for spans the snapshot did not
 * cover (its paths are skipped when the comparison attributed or dropped
 * them). When no record exists (the pre-walk failed open, or the classifier
 * says the command is read-only or statically covered), the static path stays
 * authoritative and byte-identical to Phase 1.
 *
 * The block reaches the model loop via `hookSpecificOutput.additionalContext` and
 * the user-facing UI via `systemMessage`. Fail-open is load-bearing: an absent
 * CLI/`.span/`, timeout, or non-zero exit yields no signal and never blocks the
 * tool call. The timeout is milliseconds here (the Claude CLI emits ms into
 * `hooks.json`); Codex's equivalent source value is divided to seconds at emit.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type HookContext,
  type PostToolUseInput,
  postToolUseHook,
  postToolUseOutput
} from '@goodfoot/claude-code-hooks';
import { derivePath, queueRoot, resolveRepoRoot, sanitizeSessionId, sessionDir } from '../common/agent-hooks-common.js';
import { parseCommandDetailed, type ResolvedSpan } from '../common/parse-command.js';
import {
  applyAmbiguityRules,
  classifyCommandForSnapshot,
  compareSnapshot,
  type ReadFile,
  type SiblingSnapshot,
  type SnapshotBudgets,
  type SnapshotFile,
  type SnapshotRecord,
  type StatFile
} from '../common/snapshot-core.js';
import {
  type ActivityEntry,
  activityEntriesCovering,
  createSnapshotStore,
  finishActivityEntry,
  type SnapshotStore
} from '../common/snapshot-store.js';
import {
  type CoreLogger,
  createDiskMemoStore,
  type MemoFactory,
  type MemoStore,
  resolveTouchScope
} from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  type ObservedWriteScope,
  runTouchHook,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';
import { narrowCommand, resolveSnapshotBudgets, walkSnapshotFiles } from './snapshot.js';

type ToolInput = Record<string, unknown>;

/** Read a `ToolInput` field as a positive integer, or `undefined` when absent/invalid. */
function positiveIntField(toolInput: ToolInput, field: string): number | undefined {
  const raw = toolInput[field];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

/**
 * Translate a Claude tool call into a {@link TouchInput}. `Read` is a read touch
 * carrying its `offset`/`limit` (when present) for range-precise scoping;
 * `Edit`/`Write` are write touches whose `written` block is the new content the
 * tool just applied (`new_string` for Edit, `content` for Write). An unknown tool
 * or a non-string content field yields `null` (nothing to do).
 */
function toTouchInput(
  toolName: string,
  toolInput: ToolInput,
  sessionId: string,
  cwd: string,
  filePath: string
): TouchInput | null {
  if (toolName === 'Read') {
    const offset = positiveIntField(toolInput, 'offset');
    const limit = positiveIntField(toolInput, 'limit');
    return { kind: 'read', sessionId, cwd, filePath, offset, limit };
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const raw = toolName === 'Edit' ? toolInput.new_string : toolInput.content;
    const written = typeof raw === 'string' ? raw : '';
    // The Edit/Write path passes 'exists' — the tool ran, so the file is
    // present; the write gate (plan §3 step 1) verifies it before any
    // executor call.
    return { kind: 'write', sessionId, cwd, filePath, written, targetState: 'exists' };
  }
  return null;
}

/** sha256 hex of a file's bytes, or null when the read fails. */
function hashOfFile(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

/** The empty exclude set — the static co-parser's default when no snapshot ran. */
const EMPTY_PATHS: ReadonlySet<string> = new Set();

/**
 * The static-parse Bash path, extracted so the snapshot branch can co-run it:
 * parse the command and translate every resolved span into a touch through the
 * same shared core. `excludedPaths` (repo-relative) are skipped — paths the
 * snapshot comparison already attributed or dropped must not be surfaced twice.
 * With the empty set this is byte-identical to Phase 1's standalone Bash loop.
 */
async function runStaticParseTouches(
  command: string,
  cwd: string,
  sessionId: string,
  executors: TouchExecutors,
  memo: MemoStore,
  excludedPaths: ReadonlySet<string> = EMPTY_PATHS
): Promise<string[]> {
  const blocks: string[] = [];
  const matches = parseCommandDetailed(command, { cwd });
  for (const match of matches) {
    if (match.status !== 'resolved') continue;
    const span: ResolvedSpan = match.span;
    const scope = resolveTouchScope(cwd, span.absolutePath);
    if (!scope) continue;
    if (excludedPaths.has(scope.repoRelPath)) continue;
    let touch: TouchInput;
    if (match.idiom === 'heredoc-write') {
      // `>` overwrites: whole-file scope so deleted spans beyond the new
      // EOF are surfaced. `>>` appends: narrow to the appended lines.
      const written = span.redirect === '>' ? '' : (span.body ?? '');
      touch = { kind: 'write', sessionId, cwd, filePath: span.absolutePath, written };
    } else {
      touch = {
        kind: 'read',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit: span.lineEnd - span.lineStart + 1
      };
    }
    const output = await runTouchHook(touch, executors, memo);
    if (output.additionalContext) blocks.push(output.additionalContext);
  }
  return blocks;
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

/** Injected stat over a repo-relative path: null when absent or unstat-able. */
function statRelative(repoRoot: string): StatFile {
  return (rel) => {
    try {
      const st = statSync(join(repoRoot, rel));
      // The runtime's Stats lacks `mtimeNs`, so ns is derived from mtimeMs
      // (truncated: BigInt refuses fractional values). The zero sub-ms part
      // reads as a second-granularity clock to the core, which never trusts
      // such a pair to prove non-change — it re-reads and hashes.
      return { size: st.size, mtimeNs: BigInt(Math.trunc(st.mtimeMs)) * 1_000_000n };
    } catch {
      return null;
    }
  };
}

/** Injected byte read over a repo-relative path: null when absent or unreadable. */
function readRelative(repoRoot: string): ReadFile {
  return (rel) => {
    try {
      return readFileSync(join(repoRoot, rel));
    } catch {
      return null;
    }
  };
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
 * demanded a check. The read failure itself is also logged nowhere else, so
 * the ambiguity table's missing-sibling handling stays the boundary.
 */
function readSiblingRecord(
  sessionId: string,
  toolUseId: string,
  cache: Map<string, SnapshotRecord | null>
): SnapshotRecord | null {
  const key = `${sessionId}\t${toolUseId}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let record: SnapshotRecord | null = null;
  try {
    const raw = JSON.parse(
      readFileSync(join(sessionDir(sessionId), 'snapshots', `${sanitizeSessionId(toolUseId)}.json`), 'utf8')
    ) as unknown;
    if (raw !== null && typeof raw === 'object' && (raw as SnapshotRecord).version === 1) {
      record = raw as SnapshotRecord;
    }
  } catch {
    record = null;
  }
  cache.set(key, record);
  return record;
}

/**
 * Append a diagnostic to a live record's gaps so the consume that follows
 * carries it: a consumed sibling with a gap is read as coverage-unknowable by
 * later ambiguity checks (fail closed), while a consumed sibling with an
 * empty post and no gap would read as "consumed without changing P" — a false
 * clean. The record is parsed with plain JSON.parse (the store serializes
 * bigint mtimeNs as strings, so a plain round-trip preserves them) and the
 * consume's own read then revives it. Fail open: if the record cannot be
 * re-read or rewritten, the consume below still closes the window and the
 * logger warn carries the diagnostic.
 */
function appendRecordGap(sessionId: string, toolUseId: string, gap: string, logger: CoreLogger): void {
  try {
    const file = join(sessionDir(sessionId), 'snapshots', `${sanitizeSessionId(toolUseId)}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (raw === null || typeof raw !== 'object' || (raw as SnapshotRecord).version !== 1) return;
    const rec = raw as SnapshotRecord;
    if (rec.gaps.includes(gap)) return;
    rec.gaps.push(gap);
    writeFileSync(file, JSON.stringify(rec));
  } catch (err) {
    logger.warn(`git-span record-gap append failed open: ${String(err)}`);
  }
}

/**
 * The ambiguity table's sibling set for one path: every repo record except
 * mine, read directly from disk, viewed per path exactly as the core's
 * {@link SiblingSnapshot} contract defines (pre/post null when the sibling's
 * coverage excluded the path).
 */
function siblingsForPath(
  mine: SnapshotRecord,
  repoRoot: string,
  path: string,
  store: SnapshotStore,
  cache: Map<string, SnapshotRecord | null>
): SiblingSnapshot[] {
  const out: SiblingSnapshot[] = [];
  for (const entry of store.listRepoRecords(repoRoot)) {
    if (entry.sessionId === mine.sessionId && entry.toolUseId === mine.toolUseId) continue;
    const record = readSiblingRecord(entry.sessionId, entry.toolUseId, cache);
    if (record === null) continue;
    out.push({
      sessionId: record.sessionId,
      toolUseId: record.toolUseId,
      createdAt: record.createdAt,
      consumed: record.consumed,
      consumedAt: record.consumedAt,
      coverageGap: record.gaps.length > 0,
      pre: record.files[path] ?? null,
      post: record.post?.[path] ?? null
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
 * The snapshot-first Bash attribution, shared by PostToolUse and
 * PostToolUseFailure (the failure policy compares whenever a record exists —
 * `is_interrupt` gates nothing). Flow:
 *
 * 1. Find the record. A tombstone is a consumed duplicate — nothing to do. No
 *    record means the pre-walk failed open — the caller falls back to the
 *    static path (with a warning on the Post side).
 * 2. Re-walk the repo exactly like the pre side (same classifier, same walk,
 *    same budgets) and compare. The post walk is the same tier-1/tier-2 walk
 *    so the comparison sees the same scope the pre record claimed.
 * 3. Per attributed path, in order: the ambiguity table gates first (a
 *    deterministic verdict per sibling — ambiguous paths drop whole with a
 *    warn naming the reason and the conflicting call); then the unfinished
 *    activity-entry scan (an in-flight edit may still write the path — drop
 *    with an interleaved-tool note); then the four-outcome consult:
 *    never-flag (finishedAt ≤ the path's per-file capturedAt — attribute, no
 *    note), skip (the edit's pre/post hashes equal my pre/current — it is
 *    already attributed by its own touch), bounded-double (else — attribute
 *    with an absorbed-double note).
 * 4. The consume is the single-winner gate: the O_EXCL tombstone means the
 *    first consumer wins and a racing duplicate no-ops — the touch runs only
 *    after a successful consume. The post map is fail-closed evidence: every
 *    attributed path's post state — including ambiguous and skip-dropped
 *    ones — is recorded so a later sibling's ambiguity read sees the window's
 *    end state whatever the verdict here. An unexpected throw anywhere in the
 *    compare path is belt-and-braces: the record is still consumed (with the
 *    failure recorded as a gap, so later ambiguity reads treat it as
 *    coverage-unknowable) — an unconsumed record poisons every later
 *    attribution on the repo. Deferrals, budget exhaustion, and aborts are
 *    surfaced as transcript-visible notes in the block, never logger-only.
 * 5. One multi-path touch across all attributed scopes: one heal pass on the
 *    first scope's file, one repo-wide drift, per-scope surface computation.
 *    Renames surface the OLD path (the span lives on the dead anchor); the
 *    new path is excluded from the static co-parser along with every
 *    attributed and dropped path.
 */
export async function snapshotBashBranch(
  store: SnapshotStore,
  sessionId: string,
  toolUseId: string,
  cwd: string,
  command: string,
  executors: TouchExecutors,
  memo: MemoStore,
  logger: CoreLogger,
  budgets: SnapshotBudgets
): Promise<SnapshotBashOutcome> {
  const found = store.find(sessionId, toolUseId);
  if (found === 'tombstoned') return { kind: 'tombstoned', additionalContext: null, excludedPaths: new Set() };
  if (found === null) return { kind: 'no-record', additionalContext: null, excludedPaths: new Set() };

  const repoRoot = found.repoRoot;
  const now = Date.now();
  const postMap: Record<string, SnapshotFile> = {};
  const excludedPaths = new Set<string>();
  const scopes: ObservedWriteScope[] = [];
  // Transcript-visible notes for the block — deferrals, budget exhaustion,
  // and aborts are all surfaced to the model loop, never logger-only.
  const notes: string[] = [];
  const siblingCache = new Map<string, SnapshotRecord | null>();

  try {
    const plan = classifyCommandForSnapshot(command, cwd);
    const { files, gaps } = walkSnapshotFiles(repoRoot, plan.tier1Targets, budgets, now, logger);
    const post = new Map<string, SnapshotFile>(Object.entries(files));
    const compared = compareSnapshot({
      record: found,
      post,
      postGaps: gaps,
      budgets,
      stat: statRelative(repoRoot),
      read: readRelative(repoRoot),
      wallStart: now
    });
    for (const gap of compared.gaps) logger.info?.(`git-span snapshot compare: ${gap}`);

    for (const [path, attribution] of compared.attributions) {
      const postFile = post.get(path);
      // Fail-closed evidence first: whatever the verdict below, the window's end
      // state for this path is recorded on the consumed record.
      if (postFile !== undefined) postMap[path] = postFile;

      // 1. The ambiguity table gates first — an entangled path drops whole
      // before any diff/range work.
      const verdict = applyAmbiguityRules(found, siblingsForPath(found, repoRoot, path, store, siblingCache), path);
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
        continue;
      }

      // 3. The four-outcome consult against finished entries active in the
      // window (windowStart = now, so walk-tail entries that finished between
      // the pre-read and the compare are still evaluated).
      const consulted = activityEntriesCovering(repoRoot, path, now, now, budgets);
      const capturedAt = found.files[path]?.capturedAt ?? found.createdAt;
      const currentHash = postFile?.hash ?? null;
      if (consulted.some((e) => e.finishedAt !== null && e.finishedAt <= capturedAt)) {
        // never-flag — the entry fully ended before the path's per-file
        // baseline: its change is baked into my pre and can never contaminate
        // my post-diff. Attribute without a note.
      } else if (
        consulted.some((e) =>
          e.paths.some(
            (p) => p.path === path && p.preHash === (found.files[path]?.hash ?? null) && p.postHash === currentHash
          )
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

    // Budget exhaustion with zero attributions is logger-only today; the user
    // must see why no <git-span> block appeared.
    if (scopes.length === 0 && compared.gaps.some((g) => g.includes('post-side wall budget exhausted'))) {
      notes.push(
        'git-span: the post-side wall budget was exhausted before any file could be attributed — no git-span block was produced'
      );
    }
  } catch (err) {
    // Belt-and-braces: an unexpected throw in the compare path must still
    // close the record window — an unconsumed record poisons every later
    // attribution on the repo. The failure gap lands on the record before the
    // consume so a later ambiguity read treats this consumed sibling as
    // coverage-unknowable (fail closed), never as "consumed without changing
    // P".
    const failureGap = `snapshot compare aborted: ${String(err)}`;
    logger.warn(`git-span ${failureGap}`);
    appendRecordGap(sessionId, toolUseId, failureGap, logger);
    store.consume(sessionId, toolUseId, postMap);
    return {
      kind: 'done',
      additionalContext: `git-span: snapshot comparison aborted before attribution completed (${String(err)}); the record was consumed with a gap`,
      excludedPaths
    };
  }

  // Consume first: the tombstone is the single-winner gate. The loser of a
  // duplicate-delivery race no-ops and never runs the touch.
  const consumed = store.consume(sessionId, toolUseId, postMap);
  if (consumed === null) return { kind: 'done', additionalContext: null, excludedPaths };

  let additionalContext: string | null = null;
  if (scopes.length > 0) {
    const baseInput: TouchInput = {
      kind: 'write',
      sessionId,
      cwd,
      filePath: scopes[0]!.filePath,
      written: ''
    };
    const output = await runTouchHook(baseInput, executors, memo, scopes);
    additionalContext = output.additionalContext;
  }
  if (notes.length > 0) {
    const noteText = notes.join('\n');
    additionalContext = additionalContext === null ? noteText : `${additionalContext}\n${noteText}`;
  }
  return { kind: 'done', additionalContext, excludedPaths };
}

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const memo = memoFactory(ctx.logger);
    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as ToolInput;

    // Bash has no `file_path` field, so it gets its own branch: snapshot-first
    // when the classifier decides a snapshot should exist — the comparison is
    // authoritative, and the static parser co-runs only for spans the
    // snapshot did not cover (its attributed/dropped paths are skipped).
    // Without a record the static path stays authoritative, byte-identical to
    // Phase 1. A command with no recognized idiom yields no blocks and returns
    // `null` — fail-open, same as the tool path below.
    if (toolName === 'Bash') {
      const command = narrowCommand(input.tool_input);
      if (!command) return null;
      // The snapshot surface is keyed by (session_id, tool_use_id) — a post
      // event without tool_use_id can never correlate a record, so the branch
      // fails open to the static path (contract tests call this shape).
      // Transcript-visible note for a decided-but-recordless snapshot: set when
      // the snapshot branch falls back to the static path, unshifted into the
      // blocks below (declared at Bash-block scope — the static tail runs for
      // both the snapshot and non-snapshot paths).
      let attributionNote: string | null = null;
      if (input.tool_use_id && classifyCommandForSnapshot(command, cwd).decision.kind === 'snapshot') {
        // Same resolution as the pre side (env → repo config → defaults); a
        // repo-less cwd resolves null and skips the config layer only.
        const budgets = resolveSnapshotBudgets(resolveRepoRoot(cwd));
        const store = createSnapshotStore(ctx.logger, budgets);
        const outcome = await snapshotBashBranch(
          store,
          sessionId,
          input.tool_use_id,
          cwd,
          command,
          executors,
          memo,
          ctx.logger,
          budgets
        );
        if (outcome.kind === 'tombstoned') return null;
        if (outcome.kind === 'no-record') {
          // The pre-walk failed open (or never ran) — the loss is visible,
          // never silent, and the static path still runs. The note is
          // transcript-visible so the model sees WHY no snapshot attribution
          // happened — a logger-only warn is invisible to it.
          ctx.logger.warn('git-span: snapshot decided but no record exists; falling back to the static path');
          attributionNote =
            "git-span: snapshot record unavailable — this command's file writes were not snapshot-attributed; the static spans below are the only attribution";
        } else {
          const blocks: string[] = [];
          if (outcome.additionalContext) blocks.push(outcome.additionalContext);
          blocks.push(
            ...(await runStaticParseTouches(command, cwd, sessionId, executors, memo, outcome.excludedPaths))
          );
          if (blocks.length === 0) return null;
          const combined = blocks.join('');
          return postToolUseOutput({
            hookSpecificOutput: { additionalContext: combined },
            systemMessage: combined
          });
        }
      }
      const blocks = await runStaticParseTouches(command, cwd, sessionId, executors, memo);
      if (attributionNote !== null) blocks.unshift(attributionNote);
      if (blocks.length === 0) return null;
      const combined = blocks.join('');
      return postToolUseOutput({
        hookSpecificOutput: { additionalContext: combined },
        systemMessage: combined
      });
    }

    const absPath = derivePath(toolInput, cwd);
    if (!absPath) return null;

    // Bound the touch to the CWD repo (drops cross-repo, gitignored, and span
    // documents). Fail closed on an unresolvable CWD repo.
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) return null;

    const touch = toTouchInput(toolName, toolInput, sessionId, cwd, absPath);
    if (!touch) return null;

    const output = await runTouchHook(touch, executors, memo);

    // Activity-log stamp: at the end of the edit's own touch, stamp the
    // path's postHash (the on-disk state its touch read) plus finishedAt, so
    // an interleaved-edit check inside a Bash snapshot window can resolve this
    // edit's boundary. A failed read leaves postHash null — a null stamp can
    // never resolve a boundary as clean. Fail open and continue the touch path.
    if (touch.kind === 'write') {
      try {
        finishActivityEntry(scope.repoRoot, sessionId, input.tool_use_id, [
          { path: scope.repoRelPath, postHash: hashOfFile(absPath) }
        ]);
      } catch (err) {
        ctx.logger.warn('git-span activity-log stamp failed open', { err });
      }
    }

    if (!output.additionalContext) return null;

    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: output.additionalContext },
      systemMessage: output.additionalContext
    });
  };
}

export default postToolUseHook({ matcher: 'Read|Edit|Write|Bash', timeout: 10_000 }, createHandler());
