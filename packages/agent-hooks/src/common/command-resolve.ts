/**
 * The only impure bits: counting lines of a working-tree file, and of a file
 * as it existed at a given git revision. Both return null on any failure
 * (missing file, bad rev, not a git repo, etc.) instead of throwing — a
 * command that statically matched an idiom but points at something this
 * machine can't currently resolve is a normal, expected outcome, not a bug.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/** Number of lines in a working-tree file, or null if it can't be read. Trailing newline does not count as an extra empty line. */
export function countFileLines(absolutePath: string): number | null {
  try {
    if (!statSync(absolutePath).isFile()) return null;
    const content = readFileSync(absolutePath, 'utf8');
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith('\n') ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split('\n').length;
  } catch {
    return null;
  }
}

/** Number of lines in `path` as it exists at `rev`, run from `cwd`, or null if the rev/path/repo doesn't resolve. */
export function countGitBlobLines(cwd: string, rev: string, path: string): number | null {
  try {
    const out = execFileSync('git', ['show', `${rev}:${path}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (out.length === 0) return 0;
    const withoutTrailingNewline = out.endsWith('\n') ? out.slice(0, -1) : out;
    return withoutTrailingNewline.split('\n').length;
  } catch {
    return null;
  }
}
