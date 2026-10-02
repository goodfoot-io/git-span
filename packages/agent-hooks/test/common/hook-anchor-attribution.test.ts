/** Touch drift marks the exact anchor, with path fallback only for a single anchor. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import { runTouchHook, type TouchExecutors, type TouchWriteInput } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

// The touch hook's write gate (plan §3 step 1) verifies the target exists on
// disk before any executor call, so the fixtures run against a real temp repo
// with the drift target seeded (the executors stay fakes).
let REPO_ROOT = '/repo';
const SESSION_ID = 'session-hook-anchor-attribution';
const SPAN = 'website/specimen-hardwrap-coupling';
const WHY = 'Specimen copy is hard-wrapped in the component and mirrored in the specimen table.';

const COMPONENT = 'packages/website/app/components/marketing/story/Specimen.tsx';
const SPECIMENS = 'packages/website/app/components/marketing/story/specimens.ts';

/**
 * The span's declared anchors: two disjoint ranges in each of two files. The
 * drift lands in the *second* `specimens.ts` range, so a renderer that matches
 * on path alone marks the wrong one.
 */
const ANCHORS: PorcelainRow[] = [
  { name: SPAN, path: COMPONENT, start: 36, end: 36 },
  { name: SPAN, path: COMPONENT, start: 52, end: 52 },
  { name: SPAN, path: SPECIMENS, start: 108, end: 109 },
  { name: SPAN, path: SPECIMENS, start: 133, end: 134 }
];

/** What `git span drift` reports for that state — one row, the second range. */
const DRIFT: DriftPorcelainRow[] = [{ name: SPAN, path: SPECIMENS, start: 133, end: 134, status: 'CHANGED' }];

function createMemoryMemoStore(): MemoStore {
  const bySession = new Map<string, Set<string>>();
  return {
    getSurfaced(sessionId: string): Set<string> {
      return new Set(bySession.get(sessionId) ?? []);
    },
    addSurfaced(sessionId: string, names: string[], known: ReadonlySet<string>): void {
      bySession.set(sessionId, new Set([...known, ...names]));
    }
  };
}

/** The touch hook's rendered block for the same repository state. */
async function touchBlock(anchors: PorcelainRow[], drift: DriftPorcelainRow[]): Promise<string> {
  const executors: TouchExecutors = contextExecutors({
    fix: async (): Promise<{ modified: boolean }> => ({ modified: false }),
    list: async (): Promise<PorcelainRow[]> => anchors,
    drift: async (): Promise<DriftPorcelainRow[]> => drift,
    why: async (): Promise<string | null> => WHY
  });
  // `written: ''` scopes the touch whole-file: the fixture's anchors sit at
  // lines 36-134 while the seeded file is a one-line stub, so a recovered
  // range could never intersect them — the check is about attribution,
  // not range scoping (which touch-core.test.ts covers).
  const input: TouchWriteInput = {
    kind: 'write',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/${SPECIMENS}`,
    invocationId: `${SESSION_ID}:test-event`,
    written: ''
  };
  const output = await runTouchHook(input, executors, createMemoryMemoStore());
  return output.additionalContext ?? '';
}

/**
 * Every anchor address carrying a ` — <label>` suffix in a rendered block.
 *
 * The touch hook renders anchors as a tree, so an address is spread across the
 * directory lines above it and, for a stacked range, sits on a continuation
 * line carrying no filename at all. Reassembling it is what makes this file
 * assert attribution rather than absence: a parser that only recognized the
 * flat `- path#range — label` bullet would return `[]` for every tree, and
 * `[]` compares equal to `[]` without proving attribution.
 */
function markedAnchors(rendered: string): string[] {
  const marked: string[] = [];
  const dirs: { indent: number; name: string }[] = [];
  let file: string | null = null;
  for (const line of rendered.split('\n')) {
    const branch = /^([ │]*)(?:├─|└─) (.*)$/.exec(line);
    if (branch) {
      const [, pad, rest] = branch;
      while (dirs.length > 0 && dirs[dirs.length - 1].indent >= pad.length) dirs.pop();
      if (rest.endsWith('/')) {
        dirs.push({ indent: pad.length, name: rest });
        file = null;
        continue;
      }
      const anchor = /^(\S+)\s+(#L\d+-L\d+)( — .+)?$/.exec(rest);
      file = anchor ? `${dirs.map((dir) => dir.name).join('')}${anchor[1]}` : null;
      if (anchor?.[3]) marked.push(`${file}${anchor[2]}`);
      continue;
    }
    const stacked = /^[ │]*(#L\d+-L\d+)( — .+)?$/.exec(line);
    if (stacked?.[2] && file !== null) marked.push(`${file}${stacked[1]}`);
  }
  return marked;
}

describe('per-anchor touch drift attribution', () => {
  let repo: { root: string; cleanup: () => void };

  beforeAll(() => {
    repo = makeTempRepo();
    mkdirSync(join(repo.root, 'packages/website/app/components/marketing/story'), { recursive: true });
    writeFileSync(join(repo.root, SPECIMENS), 'export const specimens = [];\n');
    REPO_ROOT = repo.root;
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('marks the range that drifted, not the first range on its path', async () => {
    const reason = await touchBlock(ANCHORS, DRIFT);

    expect(markedAnchors(reason)).toEqual([`${SPECIMENS}#L133-L134`]);
  });

  it('still falls back to path-only matching when the span has one anchor on the path', async () => {
    // Ranges legitimately disagree after a heal: the CLI names #L40-L60 while
    // the list still shows #L36-L36. With a single anchor on that path the
    // fallback is unambiguous, so the anchor is marked anyway.
    const soleAnchors: PorcelainRow[] = [
      { name: SPAN, path: COMPONENT, start: 36, end: 36 },
      { name: SPAN, path: SPECIMENS, start: 108, end: 109 }
    ];
    const healedDrift: DriftPorcelainRow[] = [{ name: SPAN, path: COMPONENT, start: 40, end: 60, status: 'CHANGED' }];

    const reason = await touchBlock(soleAnchors, healedDrift);

    expect(markedAnchors(reason)).toEqual([`${COMPONENT}#L36-L36`]);
  });
});
