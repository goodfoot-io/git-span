/**
 * Tests for the Antigravity cross-event disk stash
 * (packages/agent-hooks/src/antigravity/stash.ts).
 *
 * Every store is exercised through the real filesystem on a temp session
 * layout: the tool-call stash's consume-once join semantics, the
 * pending-injection stash's append-order drain, and the Stop-time
 * call-scoped cleanup's trash-rename contract (memo survives, planned
 * touches and both stashes retire into the shared TTL trash).
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendPendingInjection,
  cleanupCallScopedState,
  drainPendingInjections,
  stashToolCall,
  takeToolCall
} from '../../src/antigravity/stash.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

let conversationSequence = 0;
function freshConversation(): string {
  return `agy-conv-${conversationSequence++}`;
}

describe('tool-call stash', () => {
  it('round-trips a stashed tool call keyed conversationId:stepIdx', () => {
    const conv = freshConversation();
    stashToolCall(layout, conv, 7, { name: 'run_command', args: { CommandLine: 'git status', Cwd: '/repo' } });
    expect(takeToolCall(layout, conv, 7)).toEqual({
      name: 'run_command',
      args: { CommandLine: 'git status', Cwd: '/repo' }
    });
  });

  it('a take consumes the record — the same stepIdx joins at most once', () => {
    const conv = freshConversation();
    stashToolCall(layout, conv, 1, { name: 'run_command', args: {} });
    expect(takeToolCall(layout, conv, 1)).not.toBeNull();
    expect(takeToolCall(layout, conv, 1)).toBeNull();
  });

  it('returns null for a stepIdx that was never stashed and for a foreign conversation', () => {
    const conv = freshConversation();
    stashToolCall(layout, conv, 3, { name: 'run_command', args: {} });
    expect(takeToolCall(layout, conv, 4)).toBeNull();
    expect(takeToolCall(layout, freshConversation(), 3)).toBeNull();
  });

  it('returns null for a malformed record instead of throwing', () => {
    const conv = freshConversation();
    const dir = join(layout.dir(conv), 'antigravity-tool-calls');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '9.json'), 'not json');
    writeFileSync(join(dir, '10.json'), '{"name":42,"args":{}}');
    writeFileSync(join(dir, '11.json'), '{"name":"run_command","args":[]}');
    expect(takeToolCall(layout, conv, 9)).toBeNull();
    expect(takeToolCall(layout, conv, 10)).toBeNull();
    expect(takeToolCall(layout, conv, 11)).toBeNull();
  });
});

describe('pending-injection stash', () => {
  it('drains appended blocks in append order and empties the stash', () => {
    const conv = freshConversation();
    appendPendingInjection(layout, conv, 'first\n');
    appendPendingInjection(layout, conv, 'second\n');
    appendPendingInjection(layout, conv, 'third\n');
    expect(drainPendingInjections(layout, conv)).toEqual(['first\n', 'second\n', 'third\n']);
    expect(drainPendingInjections(layout, conv)).toEqual([]);
  });

  it('returns an empty list when nothing was ever appended', () => {
    expect(drainPendingInjections(layout, freshConversation())).toEqual([]);
  });

  it('is scoped per conversation', () => {
    const mine = freshConversation();
    const theirs = freshConversation();
    appendPendingInjection(layout, mine, 'mine');
    appendPendingInjection(layout, theirs, 'theirs');
    expect(drainPendingInjections(layout, mine)).toEqual(['mine']);
    expect(drainPendingInjections(layout, theirs)).toEqual(['theirs']);
  });
});

describe('cleanupCallScopedState', () => {
  it('retires planned touches and both stashes into the shared trash but leaves the memo file', () => {
    const conv = freshConversation();
    stashToolCall(layout, conv, 1, { name: 'run_command', args: {} });
    appendPendingInjection(layout, conv, 'undrained');
    mkdirSync(layout.plannedTouchesDir(conv), { recursive: true });
    writeFileSync(join(layout.plannedTouchesDir(conv), 'p.json'), '{}');
    writeFileSync(layout.memoFile(conv), '{"surfaced":[]}');

    cleanupCallScopedState(layout, conv);

    expect(existsSync(layout.plannedTouchesDir(conv))).toBe(false);
    expect(takeToolCall(layout, conv, 1)).toBeNull();
    expect(drainPendingInjections(layout, conv)).toEqual([]);
    // The surfaced-span memo survives Stop: Antigravity's Stop is a
    // turn-like execution-loop boundary, and pruning the memo would make
    // identical spans re-inject every turn.
    expect(existsSync(layout.memoFile(conv))).toBe(true);
    // The retired directories carry the shared trash marker, so the existing
    // TTL sweep collects them without a sweeper of its own.
    const trashed = readdirSync(layout.trashDir);
    expect(trashed.length).toBe(3);
    for (const name of trashed) expect(name).toContain('.trash-session-');
  });

  it('is a no-op when nothing call-scoped exists', () => {
    expect(() => cleanupCallScopedState(layout, freshConversation())).not.toThrow();
  });
});
