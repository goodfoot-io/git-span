export interface NoteReviewScope {
  host: 'claude' | 'codex' | 'opencode' | 'antigravity';
  sessionId: string;
  cwd: string;
  workspacePaths?: readonly string[];
}

/** Shared instructions with the host's installed skill name. */
export function reviewNotesPrompt(scope: NoteReviewScope): string {
  const skill = scope.host === 'claude' || scope.host === 'codex' ? 'git-span:review-notes' : 'review-notes';
  return [
    'Dispatch a forked subagent with this prompt:',
    `"Load ${skill}. Check the notes for items relevant to this session. If any exist, follow the skill instructions to review them, remove completed notes, and report unresolved items."`,
    `Review scope: ${JSON.stringify(scope)}`,
    'Include other repositories used in this session in the review scope.',
    'Wait for the subagent and include any blockers in your final response.'
  ].join('\n');
}

/** The host's continuation flag prevents repeated review. */
export function reviewNotesStopReason(
  input: { stop_hook_active: boolean; session_id: string; cwd: string },
  host: 'claude' | 'codex'
): string | undefined {
  if (input.stop_hook_active) return undefined;
  return reviewNotesPrompt({ host, sessionId: input.session_id, cwd: input.cwd });
}
