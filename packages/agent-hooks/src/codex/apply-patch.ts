/**
 * Codex `apply_patch` envelope parser.
 *
 * Turns a Codex `apply_patch` `tool_input.command` patch string into the
 * `AnchorSpec[]` shape the shared touch core already consumes — the one
 * genuinely new algorithm the Codex adapter needs. It replaces the structured
 * `file_path`/`old_string`/`offset` reading the Claude PostToolUse touch hook
 * does, because Codex delivers every edit as a single apply_patch envelope
 * rather than a typed tool input.
 *
 * The module is pure: it imports only the kernel anchor types and never touches
 * the Codex SDK, so it is DI-testable exactly like the porcelain parsers in the
 * shared kernel. Range recovery is best-effort — the apply_patch format carries
 * `@@` context and `+`/`-`/space change lines but no explicit line numbers, so a
 * range can only be recovered by locating a hunk's pre-edit block in the
 * on-disk file. That file read is injected (`readPreEditFile`) so the function
 * stays pure and testable. On ANY ambiguity (no reader, file missing, context
 * not found, fuzzy/duplicate match) the parser degrades to a whole-file anchor
 * rather than throwing — whole-file anchors are first-class and touch tracking
 * must never be blocked.
 *
 * The grammar is cross-checked against Codex's own apply_patch crate
 * (codex-rs/apply-patch/src/{parser,streaming_parser}.rs). Two subtleties are
 * mirrored deliberately: hunk-header markers are only recognized at the start of
 * a line with no leading whitespace while inside an Update hunk (a leading space
 * demotes a marker to a context line), and a bare empty line inside an Update
 * hunk is treated as an empty context line present in both old and new content.
 */

import * as fs from 'node:fs';
import type { AnchorSpec, LineRange } from '../common/agent-hooks-common.js';

/**
 * An anchor parsed from an apply_patch envelope: an {@link AnchorSpec} plus
 * the delete classification (plan §3). `*** Delete File:` hunks keep the
 * `whole-write` kind (TouchKind is fixed) and add the `absent` marker so the
 * apply_patch call site passes `targetState: 'absent'` — without it the
 * deletion touch would be gated away by the `'exists'` default.
 */
export interface ApplyPatchAnchor extends AnchorSpec {
  /** true for `*** Delete File:` hunks — the touch's targetState is `'absent'`. */
  absent?: boolean;
}

/**
 * Reads the pre-edit (on-disk, before the patch applies) content of the file at
 * `path`, or returns `null` when it cannot be read. Injected so the parser stays
 * pure; call sites default to a real filesystem read.
 */
export type ReadPreEditFile = (path: string) => string | null;

// ---------------------------------------------------------------------------
// Grammar markers (mirrors codex-rs/apply-patch/src/parser.rs)
// ---------------------------------------------------------------------------

const END_PATCH_MARKER = '*** End Patch';
const ADD_FILE_MARKER = '*** Add File: ';
const DELETE_FILE_MARKER = '*** Delete File: ';
const UPDATE_FILE_MARKER = '*** Update File: ';
const MOVE_TO_MARKER = '*** Move to: ';
const EOF_MARKER = '*** End of File';
const CHANGE_CONTEXT_MARKER = '@@ ';
const EMPTY_CHANGE_CONTEXT_MARKER = '@@';

// ---------------------------------------------------------------------------
// Intermediate hunk model
// ---------------------------------------------------------------------------

interface UpdateChunk {
  /** Optional `@@ <context>` line used to disambiguate the block's location. */
  changeContext: string | null;
  /** Pre-edit lines this chunk covers (context ` ` + removed `-`), in order. */
  oldLines: string[];
  /** Post-edit lines (context ` ` + added `+`); retained for completeness. */
  newLines: string[];
}

type Hunk =
  | { kind: 'add'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; movePath: string | null; chunks: UpdateChunk[] };

// ---------------------------------------------------------------------------
// Default reader
// ---------------------------------------------------------------------------

/**
 * Real-filesystem reader used when no reader is injected. Best-effort: any
 * failure (missing file, permission error) yields `null`, which the parser
 * degrades to a whole-file anchor.
 */
export function defaultReadPreEditFile(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Envelope scanning
// ---------------------------------------------------------------------------

/**
 * Scan the patch text into hunks. Lenient by design: unrecognized lines are
 * ignored rather than rejected, and Begin/End/Environment lines are skipped, so
 * a malformed envelope degrades to whatever hunks could be recovered (often
 * none → `[]`) instead of throwing.
 */
function scanHunks(command: string): Hunk[] {
  const hunks: Hunk[] = [];
  // The currently-open Update hunk, or null. Add/Delete hunks have no body, so
  // they close immediately and reset this to null.
  let openUpdate: (Hunk & { kind: 'update' }) | null = null;

  for (const raw of command.split('\n')) {
    // Header detection is whitespace-sensitive inside an Update hunk: Codex uses
    // trim_end there (leading space demotes a marker to a context line) and full
    // trim elsewhere. Match that so indented markers inside a hunk stay content.
    const headerLine: string = openUpdate ? raw.replace(/[ \t\r]+$/, '') : raw.trim();

    if (headerLine === END_PATCH_MARKER) {
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(ADD_FILE_MARKER)) {
      hunks.push({ kind: 'add', path: headerLine.slice(ADD_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(DELETE_FILE_MARKER)) {
      hunks.push({ kind: 'delete', path: headerLine.slice(DELETE_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(UPDATE_FILE_MARKER)) {
      const hunk: Hunk & { kind: 'update' } = {
        kind: 'update',
        path: headerLine.slice(UPDATE_FILE_MARKER.length),
        movePath: null,
        chunks: []
      };
      hunks.push(hunk);
      openUpdate = hunk;
      continue;
    }

    if (openUpdate) {
      processUpdateLine(openUpdate, raw);
    }
    // Any other line outside an Update hunk (Begin Patch, Environment ID, Add
    // File `+` content, stray text) is ignored.
  }

  return hunks;
}

function ensureChunk(hunk: Hunk & { kind: 'update' }): UpdateChunk {
  const last = hunk.chunks[hunk.chunks.length - 1];
  if (last) return last;
  const chunk: UpdateChunk = { changeContext: null, oldLines: [], newLines: [] };
  hunk.chunks.push(chunk);
  return chunk;
}

/** Apply one body line of an Update hunk to its chunk list. */
function processUpdateLine(hunk: Hunk & { kind: 'update' }, raw: string): void {
  const trimmedEnd = raw.replace(/[ \t\r]+$/, '');

  if (trimmedEnd === EOF_MARKER) return; // end-of-file hint; not needed for ranges

  // `*** Move to:` is only meaningful before any change content.
  if (hunk.chunks.length === 0 && hunk.movePath === null && trimmedEnd.startsWith(MOVE_TO_MARKER)) {
    hunk.movePath = trimmedEnd.slice(MOVE_TO_MARKER.length);
    return;
  }

  if (trimmedEnd === EMPTY_CHANGE_CONTEXT_MARKER) {
    hunk.chunks.push({ changeContext: null, oldLines: [], newLines: [] });
    return;
  }
  if (trimmedEnd.startsWith(CHANGE_CONTEXT_MARKER)) {
    hunk.chunks.push({ changeContext: trimmedEnd.slice(CHANGE_CONTEXT_MARKER.length), oldLines: [], newLines: [] });
    return;
  }

  // A bare empty line is an empty context line (present in both old and new).
  if (raw === '') {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push('');
    chunk.newLines.push('');
    return;
  }
  const first = raw[0];
  if (first === ' ') {
    const chunk = ensureChunk(hunk);
    const content = raw.slice(1);
    chunk.oldLines.push(content);
    chunk.newLines.push(content);
    return;
  }
  if (first === '+') {
    const chunk = ensureChunk(hunk);
    chunk.newLines.push(raw.slice(1));
    return;
  }
  if (first === '-') {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push(raw.slice(1));
    return;
  }
  // Unrecognized content line — ignore leniently rather than throw.
}

// ---------------------------------------------------------------------------
// Range recovery
// ---------------------------------------------------------------------------

/** Split file content into lines for matching. A trailing newline yields a
 * trailing empty element, which is harmless for sub-slice matching. */
function splitLines(content: string): string[] {
  return content.split('\n');
}

/** Indices (0-based) at which `value` appears as a full line in `lines`. */
function scanLineIndices(lines: readonly string[], value: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === value) out.push(i);
  }
  return out;
}

/** Start indices (0-based) at which `needle` matches contiguously in `haystack`. */
function scanContiguousMatches(haystack: readonly string[], needle: readonly string[]): number[] {
  const out: number[] = [];
  if (needle.length === 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * Line content → the ascending indices it occupies. A line that occurs once —
 * the overwhelmingly common case in source files — is stored as a bare number
 * so a unique line costs one map slot rather than a one-element array.
 */
type LineOccurrences = Map<string, number | number[]>;

function buildLineOccurrences(lines: readonly string[]): LineOccurrences {
  const occurrences: LineOccurrences = new Map();
  for (let i = 0; i < lines.length; i++) {
    const seen = occurrences.get(lines[i]);
    if (seen === undefined) occurrences.set(lines[i], i);
    else if (typeof seen === 'number') occurrences.set(lines[i], [seen, i]);
    else seen.push(i);
  }
  return occurrences;
}

/**
 * The ascending indices of `value`. The returned array is the index's own
 * storage for a duplicated line — callers read it and never mutate it.
 */
function occurrencesOf(occurrences: LineOccurrences, value: string): number[] {
  const seen = occurrences.get(value);
  if (seen === undefined) return [];
  return typeof seen === 'number' ? [seen] : seen;
}

function indexedContiguousMatches(
  haystack: readonly string[],
  needle: readonly string[],
  occurrences: LineOccurrences
): number[] {
  const out: number[] = [];
  if (needle.length === 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  // The candidate starts are exactly the occurrences of the block's first
  // line: every other position fails at `j === 0` in the scanning form, so
  // testing them is pure waste. The remaining lines still confirm the match.
  for (const start of occurrencesOf(occurrences, needle[0])) {
    if (start > last) break; // occurrences ascend — no later one can fit either
    let ok = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[start + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(start);
  }
  return out;
}

/**
 * The two pre-edit lookups range recovery performs, bound to one file's lines.
 *
 * Both implementations answer identically; they differ only in what they pay
 * up front. {@link preEditLines} picks between them.
 */
interface PreEditLines {
  /** Indices (0-based) at which `value` appears as a full line. */
  lineIndices(value: string): number[];
  /** Start indices (0-based) at which `needle` matches contiguously. */
  contiguousMatches(needle: readonly string[]): number[];
}

/**
 * Choose a lookup strategy for a hunk's `chunkCount` chunks.
 *
 * Every chunk searches the whole file, because a block is only accepted when
 * its match is unique across the file — so recovery cost scales with chunks ×
 * lines, and a many-chunk edit to a large file was the quadratic case.
 * Hashing every line once collapses each later chunk's search to the
 * occurrences of its first line.
 *
 * A single chunk asks each question exactly once, leaving the build nothing to
 * amortize against: hashing every line to answer one lookup costs strictly
 * more than the single linear scan it would replace. So one-chunk hunks — the
 * common shape — keep scanning directly and pay nothing for this.
 */
function preEditLines(lines: readonly string[], chunkCount: number): PreEditLines {
  if (chunkCount <= 1) {
    return {
      lineIndices: (value) => scanLineIndices(lines, value),
      contiguousMatches: (needle) => scanContiguousMatches(lines, needle)
    };
  }
  const occurrences = buildLineOccurrences(lines);
  return {
    lineIndices: (value) => occurrencesOf(occurrences, value),
    contiguousMatches: (needle) => indexedContiguousMatches(lines, needle, occurrences)
  };
}

/**
 * Locate a single chunk's pre-edit block in the file, returning its 1-based
 * line range or null when it cannot be located unambiguously.
 *
 * - Non-empty block: require a unique contiguous match, or — when duplicated —
 *   a `@@` change-context line that selects the occurrence after it.
 * - Empty block (pure insertion): anchor on a unique change-context line if one
 *   is given; otherwise it is unlocatable.
 */
function locateChunk(preLines: PreEditLines, chunk: UpdateChunk): LineRange | null {
  const block = chunk.oldLines;

  if (block.length === 0) {
    const ctx = chunk.changeContext;
    if (ctx !== null && ctx !== '') {
      const ctxIdxs = preLines.lineIndices(ctx);
      if (ctxIdxs.length === 1) {
        const line = ctxIdxs[0] + 1;
        return { start: line, end: line };
      }
    }
    return null;
  }

  const starts = preLines.contiguousMatches(block);
  if (starts.length === 1) {
    const s = starts[0];
    return { start: s + 1, end: s + block.length };
  }
  if (starts.length === 0) return null;

  // Duplicated block: use the change context to select the match after it.
  const ctx = chunk.changeContext;
  if (ctx !== null && ctx !== '') {
    for (const c of preLines.lineIndices(ctx)) {
      const after = starts.find((s) => s >= c);
      if (after !== undefined) {
        return { start: after + 1, end: after + block.length };
      }
    }
  }
  return null; // ambiguous → caller degrades to whole-file
}

/**
 * Recover a single line range spanning all of an update's chunks. Returns null
 * (→ whole-file fallback) if any chunk cannot be located.
 */
function recoverRange(preLines: PreEditLines, chunks: UpdateChunk[]): LineRange | null {
  let union: LineRange | null = null;
  for (const chunk of chunks) {
    const r = locateChunk(preLines, chunk);
    if (r === null) return null;
    union = union === null ? r : { start: Math.min(union.start, r.start), end: Math.max(union.end, r.end) };
  }
  return union;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Codex `apply_patch` command string into an anchor per touched file.
 *
 * - `*** Add File:` → `create` (whole-file)
 * - `*** Delete File:` → `whole-write` with the `absent` marker (whole-file;
 *   the file no longer exists — the touch targets absence, plan §3)
 * - `*** Update File:` → `write` with a recovered line range when the hunk's
 *   pre-edit block can be located via `readPreEditFile`, otherwise `whole-write`.
 *   A renamed update (`*** Move to:`) anchors the destination path as
 *   `whole-write` since pre-edit line numbers cannot be mapped across a rename.
 *
 * Never throws: a malformed or empty patch yields `[]`.
 */
export function parseApplyPatch(
  command: string,
  readPreEditFile: ReadPreEditFile = defaultReadPreEditFile
): ApplyPatchAnchor[] {
  const anchors: ApplyPatchAnchor[] = [];

  for (const hunk of scanHunks(command)) {
    if (hunk.kind === 'add') {
      anchors.push({ path: toPosix(hunk.path), kind: 'create' });
      continue;
    }
    if (hunk.kind === 'delete') {
      anchors.push({ path: toPosix(hunk.path), kind: 'whole-write', absent: true });
      continue;
    }

    // Update: anchor on the destination path (post-edit location).
    const targetPath = toPosix(hunk.movePath ?? hunk.path);

    // A rename defeats pre-edit line mapping — anchor whole-file on the target.
    if (hunk.movePath !== null) {
      anchors.push({ path: targetPath, kind: 'whole-write' });
      continue;
    }

    // Range recovery reads the pre-edit content at the original (pre-move) path.
    const content = readPreEditFile(hunk.path);
    const pre = content === null ? null : preEditLines(splitLines(content), hunk.chunks.length);
    const range = pre === null ? null : recoverRange(pre, hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: 'write', range });
    } else {
      anchors.push({ path: targetPath, kind: 'whole-write' });
    }
  }

  return anchors;
}
