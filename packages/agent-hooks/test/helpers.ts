import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toPosix } from '../src/common/agent-hooks-common.js';

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

/**
 * The element of `items` at `index` (negative counts from the end), failing
 * the test with a positional message when it is absent — an indexed read that
 * stays honest under `noUncheckedIndexedAccess` without a non-null assertion.
 */
export function itemAt<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) throw new Error(`expected an element at index ${index}, but the list has ${items.length}`);
  return item;
}

/** Return `value`, failing the test with a message naming `what` when it is absent (`undefined` or `null`). */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be present`);
  return value;
}
