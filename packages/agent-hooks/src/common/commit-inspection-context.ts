/** Complete, read-only current context for an immutable inspected commit set. */

import { execFileSync } from 'node:child_process';
import { collapseByPath, renderAnchorTree } from './anchor-tree.js';
import { inlineCode, shellArgument } from './delivery-presentation.js';
import { type GitSpanCommand, resolveGitSpanCommand } from './git-span-command.js';
import { isRecord } from './guards.js';
import { type ContextSpan, decodeContextDocument } from './touch-core.js';

/** Native envelope; commit selection never invents ordinary address scopes. */
export interface CommitInspectionContextDocument {
  schema_version: 1;
  commits: string[];
  spans: ContextSpan[];
}

/** One native request, bounded by the enclosing inspection driver's remaining time. */
export interface CommitInspectionContextRequest {
  repoRoot: string;
  commits: readonly string[];
  /** Native subprocess budget, at most five seconds. */
  timeoutMs: number;
}

export type CommitInspectionContextResult =
  | { ok: true; document: CommitInspectionContextDocument }
  | { ok: false; reason: string };

export type CommitInspectionContextExecutor = (
  request: CommitInspectionContextRequest
) => Promise<CommitInspectionContextResult>;

/** Resolve an argv-only executable; injectable to exercise real child processes. */
export type CommitInspectionCommandResolver = (argv: readonly string[], cwd: string) => GitSpanCommand;

/** Decode the exact native envelope and verify its complete, deduplicated requested commit set. */
const MAX_NATIVE_BYTES = 16 * 1024 * 1024;
const MAX_REPORT_BYTES = 64 * 1024;
const MAX_COMMITS = 4096;

function commitSet(commits: readonly string[]): Set<string> {
  if (commits.length > MAX_COMMITS) throw new Error('commit count exceeds the supported limit');
  const lengths = new Set(commits.map((commit) => commit.length));
  if (lengths.size > 1 || commits.some((commit) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))) {
    throw new Error('commit identities must be full object IDs of one repository format');
  }
  return new Set(commits);
}

export function decodeCommitInspectionContext(
  stdout: string,
  requestedCommits: readonly string[]
): CommitInspectionContextDocument {
  if (Buffer.byteLength(stdout) > MAX_NATIVE_BYTES) throw new Error('native context exceeds the size limit');
  const root: unknown = JSON.parse(stdout);
  if (!isRecord(root) || Object.keys(root).sort().join(',') !== 'commits,schema_version,spans') {
    throw new Error('commit context has unsupported fields');
  }
  if (root.schema_version !== 1) throw new Error('unsupported commit context schema version');
  if (!Array.isArray(root.commits) || root.commits.some((commit) => typeof commit !== 'string')) {
    throw new Error('commit context identities must be an array of strings');
  }
  const commits = root.commits as string[];
  const actual = commitSet(commits);
  const expected = commitSet(requestedCommits);
  if (actual.size !== commits.length || actual.size !== expected.size || [...actual].some((id) => !expected.has(id))) {
    throw new Error('commit context does not contain the exact selected commit set');
  }
  // Decode the existing anchor/status wire model without asserting address
  // scopes or mutation fields in the commit-specific native envelope.
  const decoded = decodeContextDocument(
    JSON.stringify({
      schema_version: 2,
      scopes: [],
      mutation: {
        requested: false,
        rewritten: false,
        spans_touched: 0,
        anchors_updated: 0,
        anchors_removed: 0,
        identities_collapsed: 0
      },
      spans: root.spans
    })
  );
  const names = new Set<string>();
  for (const span of decoded.spans) {
    if (span.name.length === 0 || names.has(span.name) || span.anchors.length === 0 || span.overlaps.length !== 0) {
      throw new Error('commit context requires distinct nonempty complete spans without address overlaps');
    }
    names.add(span.name);
    const anchorIds = new Set<string>();
    for (const [ordinal, anchor] of span.anchors.entries()) {
      if (anchor.ordinal !== ordinal || anchor.id.length === 0 || anchorIds.has(anchor.id)) {
        throw new Error('commit context contains inconsistent anchor identities');
      }
      anchorIds.add(anchor.id);
    }
  }
  return { schema_version: 1, commits, spans: decoded.spans };
}

/** Build the bounded native executor without a shell or metadata mutation. */
export function createDefaultCommitInspectionExecutor(
  resolveCommand: CommitInspectionCommandResolver = resolveGitSpanCommand
): CommitInspectionContextExecutor {
  return async (request) => {
    try {
      commitSet(request.commits);
      if (request.commits.length === 0) return { ok: true, document: { schema_version: 1, commits: [], spans: [] } };
      if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)
        throw new Error('inspection deadline exhausted');
      const command = resolveCommand(['commit-context', ...request.commits], request.repoRoot);
      const stdout = execFileSync(command.executable, command.argv, {
        cwd: request.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: Math.max(1, Math.min(5000, Math.floor(request.timeoutMs))),
        maxBuffer: MAX_NATIVE_BYTES + 1
      });
      return { ok: true, document: decodeCommitInspectionContext(stdout, request.commits) };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'native query failed' };
    }
  };
}

/** Render every current anchor and explanation, or reject a report beyond 64 KiB. */
export function renderCommitInspectionContext(document: CommitInspectionContextDocument): string | null {
  if (document.spans.length === 0) return null;
  const sections = document.spans.map((span) => {
    const anchors = span.anchors.map((anchor) => {
      const location = anchor.current ?? anchor.anchored;
      const status = anchor.status;
      const label =
        status.code === 'CONTENT_UNAVAILABLE'
          ? `content unavailable: ${status.reason.toLowerCase().replaceAll('_', ' ')}`
          : status.code.toLowerCase().replaceAll('_', ' ');
      return {
        path: location.path,
        range:
          location.extent.kind === 'whole'
            ? { kind: 'whole-file' as const }
            : { kind: 'range' as const, start: location.extent.start, end: location.extent.end },
        suffix: status.code === 'FRESH' ? '' : ` — ${label}`
      };
    });
    const tree = renderAnchorTree(collapseByPath(anchors));
    return [`## ${span.name}`, ...tree, ...(span.why === null ? [] : ['', span.why])].join('\n');
  });
  const report = `\n<git-span>\n\n${sections.join('\n\n---\n\n')}\n\n</git-span>\n`;
  if (Buffer.byteLength(report) > MAX_REPORT_BYTES)
    throw new Error('complete report exceeds the 64 KiB delivery limit');
  return report;
}

function unavailable(selection: { repoRoot: string; commits: readonly string[] }, reason: string): string {
  const command = [
    'git',
    '-C',
    shellArgument(selection.repoRoot),
    'span',
    'commit-context',
    ...selection.commits.map(shellArgument)
  ].join(' ');
  const detail = reason.replace(/\p{Cc}/gu, ' ').slice(0, 200);
  const exact = `\nGit span commit context unavailable: ${detail}. Retrieve complete native context with ${inlineCode(command)}.\n`;
  if (Buffer.byteLength(exact) <= 4096) return exact;
  const root = Buffer.byteLength(selection.repoRoot) <= 1024 ? shellArgument(selection.repoRoot) : '<repository>';
  return `\nGit span commit context unavailable: ${detail}. The complete selection contains ${selection.commits.length} commits; its IDs cannot fit in this notice. Native retrieval syntax: ${inlineCode(`git -C ${root} span commit-context <full-commit-id>...`)}. Supply the complete selected commit set; no partial report was delivered.\n`;
}

/** Query and render within the driver's shared performance.now() deadline. */
export async function runCommitInspectionContext(
  selection: { repoRoot: string; commits: readonly string[] },
  deadlineMs: number,
  executor: CommitInspectionContextExecutor = createDefaultCommitInspectionExecutor()
): Promise<string | null> {
  if (selection.commits.length === 0) return null;
  try {
    const timeoutMs = Math.min(5000, Math.floor(deadlineMs - performance.now()));
    if (timeoutMs <= 0) throw new Error('inspection deadline exhausted');
    const result = await executor({ ...selection, timeoutMs });
    if (!result.ok) return unavailable(selection, result.reason);
    const complete = decodeCommitInspectionContext(JSON.stringify(result.document), selection.commits);
    const report = renderCommitInspectionContext(complete);
    if (performance.now() >= deadlineMs) throw new Error('inspection deadline exhausted');
    return report;
  } catch (error) {
    return unavailable(selection, error instanceof Error ? error.message : 'native query failed');
  }
}
