/** Claude Stop hook — delegate one session-note review before finishing. */
import { type HookContext, type StopInput, stopHook, stopOutput } from '@goodfoot/agent-hooks/claude-code';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { type NoteReviewCheck, reviewNotesStopStatus } from '../common/review-notes-stop.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { checkClaudeNoteAdditions } from './review-note-additions.js';

export function createHandler(check?: NoteReviewCheck, layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: StopInput, ctx: HookContext) => {
    const status = await reviewNotesStopStatus(
      { stop_hook_active: input.stop_hook_active, session_id: input.session_id, cwd: input.cwd },
      'claude',
      ctx.logger,
      checkClaudeNoteAdditions(layout, check)
    );
    return status.reason
      ? stopOutput({ decision: 'block', reason: status.reason })
      : status.message
        ? stopOutput({ systemMessage: status.message })
        : null;
  };
}

disableUpdateCheck();

export default stopHook({ timeout: 10_000 }, createHandler());
