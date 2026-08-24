/**
 * Resolves the "last edited" timestamp the span viewer renders under the why
 * prose, for the `.span` declaration file and nothing else.
 *
 * Keeping the subject fixed to the declaration file is the point: a value that
 * sometimes meant "last commit touching this span's anchored code" and
 * sometimes meant "last time you saved the declaration" would render as one
 * number whose meaning silently changed between renders. Anchor churn moves
 * the History accordion; it never moves this.
 *
 * Two sources, in priority order, both describing that one file:
 *
 * - **Committed**: the committer date of the last commit touching
 *   `.span/<name>`, via `git log -1 --format=%cI`.
 * - **Worktree**: the file's mtime, used when the declaration is edited but
 *   uncommitted (where the commit date is drifted by construction), and as the
 *   fallback when the file is untracked or has never been committed (where
 *   `git log` legitimately reports nothing and mtime *is* when it was last
 *   edited).
 *
 * When neither resolves the result is `undefined` and the caller renders no
 * line at all -- an absent date is honest, an invented one is not.
 *
 * @summary Resolves the `.span` declaration file's last-edited timestamp.
 * @module spanViewer/spanTimestamp
 */

import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { runGitSpanCommand } from '../utils/gitSpanBinary.js';

/**
 * Reads the committer date of the last commit touching a repo-relative path.
 *
 * @param repoRoot - Absolute repository root to run the query in.
 * @param relativePath - Repository-relative, slash-separated path to query.
 * @param signal - Optional abort signal firing on supersession or disposal;
 *   kills the spawned `git log` instead of leaving it running to completion.
 * @returns The ISO committer date, or `null` when the path is untracked, has
 *   no commits, or the query could not be run at all.
 */
export type CommittedDateReader = (
  repoRoot: string,
  relativePath: string,
  signal?: AbortSignal
) => Promise<string | null>;

/**
 * Reads a file's modification time.
 *
 * @param filePath - Absolute path to stat.
 * @returns The mtime as an ISO string, or `null` when the file cannot be
 *   stat'ed.
 */
export type MtimeReader = (filePath: string) => Promise<string | null>;

/**
 * The committer date of the last commit touching `relativePath`.
 *
 * Spawns through {@linkcode runGitSpanCommand}, the package's single
 * process-spawning helper, rather than introducing a second way to shell out;
 * the helper is binary-agnostic despite its name.
 *
 * An untracked or never-committed path makes `git log` exit 0 with empty
 * stdout -- reported here as `null`, indistinguishable on purpose from "git
 * could not run", because both mean the same thing to the caller: fall back to
 * the worktree.
 *
 * @param repoRoot - Absolute repository root to run `git log` in.
 * @param relativePath - Repository-relative, slash-separated path to query.
 * @param signal - Optional abort signal; aborting kills the spawned `git log`
 *   and resolves `null`.
 * @returns The ISO committer date, or `null`.
 * @throws Never -- a missing `git`, a non-repository cwd, an aborted signal,
 *   and a non-zero exit all resolve to `null`.
 */
export const readCommittedDate: CommittedDateReader = async (repoRoot, relativePath, signal) => {
  try {
    // `--` keeps a path that looks like a ref from being parsed as one.
    const result = await runGitSpanCommand('git', ['log', '-1', '--format=%cI', '--', relativePath], signal, repoRoot);
    if (result.exitCode !== 0) {
      return null;
    }
    const trimmed = result.stdout.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
};

/**
 * A file's mtime as an ISO string.
 *
 * @param filePath - Absolute path to stat.
 * @returns The ISO mtime, or `null` when the stat fails.
 * @throws Never.
 */
export const readMtime: MtimeReader = async (filePath) => {
  try {
    const stats = await stat(filePath);
    return new Date(stats.mtimeMs).toISOString();
  } catch {
    return null;
  }
};

/**
 * Resolve the `.span` declaration file's last-edited timestamp.
 *
 * `dirty` selects which source leads, never which file is described. When the
 * leading source yields nothing the other is still tried -- a real date for
 * the declaration file always beats no line at all, and both sources describe
 * that same file, so the label's subject is unchanged either way.
 *
 * @param options - Everything the resolution needs.
 * @param options.repoRoot - Absolute repository root.
 * @param options.relativePath - The declaration's repository-relative,
 *   slash-separated path, e.g. `.span/my-span`.
 * @param options.dirty - Whether the declaration differs from HEAD in the
 *   worktree, i.e. whether the provider produced an uncommitted-edit card. The
 *   committed date is drifted by construction when this is true.
 * @param options.signal - Optional abort signal forwarded to the committed-date
 *   reader so a superseded or disposed render's `git log` spawn is killed.
 * @param options.readCommittedDate - Injected git reader; defaults to
 *   {@linkcode readCommittedDate}.
 * @param options.readMtime - Injected stat reader; defaults to
 *   {@linkcode readMtime}.
 * @returns The ISO timestamp, or `undefined` when neither source resolves.
 * @throws Never -- both readers absorb their own failures.
 */
export async function resolveSpanUpdatedAt(options: {
  repoRoot: string;
  relativePath: string;
  dirty: boolean;
  signal?: AbortSignal;
  readCommittedDate?: CommittedDateReader;
  readMtime?: MtimeReader;
}): Promise<string | undefined> {
  const {
    repoRoot,
    relativePath,
    dirty,
    signal,
    readCommittedDate: readCommitted = readCommittedDate,
    readMtime: readModified = readMtime
  } = options;

  const absolutePath = path.join(repoRoot, relativePath);
  const fromWorktree = (): Promise<string | null> => readModified(absolutePath);
  const fromGit = (): Promise<string | null> => readCommitted(repoRoot, relativePath, signal);

  const [leading, trailing] = dirty ? [fromWorktree, fromGit] : [fromGit, fromWorktree];
  return (await leading()) ?? (await trailing()) ?? undefined;
}
