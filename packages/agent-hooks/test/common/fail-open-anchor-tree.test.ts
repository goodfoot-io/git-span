import { guidanceClaims } from '../guidance-helpers.js';
/** Short notices carry anchored drift identities without rendering trees or explanations. */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoreLogger, MemoStore } from '../../src/common/span-surface.js';
import { runTouchHooks, type TouchInput } from '../../src/common/touch-core.js';
import { itemAt, makeTempRepo } from '../helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

function recordingLogger(): CoreLogger & { warns: Array<{ message: string; context?: Record<string, unknown> }> } {
  const warns: Array<{ message: string; context?: Record<string, unknown> }> = [];
  return {
    warns,
    warn: (message, context) => {
      warns.push({ message, context });
    }
  };
}

describe('short notices exclude full anchor trees', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
    writeFileSync(join(repo.root, 'app.ts'), 'export const app = 1;\n');
  });
  afterAll(() => repo.cleanup());

  it('renders only drift identity and retrieval guidance without diagnostic warnings', async () => {
    const logger = recordingLogger();
    const executors = contextExecutors({
      fix: async () => ({ modified: false }),
      list: async () => [{ name: 'billing/checkout', path: 'app.ts', start: 1, end: 10 }],
      drift: async () => [{ name: 'billing/checkout', path: 'app.ts', start: 1, end: 10, status: 'CHANGED' }],
      why: async () => 'Checkout flow.'
    });
    const memo: MemoStore = {
      claimGuidance: guidanceClaims(),
      getSurfaced: () => new Set<string>(),
      addSurfaced: () => undefined
    };
    const input: TouchInput = {
      kind: 'read',
      sessionId: 'session-anchor-tree',
      cwd: repo.root,
      filePath: join(repo.root, 'app.ts'),
      invocationId: 'session-anchor-tree:event'
    };

    const batch = await runTouchHooks([input], executors, memo, 'session-anchor-tree:batch', undefined, logger);

    expect(itemAt(batch.outputs, 0).additionalContext).toContain('app.ts#L1-L10 (changed in billing/checkout)');
    expect(itemAt(batch.outputs, 0).additionalContext).not.toContain('Checkout flow.');
    expect(itemAt(batch.outputs, 0).additionalContext).not.toMatch(/[└├]─/);
    expect(logger.warns).toHaveLength(0);
  });
});
