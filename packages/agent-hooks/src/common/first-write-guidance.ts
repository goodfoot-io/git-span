/** Session-scoped authoring guidance, independent from span context selection. */
import type { MemoStore } from './span-surface.js';

export const FIRST_WRITE_GUIDANCE = `<git-span>
Use \`git-span\` to preserve rules or relationships that a future edit could accidentally break. Anchor content that carries the rule or could violate it.

\`\`\`bash
git span add <name> <path>#L<start>-L<end> [<path>#L<start>-L<end ...]
git span why <name> <why>
\`\`\`

<name>: Semantic slug, example: \`api/auth/handlers\`.
<why>: One sentence explaining what must remain true and why, including relevant scope or uncertainty.
</git-span>`;

/** Claim the exact authoring message only after a confirmed write. */
export function firstWriteGuidance(sessionId: string, memo: MemoStore, writeObserved: boolean): string | null {
  return writeObserved && sessionId.length > 0 && memo.claimGuidance(sessionId, 'first-write')
    ? FIRST_WRITE_GUIDANCE
    : null;
}
