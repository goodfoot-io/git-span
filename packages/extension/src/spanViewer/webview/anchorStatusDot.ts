/**
 * Which anchor kinds wear a status dot in their card header, and what that dot
 * says.
 *
 * A `clean` anchor renders no dot at all: freshness is signalled by the
 * dot's *absence*, so there is nothing to label and nothing to lay out. Every
 * other kind wears the drift dot. That makes the presence test a type guard --
 * the label function then cannot be reached with `'clean'`, and the compiler
 * enforces it rather than a comment.
 *
 * Lives in its own module because it is DOM-free and therefore exercisable
 * from the extension host's test runner, which has no DOM. `PostedAnchor` is a
 * discriminated union that will grow; pinning every current member's dot
 * behaviour is what catches a future narrowing that silently drops the dot for
 * a kind nobody thought about.
 *
 * @summary Maps a posted anchor's kind to its status-dot presence and tooltip.
 * @module spanViewer/webview/anchorStatusDot
 */

import type { PostedAnchor } from '../types.js';

/**
 * Every anchor kind that wears a status dot -- that is, all of them except
 * `clean`.
 */
export type DottedAnchorKind = Exclude<PostedAnchor['kind'], 'clean'>;

/**
 * Whether an anchor of this kind renders a status dot.
 *
 * A type guard rather than a plain predicate so the caller narrows before
 * asking for a label, which is what makes {@linkcode statusDotLabel}
 * unreachable for `clean` by construction.
 *
 * @param kind - The posted anchor's kind.
 * @returns True when the kind wears a dot; false for `clean`.
 * @throws Never.
 */
export function hasStatusDot(kind: PostedAnchor['kind']): kind is DottedAnchorKind {
  return kind !== 'clean';
}

/**
 * The status dot's tooltip for a kind that has one.
 *
 * @param kind - The posted anchor's kind, already narrowed to a dotted kind.
 * @returns The tooltip copy for that kind.
 * @throws Never.
 */
export function statusDotLabel(kind: DottedAnchorKind): string {
  switch (kind) {
    case 'drifted':
    case 'reconciled':
      return 'drifted';
    case 'relocated':
      return 'relocated';
    case 'unavailable':
      return 'unavailable';
    case 'changed':
      return 'content changed while this span was being checked';
    case 'dangling':
      return 'no history';
  }
}
