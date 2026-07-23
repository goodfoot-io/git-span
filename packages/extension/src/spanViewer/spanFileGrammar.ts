/**
 * Client-side re-implementation of the `.span/*` on-disk file grammar.
 *
 * Mirrors `SpanFile::parse`/`parse_anchor_address` in
 * `packages/git-span-core/src/span_file.rs` exactly, so "does this parse as a
 * span file" agrees with the CLI's own fail-closed rule. This is what makes
 * the custom editor's text-fallback decision correct-by-construction for
 * non-span content living under `.span/` (logs, docs, dotfiles, ...).
 *
 * @summary Pure parser/formatter for the on-disk `.span/*` grammar.
 * @module spanViewer/spanFileGrammar
 */

export interface ParsedSpanAnchor {
  path: string;
  range: { start: number; end: number } | null;
  algorithm: string;
  contentHash: string;
}

export interface ParsedSpanFile {
  anchors: ParsedSpanAnchor[];
  why: string;
}

const CONFLICT_MARKER_PREFIXES = ['<<<<<<<', '>>>>>>>', '|||||||'];

/**
 * True when `line` is a single Git conflict-marker line, mirroring
 * `is_conflict_marker_line` in `packages/git-span-core/src/span_file.rs`.
 *
 * @param line - A single line of text (no trailing newline).
 * @returns Whether the line is a conflict-marker sentinel.
 * @throws Never.
 */
function isConflictMarkerLine(line: string): boolean {
  if (CONFLICT_MARKER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return true;
  }
  if (line.startsWith('=======')) {
    const rest = line.slice('======='.length);
    return rest.length === 0 || /^\s/.test(rest);
  }
  return false;
}

/**
 * Parse a single anchor address (without its trailing `<algorithm>:<hash>`)
 * into a path and optional line range, mirroring `parse_anchor_address`.
 *
 * @param text - The address portion of an anchor line.
 * @returns The parsed path/range, or `null` when the address is malformed.
 * @throws Never.
 */
function parseAnchorAddress(text: string): { path: string; range: { start: number; end: number } | null } | null {
  const hashSplitIndex = text.indexOf('#L');
  if (hashSplitIndex !== -1) {
    const path = text.slice(0, hashSplitIndex);
    if (path.length === 0) {
      return null;
    }
    const fragment = text.slice(hashSplitIndex + 2);
    const rangeSplitIndex = fragment.indexOf('-L');
    if (rangeSplitIndex === -1) {
      return null;
    }
    const startText = fragment.slice(0, rangeSplitIndex);
    const endText = fragment.slice(rangeSplitIndex + 2);
    if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) {
      return null;
    }
    const start = Number.parseInt(startText, 10);
    const end = Number.parseInt(endText, 10);
    if (start < 1 || end < start) {
      return null;
    }
    return { path: path.replace(/\\/g, '/'), range: { start, end } };
  }

  // A `#` without a following `L` is invalid anchor syntax (e.g. `file.ts#88`).
  if (text.includes('#')) {
    return null;
  }
  if (text.length === 0) {
    return null;
  }
  return { path: text.replace(/\\/g, '/'), range: null };
}

/**
 * Parse a single anchor line of the form `<address> <algorithm>:<hash>`,
 * mirroring `parse_anchor_line`.
 *
 * @param line - A single, already-trimmed anchor line.
 * @returns The parsed anchor, or `null` when the line is malformed.
 * @throws Never.
 */
function parseAnchorLine(line: string): ParsedSpanAnchor | null {
  const spacePos = line.lastIndexOf(' ');
  if (spacePos === -1) {
    return null;
  }
  const address = line.slice(0, spacePos);
  const hashPart = line.slice(spacePos + 1).trim();
  if (address.length === 0 || hashPart.length === 0) {
    return null;
  }

  const colonPos = hashPart.indexOf(':');
  if (colonPos === -1) {
    return null;
  }
  const algorithm = hashPart.slice(0, colonPos);
  const contentHash = hashPart.slice(colonPos + 1);
  if (algorithm.length === 0 || contentHash.length === 0) {
    return null;
  }

  const parsedAddress = parseAnchorAddress(address);
  if (parsedAddress === null) {
    return null;
  }

  return { path: parsedAddress.path, range: parsedAddress.range, algorithm, contentHash };
}

/**
 * Parse a `.span/*` file's raw text into its anchor addresses and why prose.
 *
 * @param text - Raw file contents.
 * @returns The parsed span file, or `null` when the text does not parse as a
 *   span file (malformed grammar, conflict markers, non-span content).
 * @throws Never -- unparseable input yields `null`, not a thrown error.
 */
export function parseSpanFile(text: string): ParsedSpanFile | null {
  const normalized = text.includes('\r') ? text.replace(/\r\n/g, '\n') : text;

  if (normalized.split('\n').some((line) => isConflictMarkerLine(line))) {
    return null;
  }

  let anchorBlock: string;
  let why: string;
  const separatorIndex = normalized.indexOf('\n\n');
  if (separatorIndex !== -1) {
    anchorBlock = normalized.slice(0, separatorIndex);
    why = normalized.slice(separatorIndex + 2);
  } else if (normalized.startsWith('\n')) {
    anchorBlock = '';
    why = normalized.replace(/^\n+/, '');
  } else {
    anchorBlock = normalized;
    why = '';
  }

  const anchors: ParsedSpanAnchor[] = [];
  for (const rawLine of anchorBlock.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const anchor = parseAnchorLine(line);
    if (anchor === null) {
      return null;
    }
    anchors.push(anchor);
  }

  return { anchors, why: why.replace(/\n+$/, '') };
}

/**
 * Format an anchor's address header the same way `AnchorRecord`'s `Display`
 * impl does in `packages/git-span-core/src/format.rs`.
 *
 * @param path - Repository-relative, slash-separated file path.
 * @param range - 1-based inclusive line range, or `null` for a whole-file anchor.
 * @returns The formatted address string.
 * @throws Never.
 */
export function formatAnchorAddress(path: string, range: { start: number; end: number } | null): string {
  if (range === null) {
    return path;
  }
  return `${path}#L${range.start}-L${range.end}`;
}
