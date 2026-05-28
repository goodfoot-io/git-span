/**
 * Stop hook: reads the per-session touch journal, drives `git mesh stale
 * --porcelain --batch` and `git mesh list --porcelain --batch`, assembles a
 * status document, and returns `decision: 'block'` with a `reason` instructing
 * the main agent to dispatch a background subagent for mesh review.
 *
 * Stop hooks cannot return `additionalContext`, so `decision: 'block'` + `reason`
 * is the only channel that reaches the agent loop. The block keeps the session
 * alive long enough for the agent to act; the `stop_hook_active` guard at the top
 * of the handler allows the subsequent stop so the session can actually end.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { type HookContext, type StopInput, stopHook, stopOutput } from '@goodfoot/claude-code-hooks';
import {
  formatAnchor,
  type LineRange,
  parsePorcelain,
  rangesIntersect,
  resolveRepoRoot,
  sanitizeSessionId,
  type TouchKind
} from './agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JournalEntry {
  tool: string;
  path: string;
  kind: TouchKind;
  seen: boolean;
  start?: number;
  end?: number;
}

// ---------------------------------------------------------------------------
// Journal I/O
// ---------------------------------------------------------------------------

const JOURNAL_BASE_DIR = nodePath.join(os.homedir(), '.cache', 'git-mesh', 'session');

export function journalDir(sessionId: string): string {
  return nodePath.join(JOURNAL_BASE_DIR, sanitizeSessionId(sessionId));
}

export function journalPath(sessionId: string): string {
  return nodePath.join(journalDir(sessionId), 'touches.jsonl');
}

export function loadJournal(sessionId: string): JournalEntry[] | null {
  const path = journalPath(sessionId);
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const entries: JournalEntry[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as JournalEntry;
      if (typeof e.path === 'string' && typeof e.kind === 'string') {
        entries.push(e);
      }
    } catch (_) {
      // unparseable line — skip
      void _;
    }
  }
  return entries.length === 0 ? null : entries;
}

export function writeJournal(
  sessionId: string,
  entries: JournalEntry[],
  logger: Pick<HookContext['logger'], 'warn'>
): void {
  const path = journalPath(sessionId);
  const tmpPath = `${path}.tmp`;
  try {
    const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, path);
  } catch (err) {
    logger.warn('journal rewrite failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Anchor building
// ---------------------------------------------------------------------------

interface AnchorSpec {
  path: string;
  kind: TouchKind;
  range?: LineRange;
}

/**
 * Build deduplicated anchor specs from journal entries.
 * Groups by (path, kind); for ranged kinds union all ranges.
 * Order: stable by first appearance.
 */
export function buildAnchorSpecs(entries: JournalEntry[]): AnchorSpec[] {
  // key: `${kind}:${path}`
  const order: string[] = [];
  const ranged = new Map<string, LineRange>(); // for read/write kinds
  const whole = new Set<string>(); // for whole/create kinds

  for (const e of entries) {
    const key = `${e.kind}:${e.path}`;
    if (e.kind === 'read' || e.kind === 'write') {
      if (e.start !== undefined && e.end !== undefined) {
        const existing = ranged.get(key);
        if (existing) {
          existing.start = Math.min(existing.start, e.start);
          existing.end = Math.max(existing.end, e.end);
        } else {
          if (!order.includes(key)) order.push(key);
          ranged.set(key, { start: e.start, end: e.end });
        }
      }
    } else {
      // whole or create
      if (!whole.has(key)) {
        whole.add(key);
        if (!order.includes(key)) order.push(key);
      }
    }
  }

  return order.map((key) => {
    const colonIdx = key.indexOf(':');
    const kind = key.slice(0, colonIdx) as TouchKind;
    const path = key.slice(colonIdx + 1);
    if (kind === 'read' || kind === 'write') {
      return { path, kind, range: ranged.get(key) };
    }
    return { path, kind };
  });
}

/**
 * Format anchor specs to filter lines for `--batch` stdin.
 */
export function anchorSpecsToFilterText(specs: AnchorSpec[]): string {
  return `${specs.map((s) => formatAnchor(s.path, s.kind, s.range)).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Git mesh executor abstractions
// ---------------------------------------------------------------------------

export type StaleExecutor = (filterText: string, cwd: string) => string;
export type ListBatchExecutor = (filterText: string, cwd: string) => string;
export type ListRenderExecutor = (slugs: string[], cwd: string) => string;

export function createDefaultStaleExecutor(timeoutMs = 10_000): StaleExecutor {
  return (filterText, cwd) => {
    return execFileSync('git', ['mesh', 'stale', '--porcelain', '--batch'], {
      cwd,
      input: filterText,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
  };
}

export function createDefaultListBatchExecutor(timeoutMs = 10_000): ListBatchExecutor {
  return (filterText, cwd) => {
    return execFileSync('git', ['mesh', 'list', '--porcelain', '--batch'], {
      cwd,
      input: filterText,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
  };
}

export function createDefaultListRenderExecutor(timeoutMs = 10_000): ListRenderExecutor {
  return (slugs, cwd) => {
    return execFileSync('git', ['mesh', 'list', ...slugs], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
  };
}

// ---------------------------------------------------------------------------
// Overlap helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a porcelain row feeds a journal entry.
 * A whole-file row (start=0, end=0) only feeds path-only (whole/create) entries.
 * A ranged row feeds ranged entries that intersect it.
 */
function rowFeedsEntry(rowPath: string, rowStart: number, rowEnd: number, entry: JournalEntry): boolean {
  if (entry.path !== rowPath) return false;
  const isWholeRow = rowStart === 0 && rowEnd === 0;
  if (isWholeRow) {
    return entry.kind === 'whole' || entry.kind === 'create';
  }
  if (entry.kind === 'whole' || entry.kind === 'create') return false;
  if (entry.start === undefined || entry.end === undefined) return false;
  return rangesIntersect({ start: entry.start, end: entry.end }, { start: rowStart, end: rowEnd });
}

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

export interface StopHandlerDeps {
  staleExecutor: StaleExecutor;
  listBatchExecutor: ListBatchExecutor;
  listRenderExecutor: ListRenderExecutor;
}

export function createStopHandler(deps: StopHandlerDeps) {
  const { staleExecutor, listBatchExecutor, listRenderExecutor } = deps;

  return (input: StopInput, ctx: HookContext) => {
    const sessionId = input.session_id;

    // Step 0: Break the stop loop. We surface the review by returning
    // `decision: 'block'`, which forces the agent to keep going. When the agent
    // then tries to stop again this hook re-fires with `stop_hook_active = true`;
    // because the stale section persists across runs, blocking again would loop
    // indefinitely. Allow the stop in that case.
    const stopHookActive = (input as unknown as Record<string, unknown>).stop_hook_active;
    if (stopHookActive === true) return null;

    // Step 1: Load journal
    const entries = loadJournal(sessionId);
    if (!entries) return null;

    // Step 2: Resolve repo root.
    // Primary: input.cwd (present in most Stop events).
    // Fallback 1: process.cwd() (the hook process's own working directory).
    // Fallback 2: for each journal entry, resolve the entry path relative to
    //   process.cwd() and try that directory — useful when the hook is invoked
    //   from outside the repo but the journal paths hint at file locations.
    let repoRoot: string | null = null;
    const cwdField = (input as unknown as Record<string, unknown>).cwd;
    if (typeof cwdField === 'string' && cwdField.length > 0) {
      repoRoot = resolveRepoRoot(cwdField);
    }
    if (!repoRoot) {
      repoRoot = resolveRepoRoot(process.cwd());
    }
    if (!repoRoot) {
      for (const e of entries) {
        const candidate = nodePath.resolve(process.cwd(), nodePath.dirname(e.path));
        repoRoot = resolveRepoRoot(candidate);
        if (repoRoot) break;
      }
    }
    if (!repoRoot) return null;

    const finalRepoRoot = repoRoot;

    // Step 3: Build TOUCHED_ANCHORS
    const anchorSpecs = buildAnchorSpecs(entries);
    if (anchorSpecs.length === 0) return null;
    const touchedFilterText = anchorSpecsToFilterText(anchorSpecs);

    // Step 4: Stale pass
    const staleRenders: string[] = [];
    let stalePorcelain: string;
    try {
      stalePorcelain = staleExecutor(touchedFilterText, finalRepoRoot);
    } catch (err) {
      ctx.logger.warn('git mesh stale --porcelain --batch failed', { err });
      stalePorcelain = '';
    }

    if (stalePorcelain.trim()) {
      const staleRows = parsePorcelain(stalePorcelain);
      const staleSlugs = [...new Set(staleRows.map((r) => r.name))];

      // Render stale slugs
      if (staleSlugs.length > 0) {
        try {
          const rendered = listRenderExecutor(staleSlugs, finalRepoRoot);
          // Split by blank lines between mesh blocks if multiple slugs
          const blocks = splitMeshBlocks(rendered, staleSlugs.length);
          staleRenders.push(...blocks.filter(Boolean));
        } catch (err) {
          ctx.logger.warn('git mesh list (stale render) failed', { err });
        }
      }
    }

    // Step 5: Write-coverage pass — all unseen write/create entries, regardless of stale surfacing.
    // `seen` means "a current mesh anchor covers this entry's range." Stale-surfaced entries are
    // NOT pre-marked seen; they may still be uncovered by any current mesh.
    const unseenWriteEntries = entries.filter((e) => !e.seen && (e.kind === 'write' || e.kind === 'create'));

    const relatedRenders: string[] = [];
    const uncoveredLines: string[] = [];

    if (unseenWriteEntries.length > 0) {
      // Build filter specs for write-coverage pass
      const writeSpecs = buildAnchorSpecs(unseenWriteEntries);
      const writeFilterLines = writeSpecs.map((s) => formatAnchor(s.path, s.kind, s.range));
      const writeFilterText = `${writeFilterLines.join('\n')}\n`;

      let listPorcelain: string;
      try {
        listPorcelain = listBatchExecutor(writeFilterText, finalRepoRoot);
      } catch (err) {
        ctx.logger.warn('git mesh list --porcelain --batch failed', { err });
        listPorcelain = '';
      }

      // Group rows by source filter line (match by path overlap)
      const listRows = parsePorcelain(listPorcelain);
      const coveredFilterLines = new Set<string>();
      for (const row of listRows) {
        for (const filterLine of writeFilterLines) {
          const spec = parseFilterLine(filterLine);
          if (filterLineMatchesRow(spec, row.path, row.start, row.end)) {
            coveredFilterLines.add(filterLine);
          }
        }
      }

      const relatedSlugs = [...new Set(listRows.map((r) => r.name))];

      // Mark journal entries seen when a current mesh anchor covers their range.
      // This is the authoritative definition of "covered" for persistence purposes.
      for (const row of listRows) {
        for (const e of unseenWriteEntries) {
          if (!e.seen && rowFeedsEntry(row.path, row.start, row.end, e)) {
            e.seen = true;
          }
        }
      }

      for (const filterLine of writeFilterLines) {
        if (!coveredFilterLines.has(filterLine)) {
          uncoveredLines.push(filterLine);
        }
      }

      if (relatedSlugs.length > 0) {
        try {
          const rendered = listRenderExecutor(relatedSlugs, finalRepoRoot);
          const blocks = splitMeshBlocks(rendered, relatedSlugs.length);
          relatedRenders.push(...blocks.filter(Boolean));
        } catch (err) {
          ctx.logger.warn('git mesh list (related render) failed', { err });
        }
      }
    }

    // Step 6: Assemble status doc
    const sections: string[] = [];
    if (staleRenders.length > 0) {
      sections.push(`# Stale meshes\n\n${staleRenders.join('\n\n---\n\n')}`);
    }
    if (uncoveredLines.length > 0) {
      sections.push(`# Uncovered writes\n\n${uncoveredLines.map((l) => `- ${l}`).join('\n')}`);
    }
    if (relatedRenders.length > 0) {
      sections.push(`# Related meshes\n\n${relatedRenders.join('\n\n---\n\n')}`);
    }

    if (sections.length === 0) return null;

    const doc = sections.join('\n\n');

    // Step 7: Write doc to tmp
    const docPath = nodePath.join(os.tmpdir(), `git-mesh-status-${sanitizeSessionId(sessionId)}.md`);
    try {
      fs.writeFileSync(docPath, doc, 'utf8');
    } catch (err) {
      ctx.logger.warn('failed to write status doc', { err });
      return null;
    }

    // Step 8: Rewrite journal with updated seen flags
    writeJournal(sessionId, entries, ctx.logger);

    // Step 9: Block the stop and surface the dispatch instructions in `reason`.
    // Stop hooks cannot return `additionalContext`; the only channel that reaches
    // the agent loop is `decision: 'block'` with a `reason`. The hook is otherwise
    // idempotent, so re-running after the agent acts produces the same block.
    const reason = buildSystemMessage(docPath);
    return stopOutput({ decision: 'block', reason });
  };
}

// ---------------------------------------------------------------------------
// Filter line parsing helpers
// ---------------------------------------------------------------------------

interface FilterSpec {
  path: string;
  range?: LineRange;
}

function parseFilterLine(line: string): FilterSpec {
  const hashIdx = line.indexOf('#L');
  if (hashIdx === -1) return { path: line };
  const path = line.slice(0, hashIdx);
  const rangeStr = line.slice(hashIdx + 2); // after #L
  const dashIdx = rangeStr.indexOf('-L');
  if (dashIdx === -1) return { path };
  const start = parseInt(rangeStr.slice(0, dashIdx), 10);
  const end = parseInt(rangeStr.slice(dashIdx + 2), 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return { path };
  return { path, range: { start, end } };
}

function filterLineMatchesRow(spec: FilterSpec, rowPath: string, rowStart: number, rowEnd: number): boolean {
  if (spec.path !== rowPath) return false;
  if (!spec.range) {
    // path-only: matches any row on this path
    return true;
  }
  // ranged: must intersect (whole-file rows excluded by spec)
  const isWholeRow = rowStart === 0 && rowEnd === 0;
  if (isWholeRow) return false;
  return rangesIntersect(spec.range, { start: rowStart, end: rowEnd });
}

// ---------------------------------------------------------------------------
// Mesh block splitting
// ---------------------------------------------------------------------------

/**
 * Split git mesh list output into per-slug blocks.
 * Blocks are separated by blank lines; each block starts with ##.
 * Strips trailing `---` separators emitted by upstream Rust render_blocks so
 * the caller can re-join with its own single separator without doubling.
 */
function splitMeshBlocks(rendered: string, expectedCount: number): string[] {
  const stripTrailingSep = (block: string): string => block.replace(/\n+---\s*$/, '').trimEnd();

  if (expectedCount <= 1) return [stripTrailingSep(rendered.trim())].filter(Boolean);
  // Split on double newlines that precede a ## heading
  const blocks: string[] = [];
  let current = '';
  for (const line of rendered.split('\n')) {
    if (line.startsWith('## ') && current.trim()) {
      blocks.push(stripTrailingSep(current.trim()));
      current = `${line}\n`;
    } else {
      current += `${line}\n`;
    }
  }
  if (current.trim()) blocks.push(stripTrailingSep(current.trim()));
  return blocks;
}

// ---------------------------------------------------------------------------
// System message
// ---------------------------------------------------------------------------

function buildSystemMessage(docPath: string): string {
  return `A git-mesh session-status document is at ${docPath}. Spawn a background general-purpose subagent with this prompt:

  Load the git-mesh:handbook skill. Read ${docPath}.
  - For "Stale meshes", inspect each anchor and propose
    \`git mesh add\` / \`git mesh why\` edits or removals.
  - For "Uncovered writes", propose one mesh slug + \`git mesh add\`
    command if the files form a coherent subsystem; otherwise say so.
  - For "Related meshes", note any whose scope should expand to
    cover the uncovered writes instead of creating a new mesh.
  Report back in under 300 words.

Run it in the background; do not block on its result.`;
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default stopHook(
  { timeout: 30_000 },
  createStopHandler({
    staleExecutor: createDefaultStaleExecutor(),
    listBatchExecutor: createDefaultListBatchExecutor(),
    listRenderExecutor: createDefaultListRenderExecutor()
  })
);
