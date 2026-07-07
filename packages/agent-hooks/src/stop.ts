/**
 * Stop hook: reads the per-session touch journal, writes a pre-commit record
 * to the shared queue under <git-common-dir>/git-mesh/pre-commit/, marks the
 * journal entries seen, and returns null — the stop proceeds.
 *
 * All downstream work (drift detection, mesh reconciliation) is handled by a
 * detached background dispatcher that picks up pre-commit records (Phase 3+).
 *
 * The `stop_hook_active` guard at the top of the handler short-circuits a
 * re-fired stop (the run that dispatched already marked its entries seen, so a
 * re-fire would assemble nothing — this is the explicit guard).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { type HookContext, type StopInput, stopHook } from '@goodfoot/claude-code-hooks';
import {
  type AnchorSpec,
  writePreCommitRecord as defaultWritePreCommitRecord,
  type LineRange,
  type PreCommitRecord,
  readSubagentCount,
  resolveRepoRoot,
  sanitizeSessionId,
  type TouchKind
} from './agent-hooks-common.js';
import type { HookIgnoreLoader } from './mesh-ignore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JournalEntry {
  tool: string;
  path: string;
  kind: TouchKind;
  seen: boolean;
  start?: number;
  end?: number;
}

// ---------------------------------------------------------------------------
// Journal I/O
// ---------------------------------------------------------------------------

const JOURNAL_BASE_DIR = nodePath.join(os.homedir(), '.cache', 'git-mesh', 'session');

export function journalDir(sessionId: string): string {
  return nodePath.join(JOURNAL_BASE_DIR, sanitizeSessionId(sessionId));
}

export function journalPath(sessionId: string): string {
  return nodePath.join(journalDir(sessionId), 'touches.jsonl');
}

/** The set of valid current TouchKind values. Any other string is rejected. */
const VALID_TOUCH_KINDS: ReadonlySet<string> = new Set<string>([
  'read',
  'write',
  'whole-read',
  'whole-write',
  'create'
]);

export function loadJournal(sessionId: string): JournalEntry[] | null {
  const path = journalPath(sessionId);
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const entries: JournalEntry[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as JournalEntry;
      if (typeof e.path === 'string' && typeof e.kind === 'string' && VALID_TOUCH_KINDS.has(e.kind)) {
        entries.push(e);
      }
    } catch (_) {
      // unparseable line — skip
      void _;
    }
  }
  return entries.length === 0 ? null : entries;
}

export function writeJournal(
  sessionId: string,
  entries: JournalEntry[],
  logger: Pick<HookContext['logger'], 'warn'>
): void {
  const path = journalPath(sessionId);
  const tmpPath = `${path}.tmp`;
  try {
    const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, path);
  } catch (err) {
    logger.warn('journal rewrite failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Anchor building
// ---------------------------------------------------------------------------

/**
 * Build deduplicated anchor specs from journal entries.
 * Groups by (path, kind); for ranged kinds union all ranges.
 * Order: stable by first appearance.
 */
export function buildAnchorSpecs(entries: JournalEntry[]): AnchorSpec[] {
  // key: `${kind}:${path}`
  const order: string[] = [];
  const ranged = new Map<string, LineRange>(); // for read/write kinds
  const whole = new Set<string>(); // for whole-read/whole-write/create kinds

  for (const e of entries) {
    const key = `${e.kind}:${e.path}`;
    if (e.kind === 'read' || e.kind === 'write') {
      if (e.start !== undefined && e.end !== undefined) {
        const existing = ranged.get(key);
        if (existing) {
          existing.start = Math.min(existing.start, e.start);
          existing.end = Math.max(existing.end, e.end);
        } else {
          if (!order.includes(key)) order.push(key);
          ranged.set(key, { start: e.start, end: e.end });
        }
      }
    } else {
      // whole-read, whole-write, or create
      if (!whole.has(key)) {
        whole.add(key);
        if (!order.includes(key)) order.push(key);
      }
    }
  }

  return order.map((key) => {
    const colonIdx = key.indexOf(':');
    const kind = key.slice(0, colonIdx) as TouchKind;
    const path = key.slice(colonIdx + 1);
    if (kind === 'read' || kind === 'write') {
      return { path, kind, range: ranged.get(key) };
    }
    return { path, kind };
  });
}

// ---------------------------------------------------------------------------
// Pre-commit record writer type
// ---------------------------------------------------------------------------

/**
 * Injectable writer for pre-commit records. The default implementation writes
 * to the shared queue under <git-common-dir>/git-mesh/pre-commit/.
 */
export type PreCommitRecordWriter = (repoRoot: string, record: PreCommitRecord) => void;

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

export interface StopHandlerDeps {
  /** Load path-scoped mesh suppression rules. */
  loadRules?: HookIgnoreLoader;
  /** Write a pre-commit record to the queue. Defaults to writePreCommitRecord. */
  writeRecord?: PreCommitRecordWriter;
}

export function createStopHandler(deps: StopHandlerDeps) {
  const writeRecord = deps.writeRecord ?? defaultWritePreCommitRecord;

  return (input: StopInput, ctx: HookContext) => {
    const sessionId = input.session_id;

    // Step 0: Break the stop loop. When the agent tries to stop again this
    // hook re-fires with `stop_hook_active = true`; allow that stop outright.
    // (Reported entries are also marked seen below, so a re-fire would have no
    // new entries to write — this is the explicit guard.)
    const stopHookActive = (input as unknown as Record<string, unknown>).stop_hook_active;
    if (stopHookActive === true) return null;

    // Step 0.5: Suppress while subagents are in flight. The journal may still
    // be changing under them.
    let activeSubagents: number;
    try {
      activeSubagents = readSubagentCount(sessionId);
    } catch {
      return null;
    }
    if (activeSubagents > 0) return null;

    // Step 1: Load journal
    const entries = loadJournal(sessionId);
    if (!entries) return null;

    // Step 2: Resolve repo root.
    // Primary: input.cwd (present in most Stop events).
    // Fallback 1: process.cwd() (the hook process's own working directory).
    // Fallback 2: for each journal entry, try that directory — useful when the
    //   hook is invoked from outside the repo but journal paths hint at locations.
    let repoRoot: string | null = null;
    const cwdField = (input as unknown as Record<string, unknown>).cwd;
    if (typeof cwdField === 'string' && cwdField.length > 0) {
      repoRoot = resolveRepoRoot(cwdField);
    }
    if (!repoRoot) {
      repoRoot = resolveRepoRoot(process.cwd());
    }
    if (!repoRoot) {
      for (const e of entries) {
        const candidate = nodePath.resolve(process.cwd(), nodePath.dirname(e.path));
        repoRoot = resolveRepoRoot(candidate);
        if (repoRoot) break;
      }
    }
    if (!repoRoot) return null;

    const finalRepoRoot = repoRoot;

    // Step 3: Build anchor specs from unreported write-kind entries.
    // Only written anchors (write, create, whole-write) produce pre-commit
    // records — reads (read, whole-read) do not. The whole unreported batch
    // is still marked seen in Step 5 so reads don't re-fire endlessly.
    const unreportedEntries = entries.filter((e) => !e.seen);
    const isWriteKind = (kind: TouchKind): boolean => kind === 'write' || kind === 'create' || kind === 'whole-write';
    const anchorSpecs = buildAnchorSpecs(unreportedEntries.filter((e) => isWriteKind(e.kind)));

    if (anchorSpecs.length === 0) {
      // Read-only session: no writes to record. Mark all unreported entries
      // seen so a later Stop does not re-examine them, then exit silently.
      for (const e of unreportedEntries) {
        e.seen = true;
      }
      writeJournal(sessionId, entries, ctx.logger);
      return null;
    }

    // Step 4: Write the pre-commit record for the background dispatcher.
    const record: PreCommitRecord = {
      anchors: anchorSpecs,
      created_at: new Date().toISOString()
    };
    try {
      writeRecord(finalRepoRoot, record);
    } catch (err) {
      ctx.logger.warn('failed to write pre-commit record', { err });
      // Don't suppress seen-marking — a journal-only session is better than a
      // re-dispatch loop on a persistently failing queue.
    }

    // Step 5: Mark all processed entries seen so a later Stop with no new
    // touches produces no record and exits silently.
    for (const e of unreportedEntries) {
      e.seen = true;
    }

    // Step 6: Rewrite journal with updated seen flags.
    writeJournal(sessionId, entries, ctx.logger);

    // Step 7: Return null — the stop proceeds. All downstream work happens in
    // the background dispatcher (Phase 3+).
    return null;
  };
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default stopHook({ timeout: 30_000 }, createStopHandler({}));
