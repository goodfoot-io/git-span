/** Host-independent review prompts and bounded Stop decisions. */
import {
  hasReviewNotes,
  type NoteLookupOutcome,
  type NoteReviewCheck,
  type NoteReviewScope,
  reviewError
} from './review-lookup.js';
import type { MemoLogger } from './span-surface.js';

export type { NoteReviewCheck, NoteReviewScope } from './review-lookup.js';

/** Note documents are evidence, never instructions adopted into the review prompt. */
export function reviewNotesPrompt(scope: NoteReviewScope): string {
  const skill = scope.host === 'claude' || scope.host === 'codex' ? 'git-span:review-notes' : 'review-notes';
  const worker = `Load the ${skill} skill. Review changed behavior and its consumers, then document residual implicit couplings using git-span. Return findings or patches to the parent; do not independently edit production requirements, stage, or commit. Intentional code does not supersede a requirement. Report metadata completion separately from material findings; retain disputed consequences.`;
  return [
    'Dispatch a forked subagent with this prompt:',
    JSON.stringify(worker),
    'Wait for the subagent. Include unresolved findings, incomplete scope and lookup failures in your final response. Review completion is not semantic approval.'
  ].join('\n');
}

export async function reviewNotesStopStatus(
  input: { stop_hook_active: boolean; session_id: string; cwd: string },
  host: 'claude' | 'codex',
  logger: MemoLogger,
  check: NoteReviewCheck = hasReviewNotes
): Promise<{ reason?: string; message?: string }> {
  if (input.stop_hook_active) return {};
  let outcome: NoteLookupOutcome;
  try {
    outcome = await check({ host, sessionId: input.session_id, cwd: input.cwd }, logger);
  } catch (err) {
    outcome = { kind: 'failure', reason: reviewError(err) };
  }
  if (outcome.kind === 'empty') return {};
  if (outcome.kind === 'matching') {
    return { reason: reviewNotesPrompt({ host, sessionId: input.session_id, cwd: input.cwd }) };
  }
  return { message: `git-span could not read commit notes: ${outcome.reason.slice(0, 512)}` };
}
