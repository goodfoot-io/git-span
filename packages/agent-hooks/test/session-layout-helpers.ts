import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSessionLayout, type SessionLayout } from '../src/common/agent-hooks-common.js';

/**
 * A per-run session layout on the container's overlay filesystem, isolating a
 * test file from the live `~/.cache/git-span/session` base and from every
 * other test file running in parallel.
 *
 * The base is *not* mkdtemp'd directly. `layout.trashDir` is
 * `join(dirname(base), 'session-trash')` — a sibling, matching production —
 * so a base at `/tmp/xxxx` would put the trash root at a global
 * `/tmp/session-trash` that `pruneStaleSessions` both enumerates and
 * `rmSync`es, handing every parallel fork the same shared directory the
 * isolation exists to remove. Mkdtemp a *parent* and put the base inside it,
 * and the trash root is per-run for free.
 */
export interface TempSessionLayout {
  readonly layout: SessionLayout;
  /** The mkdtemp'd parent holding both the base and the trash root. */
  readonly parent: string;
  /** Remove the parent, and with it the base and the trash root. */
  cleanup(): void;
}

export function makeTempLayout(): TempSessionLayout {
  const parent = mkdtempSync(join(tmpdir(), 'agent-hooks-session-'));
  const layout = createSessionLayout(join(parent, 'session'));
  return {
    layout,
    parent,
    cleanup: () => rmSync(parent, { recursive: true, force: true })
  };
}

/**
 * A layout whose base does not exist and whose parent is a fresh temp dir —
 * for the cases that must exercise the absent-base branch rather than depend
 * on whatever the shared base happened to contain.
 */
export function makeAbsentLayout(): TempSessionLayout {
  const temp = makeTempLayout();
  rmSync(temp.layout.base, { recursive: true, force: true });
  return temp;
}

/** Assert a path lies inside a temp layout's parent — never anywhere global. */
export function isInsideTempParent(temp: TempSessionLayout, path: string): boolean {
  return path === temp.parent || path.startsWith(`${temp.parent}/`) || dirname(path).startsWith(temp.parent);
}
