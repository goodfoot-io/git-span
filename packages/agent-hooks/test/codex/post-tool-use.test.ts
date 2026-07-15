/**
 * Tests for the Codex PostToolUse hook (packages/agent-hooks/src/codex/post-tool-use.ts).
 *
 * Job A (journal): parse the confirmed apply_patch envelope into anchors and
 * append the write entries to the per-session touch journal the Stop core drains.
 * Two fail-closed invariants are exercised against real timing semantics (no
 * injected reader): journaling happens only on a confirmed-success `tool_response`,
 * and every anchor is whole-file (no post-edit range recovery). A real temp git
 * repo backs the scope resolution.
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/codex-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import hook, { applyPatchSucceeded, createHandler } from '../../src/codex/post-tool-use.js';
import { type JournalEntry, journalPath, loadJournal } from '../../src/common/stop-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

/** apply_patch's stdout on a confirmed apply — Codex surfaces this verbatim as tool_response. */
const SUCCESS_RESPONSE = 'Success. Updated the following files:\nM foo.ts\n';

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

function postInput(
  sessionId: string,
  cwd: string,
  command: unknown,
  toolResponse: unknown = SUCCESS_RESPONSE
): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: sessionId,
    cwd,
    model: 'gpt-x',
    permission_mode: 'default',
    transcript_path: '/tmp/t',
    tool_name: 'apply_patch',
    tool_input: { command },
    tool_response: toolResponse,
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

describe('applyPatchSucceeded', () => {
  it('accepts only the apply_patch success stdout string', () => {
    expect(applyPatchSucceeded(SUCCESS_RESPONSE)).toBe(true);
    expect(applyPatchSucceeded('Success. Updated the following files:\nA new.ts\n')).toBe(true);
    // Rejection / failure text, non-strings, and absent responses do not confirm.
    expect(applyPatchSucceeded('apply_patch verification failed: no such file')).toBe(false);
    expect(applyPatchSucceeded('')).toBe(false);
    expect(applyPatchSucceeded({})).toBe(false);
    expect(applyPatchSucceeded(undefined)).toBe(false);
    expect(applyPatchSucceeded(null)).toBe(false);
  });
});

describe('codex post-tool-use journaling', () => {
  it('journals an Update as a whole-write anchor with no range on success', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('write');
      // Write genuine (pre-edit) content: were range recovery still active at Post
      // it would read this file and coarsen/mis-anchor. We assert it does neither.
      fs.writeFileSync(`${repo.root}/foo.ts`, 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
      const handler = createHandler();
      await handler(postInput(id, repo.root, updateEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).not.toBeNull();
      expect(entries).toHaveLength(1);
      expect(entries![0].tool).toBe('apply_patch');
      expect(entries![0].path).toBe('foo.ts');
      expect(entries![0].kind).toBe('whole-write');
      expect(entries![0].start).toBeUndefined();
      expect(entries![0].end).toBeUndefined();
      expect(entries![0].seen).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it('never recovers a post-edit range, even when the real reader can read the file', async () => {
    const repo = makeTempRepo();
    const savedCwd = process.cwd();
    try {
      const id = sid('postedit');
      // Reproduce the post-edit hazard against the *real* reader: run the hook
      // from the repo so `defaultReadPreEditFile('foo.ts')` resolves and reads
      // the on-disk file. The file is already POST-edit — the hunk's pre-edit
      // block (beta/gamma/delta) no longer sits where the edit happened (now
      // beta/GAMMA/delta at lines 2-4) but an untouched duplicate remains at
      // lines 6-8. Post-edit range recovery would uniquely (and wrongly) anchor
      // that copy as write 6-8. Whole-file journaling must ignore the file.
      fs.writeFileSync(`${repo.root}/foo.ts`, 'header\nbeta\nGAMMA\ndelta\ntail\nbeta\ngamma\ndelta\n');
      process.chdir(repo.root);
      const handler = createHandler();
      await handler(postInput(id, repo.root, updateEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).toHaveLength(1);
      expect(entries![0].kind).toBe('whole-write');
      expect(entries![0].start).toBeUndefined();
      expect(entries![0].end).toBeUndefined();
    } finally {
      process.chdir(savedCwd);
      repo.cleanup();
    }
  });

  it('journals an Add File envelope as a create anchor (no range) on success', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('create');
      const handler = createHandler();
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

  it('journals nothing when tool_response does not confirm success', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('failed');
      const handler = createHandler();
      // A rejected/failed apply_patch: PostToolUse still fires, but journaling a
      // write here would be a phantom → false drift. Fail closed.
      await handler(
        postInput(id, repo.root, updateEnvelope(), 'apply_patch failed: context not found') as never,
        { logger } as never
      );
      expect(loadJournal(id)).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it('journals nothing when tool_response is absent or non-string', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('ambiguous');
      const handler = createHandler();
      await handler(postInput(id, repo.root, updateEnvelope(), {}) as never, { logger } as never);
      expect(loadJournal(id)).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it('journals nothing for a non-apply_patch tool_input', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('noop');
      const handler = createHandler();
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
          tool_response: SUCCESS_RESPONSE,
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
