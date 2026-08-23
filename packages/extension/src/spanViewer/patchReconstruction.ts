/**
 * Reverse-apply of the CLI's certified anchor diffs.
 *
 * `git span history` renders every anchor diff with **file-absolute** hunk
 * coordinates (a hunk at snapshot-relative line `k` renders at
 * `first_line + k - 1`), while the content fields carry the anchored **extent
 * only** -- so a consumer cannot trust the hunk header's own line numbers
 * against the content string. `reconstructOriginal` rebases every hunk by
 * subtracting `extentStartLine - 1` (recovering the CLI's snapshot-relative
 * coordinates) and reverse-applies the rebased hunks onto the post-image to
 * recover the pre-image. A rename block's two sides live in two addresses'
 * line spaces, so the old side rebases by `originalExtentStartLine - 1`
 * (defaulting to the new side's rebase) and the new side by
 * `extentStartLine - 1`.
 *
 * Failure contract: throws when a rebased hunk's range does not fit the
 * post-image or its body does not match at the expected offset -- never
 * silently passes the text through unchanged, so "nothing to reconstruct" (a
 * header-only block) and "reconstruction failed" can never alias to the same
 * output. The `/dev/null`-sided hunk shapes are the two honest non-error
 * answers: a full addition (`@@ -0,0 +N,M @@`) has an empty pre-image, and a
 * full deletion (`@@ -N,M +0,0 @@`) has the deleted bytes as its pre-image
 * (carried verbatim by the diff's own old side, never `''` -- an empty
 * recovery would lose the deleted content). The diff dialect this module
 * parses is the CLI's own: hunk headers `@@ -oldStart[,oldCount] +newStart[,newCount] @@`
 * (count 1 renders bare,
 * `/dev/null`-side counts render as `N,0`), body lines prefixed with a single
 * space (context), `-`, or `+`, and `\ No newline at end of file` markers
 * following any body line whose bytes lack a trailing newline.
 *
 * @summary Reverse-applies CLI anchor diffs onto post-image text.
 * @module spanViewer/patchReconstruction
 */

/** Thrown when a diff cannot be reverse-applied onto the given post-image. */
export class ReconstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconstructionError';
  }
}

/** A single parsed body line of a hunk, in emission order. */
interface BodyLine {
  kind: 'context' | 'old' | 'new';
  text: string;
  markedNoNewline: boolean;
}

/** A parsed hunk with its body split into pre-region and post-region lines. */
interface ParsedHunk {
  /** File-absolute coordinates from the header (count 1 when omitted). */
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Body lines in emission order. */
  body: BodyLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/;

/**
 * Split a text into its content lines, discarding the split artifact of a
 * trailing newline and reporting whether the text ended with one.
 *
 * @param text - The text to split.
 * @returns The content lines (without the trailing-newline artifact) and
 *   whether the text ended with a newline.
 */
function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === '') {
    return { lines: [], trailingNewline: false };
  }
  const parts = text.split('\n');
  const trailingNewline = parts[parts.length - 1] === '';
  if (trailingNewline) {
    parts.pop();
  }
  return { lines: parts, trailingNewline };
}

/**
 * Parse a diff string into hunks, validating body counts against headers.
 *
 * @param diff - The CLI's unified diff string.
 * @returns The parsed hunks, in emission order.
 * @throws {ReconstructionError} When a hunk header has no body, a body line
 *   cannot be classified, or the body does not match the header counts.
 */
function parseHunks(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | undefined;
  let sawBody = false;
  let previous: BodyLine | undefined;

  for (const rawLine of diff.split('\n')) {
    const match = HUNK_HEADER.exec(rawLine);
    if (match !== null) {
      if (current !== undefined && !sawBody) {
        throw new ReconstructionError('diff has a hunk header with no body');
      }
      current = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        body: []
      };
      hunks.push(current);
      sawBody = false;
      previous = undefined;
      continue;
    }
    if (current === undefined) {
      continue; // Header region: diff --git, index, ---/+++, marker lines.
    }

    if (rawLine === '') {
      continue; // Trailing artifact of the final '\n' after the last body line.
    }

    const first = rawLine[0];
    if (first === '\\') {
      if (previous === undefined) {
        throw new ReconstructionError('diff contains a "\\ No newline" marker with no preceding body line');
      }
      if (previous.markedNoNewline) {
        throw new ReconstructionError('diff contains a doubled "\\ No newline" marker');
      }
      previous.markedNoNewline = true;
      continue;
    }
    if (first !== ' ' && first !== '-' && first !== '+') {
      throw new ReconstructionError(`unexpected non-body line inside a hunk: ${JSON.stringify(rawLine)}`);
    }

    sawBody = true;
    const line: BodyLine = {
      kind: first === '-' ? 'old' : first === '+' ? 'new' : 'context',
      text: rawLine.slice(1),
      markedNoNewline: false
    };
    current.body.push(line);
    previous = line;
  }

  if (current !== undefined && !sawBody) {
    throw new ReconstructionError('diff ends with a hunk header that has no body');
  }

  for (const hunk of hunks) {
    const oldCount = hunk.body.filter((line) => line.kind !== 'new').length;
    const newCount = hunk.body.filter((line) => line.kind !== 'old').length;
    if (oldCount !== hunk.oldCount || newCount !== hunk.newCount) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ body does not match ` +
          `its header counts (pre-region ${oldCount}/${hunk.oldCount}, post-region ${newCount}/${hunk.newCount})`
      );
    }
  }

  return hunks;
}

/**
 * Recover the pre-image of a diff by reverse-applying its hunks onto
 * `postImageText`.
 *
 * @param diff - The CLI's unified diff with file-absolute hunk coordinates.
 * @param postImageText - The full post-image text (the new side of the diff).
 * @param extentStartLine - The anchor's declared range start (`#Lstart`), or
 *   1 for a whole-file anchor; every hunk is rebased by subtracting
 *   `extentStartLine - 1` before applying.
 * @param originalExtentStartLine - The pre-image side's own range start when
 *   it differs from `extentStartLine` (a rename block's old side lives in the
 *   old address's line space); defaults to `extentStartLine`.
 * @returns The pre-image text -- `''` when the diff is a hunk-level full
 *   addition (`@@ -0,0 +N,M @@`), or the deleted bytes when it is a
 *   hunk-level full deletion (`@@ -N,M +0,0 @@`).
 * @throws {ReconstructionError} When the diff has no hunks, when a rebased
 *   hunk's range does not fit `postImageText`, when hunks overlap or fall out
 *   of order, when body lines do not match the post-image at the expected
 *   offset, or when the diff's line-termination claims contradict
 *   `postImageText`.
 */
export function reconstructOriginal(
  diff: string,
  postImageText: string,
  extentStartLine: number,
  originalExtentStartLine: number = extentStartLine
): string {
  const hunks = parseHunks(diff);
  if (hunks.length === 0) {
    throw new ReconstructionError('diff has no hunks; nothing to reconstruct');
  }
  const firstHunk = hunks[0];
  if (firstHunk !== undefined && firstHunk.oldStart === 0) {
    // `@@ -0,0 +N,M @@`: a full addition -- the old side is /dev/null, so the
    // recovered pre-image is empty, not unknown.
    return '';
  }
  if (firstHunk !== undefined && firstHunk.newStart === 0) {
    // `@@ -N,M +0,0 @@`: a full deletion -- the new side is /dev/null and the
    // deleted bytes are the pre-image. Returning `''` here would lose the
    // deleted content entirely; the diff's own old side carries it verbatim.
    return extractHunkSide(diff, 'old');
  }

  const { lines: postLines, trailingNewline: postTrailingNewline } = splitLines(postImageText);
  const postLen = postLines.length;
  const rebase = extentStartLine - 1;
  const originalRebase = originalExtentStartLine - 1;
  const totalOld = hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0);
  const totalNew = hunks.reduce((sum, hunk) => sum + hunk.newCount, 0);
  const preLen = postLen + totalOld - totalNew;
  if (preLen < 0) {
    throw new ReconstructionError('diff deletes more lines than the post-image contains');
  }

  let previousNewStart = 0;
  let previousOldStart = 0;
  for (const hunk of hunks) {
    const newStart = hunk.newStart - rebase;
    const oldStart = hunk.oldStart - originalRebase;
    if (newStart < 1) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ rebases to ` +
          `new start ${newStart}, before the extent's first line`
      );
    }
    if (oldStart < 1) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ rebases to ` +
          `old start ${oldStart}, before the extent's first line`
      );
    }
    if (hunk.newCount === 0) {
      if (newStart > postLen + 1) {
        throw new ReconstructionError(
          `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ inserts at ` +
            `${newStart}, past the post-image's end (${postLen} lines)`
        );
      }
    } else if (newStart + hunk.newCount - 1 > postLen) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ spans lines ` +
          `${newStart}-${newStart + hunk.newCount - 1} after rebasing, past the post-image's end ` +
          `(${postLen} lines)`
      );
    }
    if (newStart <= previousNewStart) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ overlaps or ` +
          `precedes the previous hunk's new-side range`
      );
    }
    if (oldStart <= previousOldStart) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ overlaps or ` +
          `precedes the previous hunk's old-side range`
      );
    }
    previousNewStart = newStart;
    previousOldStart = oldStart;

    // The post-region (context plus '+' lines) must equal the post-image at
    // the rebased offset -- a shifted or wrong post-image fails closed here.
    let postIndex = 0;
    for (const line of hunk.body) {
      if (line.kind === 'old') {
        continue;
      }
      const expected = postLines[newStart - 1 + postIndex];
      if (expected === undefined || expected !== line.text) {
        throw new ReconstructionError(
          `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ body does not ` +
            `match the post-image at line ${newStart + postIndex}: expected ${JSON.stringify(line.text)}, ` +
            `found ${JSON.stringify(expected)}`
        );
      }
      postIndex++;
    }

    // Line-termination claims. The CLI marks a body line whenever its bytes
    // lack a trailing newline, so a marker names the final line of a side --
    // claims that must agree with the pre-image's length and the post-image's
    // own termination, or the text is not the diff's post-image.
    let preIndex = 0;
    postIndex = 0;
    hunk.body.forEach((line, index) => {
      if (line.markedNoNewline) {
        if (line.kind !== 'new' && oldStart + preIndex !== preLen) {
          throw new ReconstructionError(
            `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ marks line ` +
              `${oldStart + preIndex} as the pre-image's final line, but the pre-image continues past it`
          );
        }
        if (line.kind !== 'old') {
          const atPostEnd = newStart + postIndex === postLen;
          if (line.kind === 'new' && !atPostEnd) {
            throw new ReconstructionError(
              `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ marks a '+' ` +
                `line as the post-image's final line, but the post-image continues past it`
            );
          }
          if (atPostEnd && postTrailingNewline) {
            throw new ReconstructionError(
              `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ marks its final ` +
                `line as having no trailing newline, but the post-image ends with one`
            );
          }
        }
        if (line.kind === 'new' && index !== hunk.body.length - 1) {
          throw new ReconstructionError(
            `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ has body lines ` +
              `after a '+' line marked as the post-image's final line`
          );
        }
      }
      if (line.kind !== 'new') {
        preIndex++;
      }
      if (line.kind !== 'old') {
        postIndex++;
      }
    });
  }

  // The final body line of the final hunk, when it is the post-image's final
  // line too, must agree with the post-image's own termination in both
  // directions (a marker absent where the text lacks a newline is a lie).
  const lastHunk = hunks[hunks.length - 1];
  if (lastHunk !== undefined && lastHunk.body.length > 0) {
    const lastLine = lastHunk.body[lastHunk.body.length - 1];
    if (lastLine !== undefined && lastLine.kind !== 'old') {
      const postIndex = lastHunk.body.slice(0, lastHunk.body.length - 1).filter((line) => line.kind !== 'old').length;
      const newStart = lastHunk.newStart - rebase;
      if (newStart + postIndex === postLen && !lastLine.markedNoNewline && !postTrailingNewline) {
        throw new ReconstructionError(
          `hunk @@ -${lastHunk.oldStart},${lastHunk.oldCount} +${lastHunk.newStart},${lastHunk.newCount} @@ ` +
            `does not mark its final line as missing a trailing newline, but the post-image ends without one`
        );
      }
    }
  }

  // Splice: replace each hunk's post-region with its pre-region, walking
  // forward so untouched spans are carried across unchanged.
  const out: string[] = [];
  let cursor = 0;
  let lastFromPreRegion = false;
  let lastPreLineMarked = false;
  for (const hunk of hunks) {
    const newStart = hunk.newStart - rebase;
    pushSlice(out, postLines, cursor, newStart - 1);
    for (const line of hunk.body) {
      if (line.kind === 'new') {
        continue;
      }
      out.push(line.text);
      lastFromPreRegion = true;
      lastPreLineMarked = line.markedNoNewline;
    }
    cursor = newStart - 1 + hunk.newCount;
  }
  pushSlice(out, postLines, cursor, postLines.length);

  if (out.length === 0) {
    return '';
  }
  const trailingNewline = lastFromPreRegion ? !lastPreLineMarked : postTrailingNewline;
  return out.join('\n') + (trailingNewline ? '\n' : '');
}

/**
 * Append `lines[from, to)` to `out` by iteration, never by spread. Spread
 * pushes (`out.push(...slice)`) throw `RangeError` past V8's argument-count
 * limit -- for whole-file anchors over large files that converted a valid
 * reconstruction into a caught-as-truncation failure. Iterating keeps the
 * splice correct at any size.
 *
 * @param out - The accumulator array the splice builds.
 * @param lines - The image being spliced (post-lines in reverse application,
 *   pre-lines forward).
 * @param from - First index to copy, inclusive.
 * @param to - Last index to copy, exclusive.
 */
function pushSlice(out: string[], lines: readonly string[], from: number, to: number): void {
  for (const line of lines.slice(from, to)) {
    out.push(line);
  }
}

/**
 * Apply a diff FORWARD onto its pre-image: validate that each hunk's
 * pre-region (context plus `-` lines) equals `preImageText` at the rebased
 * offset, then produce the post-image by splicing in the `+` lines. This is
 * {@link reconstructOriginal}'s inverse -- the same dialect, the same
 * file-absolute coordinates, the same fail-closed contract (a shifted or
 * wrong pre-image throws rather than passing text through). It exists to
 * thread a known older snapshot forward through a chain of committed diffs
 * to a newer state.
 *
 * @param diff - The CLI's unified diff with file-absolute hunk coordinates.
 * @param preImageText - The full pre-image text (the old side of the diff).
 * @param extentStartLine - The anchor's declared range start (`#Lstart`) of
 *   the address the new side wears, or 1 for a whole-file anchor; every
 *   hunk's new side rebases by subtracting `extentStartLine - 1` before
 *   applying.
 * @param originalExtentStartLine - The pre-image side's own range start when
 *   it differs from `extentStartLine` (a rename block's old side lives in the
 *   old address's line space); defaults to `extentStartLine`.
 * @returns The post-image text -- `''` when the diff is a hunk-level full
 *   deletion (`@@ -N,M +0,0 @@`), or the added bytes when it is a hunk-level
 *   full addition (`@@ -0,0 +N,M @@`).
 * @throws {ReconstructionError} When the diff has no hunks, when a rebased
 *   hunk's range does not fit `preImageText`, when hunks overlap or fall out
 *   of order, when body lines do not match the pre-image at the expected
 *   offset, or when the diff's line-termination claims contradict
 *   `preImageText`.
 */
export function applyDiffForward(
  diff: string,
  preImageText: string,
  extentStartLine: number,
  originalExtentStartLine: number = extentStartLine
): string {
  const hunks = parseHunks(diff);
  if (hunks.length === 0) {
    throw new ReconstructionError('diff has no hunks; nothing to apply');
  }
  const firstHunk = hunks[0];
  if (firstHunk !== undefined && firstHunk.oldStart === 0) {
    // `@@ -0,0 +N,M @@`: a full addition -- the pre-image is empty and the
    // diff's new side is the complete post-image.
    return extractHunkSide(diff, 'new');
  }
  if (firstHunk !== undefined && firstHunk.newStart === 0) {
    // `@@ -N,M +0,0 @@`: a full deletion -- the new side is /dev/null, so the
    // post-image is empty, not unknown.
    return '';
  }

  const { lines: preLines, trailingNewline: preTrailingNewline } = splitLines(preImageText);
  const preLen = preLines.length;
  const rebase = extentStartLine - 1;
  const originalRebase = originalExtentStartLine - 1;
  const totalOld = hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0);
  const totalNew = hunks.reduce((sum, hunk) => sum + hunk.newCount, 0);
  const postLen = preLen + totalNew - totalOld;
  if (postLen < 0) {
    throw new ReconstructionError('diff deletes more lines than the pre-image contains');
  }

  let previousNewStart = 0;
  let previousOldStart = 0;
  for (const hunk of hunks) {
    const newStart = hunk.newStart - rebase;
    const oldStart = hunk.oldStart - originalRebase;
    if (newStart < 1) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ rebases to ` +
          `new start ${newStart}, before the extent's first line`
      );
    }
    if (oldStart < 1) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ rebases to ` +
          `old start ${oldStart}, before the extent's first line`
      );
    }
    if (hunk.oldCount === 0) {
      if (oldStart > preLen + 1) {
        throw new ReconstructionError(
          `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ inserts at ` +
            `${oldStart}, past the pre-image's end (${preLen} lines)`
        );
      }
    } else if (oldStart + hunk.oldCount - 1 > preLen) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ spans lines ` +
          `${oldStart}-${oldStart + hunk.oldCount - 1} after rebasing, past the pre-image's end ` +
          `(${preLen} lines)`
      );
    }
    if (newStart <= previousNewStart) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ overlaps or ` +
          `precedes the previous hunk's new-side range`
      );
    }
    if (oldStart <= previousOldStart) {
      throw new ReconstructionError(
        `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ overlaps or ` +
          `precedes the previous hunk's old-side range`
      );
    }
    previousNewStart = newStart;
    previousOldStart = oldStart;

    // The pre-region (context plus '-' lines) must equal the pre-image at the
    // rebased offset -- a shifted or wrong pre-image fails closed here.
    let preIndex = 0;
    for (const line of hunk.body) {
      if (line.kind === 'new') {
        continue;
      }
      const expected = preLines[oldStart - 1 + preIndex];
      if (expected === undefined || expected !== line.text) {
        throw new ReconstructionError(
          `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ body does not ` +
            `match the pre-image at line ${oldStart + preIndex}: expected ${JSON.stringify(line.text)}, ` +
            `found ${JSON.stringify(expected)}`
        );
      }
      preIndex++;
    }

    // Line-termination claims, mirrored from reconstructOriginal: a marker
    // names the final line of a side, and claims about the pre-image must
    // agree with the passed text's own termination, or the text is not the
    // diff's pre-image. The first check pins a marked pre-side line to the
    // pre-image's final position; the second (position already settled) pins
    // its newline claim to the pre-image's own termination. Markers on '+'
    // lines speak about the post side, which is this function's output, so
    // they are consumed by the splice's trailing-newline decision below
    // instead of being validated here -- a marked '+' replacing a
    // newline-terminated final line (pre `beta\n` -> post `beta EDITED`
    // without one) is legitimate. A marked '-' line may be followed by '+'
    // lines; any pre-side line after it would extend the pre-image past its
    // claimed end and is already caught by the pre-region match above.
    preIndex = 0;
    hunk.body.forEach((line) => {
      if (line.markedNoNewline) {
        if (line.kind !== 'new' && oldStart + preIndex !== preLen) {
          throw new ReconstructionError(
            `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ marks line ` +
              `${oldStart + preIndex} as the pre-image's final line, but the pre-image continues past it`
          );
        }
        if (line.kind !== 'new' && preTrailingNewline) {
          throw new ReconstructionError(
            `hunk @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ marks its final ` +
              `line as having no trailing newline, but the pre-image ends with one`
          );
        }
      }
      if (line.kind !== 'new') {
        preIndex++;
      }
    });
  }

  // The final body line of the final hunk, when it is the pre-image's final
  // line too, must agree with the pre-image's own termination in both
  // directions (a marker absent where the text lacks a newline is a lie).
  const lastHunk = hunks[hunks.length - 1];
  if (lastHunk !== undefined && lastHunk.body.length > 0) {
    const lastLine = lastHunk.body[lastHunk.body.length - 1];
    if (lastLine !== undefined && lastLine.kind !== 'new') {
      const preIndex = lastHunk.body.slice(0, lastHunk.body.length - 1).filter((line) => line.kind !== 'new').length;
      const oldStart = lastHunk.oldStart - originalRebase;
      if (oldStart + preIndex === preLen && !lastLine.markedNoNewline && !preTrailingNewline) {
        throw new ReconstructionError(
          `hunk @@ -${lastHunk.oldStart},${lastHunk.oldCount} +${lastHunk.newStart},${lastHunk.newCount} @@ ` +
            `does not mark its final line as missing a trailing newline, but the pre-image ends without one`
        );
      }
    }
  }

  // Splice: replace each hunk's pre-region with its post-region, walking
  // forward so untouched spans are carried across unchanged.
  const out: string[] = [];
  let cursor = 0;
  let lastFromPostRegion = false;
  let lastPostLineMarked = false;
  for (const hunk of hunks) {
    const oldStart = hunk.oldStart - originalRebase;
    pushSlice(out, preLines, cursor, oldStart - 1);
    for (const line of hunk.body) {
      if (line.kind === 'old') {
        continue;
      }
      out.push(line.text);
      lastFromPostRegion = true;
      lastPostLineMarked = line.markedNoNewline;
    }
    cursor = oldStart - 1 + hunk.oldCount;
  }
  pushSlice(out, preLines, cursor, preLines.length);

  if (out.length === 0) {
    return '';
  }
  const trailingNewline = lastFromPostRegion ? !lastPostLineMarked : preTrailingNewline;
  return out.join('\n') + (trailingNewline ? '\n' : '');
}

/**
 * True when the diff's new side is `/dev/null` -- a `deleted anchor` block,
 * whose old side is the only real content.
 *
 * @param diff - The CLI's unified diff string.
 * @returns Whether the `+++` header names `/dev/null`.
 */
export function isFullDeletion(diff: string): boolean {
  return /^\+\+\+ \/dev\/null$/m.test(diff);
}

/**
 * True when the diff's old side is `/dev/null` -- a `new anchor` block,
 * whose new side is the only real content.
 *
 * @param diff - The CLI's unified diff string.
 * @returns Whether the `---` header names `/dev/null`.
 */
export function isFullAddition(diff: string): boolean {
  return /^--- \/dev\/null$/m.test(diff);
}

/**
 * True when the diff carries at least one `@@` hunk header.
 *
 * A header-only block (a pure rename, a rebound anchor, an unavailable-side
 * modify) has no hunks, which means its content is either unchanged or
 * unknown -- never a recoverable edit.
 *
 * @param diff - The CLI's unified diff string.
 * @returns Whether the diff carries any hunk.
 */
export function hasHunks(diff: string): boolean {
  return /^@@ /m.test(diff);
}

const RENAME_FROM = /^rename from (.+)$/m;

/**
 * The address a rename block's old side lived at, from its `rename from`
 * header -- the coordinate space that side's hunks are rendered in.
 *
 * @param diff - The CLI's unified diff string.
 * @returns The old address, when the diff is a rename.
 */
export function extractRenameFrom(diff: string): string | undefined {
  return RENAME_FROM.exec(diff)?.[1];
}

/**
 * Extract one side of a diff from its hunk bodies -- the `-` lines for the
 * old side, the `+` lines for the new side. Intended for `/dev/null`-sided
 * diffs (full addition/deletion), whose hunks carry no context lines, so the
 * extracted lines are the complete side.
 *
 * @param diff - The CLI's unified diff string.
 * @param side - Which side to extract.
 * @returns The concatenated lines of that side, with trailing-newline
 *   semantics from the `\ No newline at end of file` markers.
 * @throws {ReconstructionError} When the diff is malformed.
 */
export function extractHunkSide(diff: string, side: 'old' | 'new'): string {
  const hunks = parseHunks(diff);
  const lines: string[] = [];
  let marked = false;
  for (const hunk of hunks) {
    for (const line of hunk.body) {
      if (side === 'old' && line.kind === 'new') {
        continue;
      }
      if (side === 'new' && line.kind === 'old') {
        continue;
      }
      lines.push(line.text);
      if (line.markedNoNewline) {
        marked = true;
      }
    }
  }
  if (lines.length === 0) {
    return '';
  }
  return lines.join('\n') + (marked ? '' : '\n');
}
