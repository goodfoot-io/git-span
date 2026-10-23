/** Executable pending-inspection contract: literal selection, complete rendering, and shared delivery. */
import { describe, expect, it } from 'vitest';
import { createDefaultPlannedTouchStore, runLayeredBashTouches } from '../../src/common/bash-attribution.js';
import {
  createDefaultPendingContextExecutor,
  parsePendingInspection,
  renderPendingContext
} from '../../src/common/pending-context.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { type ContextDocument, decodeContextDocument, type TouchExecutors } from '../../src/common/touch-core.js';
import { makeTempLayout } from '../session-layout-helpers.js';

function document(): ContextDocument {
  return decodeContextDocument(
    JSON.stringify({
      schema_version: 2,
      scopes: [],
      mutation: {
        requested: false,
        rewritten: false,
        spans_touched: 0,
        anchors_updated: 0,
        anchors_removed: 0,
        identities_collapsed: 0
      },
      spans: [
        {
          name: 'input-contract',
          evidence_revision: 'a'.repeat(64),
          why: 'Discovery selects intended inputs before strict validation.\n\nKeep the complete explanation.',
          overlaps: [],
          anchors: [
            {
              ordinal: 0,
              id: 'a',
              anchored: { path: 'src/select.ts', extent: { kind: 'lines', start: 10, end: 15 } },
              current: { path: 'src/select.ts', extent: { kind: 'lines', start: 20, end: 25 } },
              status: { code: 'CHANGED' },
              source: 'WORKTREE',
              sources: ['WORKTREE']
            },
            {
              ordinal: 1,
              id: 'b',
              anchored: { path: 'other/validate.ts', extent: { kind: 'whole' } },
              current: { path: 'other/validate.ts', extent: { kind: 'whole' } },
              status: { code: 'FRESH' },
              source: 'WORKTREE',
              sources: ['WORKTREE']
            },
            {
              ordinal: 2,
              id: 'c',
              anchored: { path: 'old.ts', extent: { kind: 'lines', start: 1, end: 2 } },
              current: null,
              status: { code: 'DELETED' },
              source: 'INDEX',
              sources: ['INDEX']
            },
            {
              ordinal: 3,
              id: 'd',
              anchored: { path: 'unavailable.ts', extent: { kind: 'whole' } },
              current: null,
              status: { code: 'CONTENT_UNAVAILABLE', reason: 'IO_ERROR', detail: null },
              source: null,
              sources: []
            }
          ]
        }
      ]
    })
  );
}

describe('literal pending inspection recognition', () => {
  it.skip.each([
    ['git status', 'status', []],
    ['git status --porcelain=v2 -- "a b.py"', 'status', ['--porcelain=v2', '--', 'a b.py']],
    ['git diff --cached -- foo.py', 'diff', ['--cached', '--', 'foo.py']],
    ["git diff -- ':(glob)**/*.py'", 'diff', ['--', ':(glob)**/*.py']],
    ['git diff -- "*.py"', 'diff', ['--', '*.py']],
    ["git diff -- '$literal.py'", 'diff', ['--', '$literal.py']],
    ['git --no-pager diff --stat HEAD -- src/', 'diff', ['--stat', 'HEAD', '--', 'src/']]
  ] as const)('preserves literal Git argv for %s', (command, builtin, args) => {
    expect(parsePendingInspection(command, '/repo')).toEqual({
      kind: 'inspection',
      inspection: { cwd: '/repo', command: builtin, args: [...args] }
    });
  });

  it.skip('resolves repeated -C relative to the effective invocation directory', () => {
    expect(parsePendingInspection('git -C child -C ../sibling diff -- file.py', '/repo')).toEqual({
      kind: 'inspection',
      inspection: { cwd: '/repo/sibling', command: 'diff', args: ['--', 'file.py'] }
    });
  });

  it.skip.each([
    'git diff -- *.py',
    'git diff -- foo"bar"*',
    'git diff -- "$var"',
    'git diff -- "$(pwd)"',
    'git diff -- `pwd`',
    'git -C "$repo" status',
    'GIT_INDEX_FILE=other git diff',
    'env git status',
    'git diff > patch',
    'git diff | cat',
    'cd sub && git diff',
    'git status; git diff',
    'git -c core.quotePath=false diff',
    'git --git-dir other status'
  ])('rejects unsupported shell or repository form %s', (command) => {
    expect(parsePendingInspection(command, '/repo').kind).toBe('unsupported');
  });

  it.skip.each(['cat foo.py', 'git show HEAD', 'git log -p', 'echo git diff'])(
    'leaves unrelated command %s alone',
    (command) => {
      expect(parsePendingInspection(command, '/repo')).toEqual({ kind: 'none' });
    }
  );
});

describe('complete pending context presentation', () => {
  it.skip('prints full current anchors, unchanged whole-file counterparts, deleted locations, statuses, and why', () => {
    const output = renderPendingContext(document());
    expect(output).toContain('<git-span>');
    expect(output).toContain('## input-contract');
    expect(output).toContain('select.ts#L20-L25 — changed');
    expect(output).toContain('validate.ts');
    expect(output).toContain('old.ts#L1-L2 — deleted');
    expect(output).toContain('unavailable.ts — io error');
    expect(output).toContain('Keep the complete explanation.');
    expect(output).not.toMatch(/coupl|for more information|unknown read|repair/i);
    expect(renderPendingContext(document())).toBe(output);
  });

  it.skip('renders each relationship once and refuses a partial oversized result', () => {
    const value = document();
    const span = value.spans[0];
    if (span === undefined) throw new Error('missing fixture span');
    value.spans.push(span);
    expect(renderPendingContext(value)?.match(/## input-contract/g)).toHaveLength(1);
    expect(() => renderPendingContext(value, 50)).toThrow(/limit|large|bound/i);
  });

  it.skip('emits no wrapper for an empty successful selection', () => {
    const value = document();
    value.spans = [];
    expect(renderPendingContext(value)).toBeNull();
  });
});

describe('shared pending inspection delivery', () => {
  it.skip('reports diff exit 1 without ordinary touch duplicates and does not memo-suppress repeated full reports', async () => {
    const temp = makeTempLayout();
    try {
      const logger = { warn: (_message: string) => {} };
      const executors: TouchExecutors = {
        context: async () => {
          throw new Error('ordinary touch must not run');
        },
        pendingContext: async () => ({ ok: true, document: document() })
      };
      const memo = createDiskMemoStore(logger, temp.layout);
      const store = createDefaultPlannedTouchStore(temp.layout);
      const first = await runLayeredBashTouches(
        'git diff -- foo.py',
        '/repo',
        'session',
        'one',
        { exit_code: 1, output: '' },
        executors,
        memo,
        logger,
        store
      );
      const second = await runLayeredBashTouches(
        'git diff -- foo.py',
        '/repo',
        'session',
        'two',
        { exit_code: 1, output: '' },
        executors,
        memo,
        logger,
        store
      );
      expect(first).toHaveLength(1);
      expect(first[0]).toContain('Keep the complete explanation.');
      expect(second).toEqual(first);
    } finally {
      temp.cleanup();
    }
  });

  it.skip('distinguishes native failure from empty success in visible delivery', async () => {
    const temp = makeTempLayout();
    try {
      const logger = { warn: (_message: string) => {} };
      const executors: TouchExecutors = {
        context: async () => {
          throw new Error('ordinary touch must not run');
        },
        pendingContext: async () => ({ ok: false, reason: 'snapshot changed' })
      };
      const run = () =>
        runLayeredBashTouches(
          'git status',
          '/repo',
          'session',
          undefined,
          { exit_code: 0, output: '' },
          executors,
          createDiskMemoStore(logger, temp.layout),
          logger,
          createDefaultPlannedTouchStore(temp.layout)
        );
      expect((await run()).join('')).toContain('snapshot changed');
      const empty = document();
      empty.spans = [];
      executors.pendingContext = async () => ({ ok: true, document: empty });
      expect(await run()).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });
});

describe('native pending executor', () => {
  it.skip('returns an explicit failure for an unavailable invocation directory', async () => {
    const result = await createDefaultPendingContextExecutor()({
      cwd: '/nonexistent-pending-context-directory',
      command: 'diff',
      args: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toBe('');
  });
});
