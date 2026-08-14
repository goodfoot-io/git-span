import { join } from 'node:path';
import {
  type DriftPorcelainRow,
  type LineRange,
  type PorcelainRow,
  rangesIntersect
} from '../src/common/agent-hooks-common.js';
import type {
  ContextDocument,
  ContextExtent,
  ContextQueryRequest,
  ContextStatus,
  TouchExecutors
} from '../src/common/touch-core.js';

export interface SurfaceFake {
  fix: (filePath: string, cwd: string) => Promise<{ modified: boolean }>;
  list: (filePath: string, cwd: string) => Promise<PorcelainRow[]>;
  drift: (args: string[], cwd: string) => Promise<DriftPorcelainRow[]>;
  why: (name: string, cwd: string) => Promise<string | null>;
  forInvocation?: () => SurfaceFake;
}

function parseAddress(address: string): { path: string; extent: ContextExtent } {
  const match = address.match(/^(.*)#L(\d+)-L(\d+)$/);
  if (match === null) return { path: address, extent: { kind: 'whole' } };
  return {
    path: match[1],
    extent: { kind: 'lines', start: Number(match[2]), end: Number(match[3]) }
  };
}

function extentRange(extent: ContextExtent): LineRange | 'whole-file' {
  return extent.kind === 'whole' ? 'whole-file' : { start: extent.start, end: extent.end };
}

function intersection(scope: ContextExtent, row: PorcelainRow): ContextExtent | null {
  const scoped = extentRange(scope);
  if (row.start === 0 && row.end === 0) return scope;
  if (scoped === 'whole-file') return { kind: 'lines', start: row.start, end: row.end };
  const anchored = { start: row.start, end: row.end };
  if (!rangesIntersect(scoped, anchored)) return null;
  return { kind: 'lines', start: Math.max(scoped.start, row.start), end: Math.min(scoped.end, row.end) };
}

function status(
  row: PorcelainRow,
  drift: readonly DriftPorcelainRow[],
  anchors: readonly PorcelainRow[]
): ContextStatus {
  const soleOnPath = anchors.filter((anchor) => anchor.path === row.path).length === 1;
  const found = drift.find(
    (candidate) =>
      candidate.name === row.name &&
      candidate.path === row.path &&
      (soleOnPath || (candidate.start === row.start && candidate.end === row.end))
  );
  if (found === undefined || found.status === 'FRESH') return { code: 'FRESH' };
  if (
    found.status === 'LFS_NOT_FETCHED' ||
    found.status === 'LFS_NOT_INSTALLED' ||
    found.status === 'PROMISOR_MISSING' ||
    found.status === 'SPARSE_EXCLUDED' ||
    found.status === 'FILTER_FAILED' ||
    found.status === 'IO_ERROR'
  ) {
    return { code: 'CONTENT_UNAVAILABLE', reason: found.status, detail: null };
  }
  return { code: found.status };
}

async function query(fake: SurfaceFake, request: ContextQueryRequest) {
  const parsed = request.addresses.map(parseAddress);
  const paths = [...new Set(parsed.map(({ path }) => path))];
  try {
    const fixes = request.repair
      ? await Promise.all(paths.map((path) => fake.fix(join(request.repoRoot, path), request.repoRoot)))
      : [];
    const covering = (
      await Promise.all(paths.map((path) => fake.list(join(request.repoRoot, path), request.repoRoot)))
    ).flat();
    const anchors = [
      ...new Map(covering.map((row) => [`${row.name}\0${row.path}\0${row.start}\0${row.end}`, row] as const)).values()
    ];
    const drift = await fake.drift(
      paths.map((path) => join(request.repoRoot, path)),
      request.repoRoot
    );
    const byName = new Map<string, PorcelainRow[]>();
    for (const row of anchors) {
      const rows = byName.get(row.name) ?? [];
      rows.push(row);
      byName.set(row.name, rows);
    }
    const scopes = parsed.map(({ path, extent }) => ({ path, extent }));
    const spans = await Promise.all(
      [...byName].map(async ([name, rows]) => ({
        name,
        why: await fake.why(name, request.repoRoot),
        overlaps: rows.flatMap((row, ordinal) =>
          scopes.flatMap((scope, scopeIndex) => {
            if (scope.path !== row.path) return [];
            const overlap = intersection(scope.extent, row);
            if (overlap === null) return [];
            return [
              {
                scope: scopeIndex,
                anchor: { ordinal, id: `${name}:${ordinal}` },
                basis: 'anchored' as const,
                location: {
                  path: row.path,
                  extent:
                    row.start === 0 && row.end === 0
                      ? ({ kind: 'whole' } as const)
                      : ({ kind: 'lines', start: row.start, end: row.end } as const)
                },
                intersection: overlap
              }
            ];
          })
        ),
        anchors: rows.map((row, ordinal) => ({
          ordinal,
          id: `${name}:${ordinal}`,
          anchored: {
            path: row.path,
            extent:
              row.start === 0 && row.end === 0
                ? ({ kind: 'whole' } as const)
                : ({ kind: 'lines', start: row.start, end: row.end } as const)
          },
          current: null,
          status: status(row, drift, rows),
          source: 'WORKTREE' as const,
          sources: ['WORKTREE' as const]
        }))
      }))
    );
    const rewritten = fixes.some(({ modified }) => modified);
    const document: ContextDocument = {
      schema_version: 1,
      scopes,
      mutation: {
        requested: request.repair,
        rewritten,
        spans_touched: rewritten ? 1 : 0,
        anchors_updated: rewritten ? 1 : 0,
        anchors_removed: 0,
        identities_collapsed: 0
      },
      spans
    };
    return { ok: true as const, document, elapsedMs: 0 };
  } catch {
    return { ok: false as const, failure: 'schema_rejected' as const, elapsedMs: 0 };
  }
}

/** Adapt old row-oriented fixtures at the test boundary; production has no such surface. */
export function contextExecutors(fake: SurfaceFake): TouchExecutors {
  const executors: TouchExecutors = {
    context: (request) => query(fake, request),
    ...(fake.forInvocation === undefined ? {} : { forInvocation: () => contextExecutors(fake.forInvocation!()) })
  };
  return executors;
}
