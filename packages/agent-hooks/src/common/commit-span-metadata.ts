/** Bounded commit classification for automatic note creation. */
import { relative, resolve } from 'node:path';
import { isInsideSpanRoot } from './agent-hooks-common.js';
import { executeCommitNotes } from './commit-native-io.js';

/** Empty commits retain the automatic note writer's existing behavior. */
export type CommitSpanMetadata = 'empty' | 'metadata-only' | 'material';

/** Inspect every merge parent and disable rename folding so metadata moved into source remains material. */
export async function inspectCommitSpanMetadata(
  executable: string,
  cwd: string,
  sha: string,
  deadline: number,
  gitDirectory?: string
): Promise<CommitSpanMetadata> {
  const git = async (argv: string[], missingConfig = false): Promise<string> => {
    const timeoutMs = Math.floor(deadline - performance.now());
    if (timeoutMs <= 0) throw new Error('note commit inspection deadline exhausted');
    const result = await executeCommitNotes(executable, {
      cwd,
      argv: [...(gitDirectory === undefined ? [] : ['--git-dir', gitDirectory]), ...argv],
      timeoutMs,
      maxOutputBytes: 1_048_576
    });
    if (
      result.signal !== null ||
      result.timedOut ||
      result.outputExceeded ||
      (result.exitCode !== 0 && !(missingConfig && result.exitCode === 1))
    )
      throw new Error('note commit inspection unavailable, failed, or exceeded bounds');
    return result.stdout;
  };
  const configured =
    process.env.GIT_SPAN_DIR?.trim() || (await git(['config', '--get', 'git-span.dir'], true)).trim() || '.span';
  const root = relative(cwd, resolve(cwd, configured)).split('\\').join('/');
  const output = await git([
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-z',
    '-r',
    '--root',
    '-m',
    '--no-renames',
    sha,
    '--'
  ]);
  if (output && !output.endsWith('\0')) throw new Error('invalid note commit path output');
  const paths = output.split('\0').filter(Boolean);
  if (!paths.length) return 'empty';
  return paths.some(
    (changed) => !['.span', '.spans', root].some((metadata) => metadata === '' || isInsideSpanRoot(changed, metadata))
  )
    ? 'material'
    : 'metadata-only';
}
