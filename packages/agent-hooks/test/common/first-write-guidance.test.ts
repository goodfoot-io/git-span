import { afterAll, describe, expect, it } from 'vitest';
import { cleanupSessionState } from '../../src/common/agent-hooks-common.js';
import { firstWriteGuidance } from '../../src/common/first-write-guidance.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
afterAll(() => temp.cleanup());
const logger = { warn: () => undefined };
const expected = `<git-span>
Use \`git-span\` to preserve rules or relationships that a future edit could accidentally break. Anchor content that carries the rule or could violate it.

\`\`\`bash
git span add <name> <path>#L<start>-L<end> [<path>#L<start>-L<end ...]
git span why <name> <why>
\`\`\`

<name>: Semantic slug, example: \`api/auth/handlers\`.
<why>: One sentence explaining what must remain true and why, including relevant scope or uncertainty.
</git-span>`;

describe('first successful write guidance contract', () => {
  it('does not claim guidance for reads or failed writes', () => {
    const memo = createDiskMemoStore(logger, temp.layout);
    expect(firstWriteGuidance('deferred', memo, false)).toBeNull();
    expect(firstWriteGuidance('deferred', memo, false)).toBeNull();
    expect(firstWriteGuidance('deferred', memo, true)).toBe(expected);
  });

  it('returns the exact message once across stores and cleanup, independently per session', () => {
    const memo = createDiskMemoStore(logger, temp.layout);
    expect(firstWriteGuidance('once', memo, true)).toBe(expected);
    cleanupSessionState(temp.layout, 'once');
    const next = createDiskMemoStore(logger, temp.layout);
    expect(firstWriteGuidance('once', next, true)).toBeNull();
    expect(firstWriteGuidance('independent', next, true)).toBe(expected);
  });

  it('does not consume retrieval guidance families', () => {
    const memo = createDiskMemoStore(logger, temp.layout);
    expect(firstWriteGuidance('families', memo, true)).toBe(expected);
    expect(memo.claimGuidance('families', 'list')).toBe(true);
    expect(memo.claimGuidance('families', 'drift')).toBe(true);
  });

  it('does not create a claim without a usable session identity', () => {
    expect(firstWriteGuidance('', createDiskMemoStore(logger, temp.layout), true)).toBeNull();
  });
});
