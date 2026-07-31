/**
 * Cross-hook per-anchor attribution checks.
 *
 * The PostToolUse touch hook and the PreToolUse commit advisor render the same
 * span from the same `git span stale --format porcelain` rows, and an agent
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

import { describe, expect, it } from 'vitest';
import { type AdvisorExecutors, type AdvisorMemoState, evaluateAdvisor } from '../../src/common/advisor-core.js';
import type { PorcelainRow, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import { runTouchHook, type TouchExecutors, type TouchWriteInput } from '../../src/common/touch-core.js';

const REPO_ROOT = '/repo';
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

/** What `git span stale` reports for that state — one row, the second range. */
const DRIFT: StalePorcelainRow[] = [{ name: SPAN, path: SPECIMENS, start: 133, end: 134, status: 'CHANGED' }];

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
async function advisorReason(anchors: PorcelainRow[], drift: StalePorcelainRow[], blocks: string): Promise<string> {
  const executors: AdvisorExecutors = {
    fix: async (): Promise<void> => {},
    list: async (): Promise<PorcelainRow[]> => anchors,
    stale: async (): Promise<StalePorcelainRow[]> => drift,
    listBlocks: async (): Promise<string> => blocks
  };
  const result = await evaluateAdvisor([SPECIMENS], REPO_ROOT, executors, createMemoryAdvisorMemoState());
  expect(result.kind).toBe('semantic-staleness');
  return 'reason' in result ? (result.reason ?? '') : '';
}

/** The touch hook's rendered block for the same repository state. */
async function touchBlock(anchors: PorcelainRow[], drift: StalePorcelainRow[]): Promise<string> {
  const executors: TouchExecutors = {
    fix: async (): Promise<{ modified: boolean }> => ({ modified: false }),
    list: async (): Promise<PorcelainRow[]> => anchors,
    stale: async (): Promise<StalePorcelainRow[]> => drift,
    why: async (): Promise<string | null> => WHY
  };
  const input: TouchWriteInput = {
    kind: 'write',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/${SPECIMENS}`,
    written: 'export const specimens = [];\n'
  };
  const output = await runTouchHook(input, executors, createMemoryMemoStore());
  return output.additionalContext ?? '';
}

/** Every anchor address carrying a ` — <label>` suffix in a rendered block. */
function markedAnchors(rendered: string): string[] {
  const marked: string[] = [];
  for (const line of rendered.split('\n')) {
    const match = /^- (\S+) — /.exec(line);
    if (match) marked.push(match[1]);
  }
  return marked;
}

describe('per-anchor drift attribution agrees across both hooks', () => {
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
    const healedDrift: StalePorcelainRow[] = [{ name: SPAN, path: COMPONENT, start: 40, end: 60, status: 'CHANGED' }];
    const blocks = [`## ${SPAN}`, `- ${COMPONENT}#L36-L36`, `- ${SPECIMENS}#L108-L109`, '', WHY].join('\n');

    const reason = await advisorReason(soleAnchors, healedDrift, blocks);

    expect(markedAnchors(reason)).toEqual([`${COMPONENT}#L36-L36`]);
    expect(markedAnchors(reason)).toEqual(markedAnchors(await touchBlock(soleAnchors, healedDrift)));
  });

  it('appends an unmatchable finding rather than dropping it', async () => {
    // Multiple anchors on the path *and* no exact range match: the guarded
    // fallback declines to guess, so the finding is appended as its own bullet
    // instead of mislabeling an anchor or vanishing.
    const orphanDrift: StalePorcelainRow[] = [{ name: SPAN, path: SPECIMENS, start: 200, end: 210, status: 'CHANGED' }];

    const reason = await advisorReason(ANCHORS, orphanDrift, LIST_BLOCKS);

    expect(markedAnchors(reason)).toEqual([`${SPECIMENS}#L200-L210`]);
  });
});
