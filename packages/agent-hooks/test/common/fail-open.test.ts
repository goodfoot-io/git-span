/**
 * The observable fail-open contract: a swallowed failure keeps the fail-open
 * behavior but leaves one structured warn record (site, error message,
 * per-site count) on the hook's run log — immediately when a logger is in
 * reach, or from the bounded queue at the next flush when it is not.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSpanRoot, SPAN_ROOT } from '../../src/common/agent-hooks-common.js';
import {
  FAIL_OPEN_MESSAGE,
  failOpenCount,
  flushFailOpen,
  MAX_PENDING_FAIL_OPEN,
  reportFailOpen
} from '../../src/common/fail-open.js';
import type { CoreLogger } from '../../src/common/span-surface.js';
import { itemAt, makeTempRepo } from '../helpers.js';

interface WarnRecord {
  message: string;
  context?: Record<string, unknown>;
}

function recordingLogger(): CoreLogger & { warns: WarnRecord[] } {
  const warns: WarnRecord[] = [];
  return {
    warns,
    warn: (message, context) => {
      warns.push({ message, context });
    }
  };
}

/** Drain whatever earlier tests left queued so each test starts from an empty queue. */
function drainQueue(): void {
  flushFailOpen(recordingLogger());
}

describe('reportFailOpen', () => {
  beforeEach(drainQueue);

  it('writes one structured record with the site, error message, count, and context', () => {
    const logger = recordingLogger();
    const before = failOpenCount('touch-render');
    const defect = new TypeError('render defect');

    const event = reportFailOpen(logger, 'touch-render', defect, { filePath: '/repo/a.ts' });

    expect(event).toMatchObject({ site: 'touch-render', error: 'render defect', count: before + 1 });
    expect(logger.warns).toEqual([
      {
        message: FAIL_OPEN_MESSAGE,
        context: {
          filePath: '/repo/a.ts',
          err: defect,
          site: 'touch-render',
          error: 'render defect',
          count: before + 1
        }
      }
    ]);
    expect(failOpenCount('touch-render')).toBe(before + 1);
  });

  it('counts per site and stringifies a non-Error throw', () => {
    const logger = recordingLogger();
    const renderBefore = failOpenCount('anchor-tree-render');
    const touchBefore = failOpenCount('touch-render');

    reportFailOpen(logger, 'anchor-tree-render', 'plain string');
    reportFailOpen(logger, 'anchor-tree-render', 42);

    expect(failOpenCount('anchor-tree-render')).toBe(renderBefore + 2);
    expect(failOpenCount('touch-render')).toBe(touchBefore);
    expect(logger.warns.map(({ context }) => context?.error)).toEqual(['plain string', '42']);
  });

  it('queues a logger-less record until the next flush, which empties the queue', () => {
    reportFailOpen(undefined, 'span-root-config', new Error('git exploded'), { repoRoot: '/r' });
    const logger = recordingLogger();

    flushFailOpen(logger);
    flushFailOpen(logger);

    expect(logger.warns).toHaveLength(1);
    expect(itemAt(logger.warns, 0).context).toMatchObject({
      site: 'span-root-config',
      error: 'git exploded',
      repoRoot: '/r'
    });
  });

  it('flushes queued records ahead of the one reported with a logger', () => {
    reportFailOpen(undefined, 'span-root-config', new Error('first'));
    const logger = recordingLogger();

    reportFailOpen(logger, 'touch-render', new Error('second'));

    expect(logger.warns.map(({ context }) => context?.error)).toEqual(['first', 'second']);
  });

  it('bounds the queue and reports how many records overflowed it', () => {
    const overflow = 3;
    for (let index = 0; index < MAX_PENDING_FAIL_OPEN + overflow; index++) {
      reportFailOpen(undefined, 'span-root-config', new Error(`failure ${index}`));
    }
    const logger = recordingLogger();

    flushFailOpen(logger);

    expect(logger.warns).toHaveLength(MAX_PENDING_FAIL_OPEN + 1);
    expect(itemAt(logger.warns, -1)).toEqual({
      message: FAIL_OPEN_MESSAGE,
      context: { site: 'fail-open-queue', dropped: overflow }
    });
  });
});

describe('resolveSpanRoot fail-open', () => {
  const savedSpanDir = process.env.GIT_SPAN_DIR;
  let scratch: string;

  beforeEach(() => {
    drainQueue();
    delete process.env.GIT_SPAN_DIR;
    scratch = mkdtempSync(join(tmpdir(), 'agent-hooks-fail-open-'));
  });

  afterEach(() => {
    if (savedSpanDir === undefined) delete process.env.GIT_SPAN_DIR;
    else process.env.GIT_SPAN_DIR = savedSpanDir;
    rmSync(scratch, { recursive: true, force: true });
  });

  it('falls back to the default span root and records a git failure that is not an unset key', () => {
    const before = failOpenCount('span-root-config');
    const missingRepo = join(scratch, 'no-such-repository');

    expect(resolveSpanRoot(missingRepo)).toBe(SPAN_ROOT);

    expect(failOpenCount('span-root-config')).toBe(before + 1);
    const logger = recordingLogger();
    flushFailOpen(logger);
    expect(logger.warns).toHaveLength(1);
    expect(itemAt(logger.warns, 0)).toMatchObject({
      message: FAIL_OPEN_MESSAGE,
      context: { site: 'span-root-config', repoRoot: missingRepo }
    });
  });

  it('records nothing when the key is simply unset', () => {
    const repo = makeTempRepo();
    try {
      const before = failOpenCount('span-root-config');

      expect(resolveSpanRoot(repo.root)).toBe(SPAN_ROOT);

      expect(failOpenCount('span-root-config')).toBe(before);
      const logger = recordingLogger();
      flushFailOpen(logger);
      expect(logger.warns).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
