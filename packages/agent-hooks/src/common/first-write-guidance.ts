/** Session-scoped authoring guidance, independent from span context selection. */
import type { MemoStore } from './span-surface.js';

export const FIRST_WRITE_GUIDANCE = `<git-span>
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

/** Claim the exact authoring message only after a confirmed write. */
export function firstWriteGuidance(sessionId: string, memo: MemoStore, writeObserved: boolean): string | null {
  return writeObserved && sessionId.length > 0 && memo.claimGuidance(sessionId, 'first-write')
    ? FIRST_WRITE_GUIDANCE
    : null;
}
