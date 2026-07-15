/**
 * Harness-agnostic Stop/journal core.
 *
 * This module owns the per-session touch journal (read, write, append) and the
 * Stop-time drain that turns unreported write anchors into a `PreCommitRecord`
 * for the background dispatcher. It imports nothing from either hook SDK — the
 * Claude and Codex Stop adapters bind their SDK-typed `StopInput`/`HookContext`
 * to the minimal structural {@link StopCoreInput} / {@link StopCoreContext}
 * shapes defined here and pass them straight through.
 *
 * The `stop_hook_active` guard at the top of the handler short-circuits a
 * re-fired stop (the run that dispatched already marked its entries seen, so a
 * re-fire would assemble nothing — this is the explicit guard).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
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
import type { HookIgnoreLoader } from './span-ignore.js';

// ---------------------------------------------------------------------------
// Structural harness-agnostic input/context types
// ---------------------------------------------------------------------------

/**
 * The minimal Stop input the core reads. Both the Claude and Codex SDK
 * `StopInput` structurally satisfy this — the core imports neither SDK.
 */
export interface StopCoreInput {
  session_id: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/** Minimal logger surface the core uses; both SDK loggers satisfy it. */
export interface CoreLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/** The minimal hook context the core reads. */
export interface StopCoreContext {
  logger: CoreLogger;
}

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

const JOURNAL_BASE_DIR = nodePath.join(os.homedir(), '.cache', 'git-span', 'session');

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

export function writeJournal(sessionId: string, entries: JournalEntry[], logger: CoreLogger): void {
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

/**
 * Append touch anchors to the per-session journal — the write-kind entries the
 * Stop drain later consumes. Shared by both adapters: the Claude PreToolUse hook
 * journals reads/edits/writes as they are requested; the Codex PostToolUse hook
 * journals the confirmed `apply_patch` writes. Best-effort: a failure is logged,
 * never thrown, so journaling never blocks the edit.
 *
 * Each anchor's `path` must already be repo-relative. Only `read`/`write` kinds
 * carry a range; whole-file kinds (`whole-read`/`whole-write`/`create`) do not.
 */
export function appendTouchJournal(
  sessionId: string,
  tool: string,
  anchors: Array<{ path: string; kind: TouchKind; range?: LineRange }>,
  logger: CoreLogger
): void {
  if (anchors.length === 0) return;
  try {
    fs.mkdirSync(journalDir(sessionId), { recursive: true });
    const lines = anchors.map((a) => {
      const row: JournalEntry = { tool, path: a.path, kind: a.kind, seen: false };
      if ((a.kind === 'read' || a.kind === 'write') && a.range) {
        row.start = a.range.start;
        row.end = a.range.end;
      }
      return JSON.stringify(row);
    });
    fs.appendFileSync(journalPath(sessionId), `${lines.join('\n')}\n`, 'utf8');
  } catch (err) {
    logger.warn('journal append failed', { err });
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
 * to the shared queue under <git-common-dir>/git-span/pre-commit/.
 */
export type PreCommitRecordWriter = (repoRoot: string, record: PreCommitRecord) => void;

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

export interface StopHandlerDeps {
  /** Load path-scoped span suppression rules. */
  loadRules?: HookIgnoreLoader;
  /** Write a pre-commit record to the queue. Defaults to writePreCommitRecord. */
  writeRecord?: PreCommitRecordWriter;
}

export function createStopHandler(deps: StopHandlerDeps) {
  const writeRecord = deps.writeRecord ?? defaultWritePreCommitRecord;

  return (input: StopCoreInput, ctx: StopCoreContext): null => {
    const sessionId = input.session_id;

    // Step 0: Break the stop loop. When the agent tries to stop again this
    // hook re-fires with `stop_hook_active = true`; allow that stop outright.
    // (Reported entries are also marked seen below, so a re-fire would have no
    // new entries to write — this is the explicit guard.)
    if (input.stop_hook_active === true) return null;

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
    const cwdField = input.cwd;
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
