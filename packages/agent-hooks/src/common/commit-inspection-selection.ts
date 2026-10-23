/** Complete selection result; unsuccessful selection never exposes a partial commit set. */
export type CommitInspectionSelection =
  | { kind: 'unsupported'; recognized: boolean }
  | { kind: 'failed'; reason: string }
  | { kind: 'selected'; repoRoot: string; commits: string[] };

/**
 * Resolve supported literal show/log commands through native Git, independent of tool stdout.
 * Refs are observed after tool completion. Selection fails above 4096 commits,
 * 4 MiB subprocess output, or a 10-second subprocess deadline.
 */
export async function resolveCommitInspection(_command: string, _cwd: string): Promise<CommitInspectionSelection> {
  throw new Error('Not Implemented');
}
