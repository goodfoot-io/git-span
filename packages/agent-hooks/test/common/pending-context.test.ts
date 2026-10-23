/** Executable pending-inspection contract: literal selection, complete rendering, and shared delivery. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultPlannedTouchStore, runLayeredBashTouches } from '../../src/common/bash-attribution.js';
import {
  createDefaultPendingContextExecutor,
  parsePendingInspection,
  renderPendingContext
} from '../../src/common/pending-context.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { pendingContextDocument } from '../pending-context-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

describe('literal pending inspection recognition', () => {
  it.each([
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

  it('resolves repeated -C through physical directories using the same semantics as Git', () => {
    const repo = makeTempRepo();
    try {
      mkdirSync(join(repo.root, 'physical', 'child'), { recursive: true });
      symlinkSync(join(repo.root, 'physical', 'child'), join(repo.root, 'alias'), 'dir');
      const expected = execFileSync('git', ['-C', 'alias', '-C', '..', 'rev-parse', '--show-prefix'], {
        cwd: repo.root,
        encoding: 'utf8'
      }).trim();
      expect(expected).toBe('physical/');
      expect(parsePendingInspection('git -C alias -C .. diff -- file.py', repo.root)).toEqual({
        kind: 'inspection',
        inspection: { cwd: realpathSync(join(repo.root, 'physical')), command: 'diff', args: ['--', 'file.py'] }
      });
    } finally {
      repo.cleanup();
    }
  });

  it('preserves physical traversal inside one Git -C argument containing symlink and parent segments', () => {
    const repo = makeTempRepo();
    try {
      mkdirSync(join(repo.root, 'physical', 'child'), { recursive: true });
      symlinkSync(join(repo.root, 'physical', 'child'), join(repo.root, 'alias'), 'dir');
      const prefix = execFileSync('git', ['-C', 'alias/..', 'rev-parse', '--show-prefix'], {
        cwd: repo.root,
        encoding: 'utf8'
      }).trim();
      expect(prefix).toBe('physical/');
      expect(parsePendingInspection('git -C alias/.. status', repo.root)).toEqual({
        kind: 'inspection',
        inspection: { cwd: realpathSync(join(repo.root, 'physical')), command: 'status', args: [] }
      });
    } finally {
      repo.cleanup();
    }
  });

  it.each([
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
    'git diff &',
    'git diff -- ""',
    "git diff -- ''",
    'git diff -- fo\\\no.py',
    'cd sub && git diff',
    'git status; git diff',
    'git -c core.quotePath=false diff',
    'git --git-dir other status'
  ])('rejects unsupported shell or repository form %s', (command) => {
    expect(parsePendingInspection(command, '/repo').kind).toBe('unsupported');
  });

  it.each(['cat foo.py', 'git show HEAD', 'git log -p', 'echo git diff', 'git show HEAD -- diff', 'git log -- status'])(
    'leaves unrelated command %s alone',
    (command) => {
      expect(parsePendingInspection(command, '/repo')).toEqual({ kind: 'none' });
    }
  );
});

describe('complete pending context presentation', () => {
  it('prints full current anchors, unchanged whole-file counterparts, deleted locations, statuses, and why', () => {
    const output = renderPendingContext(pendingContextDocument());
    expect(output).toContain('<git-span>');
    expect(output).toContain('## input-contract');
    expect(output).toMatch(/select\.ts\s*#L20-L25 — changed/);
    expect(output).toContain('validate.ts');
    expect(output).toMatch(/old\.ts\s*#L1-L2 — deleted/);
    expect(output).toContain('unavailable.ts — content unavailable: io error');
    expect(output).toContain('Keep the complete explanation.');
    expect(output).not.toMatch(/coupl|for more information|unknown read|repair/i);
    expect(renderPendingContext(pendingContextDocument())).toBe(output);
  });

  it('renders each relationship once and refuses a partial oversized result', () => {
    const value = pendingContextDocument();
    const span = value.spans[0];
    if (span === undefined) throw new Error('missing fixture span');
    value.spans.push(span);
    expect(renderPendingContext(value)?.match(/## input-contract/g)).toHaveLength(1);
    expect(() => renderPendingContext(value, 50)).toThrow(/limit|large|bound/i);
  });

  it('emits no wrapper for an empty successful selection', () => {
    const value = pendingContextDocument();
    value.spans = [];
    expect(renderPendingContext(value)).toBeNull();
  });
});

describe('shared pending inspection delivery', () => {
  it('reports diff exit 1 without ordinary touch duplicates and does not memo-suppress repeated full reports', async () => {
    const temp = makeTempLayout();
    try {
      const logger = { warn: (_message: string) => {} };
      const executors: TouchExecutors = {
        context: async () => {
          throw new Error('ordinary touch must not run');
        },
        pendingContext: async () => ({ ok: true, document: pendingContextDocument() })
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

  it('distinguishes native failure from empty success in visible delivery', async () => {
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
      const empty = pendingContextDocument();
      empty.spans = [];
      executors.pendingContext = async () => ({ ok: true, document: empty });
      expect(await run()).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });
});

describe('native pending executor', () => {
  it('returns an explicit failure for an unavailable invocation directory', async () => {
    const result = await createDefaultPendingContextExecutor()({
      cwd: '/nonexistent-pending-context-directory',
      command: 'diff',
      args: []
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toBe('');
  });
});

describe('pending inspection failure evidence', () => {
  it.each([
    { exit_code: 2, output: 'fatal' },
    { exit_code: 0, output: '', interrupted: true },
    { exit_code: 1, output: '', exitStatusInferred: true },
    { exit_code: 1, output: '', timedOutAfterMs: 1 }
  ])('does not collect after failed, inferred-failure, or interrupted evidence %j', async (response) => {
    const temp = makeTempLayout();
    try {
      const logger = { warn: (_message: string) => {} };
      const executors: TouchExecutors = {
        context: async () => {
          throw new Error('ordinary touch must not run');
        },
        pendingContext: async () => {
          throw new Error('failed invocation must not collect');
        }
      };
      expect(
        await runLayeredBashTouches(
          'git diff',
          '/repo',
          'session',
          undefined,
          response,
          executors,
          createDiskMemoStore(logger, temp.layout),
          logger,
          createDefaultPlannedTouchStore(temp.layout)
        )
      ).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });

  it('makes renderer size refusal visible without returning a partial span report', async () => {
    const temp = makeTempLayout();
    try {
      const value = pendingContextDocument();
      const span = value.spans[0];
      if (span === undefined) throw new Error('fixture span unavailable');
      span.why = 'x'.repeat(300 * 1024);
      const logger = { warn: (_message: string) => {} };
      const executors: TouchExecutors = {
        context: async () => {
          throw new Error('ordinary touch must not run');
        },
        pendingContext: async () => ({ ok: true, document: value })
      };
      const blocks = await runLayeredBashTouches(
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
      expect(blocks.join('')).toMatch(/unavailable.*byte limit/);
      expect(blocks.join('')).not.toContain('<git-span>');
    } finally {
      temp.cleanup();
    }
  });

  it('escapes anchor path controls while retaining the full multiline explanation', () => {
    const value = pendingContextDocument();
    const anchor = value.spans[0]?.anchors[0];
    if (anchor?.current === undefined || anchor.current === null) throw new Error('fixture anchor unavailable');
    anchor.current.path = 'src/fake\nanchor.ts';
    const output = renderPendingContext(value);
    expect(output).toContain('fake\\nanchor.ts');
    expect(output).not.toContain('fake\nanchor.ts');
    expect(output).toContain('validation.\n\nKeep the complete explanation.');
  });
});
