/**
 * Cross-hook per-anchor attribution checks.
 *
 * The PostToolUse touch hook and the PreToolUse commit advisor render the same
 * span from the same `git span drift --format porcelain` rows, and an agent
 * routinely sees both in one session. When they disagree about *which* anchor
 * drifted, the agent has no way to decide which to believe — so these checks
 * drive both renderers over one repository state and assert they mark the same
 * anchor.
 *
 * The shape that exposes divergence is a span anchoring several disjoint
 * ranges in one file: the advisor's path-only fallback matches the first
 * bullet for a path regardless of range, while the touch hook permits that
 * fallback only when the span has a single anchor on the path.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdvisorExecutors, type AdvisorMemoState, evaluateAdvisor } from '../../src/common/advisor-core.js';
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

/** The human block `git span list` renders for the span, bullets in anchor order. */
const LIST_BLOCKS = [
  `## ${SPAN}`,
  `- ${COMPONENT}#L36-L36`,
  `- ${COMPONENT}#L52-L52`,
  `- ${SPECIMENS}#L108-L109`,
  `- ${SPECIMENS}#L133-L134`,
  '',
  WHY
].join('\n');

function createMemoryMemoStore(): MemoStore {
  const bySession = new Map<string, Set<string>>();
  return {
    getSurfaced(sessionId: string): Set<string> {
      return new Set(bySession.get(sessionId) ?? []);
    },
    addSurfaced(sessionId: string, names: string[]): void {
      const existing = bySession.get(sessionId) ?? new Set<string>();
      for (const n of names) existing.add(n);
      bySession.set(sessionId, existing);
    }
  };
}

function createMemoryAdvisorMemoState(): AdvisorMemoState {
  const digests = new Set<string>();
  return {
    has: (digest: string): boolean => digests.has(digest),
    record: (digest: string): boolean => {
      digests.add(digest);
      return true;
    }
  };
}

/** The advisor's rendered checklist for the shared repository state. */
async function advisorReason(anchors: PorcelainRow[], drift: DriftPorcelainRow[], blocks: string): Promise<string> {
  const executors: AdvisorExecutors = {
    fix: async (): Promise<void> => {},
    list: async (): Promise<PorcelainRow[]> => anchors,
    drift: async (): Promise<DriftPorcelainRow[]> => drift,
    listBlocks: async (): Promise<string> => blocks
  };
  const result = await evaluateAdvisor([SPECIMENS], REPO_ROOT, executors, createMemoryAdvisorMemoState());
  expect(result.kind).toBe('semantic-drift');
  return 'reason' in result ? (result.reason ?? '') : '';
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
  // range could never intersect them — the parity check is about attribution,
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
 * Both hooks render anchors as a tree, so an address is spread across the
 * directory lines above it and, for a stacked range, sits on a continuation
 * line carrying no filename at all. Reassembling it is what makes this file
 * assert attribution rather than absence: a parser that only recognized the
 * flat `- path#range — label` bullet would return `[]` for every tree, and
 * `[]` compares equal to `[]` in the cross-hook check below.
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

describe('per-anchor drift attribution agrees across both hooks', () => {
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
    const reason = await advisorReason(ANCHORS, DRIFT, LIST_BLOCKS);

    expect(markedAnchors(reason)).toEqual([`${SPECIMENS}#L133-L134`]);
  });

  it('renders the same marked anchor as the touch hook on identical repository state', async () => {
    const reason = await advisorReason(ANCHORS, DRIFT, LIST_BLOCKS);
    const block = await touchBlock(ANCHORS, DRIFT);

    expect(markedAnchors(reason)).toEqual(markedAnchors(block));
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
    const blocks = [`## ${SPAN}`, `- ${COMPONENT}#L36-L36`, `- ${SPECIMENS}#L108-L109`, '', WHY].join('\n');

    const reason = await advisorReason(soleAnchors, healedDrift, blocks);

    expect(markedAnchors(reason)).toEqual([`${COMPONENT}#L36-L36`]);
    expect(markedAnchors(reason)).toEqual(markedAnchors(await touchBlock(soleAnchors, healedDrift)));
  });

  it('appends an unmatchable finding rather than dropping it', async () => {
    // Multiple anchors on the path *and* no exact range match: the guarded
    // fallback declines to guess, so the finding is appended as its own bullet
    // instead of mislabeling an anchor or vanishing.
    const orphanDrift: DriftPorcelainRow[] = [{ name: SPAN, path: SPECIMENS, start: 200, end: 210, status: 'CHANGED' }];

    const reason = await advisorReason(ANCHORS, orphanDrift, LIST_BLOCKS);

    expect(markedAnchors(reason)).toEqual([`${SPECIMENS}#L200-L210`]);
  });
});
