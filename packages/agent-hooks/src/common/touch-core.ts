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
 * `PorcelainStatus`/`DriftPorcelainRow`/`PorcelainRow`/`parsePorcelain`/
 * `parseDriftPorcelain` (agent-hooks-common.ts), `rangesIntersect` and the
 * repo/span-root path utilities (agent-hooks-common.ts), and the `MemoStore`
 * cadence store (span-surface.ts).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { basename } from 'node:path';
import {
  type DriftPorcelainRow,
  humanStatusLabel,
  isDebt,
  type LineRange,
  type PorcelainRow,
  type PorcelainStatus,
  parseDriftPorcelain,
  parsePorcelain,
  rangesIntersect,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot
} from './agent-hooks-common.js';
import { collapseByPath, type RangeLabel, renderAnchorTree } from './anchor-tree.js';
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
  /**
   * 1-based starting line of the read, from the Claude `Read` tool's `offset`
   * input. `undefined` when the read had no `offset` (reads from line 1).
   */
  offset?: number;
  /**
   * Line count of the read, from the Claude `Read` tool's `limit` input.
   * `undefined` when the read had no `limit` — see {@link DEFAULT_READ_LIMIT}
   * for how the range is computed in that case.
   */
  limit?: number;
}

/** A write touch (Claude `Edit`/`Write`, Codex `apply_patch`, or a translated Bash write span). */
export interface TouchWriteInput extends TouchInputBase {
  kind: 'write';
  /**
   * The content just written to `filePath`, fed to {@link recoverRange} to
   * re-anchor the touched region against the healed on-disk file. For a
   * whole-file create this is the entire file body; an empty string means
   * "no locatable block" and the touch is scoped file-wide.
   */
  written: string;
  /**
   * Exact post-edit range when statically known (sed -i numeric addresses,
   * patch hunk unions); bypasses {@link recoverRangeFromDisk} (plan §3
   * step 3).
   */
  range?: LineRange;
  /**
   * The file's expected post-command state; the write path gates on it before
   * invoking any executor (plan §3 step 1). Absent means `'exists'` — the
   * Edit/Write and apply_patch paths' default.
   */
  targetState?: 'exists' | 'absent';
  /**
   * Statically knowable expected post-content, verified before any executor
   * call (plan §3 step 1b). `content` compares the on-disk state after the
   * command ran; `realDelete` is delete-only — the path must also be
   * index-tracked or spanned (probes cached per command).
   */
  postState?: {
    /** `exact`: file bytes equal; `suffix`: file content ends with it; `empty`: zero bytes; `size`: byte count. */
    content?: { exact: string } | { suffix: string } | { empty: true } | { size: number };
    /** delete-only: the path must also be index-tracked or spanned (probes cached per command). */
    realDelete?: boolean;
  };
}

/** The harness-agnostic touch the core consumes. */
export type TouchInput = TouchReadInput | TouchWriteInput;

// ---------------------------------------------------------------------------
// Injected executors
// ---------------------------------------------------------------------------

/** Structured result of a scoped `git span drift <file> --fix`. */
export interface TouchFixResult {
  /**
   * Whether `--fix` re-anchored at least one span in the working tree. Drives
   * {@link TouchOutput.treeModified} so a caller/test can assert the healing
   * happened without diffing the tree itself.
   */
  modified: boolean;
}

/**
 * Run `git span drift <file> --fix` scoped to the touched file (write path
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
 * Run `git span drift --format porcelain <args>` (scoped to the touched file or
 * its spans) and return its parsed rows — one per drifted anchor, empty when
 * clean. Status classification is via `isDebt()`; positional (`MOVED`,
 * `RESOLVED_PENDING_COMMIT`) rows are never debt.
 */
export type TouchDriftExecutor = (args: string[], cwd: string) => Promise<DriftPorcelainRow[]>;

/**
 * Run bare `git span why <name>` and return the span's recorded why sentence,
 * or `null` when none is recorded or the read fails. Feeds the human-format
 * span render; invoked only for spans actually being surfaced this touch.
 */
export type TouchWhyExecutor = (name: string, cwd: string) => Promise<string | null>;

/**
 * The injected execution surface. Kept as four narrow async functions (rather
 * than a raw command runner) so tests inject fakes returning structured data
 * and the core never spawns a subprocess itself. The `read` path never invokes
 * `fix`.
 */
export interface TouchExecutors {
  fix: TouchFixExecutor;
  list: TouchListExecutor;
  drift: TouchDriftExecutor;
  why: TouchWhyExecutor;
}

// ---------------------------------------------------------------------------
// Touch output
// ---------------------------------------------------------------------------

/** What the core hands back for the adapter to translate into SDK output. */
export interface TouchOutput {
  /**
   * The merged `<git-span>` block (header, one human-format section per
   * surfaced span, footer) to inject via the harness's `additionalContext`,
   * or `null` when there is nothing worth surfacing this touch.
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

/** The memo key under which a span's render for a given drift status is deduped. */
function driftKey(name: string, status: PorcelainStatus): string {
  // Span names come from tab-delimited porcelain, so they never contain a tab;
  // a tab-joined key can never collide with a bare span name (the surfacing key).
  return `${name}\t${status}`;
}

/** The `path#Lstart-Lend` (or bare-path, whole-file) anchor text for a row. */
function anchorText(row: PorcelainRow): string {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}

function cleanHeader(fileName: string): string {
  return `${fileName} has implicit dependencies:`;
}

function cleanFooter(fileName: string): string {
  return `If you change ${fileName} check the other files to confirm they still work together.`;
}

/**
 * The write path names the edit as the cause; the read path only surfaces
 * pre-existing drift it didn't create, so it names the dependency instead.
 */
function driftHeader(driftedCount: number, kind: TouchInput['kind']): string {
  if (kind === 'write') {
    return driftedCount === 1
      ? 'This edit put an implicit dependency out of date:'
      : 'This edit put implicit dependencies out of date:';
  }
  return driftedCount === 1
    ? 'This file has an implicit dependency out of date:'
    : 'This file has implicit dependencies out of date:';
}

function driftFooter(driftedNames: string[]): string {
  if (driftedNames.length === 1) {
    const name = driftedNames[0];
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, remove its old anchor before adding the new one. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return 'For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, remove its old anchor before adding the new one. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.';
}

/** The {@link RangeLabel} for a porcelain row — `0-0` is the whole-file anchor. */
function rangeLabel(row: PorcelainRow): RangeLabel {
  if (row.start === 0 && row.end === 0) return { kind: 'whole-file' };
  return { kind: 'range', start: row.start, end: row.end };
}

/**
 * A span's full anchor list, rendered as a shared-prefix tree by
 * {@link renderAnchorTree}, with each anchor that carries genuine drift
 * suffixed by its lowercase status token(s) (` — changed`).
 *
 * A drift row matches an anchor by exact path+range, or by path alone when the
 * span has a single anchor on that path (ranges can disagree after a heal).
 * `soleOnPath` is deliberately computed over the **full flat anchor list**,
 * before any grouping — the tree layout must never be able to change *which*
 * anchors get labeled, only where they sit on the page.
 */
function anchorBullets(anchors: PorcelainRow[], debtRows: DriftPorcelainRow[]): string[] {
  const rows = anchors.map((anchor) => {
    const soleOnPath = anchors.filter((a) => a.path === anchor.path).length === 1;
    const statuses = new Set<PorcelainStatus>();
    for (const row of debtRows) {
      if (row.path !== anchor.path) continue;
      if (soleOnPath || (row.start === anchor.start && row.end === anchor.end)) {
        statuses.add(row.status);
      }
    }
    const sorted = [...statuses].sort();
    const suffix = sorted.length > 0 ? ` — ${sorted.map(humanStatusLabel).join(', ')}` : '';
    return { path: anchor.path, range: rangeLabel(anchor), suffix };
  });
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    // FAIL-CLOSED, not a `<greenfield>`-forbidden fallback — do not remove it
    // on the theory that a degraded fallback is itself forbidden. An uncaught
    // throw here does not degrade to a flat list: it escapes to
    // `runTouchHook`'s catch, which resolves the whole hook to
    // `additionalContext: null`, so the agent is never told about the drift at
    // all. Catching locally narrows what a rendering defect can cost from "the
    // reminder disappears" to "the reminder looks like it did before the tree".
    // Whether to surface and what shape to surface in are different things, and
    // this catch only ever touches the latter.
    // `rows` is index-aligned with `anchors`, so this reproduces today's flat
    // bullet run byte for byte, suffixes included.
    return anchors.map((anchor, i) => `- ${anchorText(anchor)}${rows[i].suffix}`);
  }
}

/**
 * One human-format span section: `## <name>`, the full anchor list (drifted
 * anchors status-suffixed), and the why sentence when one is recorded.
 *
 * The name header and the why sentence are the same shape `git span list`
 * renders; the anchor list deliberately is not — it renders as a shared-prefix
 * tree ({@link anchorBullets}) where the CLI prints a flat `- path#Lrange`
 * bullet run. The CLI's own text format is untouched; only this hook's
 * re-presentation of it groups.
 */
function renderSpanSection(
  name: string,
  anchors: PorcelainRow[],
  debtRows: DriftPorcelainRow[],
  why: string | null
): string {
  const lines = [`## ${name}`, ...anchorBullets(anchors, debtRows)];
  if (why) lines.push('', why);
  return lines.join('\n');
}

/**
 * Assemble the merged `<git-span>` block: header, one section per surfaced
 * span (separated by `---`), and a single footer after a final `---`.
 */
function buildBlock(sections: string[], header: string, footer: string): string {
  const body = `${header}\n\n${sections.join('\n\n---\n\n')}\n\n---\n\n${footer}`;
  return `\n<git-span>\n${body}\n</git-span>\n`;
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
 * The Claude `Read` tool's documented default line count when `offset` is
 * given without `limit` ("By default, it reads up to 2000 lines"). Named so
 * the assumption is visible and easy to update if that default ever changes.
 */
export const DEFAULT_READ_LIMIT = 2000;

/**
 * Compute the touched range for a read from the Claude `Read` tool's
 * `offset`/`limit` inputs. Neither present means a genuine whole-file read —
 * every covering span stays in scope, matching today's behavior. Otherwise
 * the range starts at `offset` (default line 1) and runs for `limit` lines
 * (default {@link DEFAULT_READ_LIMIT}), clamped to the file's actual line
 * count so a short file with a large `offset`/`limit` doesn't overshoot.
 * Clamping requires reading the file; an unreadable file degrades to
 * `'whole-file'` — the same fail-open behavior the write path uses.
 */
function recoverReadRange(
  offset: number | undefined,
  limit: number | undefined,
  filePath: string
): LineRange | 'whole-file' {
  if (offset === undefined && limit === undefined) return 'whole-file';
  const start = offset ?? 1;
  let lineCount: number;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    lineCount = content.length === 0 ? 0 : content.split('\n').length;
  } catch {
    return 'whole-file';
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount, start));
  return { start, end };
}

/**
 * Whether a covering row is an anchor in the touched file itself. `list
 * --porcelain <file>` returns every anchor of each matching span — cross-file
 * anchors included — but only anchors in the touched file participate in the
 * range-intersection scope test. Row paths are repo-relative; the touched path
 * is absolute, so match on an exact or `/`-separated suffix.
 */
function onTouchedFile(row: PorcelainRow, filePath: string): boolean {
  return filePath === row.path || filePath.endsWith(`/${row.path}`);
}

/**
 * Compute the merged `<git-span>` block for the touch, or `null` when there is
 * nothing worth surfacing. Shared by both paths; the write path passes a
 * recovered range for precision, the read path scopes file-wide.
 *
 * A span renders as a full human-format section (name, all anchors with
 * drifted ones status-suffixed, why) when its name has not been surfaced this
 * session, or when it carries a drift status not yet surfaced for it — so a
 * span first seen healthy re-renders in full when drift later appears. A span
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
  if (covering.length === 0) return null;

  // Group every anchor by span; a span is in scope when one of its anchors on
  // the touched file intersects the recovered range.
  const anchorsByName = new Map<string, PorcelainRow[]>();
  for (const row of covering) {
    const rows = anchorsByName.get(row.name) ?? [];
    rows.push(row);
    anchorsByName.set(row.name, rows);
  }
  const touchedNames = [...anchorsByName.keys()].filter((name) =>
    (anchorsByName.get(name) ?? []).some((row) => onTouchedFile(row, input.filePath) && intersects(row, range))
  );
  if (touchedNames.length === 0) return null;

  const driftRows = await executors.drift([input.filePath], input.cwd);
  const driftByName = new Map<string, DriftPorcelainRow[]>();
  for (const row of driftRows) {
    const rows = driftByName.get(row.name) ?? [];
    rows.push(row);
    driftByName.set(row.name, rows);
  }

  const surfaced = memo.getSurfaced(input.sessionId);
  const toRecord: string[] = [];
  const sections: string[] = [];
  const driftedNames: string[] = [];

  for (const name of touchedNames) {
    const spanDrift = driftByName.get(name) ?? [];
    const debtRows = spanDrift.filter((row) => isDebt(row.status));
    if (spanDrift.length > 0 && debtRows.length === 0) continue; // positional-only drift never surfaces

    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(name, status)));
    const isNewName = !surfaced.has(name);
    if (!isNewName && unsurfacedDebt.length === 0) continue; // fully surfaced already

    const why = await executors.why(name, input.cwd);
    sections.push(renderSpanSection(name, anchorsByName.get(name) ?? [], debtRows, why));
    if (debtStatuses.length > 0) driftedNames.push(name);

    if (isNewName) toRecord.push(name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(name, status));
  }

  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord);
  const fileName = basename(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}

/**
 * Run the touch hook for a single tool call, branching on {@link TouchInput.kind}.
 *
 * - **Write path**: run `executors.fix` (`git span drift <file> --fix`) scoped
 *   to the touched file to heal positional drift in the working tree, then
 *   compute the merged `<git-span>` block against the healed anchors, rendering
 *   each surfaced span as a full human-format section with any remaining
 *   semantic drift status-suffixed on its anchors. Cadence is deduped through
 *   `memo` per span name and per (span, status).
 * - **Read path**: never invokes `fix` and never mutates the tree; surfaces the
 *   spans overlapping the read's `offset`/`limit` window (see
 *   {@link recoverReadRange}; a read with neither is whole-file, matching
 *   today's behavior) with positional statuses filtered out via `isDebt()`.
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
      // Phase 1 gate stub (plan §3 step 1): evaluateWriteGate is Phase 3
      // work. Until the post-state gate exists, an 'absent' target cannot be
      // verified and fails closed — no executor call for a deletion that may
      // not have happened.
      if (input.targetState === 'absent') return { additionalContext: null, treeModified: false };
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = input.range ?? recoverRangeFromDisk(input.written, input.filePath);
    } else {
      range = recoverReadRange(input.offset, input.limit, input.filePath);
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
        execFileSync('git', ['span', 'drift', resolved.relPath, '--fix'], {
          cwd: resolved.repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
      } catch {
        // `git span drift` exits 1 on drift even when `--fix` healed something,
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

    drift: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      // The core passes an absolute file path; scope `git span drift` to it
      // relative to the repo root so the path index resolves it.
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out: string;
      try {
        out = execFileSync('git', ['span', 'drift', '--format', 'porcelain', ...scoped], {
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
      return parseDriftPorcelain(out);
    },

    why: async (name, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      try {
        const out = execFileSync('git', ['span', 'why', name], {
          cwd: repoRoot ?? cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs
        });
        const text = out.trimEnd();
        // Bare `git span why` prints this exact sentinel (exit 0) when the
        // span has no why recorded — treat it as "no why", not as content.
        if (text.length === 0 || text === `\`${name}\` has no why recorded.`) return null;
        return text;
      } catch {
        return null;
      }
    }
  };
}
