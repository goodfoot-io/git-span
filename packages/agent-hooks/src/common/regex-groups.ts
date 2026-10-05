/**
 * Typed access to regular-expression capture groups.
 *
 * Under `noUncheckedIndexedAccess` every `match[n]` reads as
 * `string | undefined`, even for a group the pattern cannot match without.
 * {@link matchGroups} checks the groups a caller relies on once, at the match,
 * and hands back a tuple whose leading entries are plain `string`s — so a
 * pattern change that makes a required group optional degrades to "no match"
 * instead of an `undefined` flowing into the parser.
 */

/**
 * Capture groups 1..`R` (as tuple indices 0..`R - 1`) typed as present,
 * followed by any later groups — optional ones that may not participate.
 */
export type CaptureGroups<R extends number, Present extends string[] = []> = Present['length'] extends R
  ? [...Present, ...(string | undefined)[]]
  : CaptureGroups<R, [...Present, string]>;

function hasRequiredGroups<R extends number>(
  groups: readonly (string | undefined)[],
  required: R
): groups is CaptureGroups<R> {
  for (let index = 0; index < required; index++) {
    if (groups[index] === undefined) return false;
  }
  return true;
}

/**
 * Match `pattern` against `text` and return its capture groups starting at
 * group 1, or `null` when the pattern does not match or any of the first
 * `required` groups did not participate. `pattern` must be non-global and
 * non-sticky: those flags make matching stateful (`lastIndex`), which a
 * one-shot group extraction must never depend on.
 */
export function matchGroups<R extends number>(text: string, pattern: RegExp, required: R): CaptureGroups<R> | null {
  if (pattern.global || pattern.sticky)
    throw new Error(`matchGroups needs a stateless pattern, got /${pattern.source}/${pattern.flags}`);
  const match = pattern.exec(text);
  if (match === null) return null;
  const groups: (string | undefined)[] = match.slice(1);
  return hasRequiredGroups(groups, required) ? groups : null;
}
