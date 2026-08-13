import { describe, expect, it } from 'vitest';
import { type AdvisorExecutors, type AdvisorMemoState, evaluateAdvisor } from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';

const REPO_ROOT = '/repo';

function createMemoryAdvisorMemoState(): AdvisorMemoState {
  const entries = new Set<string>();
  return {
    has: (entry) => entries.has(entry),
    record: (entry) => {
      entries.add(entry);
      return true;
    }
  };
}

function createExecutors(overrides: Partial<AdvisorExecutors> = {}): AdvisorExecutors {
  return {
    fix: async () => {},
    drift: async (): Promise<DriftPorcelainRow[]> => [],
    list: async (): Promise<PorcelainRow[]> => [],
    listBlocks: async () => '',
    ...overrides
  };
}

function driftRow(path: string, name: string): DriftPorcelainRow {
  return { status: 'CHANGED', path, name, start: 1, end: 10 };
}

describe('report-only advisor memoization', () => {
  it('stays silent when an identical uncovered-write preview has no new paths', async () => {
    const memo = createMemoryAdvisorMemoState();
    const executors = createExecutors();
    const paths = ['src/first.ts', 'src/first-helper.ts'];

    expect((await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only')).kind).toBe(
      'uncovered-writes-report'
    );
    expect(await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only')).toEqual({
      decision: 'allow',
      kind: 'silent'
    });
  });

  it('reports only a newly uncovered path when an old and new path are previewed together', async () => {
    const memo = createMemoryAdvisorMemoState();
    const executors = createExecutors();

    await evaluateAdvisor(['src/first.ts', 'src/first-helper.ts'], REPO_ROOT, executors, memo, 'report-only');
    const mixed = await evaluateAdvisor(
      ['src/first.ts', 'src/first-helper.ts', 'src/second.ts'],
      REPO_ROOT,
      executors,
      memo,
      'report-only'
    );

    expect(mixed.kind).toBe('uncovered-writes-report');
    if (mixed.kind === 'uncovered-writes-report') {
      expect(mixed.uncovered).toEqual(['src/second.ts']);
      expect(mixed.reason).toContain('src/second.ts');
      expect(mixed.reason).not.toContain('src/first.ts');
      expect(mixed.reason).not.toContain('src/first-helper.ts');
    }
  });

  it('stays silent when an identical semantic-drift preview has no new rows', async () => {
    const memo = createMemoryAdvisorMemoState();
    const rows = [driftRow('src/first.ts', 'first-span')];
    const executors = createExecutors({ drift: async () => rows });
    const paths = ['src/first.ts'];

    expect((await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only')).kind).toBe(
      'semantic-drift-report'
    );
    expect(await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only')).toEqual({
      decision: 'allow',
      kind: 'silent'
    });
  });

  it('reports only a newly drifted row when an old and new row are previewed together', async () => {
    const memo = createMemoryAdvisorMemoState();
    let rows = [driftRow('src/first.ts', 'first-span')];
    const executors = createExecutors({ drift: async () => rows });

    await evaluateAdvisor(['src/first.ts'], REPO_ROOT, executors, memo, 'report-only');
    rows = [...rows, driftRow('src/second.ts', 'second-span')];
    const mixed = await evaluateAdvisor(['src/first.ts', 'src/second.ts'], REPO_ROOT, executors, memo, 'report-only');

    expect(mixed.kind).toBe('semantic-drift-report');
    if (mixed.kind === 'semantic-drift-report') {
      expect(mixed.findings).toEqual([driftRow('src/second.ts', 'second-span')]);
      expect(mixed.reason).toContain('second-span');
      expect(mixed.reason).not.toContain('first-span');
    }
  });
});
