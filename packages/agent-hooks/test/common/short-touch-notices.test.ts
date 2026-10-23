import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHandler as codexStop } from '../../src/codex/stop.js';
import { createDiskMemoStore, type MemoStore, resetExposure } from '../../src/common/span-surface.js';
import { runTouchHooks, type TouchInput } from '../../src/common/touch-core.js';
import { guidanceClaims } from '../guidance-helpers.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

function memory(): MemoStore {
  let saved = new Set<string>();
  return {
    claimGuidance: guidanceClaims(),
    getSurfaced: () => new Set(saved),
    addSurfaced: (_session, names, known) => {
      saved = new Set([...known, ...names]);
    }
  };
}

function fixture() {
  const repo = makeTempRepo();
  writeFileSync(join(repo.root, 'app.ts'), 'one\ntwo\n');
  const input: TouchInput = { kind: 'read', sessionId: 's', cwd: repo.root, filePath: join(repo.root, 'app.ts') };
  const executors = contextExecutors({
    fix: async () => ({ modified: false }),
    list: async () => [
      { name: 'clean', path: 'app.ts', start: 1, end: 2 },
      { name: 'debt', path: 'app.ts', start: 1, end: 2 },
      { name: 'debt', path: 'peer.ts', start: 0, end: 0 }
    ],
    drift: async () => [
      { name: 'debt', path: 'app.ts', start: 1, end: 2, status: 'CHANGED' },
      { name: 'debt', path: 'peer.ts', start: 0, end: 0, status: 'IO_ERROR' }
    ],
    why: async () => 'Private explanation must never appear.'
  });
  return { repo, input, executors };
}

const anchored =
  '\n<git-span>\napp.ts is anchored in: clean\n\nUse `git span list clean` for more information\n</git-span>\n';
const drift =
  '\n<git-span>\nCheck for drift from app.ts#L1-L2 (changed in debt), peer.ts (io error in debt)\n\nUse `git span drift debt` for more information\n</git-span>\n';

describe('short touch notice contract', () => {
  it('uses both exact templates and command families for mixed clean and genuine debt', async () => {
    const { repo, input, executors } = fixture();
    try {
      const memo = memory();
      const run = async (recipientId: string) =>
        (await runTouchHooks([{ ...input, recipientId }], executors, memo, null)).outputs[0]?.additionalContext;
      expect(await run('a')).toBe(anchored + drift);
      expect(await run('a')).toBeNull();
      const next = await run('b');
      expect(next).toBe(
        anchored.replace('\n\nUse `git span list clean` for more information', '') +
          drift.replace('\n\nUse `git span drift debt` for more information', '')
      );
    } finally {
      repo.cleanup();
    }
  });

  it('recommends list for write drift and emits its guidance only once across both write blocks', async () => {
    const { repo, input, executors } = fixture();
    try {
      const result = await runTouchHooks(
        [{ ...input, kind: 'write', written: 'one\ntwo\n' }],
        executors,
        memory(),
        'write-event'
      );
      const output = result.outputs[0]?.additionalContext ?? '';
      expect(output).toContain(
        'Change introduced drift from app.ts#L1-L2 (changed in debt), peer.ts (io error in debt)'
      );
      expect(output.match(/Use `git span list/g)).toHaveLength(1);
      expect(output).not.toContain('git span drift');
    } finally {
      repo.cleanup();
    }
  });

  it('retains guidance through Codex empty Stop and exposure resets, then allows a fresh session', async () => {
    const { repo, input, executors } = fixture();
    const temp = makeTempLayout();
    const logger = { warn: () => undefined };
    try {
      const run = async (sessionId = 's') =>
        (await runTouchHooks([{ ...input, sessionId }], executors, createDiskMemoStore(logger, temp.layout), null))
          .outputs[0]?.additionalContext;
      expect(await run()).toBe(anchored + drift);
      await codexStop(temp.layout)({ session_id: 's', cwd: repo.root } as never, { logger } as never);
      expect(await run()).toBe(
        anchored.replace('\n\nUse `git span list clean` for more information', '') +
          drift.replace('\n\nUse `git span drift debt` for more information', '')
      );
      resetExposure(temp.layout, 's', logger);
      expect(await run()).toBe(
        anchored.replace('\n\nUse `git span list clean` for more information', '') +
          drift.replace('\n\nUse `git span drift debt` for more information', '')
      );
      expect(await run('fresh')).toBe(anchored + drift);
    } finally {
      repo.cleanup();
      temp.cleanup();
    }
  });

  it('does not claim guidance for positional-only results or consume it on empty output', async () => {
    const { repo, input, executors } = fixture();
    try {
      const base = executors.context;
      const positional = {
        context: async (request: Parameters<typeof base>[0]) => {
          const result = await base(request);
          if (result.ok)
            for (const span of result.document.spans)
              for (const anchor of span.anchors) anchor.status = { code: 'MOVED' };
          return result;
        }
      };
      const memo = memory();
      expect((await runTouchHooks([input], positional, memo, null)).outputs[0]?.additionalContext).toBeNull();
      expect((await runTouchHooks([input], executors, memo, null)).outputs[0]?.additionalContext).toBe(
        anchored + drift
      );
    } finally {
      repo.cleanup();
    }
  });

  it('keeps complete drift identities in bounded partitions without old prose or qualifications', async () => {
    const { repo, input } = fixture();
    try {
      const rows = Array.from({ length: 200 }, (_, index) => ({
        name: `span-${index}`,
        path: 'app.ts',
        start: 1,
        end: 2
      }));
      const executors = contextExecutors({
        fix: async () => ({ modified: false }),
        list: async () => rows,
        drift: async () => rows.map((row) => ({ ...row, status: 'CHANGED' as const })),
        why: async () => 'Do not show me.'
      });
      const output =
        (await runTouchHooks([{ ...input, broadDiscovery: true, observedRange: null }], executors, memory(), null))
          .outputs[0]?.additionalContext ?? '';
      const blocks = output.match(/<git-span>[\s\S]*?<\/git-span>/g) ?? [];
      expect(blocks.length).toBeGreaterThan(1);
      for (const block of blocks) expect(Buffer.byteLength(block)).toBeLessThanOrEqual(1536);
      for (const row of rows) expect(output).toContain(`(changed in ${row.name})`);
      expect(output.match(/Use `git span drift/g)).toHaveLength(1);
      for (const removed of [
        'Do not show me',
        'unknown',
        'incomplete',
        'relationship review',
        'Evidence revision',
        'git span show',
        'Restore agreement'
      ])
        expect(output).not.toContain(removed);
    } finally {
      repo.cleanup();
    }
  });
});

it('escapes control characters for one-line display and preserves hostile names as literal CLI arguments', async () => {
  const repo = makeTempRepo();
  try {
    const path = 'line\nbreak.ts';
    const name = "-odd'`\nname";
    writeFileSync(join(repo.root, path), 'line\n');
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name, path, start: 1, end: 1 }],
      drift: async () => [],
      why: async () => null
    });
    const input: TouchInput = { kind: 'read', cwd: repo.root, filePath: join(repo.root, path), sessionId: 'unsafe' };
    const output = (await runTouchHooks([input], executors, memory(), null)).outputs[0]?.additionalContext ?? '';
    expect(output).toContain("line\\nbreak.ts is anchored in: -odd'`\\nname");
    expect(output).toContain("git span list -- $'-odd\\'`\\u000aname'");
    expect(output.match(/<git-span>/g)).toHaveLength(1);
    expect(output.trim().split('\n')).toHaveLength(5);
  } finally {
    repo.cleanup();
  }
});

it('retains successful family delivery and retries a failed family without losing guidance', async () => {
  const { repo, input, executors } = fixture();
  try {
    const store = memory();
    let fail = true;
    const memo: MemoStore = {
      ...store,
      claimGuidance: (session, family) => {
        if (family === 'drift' && fail) {
          fail = false;
          throw new Error('transient guidance failure');
        }
        return store.claimGuidance(session, family);
      }
    };
    const run = async () => (await runTouchHooks([input], executors, memo, null)).outputs[0]?.additionalContext;
    expect(await run()).toBe(anchored);
    expect(await run()).toBe(drift);
    expect(await run()).toBeNull();
  } finally {
    repo.cleanup();
  }
});
