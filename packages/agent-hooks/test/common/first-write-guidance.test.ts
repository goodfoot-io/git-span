import { afterAll, describe, expect, it } from 'vitest';
import { cleanupSessionState } from '../../src/common/agent-hooks-common.js';
import { firstWriteGuidance } from '../../src/common/first-write-guidance.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
afterAll(() => temp.cleanup());
const logger = { warn: () => undefined };
const expected = `<git-span>
If your edits create or depend on a rule or relationship that a later edit could silently break, you must declare a span for it before you commit. The span must anchor both the content that states the rule and the content that could break it.

\`\`\`bash
git span add <name> <path>#L<start>-L<end> [<path>#L<start>-L<end> ...]
git span why <name> "<why>"
\`\`\`

<name>: Semantic slug, example: \`api/auth/handlers\`.
<why>: One sentence explaining what must remain true and why, including relevant scope or uncertainty.

Specification and implementation:
\`\`\`bash
git span add billing/proration docs/spec/billing.md#L40-L58 src/billing/prorate.ts#L12-L47
git span why billing/proration "prorate() rounds partial-month credits down to the cent as spec section 4.2 requires; changing either side changes invoice totals."
\`\`\`

Cross-language contract:
\`\`\`bash
git span add events/order-created server/src/events.rs#L88-L120 web/src/api/events.ts#L5-L31
git span why events/order-created "The Rust OrderCreated serializer and TypeScript decoder share snake_case field names and an optional discount_cents; renaming either side breaks decoding at runtime, not compile time."
\`\`\`
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
