import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MemoStore } from '../../src/common/span-surface.js';
import { runTouchHooks, type TouchInput } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

function memory(): MemoStore {
  let saved = new Set<string>();
  return {
    getSurfaced: () => new Set(saved),
    addSurfaced: (_sid, names, known) => {
      saved = new Set([...known, ...names]);
    }
  };
}

describe('bounded evidence presentation', () => {
  it('treats an unknown broad extent as discovery and leaves targeted first exposure available', async () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(join(repo.root, 'app.ts'), 'line\n');
      const executors = contextExecutors({
        fix: async () => ({ modified: false }),
        list: async () => [{ name: 'late/relationship', path: 'app.ts', start: 12000, end: 12010 }],
        drift: async () => [],
        why: async () => 'Preserve late evidence.'
      });
      const memo = memory();
      const base = { kind: 'read', sessionId: 's', cwd: repo.root, filePath: join(repo.root, 'app.ts') } as const;
      const discovery = { ...base, broadDiscovery: true, observedRange: null } satisfies TouchInput;
      const first = await runTouchHooks([discovery], executors, memo, null);
      expect(first.outputs[0]?.additionalContext).toContain('Discovery only');
      expect(memo.getSurfaced('s').size).toBe(0);
      const targeted = {
        ...base,
        offset: 12000,
        limit: 11,
        observedRange: { start: 12000, end: 12010 }
      } satisfies TouchInput;
      const full = await runTouchHooks([targeted], executors, memo, null);
      expect(full.outputs[0]?.additionalContext).toContain('Preserve late evidence.');
      expect(full.outputs[0]?.additionalContext).toContain('relationship review not recorded');
    } finally {
      repo.cleanup();
    }
  });

  it('bounds broad fan-out and reports omitted spans without recording exposure', async () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(join(repo.root, 'app.ts'), 'line\n');
      const executors = contextExecutors({
        fix: async () => ({ modified: false }),
        list: async () =>
          Array.from({ length: 200 }, (_, i) => ({
            name: `span/${String(i).padStart(3, '0')}`,
            path: 'app.ts',
            start: 1,
            end: 1
          })),
        drift: async () => [],
        why: async () => 'Keep the behavior aligned.'
      });
      const memo = memory();
      const result = await runTouchHooks(
        [
          {
            kind: 'read',
            sessionId: 's',
            cwd: repo.root,
            filePath: join(repo.root, 'app.ts'),
            broadDiscovery: true,
            observedRange: { start: 1, end: 1 }
          }
        ],
        executors,
        memo,
        null
      );
      const output = result.outputs[0]?.additionalContext ?? '';
      expect(Buffer.byteLength(output)).toBeLessThanOrEqual(1536);
      expect(output).toMatch(/\d+ spans omitted/);
      expect(memo.getSurfaced('s').size).toBe(0);
    } finally {
      repo.cleanup();
    }
  });
});

// Presentation history bounds are independent of CLI/resolver correctness.
import {
  type DeliverySnapshot,
  MAX_MEMO_BYTES,
  readSnapshots,
  recordSnapshots,
  shellArgument,
  showRoute
} from '../../src/common/delivery-presentation.js';
import { claudeReadExposure } from '../../src/common/read-exposure.js';

it('rejects missing, empty, out-of-bounds and contradictory read metadata', () => {
  expect(claudeReadExposure({ file: { startLine: 1, numLines: 2000, totalLines: 13000 } })).toEqual({
    start: 1,
    end: 2000
  });
  expect(claudeReadExposure({ file: { startLine: 12000, numLines: 1001, totalLines: 13000 } })).toEqual({
    start: 12000,
    end: 13000
  });
  for (const response of [
    {},
    { file: {} },
    { file: { startLine: 1, numLines: 0, totalLines: 0 } },
    { file: { startLine: 9, numLines: 3, totalLines: 10 } },
    { file: { startLine: 1.5, numLines: 1, totalLines: 10 } }
  ])
    expect(claudeReadExposure(response)).toBeNull();
});

it('evicts snapshots deterministically and treats malformed private state as absent', () => {
  const keys = new Set<string>([`touch:${'0'.repeat(64)}:broken`]);
  expect(readSnapshots(keys).size).toBe(0);
  const updates = new Map<string, DeliverySnapshot>();
  for (let i = 0; i < 300; i++)
    updates.set(`touch:${i.toString(16).padStart(64, '0')}`, {
      version: 1,
      revision: '1'.repeat(64),
      why: 'w'.repeat(2500),
      anchors: ['a'.repeat(64)],
      fullFooter: true,
      recipient: '0'.repeat(64)
    });
  recordSnapshots(keys, updates);
  expect(readSnapshots(keys).size).toBeLessThanOrEqual(128);
  expect(Buffer.byteLength(JSON.stringify([...keys]))).toBeLessThanOrEqual(MAX_MEMO_BYTES);
  expect(readSnapshots(keys).has(`touch:${'0'.repeat(64)}`)).toBe(false);
  const giant = new Map<string, DeliverySnapshot>([
    [
      `touch:${'f'.repeat(64)}`,
      {
        version: 1,
        revision: '1'.repeat(64),
        why: 'w'.repeat(9000),
        anchors: [],
        fullFooter: false,
        recipient: '0'.repeat(64)
      }
    ]
  ]);
  recordSnapshots(keys, giant);
  expect(readSnapshots(keys).has(`touch:${'f'.repeat(64)}`)).toBe(false);
});

it('quotes hostile shell arguments and bounds routes without cutting shell syntax', () => {
  expect(shellArgument("a'; touch /tmp/nope; `echo bad`")).toBe("'a'\\''; touch /tmp/nope; `echo bad`'");
  expect(showRoute('a`b')).toContain('``');
  expect(showRoute('x'.repeat(5000))).toContain('git span list');
  expect(showRoute('a\nb')).not.toContain('a\nb');
});

it('bounds huge targeted obligations and keeps all incomplete revisions eligible', async () => {
  const repo = makeTempRepo();
  try {
    writeFileSync(join(repo.root, 'app.ts'), 'line\n');
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => Array.from({ length: 20 }, (_, i) => ({ name: `span/${i}`, path: 'app.ts', start: 1, end: 1 })),
      drift: async () => [],
      why: async () => 'w'.repeat(20000)
    });
    const memo = memory();
    const touch: TouchInput = {
      kind: 'read',
      sessionId: 's',
      cwd: repo.root,
      filePath: join(repo.root, 'app.ts'),
      offset: 1,
      limit: 1
    };
    const output = (await runTouchHooks([touch], executors, memo, null)).outputs[0]?.additionalContext ?? '';
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(8192);
    expect(output).toContain('20 relationships incomplete');
    expect(output).toContain('git span show');
    expect(memo.getSurfaced('s').size).toBe(0);
    expect((await runTouchHooks([touch], executors, memo, null)).outputs[0]?.additionalContext).not.toBeNull();
  } finally {
    repo.cleanup();
  }
});

it('renders why and anchor deltas, suppresses exact repeats, and uses a short footer only with reliable lifecycle support', async () => {
  const repo = makeTempRepo();
  try {
    writeFileSync(join(repo.root, 'app.ts'), 'line\n');
    let why = 'Preserve the contract. Keep callers aligned.';
    let end = 1;
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name: 'flow', path: 'app.ts', start: 1, end }],
      drift: async () => [],
      why: async () => why
    });
    const memo = memory();
    const touch: TouchInput = {
      kind: 'read',
      sessionId: 's',
      cwd: repo.root,
      filePath: join(repo.root, 'app.ts'),
      recipientResetSupported: true
    };
    const run = async () => (await runTouchHooks([touch], executors, memo, null)).outputs[0]?.additionalContext;
    expect(await run()).toContain('To explicitly accept content');
    expect(await run()).toBeNull();
    why = 'Updated contract. All new guidance stays visible.';
    const delta = await run();
    expect(delta).toContain(why);
    expect(delta).toContain('Evidence changed since full exposure');
    expect(delta).not.toContain('To explicitly accept content');
    end = 2;
    expect(await run()).toContain('#L1-L2');
    expect(await run()).toBeNull();
  } finally {
    repo.cleanup();
  }
});

it('separates sibling recipient baselines and forgets both baseline and cadence on explicit reset', async () => {
  const repo = makeTempRepo();
  try {
    writeFileSync(join(repo.root, 'app.ts'), 'line\n');
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name: 'flow', path: 'app.ts', start: 1, end: 1 }],
      drift: async () => [],
      why: async () => 'Keep caller behavior aligned.'
    });
    const memo = memory();
    const base: TouchInput = {
      kind: 'read',
      sessionId: 's',
      cwd: repo.root,
      filePath: join(repo.root, 'app.ts'),
      recipientResetSupported: true
    };
    const render = async (recipientId: string) =>
      (await runTouchHooks([{ ...base, recipientId }], executors, memo, null)).outputs[0]?.additionalContext;
    expect(await render('child-a')).toContain('To explicitly accept content');
    expect(await render('child-a')).toBeNull();
    expect(await render('child-b')).toContain('To explicitly accept content');
    expect(await render('child-b')).toBeNull();
    // This is the same empty authoritative memo state that SessionStart installs.
    memo.addSurfaced('s', [], new Set());
    expect(await render('child-a')).toContain('To explicitly accept content');
  } finally {
    repo.cleanup();
  }
});

it('keeps a huge single span name within the targeted envelope without broken retrieval syntax', async () => {
  const repo = makeTempRepo();
  try {
    writeFileSync(join(repo.root, 'app.ts'), 'line\n');
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name: `long/${'x'.repeat(20000)}`, path: 'app.ts', start: 1, end: 1 }],
      drift: async () => [],
      why: async () => 'Keep the two contracts aligned.'
    });
    const memo = memory();
    const result = await runTouchHooks(
      [{ kind: 'read', sessionId: 's', cwd: repo.root, filePath: join(repo.root, 'app.ts'), offset: 1, limit: 1 }],
      executors,
      memo,
      null
    );
    const output = result.outputs[0]?.additionalContext ?? '';
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(8192);
    expect(output).toContain('1 relationships incomplete');
    expect(output).toContain('retrieve the complete name');
    expect(output.match(/<\/git-span>/g)).toHaveLength(1);
    expect(memo.getSurfaced('s').size).toBe(0);
  } finally {
    repo.cleanup();
  }
});

it('retains changed source evidence when only the opaque evidence revision changes', async () => {
  const repo = makeTempRepo();
  try {
    writeFileSync(join(repo.root, 'app.ts'), 'line\n');
    let revision = '1'.repeat(64);
    const base = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name: 'caller/contract', path: 'app.ts', start: 1, end: 1 }],
      drift: async () => [{ name: 'caller/contract', path: 'app.ts', start: 1, end: 1, status: 'CHANGED' }],
      why: async () => 'Keep the caller contract intact.'
    });
    const executors = {
      context: async (request: Parameters<typeof base.context>[0]) => {
        const result = await base.context(request);
        if (result.ok) for (const span of result.document.spans) span.evidence_revision = revision;
        return result;
      }
    };
    const memo = memory();
    const touch: TouchInput = {
      kind: 'read',
      sessionId: 's',
      cwd: repo.root,
      filePath: join(repo.root, 'app.ts'),
      offset: 1,
      limit: 1
    };
    const render = async () => (await runTouchHooks([touch], executors, memo, null)).outputs[0]?.additionalContext;
    expect(await render()).toContain('app.ts #L1-L1 — changed');
    expect(await render()).toBeNull();
    revision = '2'.repeat(64);
    const next = await render();
    expect(next).toContain('app.ts #L1-L1 — changed');
    expect(next).toContain('Keep the caller contract intact.');
    expect(await render()).toBeNull();
  } finally {
    repo.cleanup();
  }
});
