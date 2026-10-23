import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHandler } from '../../src/claude/post-tool-use.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import { guidanceClaims } from '../guidance-helpers.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

describe('Claude visible read extent and discovery', () => {
  it('delivers the complete short discovery notice once and scopes later targeted reads', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const file = join(repo.root, 'app.ts');
      writeFileSync(file, 'line\n'.repeat(13000));
      execFileSync('git', ['add', 'app.ts'], { cwd: repo.root });
      let saved = new Set<string>();
      const memo: MemoStore = {
        claimGuidance: guidanceClaims(),
        getSurfaced: () => new Set(saved),
        addSurfaced: (_sid, names, known) => {
          saved = new Set([...known, ...names]);
        }
      };
      const executors = contextExecutors({
        fix: async () => ({ modified: false }),
        list: async () => [{ name: 'late/contract', path: 'app.ts', start: 12000, end: 12010 }],
        drift: async () => [],
        why: async () => 'The late boundary must preserve its consumer contract.'
      });
      const handler = createHandler(executors, () => memo, temp.layout);
      const base = {
        hook_event_name: 'PostToolUse',
        session_id: 's',
        transcript_path: '/tmp/root-transcript',
        cwd: repo.root,
        tool_name: 'Read',
        tool_use_id: 'read'
      };
      const ctx = { logger: { warn: () => undefined } };
      const broad = await handler(
        {
          ...base,
          tool_input: { file_path: file },
          tool_response: { file: { startLine: 1, numLines: 2000, totalLines: 13000 } }
        } as never,
        ctx as never
      );
      expect(broad?.stdout.hookSpecificOutput?.additionalContext).toContain('app.ts is anchored in: late/contract');
      expect(saved.size).toBe(1);
      const targeted = await handler(
        {
          ...base,
          tool_input: { file_path: file, offset: 12000, limit: 11 },
          tool_response: { file: { startLine: 12000, numLines: 11, totalLines: 13000 } }
        } as never,
        ctx as never
      );
      expect(targeted).toBeNull();
      expect(saved.size).toBe(1);
      // Same targeted request was truncated before the late anchor: outside the actual visible range.
      saved = new Set();
      const truncated = await handler(
        {
          ...base,
          tool_input: { file_path: file, offset: 11900, limit: 200 },
          tool_response: { file: { startLine: 11900, numLines: 50, totalLines: 13000 } }
        } as never,
        ctx as never
      );
      expect(truncated).toBeNull();
      expect(saved.size).toBe(0);
    } finally {
      repo.cleanup();
      temp.cleanup();
    }
  });
});
