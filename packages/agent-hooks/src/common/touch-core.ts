/**
 * Harness-agnostic touch-hook core.
 *
 * This module implements the PostToolUse "touch signal" that both the Claude
 * (`Read|Edit|Write`) and Codex (`apply_patch`) adapters drive. It imports
 * nothing from either hook SDK and is typed structurally, per the `common/`
 * layer convention: adapters translate their SDK-specific hook input into a
 * {@link TouchInput}, inject execution/state dependencies, and wrap the returned
 * {@link TouchOutput} in their own output builder.
 *
 * Reused from the shared kernel (not redefined): `isDebt()` +
 * `PorcelainStatus`/`StalePorcelainRow`/`PorcelainRow`/`parsePorcelain`/
 * `parseStalePorcelain` (agent-hooks-common.ts), `rangesIntersect` and the
 * repo/span-root path utilities (agent-hooks-common.ts), and the `MemoStore`
 * cadence store (span-surface.ts).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import {
  isDebt,
  type LineRange,
  type PorcelainRow,
  type PorcelainStatus,
  parsePorcelain,
  parseStalePorcelain,
  rangesIntersect,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot,
  type StalePorcelainRow
} from './agent-hooks-common.js';
import type { MemoStore } from './span-surface.js';

// ---------------------------------------------------------------------------
// Post-edit range recovery
// ---------------------------------------------------------------------------

/**
 * Split written content into the lines to locate on disk. A single trailing
 * newline is dropped so `"a\nb\n"` and `"a\nb"` locate identically; an empty
 * (or newline-only) write has no locatable block.
 */
function toNeedleLines(written: string): string[] {
  if (written.length === 0) return [];
  const trimmed = written.endsWith('\n') ? written.slice(0, -1) : written;
  if (trimmed.length === 0) return [];
  return trimmed.split('\n');
}

/**
 * Recover the line range that written content now occupies in the on-disk file,
 * for anchoring the touched region after an edit has already applied.
 *
 * This generalizes the pre-edit `locateChunk()` technique in
 * [apply-patch.ts](./packages/agent-hooks/src/codex/apply-patch.ts#L253-L286)
 * (previously Codex-only) into a shared post-edit primitive both harnesses use:
 * split `written` and `onDiskContent` into lines and locate the written block as
 * a contiguous run inside the on-disk lines.
 *
 * - A single contiguous match yields its 1-based inclusive {@link LineRange}.
 * - When the block is absent, or appears more than once (context to disambiguate
 *   is not available post-edit), recovery is ambiguous and the result degrades
 *   to `'whole-file'` (the same fallback `locateChunk()` signals with `null`).
 *
 * Never throws: an unlocatable write is a `'whole-file'` answer, not an error.
 */
export function recoverRange(written: string, onDiskContent: string): LineRange | 'whole-file' {
  const needle = toNeedleLines(written);
  if (needle.length === 0) return 'whole-file';

  const haystack = onDiskContent.split('\n');
  const last = haystack.length - needle.length;
  const starts: number[] = [];
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i);
      if (starts.length > 1) break; // duplicated → ambiguous, stop early
    }
  }

  if (starts.length === 1) {
    return { start: starts[0] + 1, end: starts[0] + needle.length };
  }
  return 'whole-file';
}

// ---------------------------------------------------------------------------
// Touch input
// ---------------------------------------------------------------------------

/**
 * Which harness event fired, as the touch core sees it. The core branches on
 * this: `write` heals positional drift in the working tree and may surface a
 * merged block; `read` never mutates the tree and filters positional statuses
 * out of what it surfaces.
 */
export type TouchEventKind = 'read' | 'write';

/** Fields shared by every touch, regardless of kind. */
interface TouchInputBase {
  /** Harness session id — keys the per-session cadence {@link MemoStore}. */
  sessionId: string;
  /**
   * Working directory the tool ran in, used to bound the touch to the CWD repo
   * via `resolveTouchScope()` before any span invocation.
   */
  cwd: string;
  /** Absolute, canonicalized path of the touched file. */
  filePath: string;
}

/** A read touch (Claude `Read`, or a read-shaped Codex event). */
export interface TouchReadInput extends TouchInputBase {
  kind: 'read';
}

/** A write touch (Claude `Edit`/`Write`, Codex `apply_patch`). */
export interface TouchWriteInput extends TouchInputBase {
  kind: 'write';
  /**
   * The content just written to `filePath`, fed to {@link recoverRange} to
   * re-anchor the touched region against the healed on-disk file. For a
   * whole-file create this is the entire file body; an empty string means
   * "no locatable block" and the touch is scoped file-wide.
   */
  written: string;
}

/** The harness-agnostic touch the core consumes. */
export type TouchInput = TouchReadInput | TouchWriteInput;

// ---------------------------------------------------------------------------
// Injected executors
// ---------------------------------------------------------------------------

/** Structured result of a scoped `git span stale <file> --fix`. */
export interface TouchFixResult {
  /**
   * Whether `--fix` re-anchored at least one span in the working tree. Drives
   * {@link TouchOutput.treeModified} so a caller/test can assert the healing
   * happened without diffing the tree itself.
   */
  modified: boolean;
}

/**
 * Run `git span stale <file> --fix` scoped to the touched file (write path
 * only), reporting whether the working tree was healed. Async so the eventual
 * implementation and its tests can inject a fake without a real subprocess.
 */
export type TouchFixExecutor = (filePath: string, cwd: string) => Promise<TouchFixResult>;

/**
 * Run `git span list --porcelain <file>` and return its parsed rows — one per
 * anchor covering the file. Structured (not raw stdout) so the merged-block
 * computation and its tests share the same shape.
 */
export type TouchListExecutor = (filePath: string, cwd: string) => Promise<PorcelainRow[]>;

/**
 * Run `git span stale --format porcelain <args>` (scoped to the touched file or
 * its spans) and return its parsed rows — one per drifted anchor, empty when
 * clean. Status classification is via `isDebt()`; positional (`MOVED`,
 * `RESOLVED_PENDING_COMMIT`) rows are never debt.
 */
export type TouchStaleExecutor = (args: string[], cwd: string) => Promise<StalePorcelainRow[]>;

/**
 * The injected execution surface. Kept as three narrow async functions (rather
 * than a raw command runner) so tests inject fakes returning structured data
 * and the core never spawns a subprocess itself. The `read` path never invokes
 * `fix`.
 */
export interface TouchExecutors {
  fix: TouchFixExecutor;
  list: TouchListExecutor;
  stale: TouchStaleExecutor;
}

// ---------------------------------------------------------------------------
// Touch output
// ---------------------------------------------------------------------------

/** What the core hands back for the adapter to translate into SDK output. */
export interface TouchOutput {
  /**
   * The merged `<git-span>` block (span render + any folded semantic directive
   * line) to inject via the harness's `additionalContext`, or `null` when there
   * is nothing worth surfacing this touch.
   */
  additionalContext: string | null;
  /**
   * Whether the working tree was modified by a scoped `--fix` on the write path.
   * Always `false` on the read path (reads never mutate the tree).
   */
  treeModified: boolean;
}

// ---------------------------------------------------------------------------
// Merged-block assembly
// ---------------------------------------------------------------------------

/** The memo key under which a span's directive for a given status is deduped. */
function directiveKey(name: string, status: PorcelainStatus): string {
  // Span names come from tab-delimited porcelain, so they never contain a tab;
  // a tab-joined key can never collide with a bare span name (the surfacing key).
  return `${name}\t${status}`;
}

/** The `path#Lstart-Lend` (or bare-path, whole-file) anchor text for a row. */
function anchorText(row: PorcelainRow): string {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}

/** One folded semantic-directive line for a drifted span. */
function directiveLine(name: string, status: PorcelainStatus): string {
  return `- ${name} (${status}): the described coupling no longer matches the code. Update its anchors/why in this change before it lands, or tell the user why the coupling no longer holds.`;
}

/** Assemble the merged `<git-span>` block from render rows + directive lines. */
function buildBlock(renderRows: PorcelainRow[], directiveLines: string[]): string {
  const parts: string[] = [];
  if (renderRows.length > 0) {
    parts.push('Spans coupled to this change:');
    for (const row of renderRows) {
      parts.push(`  ${row.name}\t${anchorText(row)}`);
    }
  }
  if (directiveLines.length > 0) {
    if (parts.length > 0) parts.push('');
    for (const line of directiveLines) parts.push(line);
  }
  return `\n<git-span>\n${parts.join('\n')}\n</git-span>\n`;
}

// ---------------------------------------------------------------------------
// Touch hook entry point
// ---------------------------------------------------------------------------

/** Whether a covering row is in scope for the recovered range. */
function intersects(row: PorcelainRow, range: LineRange | 'whole-file'): boolean {
  if (range === 'whole-file') return true;
  if (row.start === 0 && row.end === 0) return true; // whole-file anchor
  return rangesIntersect(range, { start: row.start, end: row.end });
}

/**
 * Recover the touched range from the on-disk file for a write. An empty write or
 * an unreadable file (e.g. a delete, or the file was never written) degrades to
 * `'whole-file'`, scoping the touch to every covering span — the fail-open
 * behavior, not an error.
 */
function recoverRangeFromDisk(written: string, filePath: string): LineRange | 'whole-file' {
  if (written.length === 0) return 'whole-file';
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return 'whole-file';
  }
  return recoverRange(written, content);
}

/**
 * Compute the merged `<git-span>` block for the touch, or `null` when there is
 * nothing worth surfacing. Shared by both paths; the write path passes a
 * recovered range for precision, the read path scopes file-wide.
 *
 * A covering span surfaces at most once per session; a span carrying semantic
 * debt folds one directive line per (span, status) into the same block. A span
 * whose only drift is positional (`MOVED`/`RESOLVED_PENDING_COMMIT` — never
 * `isDebt`) is filtered out entirely: positional drift never surfaces.
 */
async function computeSurface(
  input: TouchInput,
  executors: TouchExecutors,
  memo: MemoStore,
  range: LineRange | 'whole-file'
): Promise<string | null> {
  const covering = await executors.list(input.filePath, input.cwd);
  const coveringRows = covering.filter((row) => intersects(row, range));
  if (coveringRows.length === 0) return null;

  const staleRows = await executors.stale([input.filePath], input.cwd);
  const staleByName = new Map<string, Set<PorcelainStatus>>();
  for (const r of staleRows) {
    let s = staleByName.get(r.name);
    if (!s) {
      s = new Set<PorcelainStatus>();
      staleByName.set(r.name, s);
    }
    s.add(r.status);
  }

  const surfaced = memo.getSurfaced(input.sessionId);
  const toRecord: string[] = [];
  const renderRows: PorcelainRow[] = [];
  const renderedNames = new Set<string>();
  const directiveLines: string[] = [];

  for (const row of coveringRows) {
    const statuses = staleByName.get(row.name);
    const debtStatuses = statuses ? [...statuses].filter(isDebt).sort() : [];
    const positionalOnly = statuses !== undefined && statuses.size > 0 && debtStatuses.length === 0;
    if (positionalOnly) continue; // positional-only drift never surfaces

    // Surfacing: once per span per session.
    if (!surfaced.has(row.name) && !renderedNames.has(row.name)) {
      renderRows.push(row);
      renderedNames.add(row.name);
      toRecord.push(row.name);
    }

    // Directive: once per span per status.
    for (const status of debtStatuses) {
      const key = directiveKey(row.name, status);
      if (!surfaced.has(key) && !toRecord.includes(key)) {
        directiveLines.push(directiveLine(row.name, status));
        toRecord.push(key);
      }
    }
  }

  if (renderRows.length === 0 && directiveLines.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord);
  return buildBlock(renderRows, directiveLines);
}

/**
 * Run the touch hook for a single tool call, branching on {@link TouchInput.kind}.
 *
 * - **Write path**: run `executors.fix` (`git span stale <file> --fix`) scoped
 *   to the touched file to heal positional drift in the working tree, then
 *   compute the merged `<git-span>` block against the healed anchors, folding any
 *   remaining semantic residue into one directive line per (span, status) in the
 *   same block. Cadence is deduped through `memo`.
 * - **Read path**: never invokes `fix` and never mutates the tree; surfaces the
 *   overlapping spans with positional statuses filtered out via `isDebt()`.
 *
 * Fails open: any executor rejection or internal error yields
 * `additionalContext: null` (no signal, editing never blocked) rather than
 * throwing. `treeModified` reflects a successful `--fix` even when the
 * subsequent surface computation fails.
 */
export async function runTouchHook(
  input: TouchInput,
  executors: TouchExecutors,
  memo: MemoStore
): Promise<TouchOutput> {
  let treeModified = false;
  try {
    let range: LineRange | 'whole-file' = 'whole-file';
    if (input.kind === 'write') {
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = recoverRangeFromDisk(input.written, input.filePath);
    }
    const additionalContext = await computeSurface(input, executors, memo, range);
    return { additionalContext, treeModified };
  } catch {
    // Fail open: never let a touch-core error propagate up and block the tool
    // call. The tree may already have been healed (treeModified preserved).
    return { additionalContext: null, treeModified };
  }
}

// ---------------------------------------------------------------------------
// Default subprocess-backed executors
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

/** Resolve the touched file to a path relative to its repo root, for `git span`. */
function repoRelArg(filePath: string, cwd: string): { repoRoot: string; relPath: string } | null {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) return null;
  return { repoRoot, relPath: relativeToRepo(repoRoot, filePath) };
}

/**
 * A snapshot of the span root's working-tree status, used to detect whether a
 * `--fix` re-anchored anything. Compared before/after; an unresolvable repo or
 * a failed status yields a stable empty string (→ `modified: false`).
 */
function spanStatusSnapshot(repoRoot: string): string {
  const spanRoot = resolveSpanRoot(repoRoot);
  try {
    return execFileSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', spanRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: DEFAULT_TIMEOUT_MS
    });
  } catch {
    return '';
  }
}

/**
 * The production execution surface: three subprocess-backed executors following
 * span-surface.ts's `createDefault*Executor` style. Each captures stdout even on
 * a non-zero exit where the CLI still emits useful output, and every failure
 * mode (absent binary, timeout, parse failure) surfaces as an empty/clean result
 * so {@link runTouchHook}'s fail-open contract holds.
 */
export function createDefaultTouchExecutors(timeoutMs: number = DEFAULT_TIMEOUT_MS): TouchExecutors {
  return {
    fix: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return { modified: false };
      const before = spanStatusSnapshot(resolved.repoRoot);
      try {
        execFileSync('git', ['span', 'stale', resolved.relPath, '--fix'], {
          cwd: resolved.repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
      } catch {
        // `git span stale` exits 1 on drift even when `--fix` healed something,
        // and non-zero on genuine failure; the snapshot diff is the source of
        // truth for whether the tree changed, so the exit code is ignored here.
      }
      const after = spanStatusSnapshot(resolved.repoRoot);
      return { modified: before !== after };
    },

    list: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return [];
      try {
        const out = execFileSync('git', ['span', 'list', '--porcelain', resolved.relPath], {
          cwd: resolved.repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    },

    stale: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      // The core passes an absolute file path; scope `git span stale` to it
      // relative to the repo root so the path index resolves it.
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out: string;
      try {
        out = execFileSync('git', ['span', 'stale', '--format', 'porcelain', ...scoped], {
          cwd: runCwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
      } catch (err) {
        const captured = (err as { stdout?: string }).stdout;
        if (typeof captured === 'string') {
          out = captured;
        } else {
          return [];
        }
      }
      return parseStalePorcelain(out);
    }
  };
}
