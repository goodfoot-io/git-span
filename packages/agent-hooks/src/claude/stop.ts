/** Claude Stop hook — delegate one session-note review before finishing. */
import { type HookContext, type StopInput, stopHook, stopOutput } from '@goodfoot/agent-hooks/claude-code';
import { type NoteReviewCheck, reviewNotesStopReason } from '../common/review-notes-stop.js';
import { disableUpdateCheck } from '../common/update-check-env.js';

export function createHandler(check?: NoteReviewCheck) {
  return async (input: StopInput, ctx: HookContext) => {
    const reason = await reviewNotesStopReason(
      { stop_hook_active: input.stop_hook_active, session_id: input.session_id, cwd: input.cwd },
      'claude',
      ctx.logger,
      check
    );
    return reason === undefined ? null : stopOutput({ decision: 'block', reason });
  };
}

disableUpdateCheck();

export default stopHook({ timeout: 10_000 }, createHandler());
