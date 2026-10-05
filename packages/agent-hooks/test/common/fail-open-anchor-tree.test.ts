/**
 * The anchor-tree render catch in the touch core: a tree defect degrades the
 * span's anchor list to the flat bullet run (fail-open, unchanged) and now
 * records the swallow on the run log instead of absorbing it silently.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CoreLogger, MemoStore } from '../../src/common/span-surface.js';
import { runTouchHooks, type TouchInput } from '../../src/common/touch-core.js';
import { itemAt, makeTempRepo } from '../helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

const treeDefect = new RangeError('anchor tree defect');

vi.mock('../../src/common/anchor-tree.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/common/anchor-tree.js')>();
  return {
    ...actual,
    renderAnchorTree: () => {
      throw treeDefect;
    }
  };
});

function recordingLogger(): CoreLogger & { warns: Array<{ message: string; context?: Record<string, unknown> }> } {
  const warns: Array<{ message: string; context?: Record<string, unknown> }> = [];
  return {
    warns,
    warn: (message, context) => {
      warns.push({ message, context });
    }
  };
}

describe('anchor-tree render fail-open', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
    writeFileSync(join(repo.root, 'app.ts'), 'export const app = 1;\n');
  });
  afterAll(() => repo.cleanup());

  it('renders the flat bullet list and records the tree defect on the run log', async () => {
    const logger = recordingLogger();
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name: 'billing/checkout', path: 'app.ts', start: 1, end: 10 }],
      drift: async () => [{ name: 'billing/checkout', path: 'app.ts', start: 1, end: 10, status: 'CHANGED' }],
      why: async () => 'Checkout flow.'
    });
    const memo: MemoStore = { getSurfaced: () => new Set<string>(), addSurfaced: () => undefined };
    const input: TouchInput = {
      kind: 'read',
      sessionId: 'session-anchor-tree',
      cwd: repo.root,
      filePath: join(repo.root, 'app.ts'),
      invocationId: 'session-anchor-tree:event'
    };

    const batch = await runTouchHooks([input], executors, memo, 'session-anchor-tree:batch', undefined, logger);

    expect(itemAt(batch.outputs, 0).additionalContext).toContain('- app.ts#L1-L10 — changed');
    expect(logger.warns).toHaveLength(1);
    expect(itemAt(logger.warns, 0)).toMatchObject({
      message: 'git-span failed open',
      context: { site: 'anchor-tree-render', error: 'anchor tree defect', span: 'billing/checkout', err: treeDefect }
    });
  });
});
