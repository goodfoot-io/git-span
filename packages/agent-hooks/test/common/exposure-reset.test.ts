import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createHandler as claudeStart } from '../../src/claude/session-start.js';
import { createHandler as codexStart } from '../../src/codex/session-start.js';
import type { WarmupSpawner } from '../../src/common/context-warmup.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { makeTempLayout } from '../session-layout-helpers.js';

describe('trusted host exposure lifecycle', () => {
  it.each(['compact', 'resume', 'clear', 'startup'] as const)(
    'resets memo, keeps plans, and warms on %s for both hosts',
    async (source) => {
      const temp = makeTempLayout();
      try {
        const logger = { warn: vi.fn() };
        const spawn = vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() })) as unknown as WarmupSpawner;
        const input = {
          hook_event_name: 'SessionStart',
          session_id: 's',
          transcript_path: '/tmp/t',
          cwd: '/tmp',
          source,
          permission_mode: 'default'
        };
        for (const handler of [claudeStart(spawn, temp.layout), codexStart(spawn, temp.layout)]) {
          createDiskMemoStore(logger, temp.layout).addSurfaced('s', ['some-exposure'], new Set());
          mkdirSync(temp.layout.plannedTouchesDir('s'), { recursive: true });
          const plan = temp.layout.plannedTouchRecordFile('s', 'tool');
          writeFileSync(plan, '{}');
          await handler(input as never, { logger } as never);
          expect(existsSync(temp.layout.memoFile('s'))).toBe(false);
          expect(existsSync(plan)).toBe(true);
        }
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(logger.warn).not.toHaveBeenCalled();
      } finally {
        temp.cleanup();
      }
    }
  );
});

it('fences an in-flight writer to its captured obsolete epoch', async () => {
  const temp = makeTempLayout();
  try {
    const logger = { warn: vi.fn() };
    const store = createDiskMemoStore(logger, temp.layout);
    store.addSurfaced('s', ['before-reset'], new Set());
    const captured = store.getSurfaced('s');
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() })) as unknown as WarmupSpawner;
    await claudeStart(spawn, temp.layout)(
      {
        hook_event_name: 'SessionStart',
        session_id: 's',
        transcript_path: '/tmp/t',
        cwd: '/tmp',
        source: 'compact'
      } as never,
      { logger } as never
    );
    store.addSurfaced('s', ['late-old-write'], captured);
    expect(createDiskMemoStore(logger, temp.layout).getSurfaced('s')).toEqual(new Set());
    const after = createDiskMemoStore(logger, temp.layout);
    const fresh = after.getSurfaced('s');
    after.addSurfaced('s', ['new-context'], fresh);
    store.addSurfaced('s', ['another-old-write'], captured);
    expect(createDiskMemoStore(logger, temp.layout).getSurfaced('s')).toEqual(new Set(['new-context']));
  } finally {
    temp.cleanup();
  }
});
