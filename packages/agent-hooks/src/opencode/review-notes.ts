/** OpenCode V2 resumes from idle; synthetic requests do not fire the prompt hook. */
import { isRecord } from '../common/guards.js';
import { hasReviewNotes, type NoteReviewCheck, reviewNotesPrompt } from '../common/review-notes-stop.js';
import type { MemoLogger } from '../common/span-surface.js';
import type { OpencodeReviewClient } from './types.js';

export function createNoteReviewHandler(deps: {
  directory: string;
  client?: OpencodeReviewClient;
  logger: MemoLogger;
  check?: NoteReviewCheck;
}) {
  const pending = new Map<string, { requested: boolean }>();
  return {
    message(sessionId: unknown, parts: unknown): void {
      if (typeof sessionId !== 'string' || !sessionId || !Array.isArray(parts)) return;
      if (
        parts.some(
          (part) => isRecord(part) && part.synthetic !== true && (part.type === 'text' || part.type === 'file')
        )
      )
        pending.set(sessionId, { requested: false });
    },
    forget(sessionId: string): void {
      pending.delete(sessionId);
    },
    clear(): void {
      pending.clear();
    },
    async idle(sessionId: string): Promise<void> {
      const turn = pending.get(sessionId);
      if (!turn || turn.requested) return;
      // Claim before awaiting: duplicate idle events must not both dispatch.
      turn.requested = true;
      try {
        if (!deps.client) throw new Error('OpenCode client unavailable for note review');
        const request = { sessionID: sessionId };
        const session = await deps.client.session.get(request, { signal: AbortSignal.timeout(5_000) });
        if (!isRecord(session) || session.id !== sessionId) throw new Error('Invalid OpenCode session response');
        if (session.parentID !== undefined && session.parentID !== null) return;
        const scope = { host: 'opencode' as const, sessionId, cwd: deps.directory };
        if (!(await (deps.check ?? hasReviewNotes)(scope, deps.logger))) return;
        // A new user message supersedes the stop being reviewed.
        if (pending.get(sessionId) !== turn) return;
        await deps.client.session.synthetic(
          { ...request, text: reviewNotesPrompt(scope), resume: true },
          { signal: AbortSignal.timeout(5_000) }
        );
      } catch (err) {
        deps.logger.warn('git-span opencode note-review continuation failed', { err });
      }
    }
  };
}
