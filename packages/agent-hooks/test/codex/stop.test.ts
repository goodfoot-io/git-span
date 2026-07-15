/**
 * Tests for the Codex Stop hook (packages/agent-hooks/src/codex/stop.ts).
 *
 * The drain logic is the shared Stop/journal core (covered by test/claude/stop.test.ts);
 * these tests exercise the actual Codex entry point end-to-end against a real temp
 * git repo and the real pre-commit queue — no mocks. They confirm the Codex
 * wrapper reads `session_id`/`cwd`/`stop_hook_active`, drains a write journal into
 * a `PreCommitRecord`, and returns a normalized-empty result (the core's `null`
 * coerced to `undefined`, which the SDK renders as valid empty JSON).
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { Logger } from '@goodfoot/codex-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import hook from '../../src/codex/stop.js';
import { preCommitDir } from '../../src/common/agent-hooks-common.js';
import { type JournalEntry, journalPath } from '../../src/common/stop-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

function stopInput(sessionId: string, cwd: string, stopHookActive = false): Record<string, unknown> {
  return {
    hook_event_name: 'Stop' as const,
    session_id: sessionId,
    cwd,
    model: 'gpt-x',
    permission_mode: 'default',
    transcript_path: '/tmp/t.jsonl',
    last_assistant_message: null,
    stop_hook_active: stopHookActive,
    turn_id: 'turn-1'
  };
}

function writeJournalRaw(sessionId: string, entries: JournalEntry[]): void {
  const dir = nodePath.dirname(journalPath(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(journalPath(sessionId), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
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
  const id = `codex-stop-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sids.push(id);
  return id;
}

describe('codex stop hook', () => {
  it('registers a Stop hook', () => {
    expect(hook.hookEventName).toBe('Stop');
  });

  it('drains a write journal into a pre-commit record and returns empty (undefined)', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('drain');
      writeJournalRaw(id, [{ tool: 'apply_patch', path: 'src/foo.ts', kind: 'write', seen: false, start: 4, end: 6 }]);

      const result = await hook(stopInput(id, repo.root) as never, { logger } as never);
      // The core returns null; the Codex wrapper coerces it to undefined so the
      // SDK renders valid empty JSON (Codex's exit-0-must-be-JSON rule).
      expect(result).toBeUndefined();

      // A pre-commit record was written to the real queue for the touched write.
      const dir = preCommitDir(repo.root);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
      expect(files).toHaveLength(1);
      const record = JSON.parse(fs.readFileSync(nodePath.join(dir, files[0]), 'utf8')) as {
        anchors: Array<{ path: string; kind: string; range?: { start: number; end: number } }>;
      };
      expect(record.anchors).toHaveLength(1);
      expect(record.anchors[0].path).toBe('src/foo.ts');
      expect(record.anchors[0].kind).toBe('write');
      expect(record.anchors[0].range).toEqual({ start: 4, end: 6 });

      // The journal entry is marked seen.
      const updated = fs
        .readFileSync(journalPath(id), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as JournalEntry);
      expect(updated[0].seen).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('re-fired stop (stop_hook_active) writes no record', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('refire');
      writeJournalRaw(id, [{ tool: 'apply_patch', path: 'src/foo.ts', kind: 'write', seen: false, start: 1, end: 2 }]);

      const result = await hook(stopInput(id, repo.root, true) as never, { logger } as never);
      expect(result).toBeUndefined();

      const dir = preCommitDir(repo.root);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
      expect(files).toHaveLength(0);
    } finally {
      repo.cleanup();
    }
  });
});
