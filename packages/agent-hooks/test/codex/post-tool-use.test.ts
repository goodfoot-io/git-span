/**
 * Tests for the Codex PostToolUse hook (packages/agent-hooks/src/codex/post-tool-use.ts).
 *
 * Job A (journal): parse the confirmed apply_patch envelope into anchors and
 * append the write entries to the per-session touch journal the Stop core drains.
 * An injected `readPreEditFile` supplies pre-edit content so the parser recovers
 * a line range; a real temp git repo backs the scope resolution.
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/codex-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadPreEditFile } from '../../src/codex/apply-patch.js';
import hook, { createHandler } from '../../src/codex/post-tool-use.js';
import { type JournalEntry, journalPath, loadJournal } from '../../src/common/stop-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

const PRE_EDIT = 'alpha\nbeta\ngamma\ndelta\nepsilon\n';
const readPreEdit: ReadPreEditFile = () => PRE_EDIT;

/** Update `foo.ts` line 3 (block beta/gamma/delta → lines 2-4). */
function updateEnvelope(path = 'foo.ts'): string {
  return [
    '*** Begin Patch',
    `*** Update File: ${path}`,
    '@@',
    ' beta',
    '-gamma',
    '+GAMMA',
    ' delta',
    '*** End Patch'
  ].join('\n');
}

function addEnvelope(path = 'brand-new.ts'): string {
  return ['*** Begin Patch', `*** Add File: ${path}`, '+hello', '*** End Patch'].join('\n');
}

function postInput(sessionId: string, cwd: string, command: unknown): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: sessionId,
    cwd,
    model: 'gpt-x',
    permission_mode: 'default',
    transcript_path: '/tmp/t',
    tool_name: 'apply_patch',
    tool_input: { command },
    tool_response: {},
    tool_use_id: 'tu-1',
    turn_id: 'turn-1'
  };
}

const sids: string[] = [];
afterEach(() => {
  for (const sid of sids) {
    const p = journalPath(sid);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  sids.length = 0;
});

function sid(label: string): string {
  const id = `codex-post-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sids.push(id);
  return id;
}

describe('codex post-tool-use hook registration', () => {
  it('registers PostToolUse with matcher apply_patch', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('apply_patch');
  });
});

describe('codex post-tool-use journaling', () => {
  it('journals the parsed write anchor with a recovered range', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('write');
      const handler = createHandler(readPreEdit);
      await handler(postInput(id, repo.root, updateEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).not.toBeNull();
      expect(entries).toHaveLength(1);
      expect(entries![0].tool).toBe('apply_patch');
      expect(entries![0].path).toBe('foo.ts');
      expect(entries![0].kind).toBe('write');
      expect(entries![0].start).toBe(2);
      expect(entries![0].end).toBe(4);
      expect(entries![0].seen).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it('journals an Add File envelope as a create anchor (no range)', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('create');
      const handler = createHandler(readPreEdit);
      await handler(postInput(id, repo.root, addEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).not.toBeNull();
      expect(entries).toHaveLength(1);
      expect(entries![0].path).toBe('brand-new.ts');
      expect(entries![0].kind).toBe('create');
      expect(entries![0].start).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('journals nothing for a non-apply_patch tool_input', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('noop');
      const handler = createHandler(readPreEdit);
      await handler(
        {
          hook_event_name: 'PostToolUse',
          session_id: id,
          cwd: repo.root,
          model: 'gpt-x',
          permission_mode: 'default',
          transcript_path: '/tmp/t',
          tool_name: 'apply_patch',
          tool_input: { notCommand: 'x' },
          tool_response: {},
          tool_use_id: 'tu-1',
          turn_id: 'turn-1'
        } as never,
        { logger } as never
      );
      expect(loadJournal(id)).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});
