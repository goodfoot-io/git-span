import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toPosix } from '../src/pre-tool-use.js';

/**
 * Initialise an empty git repo in a fresh temp directory and return its
 * absolute path. Caller invokes `cleanup()` to remove it.
 */
export function makeTempRepo(): { root: string; cleanup: () => void } {
  // Canonical POSIX form: matches what `git rev-parse --show-toplevel`
  // (via resolveRepoRoot) returns even on Windows.
  const root = toPosix(mkdtempSync(join(tmpdir(), 'agent-hooks-')));
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}
