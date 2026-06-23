/**
 * Stop hook: reads the per-session touch journal, drives `git mesh stale
 * --porcelain --batch` and `git mesh list --porcelain --batch`, assembles the
 * findings into a self-contained prompt, and dispatches the mesh review to a
 * forked, headless `claude` carrying that prompt — then returns `null` so the
 * stop proceeds.
 *
 * The fork is a configuration-identical copy of the current session
 * (`--resume <id> --fork-session`, nothing else), so it starts from the parent's
 * warm prompt cache and does the review itself. Dispatch is fire-and-forget: the
 * forked process runs independently in the background; the session ends normally.
 * See {@link ForkDispatcher} for the invocation and executable resolution.
 *
 * The `stop_hook_active` guard at the top of the handler short-circuits a
 * re-fired stop (the run that dispatched already marked its entries seen, so a
 * re-fire would assemble nothing anyway — this is the explicit guard).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { type HookContext, type StopInput, stopHook } from '@goodfoot/claude-code-hooks';
import {
  formatAnchor,
  type LineRange,
  parsePorcelain,
  rangesIntersect,
  readSubagentCount,
  resolveRepoRoot,
  sanitizeSessionId,
  type TouchKind
} from './agent-hooks-common.js';
import { createDefaultForkDispatcher, type ForkDispatcher } from './fork-dispatch.js';
import { type HookIgnoreLoader, isMeshSuppressed, loadHookIgnore } from './mesh-ignore.js';

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

/** The set of valid current TouchKind values. Any other string is rejected. */
const VALID_TOUCH_KINDS: ReadonlySet<string> = new Set<string>([
  'read',
  'write',
  'whole-read',
  'whole-write',
  'create'
]);

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
      if (typeof e.path === 'string' && typeof e.kind === 'string' && VALID_TOUCH_KINDS.has(e.kind)) {
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
  const whole = new Set<string>(); // for whole-read/whole-write/create kinds

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
      // whole-read, whole-write, or create
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
export type StaleRenderExecutor = (slugs: string[], cwd: string) => string;

/**
 * Decide whether a stale anchor's drift is *resolved-pending-commit*: its only
 * blocker is that the anchored source file is uncommitted, and the mesh has
 * already been re-anchored and staged. Such drift cannot clear until the source
 * is committed — the one action the resolver is forbidden to take — so
 * re-dispatching the resolver loops forever. Returning `true` drops the row from
 * the stale section, breaking the loop while leaving the staged re-anchor ready
 * to commit alongside its source.
 */
export type PendingCommitProbe = (repoRoot: string, slug: string, anchorPath: string) => boolean;

function gitDirty(repoRoot: string, args: string[]): boolean {
  // `git diff --quiet …` exits 0 when there is no diff and 1 when there is.
  // execFileSync throws on non-zero exit, so a thrown error means "dirty".
  try {
    execFileSync('git', ['-C', repoRoot, ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    return false;
  } catch (err) {
    const status = (err as { status?: number }).status;
    // Exit 1 is the expected "has diff" signal. Any other failure (e.g. git not
    // found, not a repo) is not a reliable "dirty" answer.
    return status === 1;
  }
}

/**
 * Default probe: a row is resolved-pending-commit when its anchored source file
 * differs from HEAD (an uncommitted edit) AND the mesh file `.mesh/<slug>` has a
 * staged change (the resolver has already re-anchored). When git cannot answer,
 * returns `false` so the hook falls back to surfacing the drift rather than
 * silently hiding it.
 */
export function createDefaultPendingCommitProbe(): PendingCommitProbe {
  return (repoRoot, slug, anchorPath) => {
    const sourceUncommitted = gitDirty(repoRoot, ['diff', '--quiet', 'HEAD', '--', anchorPath]);
    if (!sourceUncommitted) return false;
    const meshPath = `.mesh/${slug}`;
    const meshReanchorStaged = gitDirty(repoRoot, ['diff', '--cached', '--quiet', '--', meshPath]);
    return meshReanchorStaged;
  };
}

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

/**
 * Render the full `git mesh stale` text for the given mesh slugs — every anchor,
 * a drift reason on the changed ones, and the why, exactly as the CLI prints it.
 * `git mesh stale` exits non-zero when drift exists (the common case here), so
 * the render arrives on the thrown error's stdout; capture it rather than fail.
 */
export function createDefaultStaleRenderExecutor(timeoutMs = 10_000): StaleRenderExecutor {
  return (slugs, cwd) => {
    try {
      return execFileSync('git', ['mesh', 'stale', ...slugs], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs
      });
    } catch (err) {
      const out = (err as { stdout?: string }).stdout;
      if (typeof out === 'string' && out.length > 0) return out;
      throw err;
    }
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
// Main handler factory
// ---------------------------------------------------------------------------

export interface StopHandlerDeps {
  staleExecutor: StaleExecutor;
  listBatchExecutor: ListBatchExecutor;
  listRenderExecutor: ListRenderExecutor;
  staleRenderExecutor?: StaleRenderExecutor;
  pendingCommitProbe?: PendingCommitProbe;
  loadRules?: HookIgnoreLoader;
  forkDispatcher?: ForkDispatcher;
}

export function createStopHandler(deps: StopHandlerDeps) {
  const { staleExecutor, listBatchExecutor, listRenderExecutor } = deps;
  const staleRenderExecutor = deps.staleRenderExecutor ?? createDefaultStaleRenderExecutor();
  const pendingCommitProbe = deps.pendingCommitProbe ?? createDefaultPendingCommitProbe();
  const loadRules = deps.loadRules ?? loadHookIgnore;
  const forkDispatcher = deps.forkDispatcher ?? createDefaultForkDispatcher();

  return (input: StopInput, ctx: HookContext) => {
    const sessionId = input.session_id;
    // The path to this session's transcript, surfaced in the status doc so the
    // resolver can consult the conversation to understand a coupling the anchored
    // bytes alone don't reveal.
    const transcriptPath = (input as unknown as Record<string, unknown>).transcript_path;

    // Step 0: Break the stop loop. We surface the review by returning
    // `decision: 'block'`, which forces the agent to keep going. When the agent
    // then tries to stop again this hook re-fires with `stop_hook_active = true`;
    // allow that stop outright. (Reported entries are also marked seen below, so
    // a re-fire would assemble no sections anyway — this is the explicit guard.)
    const stopHookActive = (input as unknown as Record<string, unknown>).stop_hook_active;
    if (stopHookActive === true) return null;

    // Step 0.5: Suppress dispatch while subagents are in flight. The journal may
    // still be changing under them, so this is not a "ready to document" moment.
    // Read failure suppresses too — fail-closed, like every other error path here.
    let activeSubagents: number;
    try {
      activeSubagents = readSubagentCount(sessionId);
    } catch {
      return null;
    }
    if (activeSubagents > 0) return null;

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

    // Path-scoped suppression rules (.mesh/.hookignore): hold back mesh slug
    // prefixes for anchors under given paths, so neither the stale nor the
    // related section surfaces a mesh the repo asked to hide for that path.
    const ignoreRules = loadRules(finalRepoRoot);

    // Step 3: Build TOUCHED_ANCHORS from write-kind entries not yet reported.
    // `seen` means "already surfaced in a status doc this session." Every entry
    // processed by a dispatching run is marked seen in Step 6 and excluded here,
    // so a later Stop with no new touches assembles no sections and dispatches
    // nothing. Only written anchors (write, create, whole-write) feed the stale
    // pass — reads (read, whole-read) do not cause drift and must not wake a
    // resolver. The whole unreported batch (reads included) is still marked seen
    // in Step 6: reads now feed no section, but marking them seen prevents a
    // later Stop from re-examining them and dispatching on drift they didn't cause.
    const unreportedEntries = entries.filter((e) => !e.seen);
    const isWriteKind = (kind: TouchKind): boolean => kind === 'write' || kind === 'create' || kind === 'whole-write';
    const anchorSpecs = buildAnchorSpecs(unreportedEntries.filter((e) => isWriteKind(e.kind)));
    if (anchorSpecs.length === 0) {
      // Read-only session: no writes to check. Mark all unreported entries seen so
      // a later Stop does not re-examine them, then exit silently.
      for (const e of unreportedEntries) {
        e.seen = true;
      }
      writeJournal(sessionId, entries, ctx.logger);
      return null;
    }
    const touchedFilterText = anchorSpecsToFilterText(anchorSpecs);

    // Step 4: Stale pass. The porcelain rows detect which touched anchors have
    // drifted; the section then renders each affected mesh in full via
    // `git mesh stale <slugs>` — every anchor, the drift reason on the changed
    // ones, and the why, exactly as the CLI prints it. Detection is scoped to the
    // touched anchors; rendering shows the whole mesh so the resolver sees the
    // complete coupling, not just the file it happened to edit.
    let staleSection = '';
    let stalePorcelain: string;
    try {
      stalePorcelain = staleExecutor(touchedFilterText, finalRepoRoot);
    } catch (err) {
      ctx.logger.warn('git mesh stale --porcelain --batch failed', { err });
      stalePorcelain = '';
    }

    if (stalePorcelain.trim()) {
      // Drop suppressed meshes outright — hidden drift is not surfaced.
      const staleRows = parsePorcelain(stalePorcelain).filter(
        (row) => !isMeshSuppressed(ignoreRules, row.path, row.name)
      );
      // Drop rows whose drift is resolved-pending-commit: an uncommitted source
      // edit whose re-anchor is already staged. Surfacing those re-dispatches a
      // resolver that cannot clear them (it may not commit the source), so the
      // block would re-fire on every Stop. The remaining rows are genuine drift
      // the resolver can act on.
      const actionableRows = staleRows.filter((row) => !pendingCommitProbe(finalRepoRoot, row.name, row.path));
      const staleSlugs = [...new Set(actionableRows.map((row) => row.name))];
      if (staleSlugs.length > 0) {
        try {
          const rendered = staleRenderExecutor(staleSlugs, finalRepoRoot);
          const blocks = splitMeshBlocks(rendered, staleSlugs.length).filter(Boolean);
          staleSection = blocks.join('\n\n---\n\n');
        } catch (err) {
          ctx.logger.warn('git mesh stale (render) failed', { err });
        }
      }
    }

    // Step 5: Write-coverage pass — all unreported write/create entries. A write
    // that also overlaps a drifted anchor still appears here (covered → related,
    // otherwise uncovered); section placement is independent of the stale pass.
    const unseenWriteEntries = unreportedEntries.filter((e) => e.kind === 'write' || e.kind === 'create');

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

      // Suppressed meshes still count toward coverage above — a write they
      // cover must not be miscounted as uncovered — but are excluded from the
      // related render so the hidden mesh is never surfaced.
      const relatedSlugs = [
        ...new Set(listRows.filter((r) => !isMeshSuppressed(ignoreRules, r.path, r.name)).map((r) => r.name))
      ];

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

    // Step 6: Decide which sections to surface.
    const hasStale = staleSection.length > 0;
    // A lone uncovered write with no related mesh to absorb it is noise: a single
    // file forms no coherent subsystem on its own and there is no existing mesh to
    // extend, so waking the resolver for it has nothing to act on. Count distinct
    // file paths (ranges stripped) — multiple ranged anchors on one file are still
    // one file — and suppress the section when exactly one file is uncovered and no
    // related mesh was found.
    const uncoveredPaths = new Set(uncoveredLines.map((l) => parseFilterLine(l).path));
    const hasUncovered = uncoveredLines.length > 0 && !(uncoveredPaths.size === 1 && relatedRenders.length === 0);
    // Related meshes are surfaced only as supporting context for absorbing an
    // uncovered write — the one task they drive (see buildForkPrompt). With no
    // uncovered write there is nothing to absorb, so surfacing them would dispatch
    // a resolver with a vacuous task. Gate on hasUncovered.
    const hasRelated = hasUncovered && relatedRenders.length > 0;

    // Nothing actionable → allow the stop silently.
    if (!hasStale && !hasUncovered) return null;

    // Mark every entry processed by this dispatching run seen, so a later Stop
    // with no new touches assembles no sections and dispatches nothing. We mark
    // the whole batch — not only the entries that fed a section — because a
    // touch can surface stale anchors on its file without itself being featured,
    // and leaving it unmarked would re-dispatch indefinitely.
    for (const e of unreportedEntries) {
      e.seen = true;
    }

    // Step 7: Rewrite journal with updated seen flags.
    writeJournal(sessionId, entries, ctx.logger);

    // Step 8: Dispatch the review to a forked, headless `claude` and allow the
    // stop. The findings are embedded directly in the prompt — no temp file — so
    // the fork acts on them without an extra read. The fork is a
    // configuration-identical copy of this session, so it resumes from the warm
    // prompt cache and performs the work itself. Dispatch is fire-and-forget; a
    // failure to launch is logged (fail-closed: no dispatch rather than a wrong
    // one) and the stop still proceeds. Entries are already marked seen above, so
    // a later stop assembles nothing and re-runs no dispatch.
    const prompt = buildForkPrompt({
      staleSection: hasStale ? staleSection : null,
      uncoveredLines: hasUncovered ? uncoveredLines : null,
      relatedRenders: hasRelated ? relatedRenders : null,
      transcriptPath: typeof transcriptPath === 'string' && transcriptPath.length > 0 ? transcriptPath : null
    });
    try {
      forkDispatcher({ sessionId, repoRoot: finalRepoRoot, prompt });
    } catch (err) {
      ctx.logger.warn('failed to dispatch git-mesh review fork', { err });
    }
    return null;
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
// Fork prompt
// ---------------------------------------------------------------------------

/**
 * The findings to embed in the fork prompt. Each field is null/empty when its
 * section is absent, so the prompt names only the work actually present.
 */
interface ReviewContent {
  /** Rendered `git mesh stale <slugs>` output for the drifted meshes. */
  staleSection: string | null;
  /** Anchor filter lines for writes no mesh covers. */
  uncoveredLines: string[] | null;
  /** Rendered `git mesh list <slugs>` output for meshes near the uncovered writes. */
  relatedRenders: string[] | null;
  /** Path to this session's transcript, for consulting the coupling's intent. */
  transcriptPath: string | null;
}

/**
 * Build the self-contained prompt for the forked session. The findings are
 * embedded inline (no temp file) and each present section carries the action to
 * take on it — reconcile the stale meshes, create meshes for the uncovered
 * writes, extend/prune the related ones. The fork runs as the (forked) main
 * agent, not a dedicated expert, so the prompt also points it at the git-mesh
 * handbook for command mechanics and echoes the commit boundary inline — never
 * touch source, and commit a mesh only once every file it anchors is already
 * committed — because mistaking it commits files the resolver must never touch.
 */
function buildForkPrompt(content: ReviewContent): string {
  const parts: string[] = [
    'A working session just ended. Reconcile git-mesh coverage for the changes it made, acting directly rather than proposing. Use the git-mesh handbook for command mechanics.'
  ];

  if (content.staleSection) {
    parts.push(
      `# Stale meshes — reconcile each\nTheir anchored source changed this session. For each mesh below: re-anchor it to where the lines moved if the coupling still holds; reshape the slug or rewrite the why if the subsystem changed; or retire the mesh if the coupling no longer holds.\n\n${content.staleSection}`
    );
  }

  if (content.uncoveredLines && content.uncoveredLines.length > 0) {
    parts.push(
      `# Uncovered writes — create a mesh where they form a subsystem\nNo mesh covers these anchors. Where two or more form a coherent subsystem (a flow or concern that spans them), create one: \`git mesh add <slug> <anchors>\` then \`git mesh why <slug> -m "<what it does across the anchors>"\`. Leave a lone file that forms no subsystem alone.\n\n${content.uncoveredLines.map((l) => `- ${l}`).join('\n')}`
    );
  }

  if (content.relatedRenders && content.relatedRenders.length > 0) {
    parts.push(
      `# Related meshes — extend or prune\nThese existing meshes sit near the uncovered writes. Absorb an uncovered write into one, prune an anchor that no longer holds, or refactor — whichever fits.\n\n${content.relatedRenders.join('\n\n---\n\n')}`
    );
  }

  if (content.transcriptPath) {
    parts.push(
      `# Transcript\nThe conversation that produced these changes: ${content.transcriptPath}\nConsult it (grep the touched paths, don't read it wholesale) only when the anchored bytes alone don't reveal why two sites move together. The why you write must read as a standing definition of the current bytes, not the change's intent.`
    );
  }

  parts.push(
    `# Commit boundary\nNever stage or commit source files. Commit a mesh's edit only once every file it anchors is already committed; if any anchor file is still uncommitted, leave that mesh staged and say so.`
  );

  parts.push('Work in the background and do not report unless something needs human intervention.');

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default stopHook(
  { timeout: 30_000 },
  createStopHandler({
    staleExecutor: createDefaultStaleExecutor(),
    listBatchExecutor: createDefaultListBatchExecutor(),
    listRenderExecutor: createDefaultListRenderExecutor(),
    staleRenderExecutor: createDefaultStaleRenderExecutor()
  })
);
