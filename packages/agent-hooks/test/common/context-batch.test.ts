import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MemoStore } from '../../src/common/span-surface.js';
import {
  type ContextDocument,
  type ContextStatus,
  decodeContextDocument,
  runTouchHooks,
  type TouchExecutors,
  type TouchInput
} from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

function memoStore(): MemoStore {
  const surfaced = new Map<string, Set<string>>();
  return {
    getSurfaced: (sessionId) => new Set(surfaced.get(sessionId) ?? []),
    addSurfaced: (sessionId, names) => {
      const values = surfaced.get(sessionId) ?? new Set<string>();
      for (const name of names) values.add(name);
      surfaced.set(sessionId, values);
    }
  };
}

function document(path: string, status: ContextStatus = { code: 'FRESH' }, rewritten = false): ContextDocument {
  return {
    schema_version: 1,
    scopes: [{ path, extent: { kind: 'whole' } }],
    mutation: {
      requested: rewritten,
      rewritten,
      spans_touched: rewritten ? 1 : 0,
      anchors_updated: rewritten ? 1 : 0,
      anchors_removed: 0,
      identities_collapsed: 0
    },
    spans: [
      {
        name: `span/${path}`,
        why: `Keep ${path} aligned.`,
        overlaps: [
          {
            scope: 0,
            anchor: { ordinal: 0, id: `anchor-${path}` },
            basis: 'anchored',
            location: { path, extent: { kind: 'lines', start: 1, end: 10 } },
            intersection: { kind: 'lines', start: 1, end: 10 }
          }
        ],
        anchors: [
          {
            ordinal: 0,
            id: `anchor-${path}`,
            anchored: { path, extent: { kind: 'lines', start: 1, end: 10 } },
            current: { path, extent: { kind: 'lines', start: 1, end: 10 } },
            status,
            source: 'WORKTREE',
            sources: ['HEAD', 'INDEX', 'WORKTREE']
          }
        ]
      }
    ]
  };
}

describe('schema-v1 context decoder', () => {
  it('accepts every status, source, and unavailable-reason token', () => {
    const statuses: ContextStatus[] = [
      { code: 'FRESH' },
      { code: 'RESOLVED_PENDING_COMMIT' },
      { code: 'MOVED' },
      { code: 'CHANGED' },
      { code: 'DELETED' },
      { code: 'CONFLICT' },
      { code: 'SUBMODULE' },
      ...(
        [
          'LFS_NOT_FETCHED',
          'LFS_NOT_INSTALLED',
          'PROMISOR_MISSING',
          'SPARSE_EXCLUDED',
          'FILTER_FAILED',
          'IO_ERROR'
        ] as const
      ).map((reason): ContextStatus => ({ code: 'CONTENT_UNAVAILABLE', reason, detail: { bounded: true } }))
    ];
    for (const status of statuses) {
      const value = document('src/app.ts', status);
      expect(decodeContextDocument(JSON.stringify(value))).toEqual(value);
    }
  });

  it('accepts a valid empty result and rejects malformed, incomplete, unsupported, and unknown-token documents', () => {
    const empty = { ...document('src/app.ts'), spans: [] };
    expect(decodeContextDocument(JSON.stringify(empty))).toEqual(empty);
    expect(() => decodeContextDocument('{')).toThrow();
    expect(() => decodeContextDocument(JSON.stringify({ ...empty, mutation: undefined }))).toThrow();
    expect(() => decodeContextDocument(JSON.stringify({ ...empty, schema_version: 2 }))).toThrow();
    const unknown = document('src/app.ts');
    unknown.spans[0].anchors[0].status = { code: 'FUTURE' } as unknown as ContextStatus;
    expect(() => decodeContextDocument(JSON.stringify(unknown))).toThrow();
  });

  it('rejects nested overlap contradictions across basis, location, and intersection', () => {
    const contradict = (mutate: (value: ContextDocument) => void): void => {
      const value = document('src/app.ts');
      value.scopes[0].extent = { kind: 'lines', start: 1, end: 10 };
      mutate(value);
      expect(() => decodeContextDocument(JSON.stringify(value))).toThrow();
    };
    contradict((value) => {
      value.spans[0].overlaps[0].basis = 'current';
      value.spans[0].anchors[0].current = null;
    });
    contradict((value) => {
      value.spans[0].overlaps[0].location.extent = { kind: 'lines', start: 2, end: 10 };
    });
    contradict((value) => {
      value.scopes[0].extent = { kind: 'lines', start: 2, end: 10 };
      value.spans[0].overlaps[0].intersection = { kind: 'lines', start: 1, end: 2 };
    });
    contradict((value) => {
      value.scopes[0].extent = { kind: 'whole' };
      value.spans[0].overlaps[0].intersection = { kind: 'lines', start: 9, end: 11 };
    });
    contradict((value) => {
      value.scopes[0].extent = { kind: 'lines', start: 1, end: 9 };
      value.spans[0].overlaps[0].intersection = { kind: 'lines', start: 2, end: 8 };
    });
  });
});

describe('plural touch execution', () => {
  it('partitions reads from repairs, batches each partition once, preserves order, and keeps mutation batch-scoped', async () => {
    const repo = makeTempRepo();
    try {
      mkdirSync(join(repo.root, 'src'));
      writeFileSync(join(repo.root, 'src/a.ts'), 'a\n');
      writeFileSync(join(repo.root, 'src/b.ts'), 'b\n');
      const requests: Parameters<Extract<TouchExecutors, { context: unknown }>['context']>[0][] = [];
      const executors: TouchExecutors = {
        context: async (request) => {
          requests.push(request);
          const path = request.addresses[0].split('#L')[0];
          return { ok: true, document: document(path, { code: 'FRESH' }, request.repair), elapsedMs: 2 };
        }
      };
      const touches: TouchInput[] = [
        { kind: 'read', sessionId: 's', invocationId: 'event', cwd: repo.root, filePath: join(repo.root, 'src/a.ts') },
        { kind: 'read', sessionId: 's', invocationId: 'event', cwd: repo.root, filePath: join(repo.root, 'src/b.ts') },
        {
          kind: 'write',
          sessionId: 's',
          invocationId: 'event',
          cwd: repo.root,
          filePath: join(repo.root, 'src/a.ts'),
          written: ''
        },
        {
          kind: 'write',
          sessionId: 's',
          invocationId: 'event',
          cwd: repo.root,
          filePath: join(repo.root, 'src/b.ts'),
          written: ''
        }
      ];

      const result = await runTouchHooks(touches, executors, memoStore(), 'event');

      expect(requests).toHaveLength(2);
      expect(requests.map(({ repair }) => repair)).toEqual([false, true]);
      expect(requests[0].addresses).toEqual(['src/a.ts', 'src/b.ts']);
      expect(requests[1].addresses).toEqual(['src/a.ts', 'src/b.ts']);
      expect(requests[0].operationId).toBeUndefined();
      expect(requests[1].operationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.treeModified).toBe(true);
      expect(result.outputs.every(({ treeModified }) => treeModified === false)).toBe(true);
      expect(result.diagnostics).toMatchObject({ queryCount: 2, elapsedMs: 4, mutation: 'rewritten' });
    } finally {
      repo.cleanup();
    }
  });

  it('reuses a deterministic repair operation id and reports delivery-unknown failure without claiming mutation', async () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(join(repo.root, 'a.ts'), 'a\n');
      const operationIds: string[] = [];
      const executors: TouchExecutors = {
        context: async (request) => {
          operationIds.push(request.operationId!);
          return { ok: false, failure: 'timeout', elapsedMs: 10 };
        }
      };
      const touch: TouchInput = {
        kind: 'write',
        sessionId: 's',
        cwd: repo.root,
        filePath: join(repo.root, 'a.ts'),
        written: ''
      };
      const first = await runTouchHooks([touch], executors, memoStore(), 'stable-event');
      const second = await runTouchHooks([touch], executors, memoStore(), 'stable-event');
      expect(operationIds[0]).toBe(operationIds[1]);
      const ranged = [
        { ...touch, range: { start: 8, end: 10 } },
        { ...touch, range: { start: 2, end: 4 } }
      ] satisfies TouchInput[];
      await runTouchHooks(ranged, executors, memoStore(), 'normalized-event');
      await runTouchHooks([...ranged].reverse(), executors, memoStore(), 'normalized-event');
      expect(operationIds[2]).toBe(operationIds[3]);
      expect(first.treeModified).toBe(false);
      expect(first.diagnostics).toMatchObject({ mutation: 'unknown', failure: 'timeout' });
      expect(second.outputs[0]).toEqual({ additionalContext: null, treeModified: false });
    } finally {
      repo.cleanup();
    }
  });

  it('never reuses a repair identity when distinct events lack or carry different host identities', async () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(join(repo.root, 'a.ts'), 'a\n');
      const operationIds: string[] = [];
      const executors: TouchExecutors = {
        context: async (request) => {
          operationIds.push(request.operationId!);
          return { ok: true, document: { ...document('a.ts'), spans: [] }, elapsedMs: 1 };
        }
      };
      const touch: TouchInput = {
        kind: 'write',
        sessionId: 'session',
        cwd: repo.root,
        filePath: join(repo.root, 'a.ts'),
        written: ''
      };
      const missing = await runTouchHooks([touch], executors, memoStore(), null);
      expect(operationIds).toEqual([]);
      expect(missing.diagnostics).toMatchObject({
        mutation: 'unknown',
        failure: 'missing_invocation_identity'
      });
      await runTouchHooks([touch], executors, memoStore(), 'session:event-1');
      await runTouchHooks([touch], executors, memoStore(), 'session:event-2');
      expect(operationIds).toHaveLength(2);
      expect(operationIds[0]).not.toBe(operationIds[1]);
    } finally {
      repo.cleanup();
    }
  });

  it('counts selected spans before memo suppression while rendered-block reporting remains separate', async () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(join(repo.root, 'a.ts'), 'a\n');
      const selected = document('a.ts');
      const second = structuredClone(selected.spans[0]);
      second.name = 'span/a-second';
      second.anchors[0].id = 'anchor-a-second';
      second.overlaps[0].anchor.id = 'anchor-a-second';
      selected.spans.push(second);
      const executors: TouchExecutors = {
        context: async () => ({ ok: true, document: selected, elapsedMs: 1 })
      };
      const touch: TouchInput = {
        kind: 'read',
        sessionId: 'session',
        cwd: repo.root,
        filePath: join(repo.root, 'a.ts')
      };
      const memo = memoStore();
      const first = await runTouchHooks([touch], executors, memo, 'event-1');
      const repeated = await runTouchHooks([touch], executors, memo, 'event-2');
      expect(first.diagnostics.selectedResultCount).toBe(2);
      expect(first.outputs[0].additionalContext).not.toBeNull();
      expect(repeated.diagnostics.selectedResultCount).toBe(2);
      expect(repeated.outputs[0].additionalContext).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it('separates repositories and accepts the complete 4096-address boundary atomically', async () => {
    const firstRepo = makeTempRepo();
    const secondRepo = makeTempRepo();
    try {
      writeFileSync(join(firstRepo.root, 'a.ts'), 'a\n');
      writeFileSync(join(secondRepo.root, 'b.ts'), 'b\n');
      const requests: Parameters<Extract<TouchExecutors, { context: unknown }>['context']>[0][] = [];
      const executors: TouchExecutors = {
        context: async (request) => {
          requests.push(request);
          return {
            ok: true,
            document: { ...document(request.addresses[0].split('#L')[0]), spans: [] },
            elapsedMs: 1
          };
        }
      };
      const crossRepo: TouchInput[] = [
        { kind: 'read', sessionId: 's', cwd: firstRepo.root, filePath: join(firstRepo.root, 'a.ts') },
        { kind: 'read', sessionId: 's', cwd: secondRepo.root, filePath: join(secondRepo.root, 'b.ts') }
      ];
      await runTouchHooks(crossRepo, executors, memoStore(), 'cross-repo');
      expect(requests.map(({ repoRoot }) => repoRoot).sort()).toEqual([firstRepo.root, secondRepo.root].sort());

      requests.length = 0;
      const maximum = Array.from(
        { length: 4096 },
        (_, index): TouchInput => ({
          kind: 'read',
          sessionId: 's',
          cwd: firstRepo.root,
          filePath: join(firstRepo.root, 'a.ts'),
          offset: index + 1,
          limit: 1
        })
      );
      await runTouchHooks(maximum, executors, memoStore(), 'maximum');
      expect(requests).toHaveLength(1);
      expect(requests[0].addresses).toHaveLength(4096);

      requests.length = 0;
      const overLimit = [...maximum, maximum[0]];
      const rejected = await runTouchHooks(overLimit, executors, memoStore(), 'over-limit');
      expect(requests).toHaveLength(0);
      expect(rejected.diagnostics.failure).toBe('address_limit');
    } finally {
      firstRepo.cleanup();
      secondRepo.cleanup();
    }
  });
});
