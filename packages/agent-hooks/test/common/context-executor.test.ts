import { describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[]; options: Record<string, unknown> }[],
  stdout: ''
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((file: string, args: string[], options: Record<string, unknown>) => {
    capture.calls.push({ file, args, options });
    return capture.stdout;
  })
}));

import {
  type ContextDocument,
  type ContextQueryRequest,
  createDefaultTouchExecutors
} from '../../src/common/touch-core.js';

function emptyDocument(requested: boolean): ContextDocument {
  return {
    schema_version: 1,
    scopes: [{ path: 'src/a.ts', extent: { kind: 'lines', start: 2, end: 4 } }],
    mutation: {
      requested,
      rewritten: false,
      spans_touched: 0,
      anchors_updated: 0,
      anchors_removed: 0,
      identities_collapsed: 0
    },
    spans: []
  };
}

describe('default context executor', () => {
  it('leaves recovery time inside the outer hook deadline and bounds repository lock waits', async () => {
    const executors = createDefaultTouchExecutors();
    if (!('context' in executors)) throw new Error('default executors must expose context');
    capture.stdout = JSON.stringify(emptyDocument(false));
    await executors.context({ repoRoot: '/repo', addresses: ['src/a.ts#L2-L4'], repair: false });
    expect(capture.calls[0]).toMatchObject({
      file: 'git',
      args: ['span', 'context', 'src/a.ts#L2-L4', '--format', 'json'],
      options: {
        cwd: '/repo',
        timeout: 5_000,
        env: expect.objectContaining({ GIT_SPAN_LOCK_WAIT_SECS: '1' }),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    });

    capture.stdout = JSON.stringify(emptyDocument(true));
    const operationId = '1d88b029-66a0-55cc-bcff-16082c41392a';
    await executors.context({
      repoRoot: '/repo',
      addresses: ['src/a.ts#L2-L4', 'src/b.ts'],
      repair: true,
      operationId
    });
    expect(capture.calls[1].args).toEqual([
      'span',
      'context',
      'src/a.ts#L2-L4',
      'src/b.ts',
      '--format',
      'json',
      '--fix',
      '--operation-id',
      operationId
    ]);
  });

  it('classifies empty, malformed, and schema-rejected output without accepting partial data', async () => {
    const executors = createDefaultTouchExecutors();
    if (!('context' in executors)) throw new Error('default executors must expose context');
    const request: ContextQueryRequest = { repoRoot: '/repo', addresses: ['src/a.ts'], repair: false };
    capture.stdout = '';
    expect(await executors.context(request)).toMatchObject({ ok: false, failure: 'empty_output' });
    capture.stdout = '{';
    expect(await executors.context(request)).toMatchObject({ ok: false, failure: 'malformed_json' });
    capture.stdout = JSON.stringify({ ...emptyDocument(false), schema_version: 2 });
    expect(await executors.context(request)).toMatchObject({ ok: false, failure: 'schema_rejected' });
    capture.stdout = JSON.stringify(emptyDocument(true));
    expect(await executors.context(request)).toMatchObject({ ok: false, failure: 'schema_rejected' });
  });

  it('parses the context output exactly once per invocation', async () => {
    const executors = createDefaultTouchExecutors();
    if (!('context' in executors)) throw new Error('default executors must expose context');
    const request: ContextQueryRequest = { repoRoot: '/repo', addresses: ['src/a.ts'], repair: false };
    capture.stdout = JSON.stringify(emptyDocument(false));
    const parseSpy = vi.spyOn(JSON, 'parse');
    try {
      await executors.context(request);
      expect(parseSpy.mock.calls.length).toBe(1);

      capture.stdout = '{';
      await executors.context(request);
      expect(parseSpy.mock.calls.length).toBe(2);
      expect(await executors.context(request)).toEqual({
        ok: false,
        failure: 'malformed_json',
        elapsedMs: expect.any(Number)
      });
      expect(parseSpy.mock.calls.length).toBe(3);
    } finally {
      parseSpy.mockRestore();
    }
  });
});
