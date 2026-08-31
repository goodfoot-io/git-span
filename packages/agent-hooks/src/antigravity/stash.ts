/**
 * Disk-backed cross-event stash for the Antigravity adapters.
 *
 * Antigravity runs every hook as a fresh subprocess, so *all* state joined
 * across events must live on disk — the in-memory OpenCode stash shape does
 * not transfer. Two stores, both under the session directory the shared
 * {@link SessionLayout} already owns (`layout.dir(conversationId)`), so the
 * existing retention machinery (30-day prune, trash-rename TTL) covers them
 * with no new sweep:
 *
 * - **Tool-call stash** (`antigravity-tool-calls/<stepIdx>.json`): the
 *   PreToolUse handler records `toolCall{name,args}` keyed
 *   `conversationId:stepIdx`; the paired PostToolUse handler — whose input
 *   carries only `stepIdx` and an optional `error` — takes it to recover the
 *   tool identity and arguments the host withholds. Single-consumer: a take
 *   unlinks the record.
 * - **Pending-injection stash** (`antigravity-pending-injections/`): rendered
 *   `<git-span>` blocks and allow-with-report advisories accumulate here
 *   keyed `conversationId` (one file per block, filenames ordered by append
 *   time), because neither PreToolUse-allow nor PostToolUse has a message
 *   channel. The PostInvocation handler drains them into one
 *   `ephemeralMessage` per invocation.
 *
 * Everything here is fail-open: a stash that cannot be written loses one
 * block or one join, never the tool call.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { SESSION_TRASH_MARKER, type SessionLayout } from '../common/agent-hooks-common.js';

/** The stashed slice of a PreToolUse `toolCall` — exactly what the join needs. */
export interface StashedToolCall {
  name: string;
  args: Record<string, unknown>;
}

function toolCallDir(layout: SessionLayout, conversationId: string): string {
  return nodePath.join(layout.dir(conversationId), 'antigravity-tool-calls');
}

function pendingInjectionsDir(layout: SessionLayout, conversationId: string): string {
  return nodePath.join(layout.dir(conversationId), 'antigravity-pending-injections');
}

/**
 * Write `content` to `target` atomically: a temp file in the same directory,
 * then a rename, so a concurrent reader never observes a half-written record.
 */
function writeAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

/** Stash one PreToolUse `toolCall` keyed `conversationId:stepIdx`. */
export function stashToolCall(
  layout: SessionLayout,
  conversationId: string,
  stepIdx: number,
  toolCall: StashedToolCall
): void {
  const dir = toolCallDir(layout, conversationId);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(
    nodePath.join(dir, `${stepIdx}.json`),
    `${JSON.stringify({ name: toolCall.name, args: toolCall.args })}\n`
  );
}

/**
 * Retrieve and consume the stashed tool call for `conversationId:stepIdx`.
 * Returns `null` when nothing was stashed (the tool was denied before running,
 * the stash write failed, or the record is malformed) — the caller then has no
 * command to attribute and must no-op.
 */
export function takeToolCall(layout: SessionLayout, conversationId: string, stepIdx: number): StashedToolCall | null {
  const file = nodePath.join(toolCallDir(layout, conversationId), `${stepIdx}.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    fs.unlinkSync(file);
  } catch (err) {
    // Consumption is best-effort; a lingering record for this stepIdx can
    // never be joined again (stepIdx is monotonic per conversation) and is
    // swept with the rest of the call-scoped state.
    void err;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== 'string') return null;
    const args = record.args;
    if (args === null || typeof args !== 'object' || Array.isArray(args)) return null;
    return { name: record.name, args: args as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * In-process append counter for pending-injection filenames. One handler can
 * append several blocks in the same millisecond (the PostToolUse join loops
 * over its rendered blocks), so the timestamp alone cannot order them; a
 * monotonic sequence per process breaks the tie deterministically.
 */
let appendSequence = 0;

/**
 * Append one rendered block to the conversation's pending-injection stash.
 * Filenames are zero-padded epoch millis, pid, an in-process sequence, and a
 * random suffix, so a lexicographic sort reproduces append order both across
 * the fresh subprocesses each hook runs in and within one handler process.
 */
export function appendPendingInjection(layout: SessionLayout, conversationId: string, block: string): void {
  const dir = pendingInjectionsDir(layout, conversationId);
  fs.mkdirSync(dir, { recursive: true });
  appendSequence += 1;
  const sequence = String(appendSequence).padStart(6, '0');
  const name = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${sequence}-${randomBytes(3).toString('hex')}.txt`;
  writeAtomic(nodePath.join(dir, name), block);
}

/** Drain every pending injection for the conversation, in append order. */
export function drainPendingInjections(layout: SessionLayout, conversationId: string): string[] {
  const dir = pendingInjectionsDir(layout, conversationId);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.txt'));
  } catch {
    return [];
  }
  names.sort();
  const blocks: string[] = [];
  for (const name of names) {
    const file = nodePath.join(dir, name);
    try {
      blocks.push(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
    } catch (err) {
      // A block that cannot be read or unlinked is dropped from this drain;
      // an unlink failure at worst re-delivers it on the next invocation.
      void err;
    }
  }
  return blocks;
}

/**
 * Retire the conversation's *call-scoped* state at Stop: the planned-touch
 * store, the tool-call stash, and any undrained pending injections. The
 * surfaced-span memo (`touch-memo.json`) deliberately survives — Antigravity's
 * Stop is an execution-loop boundary closer to a turn than a session end, and
 * pruning the memo there would make identical spans re-inject every turn
 * (the OpenCode decision-8 finding); the layout's 30-day TTL sweep collects
 * it with the rest of the session directory.
 *
 * Each directory is renamed into the layout's trash (never recursively
 * unlinked in place, matching `cleanupSessionState`'s reader-safety doctrine)
 * where the shared TTL pass removes it.
 */
export function cleanupCallScopedState(layout: SessionLayout, conversationId: string, now: number = Date.now()): void {
  const targets = [
    layout.plannedTouchesDir(conversationId),
    toolCallDir(layout, conversationId),
    pendingInjectionsDir(layout, conversationId)
  ];
  for (const dirPath of targets) {
    try {
      fs.mkdirSync(layout.trashDir, { recursive: true, mode: 0o700 });
      const trashPath = nodePath.join(
        layout.trashDir,
        `${nodePath.basename(dirPath)}${SESSION_TRASH_MARKER}${process.pid}-${now.toString(36)}-${randomBytes(2).toString('hex')}`
      );
      fs.renameSync(dirPath, trashPath);
      fs.utimesSync(trashPath, now / 1000, now / 1000);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
