/**
 * Antigravity Stop hook — retire the conversation's call-scoped state (the
 * planned-touch store, the tool-call stash, undrained pending injections)
 * when the execution loop ends.
 *
 * Deliberately narrower than the Claude/Codex Stop hooks' whole-session
 * {@link cleanupSessionState}: Antigravity's Stop marks an execution-loop
 * boundary closer to a turn than a session end, so the surfaced-span memo
 * survives to keep identical spans from re-injecting every turn (see
 * {@link cleanupCallScopedState} for the full rationale); the layout's TTL
 * sweep retires the memo with the rest of the session directory.
 *
 * Request note review once per conversation; the durable guard survives
 * hook subprocesses and call-scoped cleanup.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HookContext, type StopInput, stopHook, stopOutput } from '@goodfoot/agent-hooks/antigravity';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { errnoCode } from '../common/guards.js';
import { hasReviewNotes } from '../common/review-lookup.js';
import { type NoteReviewCheck, reviewNotesPrompt } from '../common/review-notes-stop.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { cleanupCallScopedState } from './stash.js';

/**
 * Extracted from the default export so a test can construct one over a
 * scratch layout: a default export binds {@link DEFAULT_SESSION_LAYOUT} at
 * module load, so a test that awaited it would sweep the developer's live
 * session state no matter where its own fixtures lived.
 */
export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT, check: NoteReviewCheck = hasReviewNotes) {
  return async (input: StopInput, ctx: HookContext) => {
    const scope = {
      host: 'antigravity' as const,
      sessionId: input.conversationId,
      cwd: input.workspacePaths[0] ?? '',
      workspacePaths: input.workspacePaths
    };
    let failure: string | undefined;
    const outcome =
      input.terminationReason === 'model_stop' && !input.error && input.fullyIdle
        ? await check(scope, ctx.logger).catch((err: unknown) => ({
            kind: 'failure' as const,
            reason: err instanceof Error ? err.message.slice(0, 512) : 'lookup unavailable'
          }))
        : { kind: 'empty' as const };
    if (outcome.kind === 'failure') failure = `git-span could not read commit notes: ${outcome.reason}`;
    if (outcome.kind === 'matching') {
      try {
        mkdirSync(layout.dir(input.conversationId), { recursive: true, mode: 0o700 });
        writeFileSync(join(layout.dir(input.conversationId), 'antigravity-note-review-requested'), '', {
          flag: 'wx',
          mode: 0o600
        });
        return stopOutput({
          decision: 'continue',
          reason:
            'If you are already the notes-review subagent, finish without dispatching another reviewer.\n' +
            reviewNotesPrompt(scope)
        });
      } catch (err) {
        if (errnoCode(err) !== 'EEXIST') ctx.logger.warn('git-span note-review guard failed', { err });
      }
    }
    try {
      cleanupCallScopedState(layout, input.conversationId);
      return failure ? stopOutput({ reason: failure }) : undefined;
    } catch (err) {
      ctx.logger.warn('git-span stop cleanup failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default stopHook({ timeout: 10_000 }, createHandler());
