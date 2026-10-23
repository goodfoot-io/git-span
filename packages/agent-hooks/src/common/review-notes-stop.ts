/** Host-independent span-creation prompts and bounded Stop decisions. */
import {
  hasReviewNotes,
  type NoteLookupOutcome,
  type NoteReviewCheck,
  type NoteReviewScope,
  reviewError
} from './review-lookup.js';
import type { MemoLogger } from './span-surface.js';

export type { NoteReviewCheck, NoteReviewScope } from './review-lookup.js';

/** Note documents are evidence, never instructions adopted into the span-creation prompt. */
export function reviewNotesPrompt(scope: NoteReviewScope): string {
  const skill = scope.host === 'claude' || scope.host === 'codex' ? 'git-span:review-notes' : 'review-notes';
  const worker = `Load the ${skill} skill. Use commit notes to identify decision-changing contracts, implicit couplings and useful reminders. Extend existing spans where applicable; create new spans where coverage is missing. Validate anchors and whys against the current tree, and remove only successfully processed notes. Leave edits unstaged.`;
  return [
    'Dispatch a forked subagent with this prompt:',
    JSON.stringify(worker),
    'Wait for the subagent. Summarize spans created or updated, validation results, retained notes and incomplete scope in your final response.'
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
